// Random fighter shapes for bots: scattered around the standard fighter.
//
// Not part of the deterministic sim (it uses Math.log/cos, which the sim
// forbids): a bot's shape is picked once, before a match, and then travels as
// plain data in the match setup, so every client still simulates identical
// numbers.

import type { FighterShape, Vec2 } from "../sim/geometry";
import { STANDARD_SHAPE, balanceShape, shapeIssue } from "../sim/shapes";

/**
 * How far bot corners stray: the standard deviation of each top corner's
 * offset, in unit-shape units (the standard fighter is ~1.44 wide, ~1.39 tall).
 */
export const BOT_SHAPE_SPREAD = 0.25;

/** A standard normal sample (Box–Muller) from a uniform [0, 1) source. */
function gaussian(rng: () => number): number {
  const u = 1 - rng(); // (0, 1], so log is finite
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * A random shape near the standard one: each top corner moved by a normal
 * offset (σ = `spread`), then balanced at equal mass. If that breaks a limit,
 * the offsets shrink toward zero (toward the standard shape) until it fits, so
 * the result is always legal.
 */
export function randomBotShape(rng: () => number, spread = BOT_SHAPE_SPREAD): FighterShape {
  const s = STANDARD_SHAPE;
  const offsets: Vec2[] = s.vertices.map((_, i) => (i === s.footIndex ? { x: 0, y: 0 } : { x: gaussian(rng) * spread, y: gaussian(rng) * spread }));
  const at = (t: number) => balanceShape(s.vertices.map((v, i) => ({ x: v.x + offsets[i].x * t, y: v.y + offsets[i].y * t })), s.footIndex);
  const ok = (t: number) => {
    const shape = at(t);
    return shape !== null && shapeIssue(shape) === null;
  };
  if (ok(1)) return at(1)!;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 20; n++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return at(lo) ?? STANDARD_SHAPE;
}
