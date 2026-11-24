// Who's in a match: the input source driving each fighter, their shapes (part
// of the sim), and their looks (names, eye styles, colors: presentation only).
// Built here for matches on this machine (a room with just you and bots: roomLineup)
// and the bot match behind the menus; online, every client builds the looks
// from the room's roster (onlineLooks).

import { BotSource, DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { randomBotShape } from "./bots/shapes";
import { KeyboardSource } from "./input";
import { EYE_STYLES } from "./look/eyes";
import type { NetClient } from "./net/client";
import type { BotLevel, RosterEntry } from "./net/protocol";
import type { InputSource } from "./session";
import type { FighterShape } from "./sim/geometry";
import type { Params } from "./sim/params";
import { assignColors } from "./theme";

export type { BotLevel } from "./net/protocol";
/** Bot reaction delay (ticks) per difficulty. */
export const BOT_REACTION: Record<BotLevel, number> = { easy: 24, normal: 12, hard: 4 };
/** The bots behind the menus. */
const ATTRACT_REACTION = 12;

/** You, as set up in the menus. */
export interface Profile {
  name: string;
  shape: FighterShape | null; // balanced unit-area shape; null = the standard fighter
  eyes: number; // index into EYE_STYLES
  color: number; // index into PLAYER_COLORS
}

/** What the screen shows for each fighter (not part of the sim). */
export interface Looks {
  names: string[];
  eyes: number[];
  colors: number[]; // indices into PLAYER_COLORS
}

export interface Lineup {
  sources: InputSource[];
  shapes: (FighterShape | null)[];
  looks: Looks;
}

/** Makes the bot for fighter i with a reaction delay (ticks). */
export type BotMaker = (fighter: number, reaction: number) => InputSource;

/**
 * Bots for one match: HeuristicBots seeded by match and fighter, or (for
 * browser tests, ?bots=still) bots that give no input.
 */
export function botMaker(params: Params, matchNumber: number, still = false): BotMaker {
  return (fighter, reaction) =>
    still
      ? { isHuman: false, describe: () => "bot (still)", next: () => ({ turn: 0, charge: false }) }
      : new BotSource(new HeuristicBot(fighter, { ...DEFAULT_BOT, reactionTicks: reaction, seed: matchNumber * 4 + fighter + 1 }), params);
}

/** A random eye style (bots, the menu backdrop). */
export function randomEyes(): number {
  return Math.floor(Math.random() * EYE_STYLES.length);
}

/**
 * A match on this machine from a room's roster (you and bots: online matches
 * go through the relay instead). Fighter i = the i-th seat, as online. You
 * play with the arrow keys or A/D/S; bots play at their level. Shapes, eyes
 * and colors are the room's.
 */
export function roomLineup(roster: RosterEntry[], bot: BotMaker): Lineup {
  return {
    sources: roster.map((p, i) => (p.bot ? bot(i, BOT_REACTION[p.level ?? "normal"]) : new KeyboardSource([0, 1], i))),
    shapes: roster.map((p) => p.shape),
    looks: { names: roster.map((p) => p.name), eyes: roster.map((p) => p.eyes), colors: roster.map((p) => p.color) },
  };
}

/** The bot match behind the menus: random shapes and eyes, nameless. */
export function attractLineup(bot: BotMaker, players = 4): Lineup {
  return {
    sources: Array.from({ length: players }, (_, i) => bot(i, ATTRACT_REACTION)),
    shapes: Array.from({ length: players }, () => randomBotShape(Math.random)),
    looks: { names: Array(players).fill(""), eyes: Array.from({ length: players }, randomEyes), colors: assignColors(players) },
  };
}

/** Online, the room's roster decides how fighters look. */
export function onlineLooks(net: NetClient, players: number): Looks {
  const fighters = Array.from({ length: players }, (_, i) => i);
  return { names: fighters.map((i) => net.nameOf(i)), eyes: fighters.map((i) => net.eyesOf(i)), colors: fighters.map((i) => net.colorOf(i)) };
}
