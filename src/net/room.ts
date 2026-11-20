// The relay's room logic, as plain TypeScript (no Cloudflare APIs), so it's
// tested in Node like the sim. server/room-do.ts is the thin Durable Object
// wrapper that feeds it WebSocket events and a 60 Hz clock.
//
// Events in (connect, disconnect, receive, advance), messages out.

import { LEFT, encodeInput } from "../sim/inputCodec";
import type { FighterShape } from "../sim/geometry";
import { shapeIssue } from "../sim/shapes";
import { randomBotShape } from "../bots/shapes";
import { EYE_STYLES } from "../look/eyes";
import { NO_INPUT } from "../sim/types";
import {
  DEFAULT_ROOM_SETTINGS,
  HASH_EVERY,
  MAX_INPUT_LEAD,
  MAX_PLAYERS,
  MAX_SPECTATORS,
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
  joined: boolean; // said hello
  joinedAt: number; // join order (spectators get seats in this order)
  slot: number | null; // seat; null = not joined yet, or spectating
  fighter: number | null; // during a match: this player's own fighter
  drives: number[]; // during a match: fighters whose inputs this connection may send
  shape: FighterShape | null; // their custom fighter (null = standard)
  eyes: number; // their eye style
}

/** A seat in the room: a connected player, or a bot (no connection; the host drives it). */
interface Seat {
  slot: number;
  name: string;
  conn: string | null; // null = bot
  shape: FighterShape | null;
  eyes: number;
}

const IDLE = encodeInput(NO_INPUT);

export class RoomCore {
  private conns = new Map<string, Conn>();
  private bots = new Map<number, { name: string; shape: FighterShape; eyes: number }>(); // slot → bot
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
  /** The current match's input changes so far ([step, changes], only steps with changes), for spectators to catch up. */
  private log: [number, [number, string][]][] = [];
  private matchNames: string[] = []; // fighter names at the start of the match
  private joins = 0;

  /** `random` picks bot shapes (pass a seeded source in tests). */
  constructor(
    readonly code: string,
    private random: () => number = Math.random,
  ) {}

  get connectionCount() {
    return this.conns.size;
  }

  connect(id: string): Outgoing[] {
    this.conns.set(id, { name: "player", joined: false, joinedAt: 0, slot: null, fighter: null, drives: [], shape: null, eyes: 0 });
    return [];
  }

  disconnect(id: string): Outgoing[] {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (!c) return [];
    const out: Outgoing[] = [];
    if (this.phase === "match") {
      // Their fighter leaves the match: every client removes it at the same step.
      if (c.fighter !== null) this.schedule(c.fighter, this.nextStep, LEFT);
      // Bots they drove (they were host) go to the new host, idling until then.
      const bots = c.drives.filter((f) => f !== c.fighter);
      for (const f of bots) this.schedule(f, this.nextStep, IDLE);
      const heir = this.hostId();
      if (bots.length && heir) {
        this.conns.get(heir)!.drives.push(...bots);
        out.push({ to: heir, msg: { type: "drive", fighters: bots } });
      }
    }
    if (this.conns.size === 0) this.reset();
    else if (this.phase === "lobby") out.push(...this.seatSpectators()); // a seat may have freed up
    return c.joined ? [...out, this.roster()] : out;
  }

