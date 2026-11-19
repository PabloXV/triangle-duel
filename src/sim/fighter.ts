// A fighter inside the sim, and the shared match context the rule modules
// (movement.ts, lives.ts, platforms.ts) operate on. Internal to src/sim.

import type RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { rotate, type FighterShape, type Stage, type Vec2 } from "./geometry";
import type { Params } from "./params";
import type { FighterState, MatchOptions, MatchResult, SimEvent } from "./types";

/** A fighter: its fixed setup, its live Rapier objects, and its rule state. */
export interface Fighter {
  shape: FighterShape;
  spawn: Vec2; // spawn point (foot)
  body: RAPIER.RigidBody; // re-fetched by handle after Sim.restore()
  collider: RAPIER.Collider;
  state: FighterState;
}

/** Everything the rule modules read and write during a step. Owned by Sim. */
export interface MatchContext {
  readonly stage: Stage;
  /** Shared with the panel for live tuning, so read it fresh each tick. */
  readonly params: Params;
  readonly match: MatchOptions;
  readonly fighters: Fighter[];
  /** oneWaySolid[fighter][platform]: does this one-way platform block this fighter this tick? */
  oneWaySolid: boolean[][];
  gripActive: boolean[];
  events: SimEvent[];
  tick: number;
  result: MatchResult;
}

export function freshFighterState(stocks: number): FighterState {
  return {
    chargeTicks: 0,
    charging: false,
    chargeWasHeld: false,
    ticksSinceGrounded: 0,
    jumpCooldown: 0,
    ko: null,
    stocks,
    respawnTimer: 0,
    ghostTimer: 0,
  };
}

/** The fighter's vertices in world space. */
export function worldVertices(f: Fighter): Vec2[] {
  const t = f.body.translation();
  const a = f.body.rotation();
  return f.shape.vertices.map((v) => {
    const r = rotate(v, a);
    return { x: t.x + r.x, y: t.y + r.y };
  });
}

/** The foot vertex in world space. */
export function footPosition(f: Fighter): Vec2 {
  return worldVertices(f)[f.shape.footIndex];
}
