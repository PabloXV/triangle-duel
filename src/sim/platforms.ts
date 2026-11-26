// One-way (pass-through-from-below) platforms: deciding, per fighter and per
// tick, which platforms are solid. Every "touching a surface" question in the
// sim goes through distanceToSolid, so the contact hook, grounded check, grip,
// and KO checks always agree.

import { distanceToPlatform, platformTop, segmentDistanceToPlatform, type Vec2 } from "./geometry";
import { worldVertices, type MatchContext } from "./fighter";
import { DT } from "./types";

/** How far (m) below a one-way platform's top a vertex may be and still count as "above" it. */
const ONE_WAY_ALLOWANCE = 0.05;

/** Is platform `pi` solid for fighter `i` this tick? Regular platforms always are. */
export function isSolidFor(ctx: MatchContext, i: number, pi: number): boolean {
  return !ctx.stage.platforms[pi].oneWay || ctx.oneWaySolid[i][pi];
}

/**
 * Whether each one-way platform blocks each fighter this tick. Decided once
 * per tick, before physics.
 *
 * Becomes solid when the fighter's lowest vertex is above the top surface,
 * or below it by no more than one tick's worth of falling. Rapier only reports
 * a contact once shapes overlap, so a fast faller is already a bit inside
 * when we're first asked.
 *
 * Stays solid until the lowest vertex is a full platform-thickness below the
 * top. Rapier pushes out of overlaps over several ticks, not instantly, so
 * without this a landing fighter would flip back to non-solid while still
 * slightly sunk in and fall through.
 *
 * Net effect: you pass up through from below (your lowest point starts far
 * below the top) and through the ends sideways, and you land on it from above.
 */
export function updateOneWaySolidity(ctx: MatchContext) {
  ctx.fighters.forEach((f, i) => {
    const lowest = Math.min(...worldVertices(f).map((v) => v.y));
    const fallPerTick = Math.max(0, -f.body.linvel().y) * DT;
    ctx.stage.platforms.forEach((plat, pi) => {
      if (!plat.oneWay) return;
      const allowance = ctx.oneWaySolid[i][pi]
        ? 2 * plat.halfHeight // already standing on it: stay solid
        : ONE_WAY_ALLOWANCE + 2 * fallPerTick; // 2x: safety margin
      ctx.oneWaySolid[i][pi] = lowest >= platformTop(plat) - allowance;
    });
  });
}

/** Distance from segment ab to the nearest platform that is solid for fighter i. */
export function segmentDistanceToSolid(ctx: MatchContext, a: Vec2, b: Vec2, i: number): number {
  let best = Infinity;
  ctx.stage.platforms.forEach((plat, pi) => {
    if (!isSolidFor(ctx, i, pi)) return;
    best = Math.min(best, segmentDistanceToPlatform(a, b, plat));
  });
  return best;
}

/** Distance from a point to the nearest platform that is solid for fighter i. */
export function distanceToSolid(ctx: MatchContext, point: Vec2, i: number): number {
  let best = Infinity;
  ctx.stage.platforms.forEach((plat, pi) => {
    if (!isSolidFor(ctx, i, pi)) return;
    best = Math.min(best, distanceToPlatform(point, plat));
  });
  return best;
}
