// Messages between game clients and the room relay (server/room-do.ts wraps
// src/net/room.ts). JSON over WebSocket. Shared by browser and server: no DOM,
// no Cloudflare APIs.
//
// The relay owns the match clock and the official input stream:
//   - Clients send an input only when it changes, tagged with the step it
//     should take effect on ("input", tick = step index).
//   - Every 1/60 s the relay finalizes the next step and broadcasts "tick":
//     step t's inputs are final, plus which fighters' inputs changed at t.
//   - An input arriving after its step was finalized is applied at the next
//     open step instead. The relay never waits for anyone, so one laggy
//     player can't stall the match. Every client simulates this same stream.
//
// "Step t" = the sim step that takes sim.tick from t to t+1.

import type { FighterShape, Stage } from "../sim/geometry";
import type { Params } from "../sim/params";
import type { MatchOptions } from "../sim/sim";

export const PROTOCOL_VERSION = 12; // 12: KO when an edge (not just a corner) touches a surface
export const MAX_PLAYERS = 4;
/** Spectators per room (watching a match, or waiting for a free seat). */
export const MAX_SPECTATORS = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Clients report a state fingerprint every this many steps. */
export const HASH_EVERY = 60;
/** How far ahead of the relay's clock a client may schedule an input (steps). */
export const MAX_INPUT_LEAD = 120;
/** Room codes: 4 letters, no easily-confused ones (I, L, O...). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

/** Everything needed to start identical sims on every client. Chosen by the host. */
export interface MatchSetup {
  stage: Stage;
  match: MatchOptions;
  params: Params;
}

/** Lobby settings the host chooses; everyone sees them. */
export interface RoomSettings {
  stageId: string; // see src/stages.ts
  stocks: number;
  hops: boolean; // idle hopping on (fighters hop whenever they land) or off (they stand; only charged jumps): Params.idleHop
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = { stageId: "wings", stocks: 3, hops: false };
export const MAX_STOCKS = 5;

/** How quickly a bot reacts (src/lineup.ts BOT_REACTION). Chosen per bot by the host. */
export type BotLevel = "easy" | "normal" | "hard";
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "normal", "hard"];

export interface RosterEntry {
  slot: number;
  name: string;
  host: boolean;
  bot: boolean; // a bot seat, driven by the host's browser
  /** A bot's difficulty (null for players). */
  level: BotLevel | null;
  /** Their custom fighter shape (balanced, unit area), or null for the standard fighter. */
  shape: FighterShape | null;
  /** Their eye style (an index into EYE_STYLES; cosmetic, not part of the sim). */
  eyes: number;
  /** Their color (an index into PLAYER_COLORS); unique within the room. Cosmetic. */
  color: number;
}

export type ClientMsg =
  /** First message after connecting. */
  | { type: "hello"; version: number; name: string }
  /** Host, in the lobby: start a match with everyone seated. */
  | { type: "start"; setup: MatchSetup }
  /** During a match: an input (encodeInput char) from step `tick` on, for my fighter or (host) a bot's. */
  | { type: "input"; tick: number; input: string; fighter?: number }
  /** Host, in the lobby: add a bot (in `slot` if given and free, else the first free seat). Remove one with "kick". */
  | { type: "addBot"; slot?: number; level?: BotLevel }
  /** Host, in the lobby: change a bot's difficulty. */
  | { type: "botLevel"; slot: number; level: BotLevel }
  /** My fighter shape for upcoming matches (null = the standard fighter). The relay validates it. */
  | { type: "shape"; shape: FighterShape | null }
  /** My eye style for upcoming matches. */
  | { type: "eyes"; eyes: number }
  /** The color I'd like (granted if free; a bot holding it swaps). */
  | { type: "color"; color: number }
  /** Host, in the lobby: change the room's settings. */
  | { type: "settings"; settings: RoomSettings }
  /** Host: remove the player in `slot` from the room. */
  | { type: "kick"; slot: number }
  /** During a match: my state fingerprint (Sim.hash) after step `step`, for desync detection. */
  | { type: "hash"; step: number; hash: string }
  /** Round-trip time measurement. */
  | { type: "ping"; id: number }
  /** Host: end the match, back to the lobby. */
  | { type: "lobby" };

