// The relay's room logic, as plain TypeScript (no Cloudflare APIs), so it's
// tested in Node like the sim. server/room-do.ts is the thin Durable Object
// wrapper that feeds it WebSocket events and a 60 Hz clock.
//
// Events in (connect, disconnect, receive, advance), messages out.

import { encodeInput } from "../sim/inputCodec";
import { NO_INPUT } from "../sim/types";
import {
  MAX_INPUT_LEAD,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  cleanName,
  parseClientMsg,
  type MatchSetup,
  type RosterEntry,
  type ServerMsg,
} from "./protocol";

/** A message to send: to one connection, or to everyone. `close` = then disconnect them. */
export interface Outgoing {
  to: string | "all";
  msg: ServerMsg;
  close?: boolean;
}

interface Conn {
  name: string;
  slot: number | null; // null until "hello"
  fighter: number | null; // during a match: which fighter this connection drives
}

const IDLE = encodeInput(NO_INPUT);

export class RoomCore {
  private conns = new Map<string, Conn>();
  phase: "lobby" | "match" = "lobby";
  private setup: MatchSetup | null = null;
  /** The next step to finalize. Steps before it are final and broadcast. */
  nextStep = 0;
  /** Each fighter's input as of the last finalized step. */
  private inputs: string[] = [];
  /** Scheduled changes: step → fighter → input. */
  private pending = new Map<number, Map<number, string>>();

  constructor(readonly code: string) {}

  get connectionCount() {
    return this.conns.size;
  }

  connect(id: string): Outgoing[] {
    this.conns.set(id, { name: "player", slot: null, fighter: null });
    return [];
  }

  disconnect(id: string): Outgoing[] {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (!c) return [];
    // A fighter whose player left goes idle (later: a bot takes over).
    if (this.phase === "match" && c.fighter !== null) this.schedule(c.fighter, this.nextStep, IDLE);
    if (this.conns.size === 0) this.reset();
    return c.slot === null ? [] : [this.roster()];
  }

  receive(id: string, raw: unknown): Outgoing[] {
    const c = this.conns.get(id);
    if (!c) return [];
    const m = parseClientMsg(raw);
    if (!m) return [error(id, "malformed message")];
    if (c.slot === null && m.type !== "hello") return [error(id, "say hello first")];

    switch (m.type) {
      case "hello": {
        if (c.slot !== null) return [error(id, "already joined")];
        if (m.version !== PROTOCOL_VERSION) return [error(id, `protocol version mismatch (relay ${PROTOCOL_VERSION})`, true)];
        if (this.phase === "match") return [error(id, "a match is in progress in this room", true)];
        const slot = this.freeSlot();
        if (slot === null) return [error(id, `room is full (${MAX_PLAYERS} players)`, true)];
        c.slot = slot;
        c.name = cleanName(m.name);
        return [{ to: id, msg: { type: "welcome", room: this.code, slot } }, this.roster()];
      }
      case "start": {
        if (!this.isHost(id)) return [error(id, "only the host can start")];
        if (this.phase !== "lobby") return [error(id, "already in a match")];
        const seated = this.seated();
        if (seated.length < 2) return [error(id, "need at least 2 players")];
        if (m.setup.match.players !== seated.length) return [error(id, `setup is for ${m.setup.match.players} players, ${seated.length} are here`)];
        this.setup = m.setup;
        this.phase = "match";
        this.nextStep = 0;
        this.pending.clear();
        this.inputs = seated.map(() => IDLE);
        const fighters = seated.map(([, conn]) => conn.slot!);
        const out: Outgoing[] = seated.map(([connId, conn], i) => {
          conn.fighter = i;
          return { to: connId, msg: { type: "start", setup: this.setup!, fighters, you: i } };
        });
        return [...out, this.roster()];
      }
      case "input": {
        if (this.phase !== "match" || c.fighter === null) return [];
        if (m.tick > this.nextStep + MAX_INPUT_LEAD) return [error(id, "input scheduled too far ahead")];
        // Too late for its step? It takes effect at the next open step instead.
        this.schedule(c.fighter, Math.max(m.tick, this.nextStep), m.input);
        return [];
      }
      case "ping":
        return [{ to: id, msg: { type: "pong", id: m.id } }];
      case "lobby": {
        if (!this.isHost(id)) return [error(id, "only the host can end the match")];
        this.toLobby();
        return [{ to: "all", msg: { type: "lobby" } }, this.roster()];
      }
    }
  }

  /** Finalize the next step and broadcast it. Called at 60 Hz during a match. */
  advance(): Outgoing[] {
    if (this.phase !== "match") return [];
    const t = this.nextStep++;
    const scheduled = this.pending.get(t);
    this.pending.delete(t);
    const changes: [number, string][] = [];
    for (const [fighter, input] of scheduled ?? []) {
      if (this.inputs[fighter] !== input) {
        this.inputs[fighter] = input;
        changes.push([fighter, input]);
      }
    }
    const msg: ServerMsg = changes.length ? { type: "tick", t, c: changes } : { type: "tick", t };
    return [{ to: "all", msg }];
  }

  private schedule(fighter: number, step: number, input: string) {
    let at = this.pending.get(step);
    if (!at) this.pending.set(step, (at = new Map()));
    at.set(fighter, input); // latest wins within a step
  }

  /** Joined connections, in slot order. */
  private seated(): [string, Conn][] {
    return [...this.conns].filter(([, c]) => c.slot !== null).sort(([, a], [, b]) => a.slot! - b.slot!);
  }

  /** The host is whoever holds the lowest slot, so hosting passes on automatically. */
  private isHost(id: string): boolean {
    return this.seated()[0]?.[0] === id;
  }

  private freeSlot(): number | null {
    const taken = new Set(this.seated().map(([, c]) => c.slot));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!taken.has(s)) return s;
    return null;
  }

  private roster(): Outgoing {
    const players: RosterEntry[] = this.seated().map(([, c], i) => ({ slot: c.slot!, name: c.name, host: i === 0 }));
    return { to: "all", msg: { type: "roster", phase: this.phase, players } };
  }

  private toLobby() {
    this.phase = "lobby";
    this.setup = null;
    this.pending.clear();
    for (const c of this.conns.values()) c.fighter = null;
  }

  private reset() {
    this.toLobby();
    this.nextStep = 0;
  }
}

function error(to: string, message: string, close = false): Outgoing {
  return { to, msg: { type: "error", message }, close };
}
