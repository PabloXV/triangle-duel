// Who's in a match: the input source driving each fighter, their shapes (part
// of the sim), and their looks (names, eye styles, colors: presentation only).
// Built here for local play and the bot match behind the menus; online, the
// room decides (the relay's roster), see onlineLooks.

import { BotSource, DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { randomBotShape } from "./bots/shapes";
import { KeyboardSource } from "./input";
import { EYE_STYLES } from "./look/eyes";
import type { NetClient } from "./net/client";
import type { InputSource } from "./session";
import type { FighterShape } from "./sim/geometry";
import type { Params } from "./sim/params";
import { STAGES } from "./stages";
import { assignColors } from "./theme";

export type BotLevel = "easy" | "normal" | "hard";
/** Bot reaction delay (ticks) per difficulty. */
const BOT_REACTION: Record<BotLevel, number> = { easy: 24, normal: 12, hard: 4 };
/** The bots behind the menus. */
const ATTRACT_REACTION = 12;

export interface LocalSetup {
  stageId: string;
  bots: number; // 1–3 (fewer if a second player joins)
  stocks: number;
  botLevel: BotLevel;
  secondPlayer: boolean; // a 2nd human on the same keyboard (A/D/S)
  hops: boolean; // idle hopping (Params.idleHop)
}
export const DEFAULT_LOCAL_SETUP: LocalSetup = { stageId: STAGES[0].id, bots: 1, stocks: 3, botLevel: "normal", secondPlayer: false, hops: true };

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
 * A local match: you (P1, arrow keys), maybe a 2nd keyboard player, then bots.
 * You get your shape, eyes and color; a 2nd player the defaults; bots random
 * shapes and eyes; everyone else the first free colors.
 */
export function localLineup(setup: LocalSetup, me: Profile, bot: BotMaker): Lineup {
  const humans = setup.secondPlayer ? 2 : 1;
  const players = humans + setup.bots;
  const isBot = (i: number) => i >= humans;
  return {
    sources: Array.from({ length: players }, (_, i) => (isBot(i) ? bot(i, BOT_REACTION[setup.botLevel]) : new KeyboardSource(i, i))),
    shapes: Array.from({ length: players }, (_, i) => (i === 0 ? me.shape : isBot(i) ? randomBotShape(Math.random) : null)),
    looks: {
      names: Array.from({ length: players }, (_, i) => (i === 0 ? me.name : isBot(i) ? `bot ${i - humans + 1}` : "player 2")),
      eyes: Array.from({ length: players }, (_, i) => (i === 0 ? me.eyes : isBot(i) ? randomEyes() : 0)),
      colors: assignColors(players, [me.color]),
    },
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