export type ServerMsg =
  /** You're in. `slot` = your seat, or null if you're spectating (match on, or room full). */
  | { type: "welcome"; room: string; slot: number | null }
  /** Who's here (seated players, and spectators by name) and the room's settings, sent whenever they change. */
  | { type: "roster"; phase: "lobby" | "match"; players: RosterEntry[]; spectators: string[]; settings: RoomSettings }
  /**
   * You're spectating the current match. `log` = every input change so far
   * ([step, changes], only steps with changes); steps before `next` are final.
   * Replay it to catch up, then follow the live "tick"s. `names[i]` = fighter i.
   */
  | { type: "spectate"; setup: MatchSetup; names: string[]; log: [number, [number, string][]][]; next: number }
  /** You were removed from the room by the host. */
  | { type: "kicked" }
  /** Mid-match: you now also drive these fighters (bots whose driver, the old host, left). */
  | { type: "drive"; fighters: number[] }
  /**
   * A match begins at step 0. `fighters[i]` = the lobby slot playing fighter i;
   * `you` = your fighter; `drive` = fighters whose inputs you send (yours, plus
   * the bots if you're the host).
   */
  | { type: "start"; setup: MatchSetup; fighters: number[]; you: number; drive: number[] }
  /** Step `t` is final. `c` = [fighter, input] pairs whose input changes at step t. */
  | { type: "tick"; t: number; c?: [number, string][] }
  | { type: "pong"; id: number }
  | { type: "lobby" }
  /** Clients' fingerprints disagree: their matches have diverged. `hashes` = [fighter, hash]. */
  | { type: "desync"; step: number; hashes: [number, string][] }
  | { type: "error"; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isInputChar = (v: unknown): v is string => typeof v === "string" && /^[0-5]$/.test(v);
const isLevel = (v: unknown): v is BotLevel => BOT_LEVELS.includes(v as BotLevel);

/**
 * Parse and validate a message from a client. Returns null for anything
 * malformed. Clients are untrusted, so this checks every field the relay uses.
 * (The match setup is only shape-checked: the relay passes it through to the
 * other clients, who trust their host.)
 */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.type) {
    case "hello":
      return isInt(m.version) && typeof m.name === "string" ? { type: "hello", version: m.version, name: m.name } : null;
    case "start": {
      const s = m.setup;
      if (!isObj(s) || !isObj(s.stage) || !isObj(s.match) || !isObj(s.params) || !isInt(s.match.players)) return null;
      return { type: "start", setup: s as unknown as MatchSetup };
    }
    case "input": {
      if (!isInt(m.tick) || m.tick < 0 || !isInputChar(m.input)) return null;
      if (m.fighter === undefined) return { type: "input", tick: m.tick, input: m.input };
      return isInt(m.fighter) && m.fighter >= 0 ? { type: "input", tick: m.tick, input: m.input, fighter: m.fighter } : null;
    }
    case "addBot": {
      if (m.slot !== undefined && !(isInt(m.slot) && m.slot >= 0)) return null;
      if (m.level !== undefined && !isLevel(m.level)) return null;
      return { type: "addBot", ...(m.slot !== undefined && { slot: m.slot as number }), ...(m.level !== undefined && { level: m.level as BotLevel }) };
    }
    case "botLevel":
      return isInt(m.slot) && m.slot >= 0 && isLevel(m.level) ? { type: "botLevel", slot: m.slot, level: m.level } : null;
    case "settings": {
      const s = m.settings;
      if (!isObj(s) || typeof s.stageId !== "string" || !/^[a-z0-9-]{1,24}$/.test(s.stageId)) return null;
      if (!isInt(s.stocks) || s.stocks < 1 || s.stocks > MAX_STOCKS) return null;
      if (typeof s.hops !== "boolean") return null;
      return { type: "settings", settings: { stageId: s.stageId, stocks: s.stocks, hops: s.hops } };
    }
    case "kick":
      return isInt(m.slot) && m.slot >= 0 ? { type: "kick", slot: m.slot } : null;
    case "color":
      return isInt(m.color) ? { type: "color", color: m.color } : null; // RoomCore checks the range
    case "eyes":
      return isInt(m.eyes) ? { type: "eyes", eyes: m.eyes } : null; // RoomCore checks the range
    case "shape":
      if (m.shape === null) return { type: "shape", shape: null };
      return isObj(m.shape) && Array.isArray(m.shape.vertices) ? { type: "shape", shape: m.shape as unknown as FighterShape } : null; // RoomCore checks the geometry
    case "hash":
      return isInt(m.step) && m.step >= 0 && typeof m.hash === "string" && /^[0-9a-f]{8}$/.test(m.hash)
        ? { type: "hash", step: m.step, hash: m.hash }
        : null;
    case "ping":
      return isInt(m.id) ? { type: "ping", id: m.id } : null;
    case "lobby":
      return { type: "lobby" };
    default:
      return null;
  }
}

/** Keep names short and printable. */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16);
  return cleaned || "player";
}

export function randomRoomCode(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]).join("");
}