  receive(id: string, raw: unknown): Outgoing[] {
    const c = this.conns.get(id);
    if (!c) return [];
    const m = parseClientMsg(raw);
    if (!m) return [error(id, "malformed message")];
    if (!c.joined && m.type !== "hello") return [error(id, "say hello first")];

    switch (m.type) {
      case "hello": {
        if (c.joined) return [error(id, "already joined")];
        if (m.version !== PROTOCOL_VERSION) return [error(id, `protocol version mismatch (relay ${PROTOCOL_VERSION})`, true)];
        // Seat them if a match isn't on and there's room; otherwise they spectate.
        const slot = this.phase === "lobby" ? this.freeSlot() : null;
        if (slot === null && this.spectators().length >= MAX_SPECTATORS) return [error(id, "room is full", true)];
        c.joined = true;
        c.joinedAt = this.joins++;
        c.slot = slot;
        c.name = cleanName(m.name);
        const out: Outgoing[] = [{ to: id, msg: { type: "welcome", room: this.code, slot } }];
        if (this.phase === "match") out.push({ to: id, msg: this.spectateMsg() });
        return [...out, this.roster()];
      }
      case "start": {
        if (!this.isHost(id)) return [error(id, "only the host can start")];
        if (this.phase !== "lobby") return [error(id, "already in a match")];
        const seats = this.seats();
        if (seats.length < 2) return [error(id, "need at least 2 players (add a bot?)")];
        if (m.setup.match.players !== seats.length) return [error(id, `setup is for ${m.setup.match.players} players, ${seats.length} are here`)];
        if ((m.setup.match.shapes ?? []).some((s) => s !== null && shapeIssue(s) !== null)) return [error(id, "the setup has an invalid fighter shape")];
        this.setup = m.setup;
        this.phase = "match";
        this.nextStep = 0;
        this.pending.clear();
        this.inputs = seats.map(() => IDLE);
        this.hashes.clear();
        this.desyncReported = false;
        this.log = [];
        this.matchNames = seats.map((s) => s.name);
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
        // Anyone waiting for a seat watches.
        for (const [sid] of this.spectators()) out.push({ to: sid, msg: this.spectateMsg() });
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
        // Each bot gets a random shape near the standard one, kept for as long as it's seated.
        this.bots.set(slot, { name: `bot ${this.bots.size + 1}`, shape: randomBotShape(this.random), eyes: Math.floor(this.random() * EYE_STYLES.length) });
        return [this.roster()];
      }
      case "eyes": {
        if (!Number.isInteger(m.eyes) || m.eyes < 0 || m.eyes >= EYE_STYLES.length) return [error(id, "unknown eye style")];
        c.eyes = m.eyes;
        return c.slot === null ? [] : [this.roster()];
      }
      case "shape": {
        const issue = m.shape && shapeIssue(m.shape);
        if (issue) return [error(id, `that fighter shape isn't allowed (${issue})`)];
        c.shape = m.shape;
        return c.slot === null ? [] : [this.roster()];
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
          return [...this.seatSpectators(), this.roster()];
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
        return [...this.seatSpectators(), this.roster()];
      }
      case "ping":
        return [{ to: id, msg: { type: "pong", id: m.id } }];
      case "lobby": {
        if (!this.isHost(id)) return [error(id, "only the host can end the match")];
        this.toLobby();
        return [{ to: "all", msg: { type: "lobby" } }, ...this.seatSpectators(), this.roster()];
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
    if (changes.length) this.log.push([t, changes]);
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
    const players: Seat[] = [...this.conns].flatMap(([id, c]) => (c.slot === null ? [] : [{ slot: c.slot, name: c.name, conn: id, shape: c.shape, eyes: c.eyes }]));
    const bots: Seat[] = [...this.bots].map(([slot, b]) => ({ slot, name: b.name, conn: null, shape: b.shape, eyes: b.eyes }));
    return [...players, ...bots].sort((a, b) => a.slot - b.slot);
  }

  /** Joined connections without a seat, in join order. */
  private spectators(): [string, Conn][] {
    return [...this.conns].filter(([, c]) => c.joined && c.slot === null).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
  }

  /** Lobby: give free seats to spectators, longest-waiting first. */
  private seatSpectators(): Outgoing[] {
    const out: Outgoing[] = [];
    for (const [id, c] of this.spectators()) {
      const slot = this.freeSlot();
      if (slot === null) break;
      c.slot = slot;
      out.push({ to: id, msg: { type: "welcome", room: this.code, slot } });
    }
    return out;
  }

  /** Everything a spectator needs to catch up on the current match. */
  private spectateMsg(): ServerMsg {
    return { type: "spectate", setup: this.setup!, names: this.matchNames, log: this.log, next: this.nextStep };
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
    const players: RosterEntry[] = this.seats().map((s) => ({ slot: s.slot, name: s.name, host: s.conn !== null && s.conn === host, bot: s.conn === null, shape: s.shape, eyes: s.eyes }));
    const spectators = this.spectators().map(([, c]) => c.name);
    return { to: "all", msg: { type: "roster", phase: this.phase, players, spectators, settings: this.settings } };
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
    this.log = [];
  }
}

function error(to: string, message: string, close = false): Outgoing {
  return { to, msg: { type: "error", message }, close };
}
