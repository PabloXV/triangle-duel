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

import type { Stage } from "../sim/geometry";
import type { Params } from "../sim/params";
import type { MatchOptions } from "../sim/sim";

export const PROTOCOL_VERSION = 2;
export const MAX_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 64 * 1024;
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

export interface RosterEntry {
  slot: number;
  name: string;
  host: boolean;
}

export type ClientMsg =
  /** First message after connecting. */
  | { type: "hello"; version: number; name: string }
  /** Host, in the lobby: start a match with everyone seated. */
  | { type: "start"; setup: MatchSetup }
  /** During a match: my input (encodeInput char) from step `tick` on. */
  | { type: "input"; tick: number; input: string }
  /** During a match: my state fingerprint (Sim.hash) after step `step`, for desync detection. */
  | { type: "hash"; step: number; hash: string }
  /** Round-trip time measurement. */
  | { type: "ping"; id: number }
  /** Host: end the match, back to the lobby. */
  | { type: "lobby" };

export type ServerMsg =
  /** You're in. `slot` = your seat in the lobby. */
  | { type: "welcome"; room: string; slot: number }
  /** Who's here, sent whenever it changes. */
  | { type: "roster"; phase: "lobby" | "match"; players: RosterEntry[] }
  /** A match begins at step 0. `fighters[i]` = the lobby slot playing fighter i; `you` = your fighter index. */
  | { type: "start"; setup: MatchSetup; fighters: number[]; you: number }
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
    case "input":
      return isInt(m.tick) && m.tick >= 0 && isInputChar(m.input) ? { type: "input", tick: m.tick, input: m.input } : null;
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
