// Public types of the simulation. Re-exported from sim.ts, so other code can
// keep importing everything from "./sim/sim".

import type { Vec2 } from "./geometry";

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export interface Input {
  /** -1 = rotate left (counterclockwise), +1 = rotate right (clockwise), 0 = none. */
  turn: -1 | 0 | 1;
  /** Held state of the charge button. What it does depends on jumpMode, see movement.ts. */
  charge: boolean;
}

export const NO_INPUT: Input = { turn: 0, charge: false };

export type KoReason = "touched" | "fell";

/**
 * Things that happened during the last step(), for presentation (screen shake,
 * replays, later sound). Deterministic like everything else in the sim.
 */
export type SimEvent =
  /** Two fighters pushing on each other this tick. `force` = Rapier contact force (N). */
  | { type: "impact"; a: number; b: number; force: number }
  /** A fighter lost a stock. `final` = this KO ended the match. */
  | { type: "ko"; fighter: number; reason: KoReason; stocksLeft: number; final: boolean };

/** Match setup: who's playing and how many lives. Fixed for the whole match. */
export interface MatchOptions {
  players: number;
  stocks: number; // lives per player
  respawnDelayTicks: number; // a KO'd body lies where it fell this long before respawning
  ghostTicks: number; // after respawning: pass through fighters, immune to touch-KOs
  /** Override spawn positions (foot). Default: evenly spaced on the stage's spawn line. */
  spawns?: Vec2[];
}

export const DEFAULT_MATCH: MatchOptions = {
  players: 2,
  stocks: 3,
  respawnDelayTicks: 60,
  ghostTicks: 120,
};

export type MatchResult = { over: false } | { over: true; winner: number | null; tick: number };

/**
 * Per-fighter game-rule state that Rapier doesn't know about. Plain data only
 * (no Rapier objects), so saving it is a deep copy and no field can be
 * forgotten by save/restore.
 */
export interface FighterState {
  chargeTicks: number; // ticks of charge built up
  charging: boolean; // auto mode: planted on the ground, building a charge
  chargeWasHeld: boolean; // last tick's charge button, to detect release
  ticksSinceGrounded: number; // 0 = grounded this tick
  jumpCooldown: number; // ticks left where we count as airborne after a jump
  ko: KoReason | null; // set while dead (respawning or eliminated)
  stocks: number; // lives left, including the current one. 0 = eliminated
  respawnTimer: number; // while dead: ticks until respawn
  ghostTimer: number; // ticks of post-respawn ghosting left
}

/** Read-only snapshot of a fighter, for rendering, bots, and debugging. */
export interface FighterView {
  x: number;
  y: number;
  angle: number; // radians, counterclockwise
  angularVelocity: number;
  vx: number; // linear velocity, m/s
  vy: number;
  vertices: Vec2[]; // world space
  footIndex: number;
  grounded: boolean;
  canJump: boolean; // grounded or within coyote time
  gripActive: boolean;
  charge: number; // 0..1
  ko: KoReason | null;
  stocks: number;
  eliminated: boolean; // out of stocks and removed from the stage
  ghost: boolean; // just respawned: passes through fighters, immune to touch-KOs
}

/** A complete, resumable snapshot of a match in progress. See Sim.save(). */
export interface SimState {
  physics: Uint8Array; // Rapier world snapshot
  fighters: FighterState[];
  oneWaySolid: boolean[][];
  gripActive: boolean[];
  tick: number;
  result: MatchResult;
  events: SimEvent[];
}
