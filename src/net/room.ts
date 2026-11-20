// The relay's room logic, as plain TypeScript (no Cloudflare APIs), so it's
// tested in Node like the sim. server/room-do.ts is the thin Durable Object
// wrapper that feeds it WebSocket events and a 60 Hz clock.
//
// Events in (connect, disconnect, receive, advance), messages out.

import { encodeInput } from "../sim/inputCodec";
import { NO_INPUT } from "../sim/types";
import {
  DEFAULT_ROOM_SETTINGS,
  HASH_EVERY,
  MAX_INPUT_LEAD,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  cleanName,
  parseClientMsg,
  type MatchSetup,
  type RoomSettings,
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
  fighter: number | null; // during a match: this player's own fighter
  drives: number[]; // during a match: fighters whose inputs this connection may send
}

/** A seat in the room: a connected player, or a bot (no connection; the host drives it). */
interface Seat {
  slot: number;
  name: string;
  conn: string | null; // null = bot
}

const IDLE = encodeInput(NO_INPUT);

export class RoomCore {
  private conns = new Map<string, Conn>();
  private bots = new Map<number, string>(); // slot → name
  private settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };
  phase: "lobby" | "match" = "lobby";
  private setup: MatchSetup | null = null;
  /** The next step to finalize. Steps before it are final and broadcast. */
  nextStep = 0;
  /** Each fighter's input as of the last finalized step. */
  private inputs: string[] = [];
  /** Scheduled changes: step → fighter → input. */
  private pending = new Map<number, Map<number, string>>();
  /** Reported fingerprints: step → fighter → hash. Only recent steps are kept. */
  private hashes = new Map<number, Map<number, string>>();
  private desyncReported = false;

  constructor(readonly code: string) {}

  get connectionCount() {
    return this.conns.size;
  }

  connect(id: string): Outgoing[] {
    this.conns.set(id, { name: "player", slot: null, fighter: null, drives: [] });
    return [];
  }

  disconnect(id: string): Outgoing[] {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (!c) return [];
    // Fighters this player drove (their own, and bots if they hosted) go idle.
    if (this.phase === "match") for (const f of c.drives) this.schedule(f, this.nextStep, IDLE);
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
        const seats = this.seats();
        if (seats.length < 2) return [error(id, "need at least 2 players (add a bot?)")];
        if (m.setup.match.players !== seats.length) return [error(id, `setup is for ${m.setup.match.players} players, ${seats.length} are here`)];
        this.setup = m.setup;
        this.phase = "match";
        this.nextStep = 0;
        this.pending.clear();
        this.inputs = seats.map(() => IDLE);
        this.hashes.clear();
        this.desyncReported = false;
        // Fighter i = the i-th seat by slot. The host drives every bot.
        const fighters = seats.map((s) => s.slot);
        const botFighters = seats.flatMap((s, i) => (s.conn === null ? [i] : []));
        const out: Outgoing[] = [];
        seats.forEach((s, i) => {
          if (s.conn === null) return;
          const conn = this.conns.get(s.conn)!;
          conn.fighter = i;
          conn.drives = s.conn === id ? [i, ...botFighters] : [i];
          out.push({ to: s.conn, msg: { type: "start", setup: this.setup!, fighters, you: i, drive: conn.drives } });
        });
        return [...out, this.roster()];
      }
      case "input": {
        if (this.phase !== "match" || c.fighter === null) return [];
        const fighter = m.fighter ?? c.fighter;
        if (!c.drives.includes(fighter)) return [error(id, `you can't send inputs for fighter ${fighter}`)];
        if (m.tick > this.nextStep + MAX_INPUT_LEAD) return [error(id, "input scheduled too far ahead")];
        // Too late for its step? It takes effect at the next open step instead.
        this.schedule(fighter, Math.max(m.tick, this.nextStep), m.input);
        return [];
      }
      case "hash": {
        if (this.phase !== "match" || c.fighter === null) return [];
        if (m.step > this.nextStep) return [error(id, "fingerprint for a step that isn't final yet")];
        let reports = this.hashes.get(m.step);
        if (!reports) this.hashes.set(m.step, (reports = new Map()));
        reports.set(c.fighter, m.hash);
        for (const step of this.hashes.keys()) if (step < m.step - 10 * HASH_EVERY) this.hashes.delete(step);
        // Any two clients disagreeing means their matches have diverged. Say so once.
        if (new Set(reports.values()).size > 1 && !this.desyncReported) {
          this.desyncReported = true;
          return [{ to: "all", msg: { type: "desync", step: m.step, hashes: [...reports] } }];
        }
        return [];
      }
      case "addBot": {
        if (!this.isHost(id)) return [error(id, "only the host can add bots")];
        if (this.phase !== "lobby") return [error(id, "can't change seats during a match")];
        const slot = this.freeSlot();
        if (slot === null) return [error(id, `room is full (${MAX_PLAYERS} players)`)];
        this.bots.set(slot, `bot ${this.bots.size + 1}`);
        return [this.roster()];
      }
      case "settings": {
        if (!this.isHost(id)) return [error(id, "only the host can change settings")];
        if (this.phase !== "lobby") return [error(id, "can't change settings during a match")];
        this.settings = m.settings;
        return [this.roster()];
      }
      case "kick": {
        if (!this.isHost(id)) return [error(id, "only the host can kick")];
        const seat = this.seats().find((s) => s.slot === m.slot);
        if (!seat) return [error(id, "nobody in that seat")];
        if (seat.conn === id) return [error(id, "you can't kick yourself (leave instead)")];
        if (seat.conn === null) {
          if (this.phase !== "lobby") return [error(id, "can't remove bots during a match")];
          this.bots.delete(seat.slot); // kicking a bot seat just removes the bot
          return [this.roster()];
        }
        // Tell them, close their connection, and treat it as them leaving.
        return [{ to: seat.conn, msg: { type: "kicked" }, close: true }, ...this.disconnect(seat.conn)];
      }
      case "removeBot": {
        if (!this.isHost(id)) return [error(id, "only the host can remove bots")];
        if (this.phase !== "lobby") return [error(id, "can't change seats during a match")];
        const last = Math.max(-1, ...this.bots.keys());
        if (last < 0) return [error(id, "there are no bots")];
        this.bots.delete(last);
        return [this.roster()];
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

  /** Every seat (joined players and bots), in slot order. */
  private seats(): Seat[] {
    const players: Seat[] = [...this.conns].flatMap(([id, c]) => (c.slot === null ? [] : [{ slot: c.slot, name: c.name, conn: id }]));
    const bots: Seat[] = [...this.bots].map(([slot, name]) => ({ slot, name, conn: null }));
    return [...players, ...bots].sort((a, b) => a.slot - b.slot);
  }

  /** The host is the player (not bot) in the lowest slot, so hosting passes on automatically. */
  private hostId(): string | null {
    return this.seats().find((s) => s.conn !== null)?.conn ?? null;
  }

  private isHost(id: string): boolean {
    return this.hostId() === id;
  }

  private freeSlot(): number | null {
    const taken = new Set(this.seats().map((s) => s.slot));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!taken.has(s)) return s;
    return null;
  }

  private roster(): Outgoing {
    const host = this.hostId();
    const players: RosterEntry[] = this.seats().map((s) => ({ slot: s.slot, name: s.name, host: s.conn !== null && s.conn === host, bot: s.conn === null }));
    return { to: "all", msg: { type: "roster", phase: this.phase, players, settings: this.settings } };
  }

  private toLobby() {
    this.phase = "lobby";
    this.setup = null;
    this.pending.clear();
    for (const c of this.conns.values()) {
      c.fighter = null;
      c.drives = [];
    }
  }

  /** Everyone left: start fresh (bots go too). */
  private reset() {
    this.toLobby();
    this.nextStep = 0;
    this.bots.clear();
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
  }
}

function error(to: string, message: string, close = false): Outgoing {
  return { to, msg: { type: "error", message }, close };
}
