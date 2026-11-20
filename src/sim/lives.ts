// KOs, stocks, respawning, ghosting, and deciding when the match is over.

import { worldVertices, type Fighter, type MatchContext } from "./fighter";
import { spawnPoints } from "./geometry";
import { distanceToSolid } from "./platforms";
import type { KoReason } from "./types";

/**
 * After physics: KO anyone touching a solid surface with a non-foot vertex, or
 * whose center left the blast zone. Then end the match if at most one fighter
 * has stocks left. Uses this tick's one-way solidity (decided before physics),
 * so a fighter passing up through a wing can't be KO'd by brushing it.
 */
export function checkKOs(ctx: MatchContext) {
  const p = ctx.params;
  const bz = ctx.stage.blastZone;
  ctx.fighters.forEach((f, i) => {
    if (f.state.ko) return;
    const verts = worldVertices(f);
    // Ghosts (just respawned) can't be KO'd by touching, only by falling off.
    const touched =
      f.state.ghostTimer === 0 &&
      verts.some((v, idx) => idx !== f.shape.footIndex && distanceToSolid(ctx, v, i) <= p.koTolerance);
    const c = f.body.translation();
    const fell = c.x < bz.minX || c.x > bz.maxX || c.y < bz.minY || c.y > bz.maxY;
    if (touched) knockOut(ctx, i, "touched");
    else if (fell) knockOut(ctx, i, "fell");
  });
  if (!ctx.result.over) {
    const remaining = ctx.fighters.flatMap((f, i) => (f.state.stocks > 0 ? [i] : []));
    // Last fighters losing their last stocks on the same tick = draw (winner null).
    if (remaining.length <= 1) {
      ctx.result = { over: true, winner: remaining[0] ?? null, tick: ctx.tick };
      // The KO(s) this tick ended the match.
      for (const e of ctx.events) if (e.type === "ko") e.final = true;
    }
  }
}

function knockOut(ctx: MatchContext, i: number, reason: KoReason) {
  const s = ctx.fighters[i].state;
  s.ko = reason;
  s.stocks--;
  ctx.events.push({ type: "ko", fighter: i, reason, stocksLeft: s.stocks, final: false });
  s.respawnTimer = ctx.match.respawnDelayTicks;
  s.ghostTimer = 0;
  s.charging = false;
  s.chargeTicks = 0;
}

/**
 * A KO'd body lies where it fell (passing through other fighters) for
 * respawnDelayTicks. Then it respawns if it has stocks left, otherwise it's
 * removed from the stage for good.
 */
export function updateDead(ctx: MatchContext, f: Fighter) {
  if (f.state.respawnTimer > 0 && --f.state.respawnTimer > 0) return;
  if (f.state.stocks > 0) respawn(ctx, f);
  else if (f.body.isEnabled()) f.body.setEnabled(false); // eliminated
}

/**
 * Of the stage's spawn points (its 4-player set), the x farthest from the
 * nearest opponent still in play. Ties go to the first; deterministic, as
 * everything in the sim must be.
 */
function safestSpawnX(ctx: MatchContext, f: Fighter): number {
  const others = ctx.fighters.filter((o) => o !== f && !o.state.ko && o.body.isEnabled()).map((o) => o.body.translation());
  if (others.length === 0) return f.spawn.x;
  let best = f.spawn.x;
  let bestDist = -1;
  for (const p of spawnPoints(ctx.stage, 4)) {
    const nearest = Math.min(...others.map((o) => (o.x - p.x) * (o.x - p.x) + (o.y - p.y) * (o.y - p.y)));
    if (nearest > bestDist) {
      bestDist = nearest;
      best = p.x;
    }
  }
  return best;
}

/**
 * Drop back in, upright and still, above this fighter's own spawn point, or
 * (smartRespawn) above the stage's spawn point farthest from any opponent.
 */
function respawn(ctx: MatchContext, f: Fighter) {
  const foot = f.shape.vertices[f.shape.footIndex];
  const x = ctx.match.smartRespawn ? safestSpawnX(ctx, f) : f.spawn.x;
  f.body.setTranslation({ x: x - foot.x, y: ctx.stage.respawnY - foot.y }, true);
  f.body.setRotation(0, true);
  f.body.setLinvel({ x: 0, y: 0 }, true);
  f.body.setAngvel(0, true);
  f.state.ko = null;
  f.state.ghostTimer = ctx.match.ghostTicks;
  f.state.ticksSinceGrounded = ctx.params.coyoteTicks + 1; // airborne, no coyote jump
  f.state.jumpCooldown = 0;
  f.state.chargeWasHeld = false;
}

/**
 * Count down post-respawn ghosting. It doesn't end while we overlap another
 * fighter: switching collisions back on mid-overlap makes Rapier shove the
 * two bodies apart violently.
 */
export function updateGhost(ctx: MatchContext, i: number) {
  const s = ctx.fighters[i].state;
  if (s.ghostTimer === 0) return;
  if (s.ghostTimer > 1 || !overlapsAnyFighter(ctx, i)) s.ghostTimer--;
}

/** Rough overlap test: bounding circles around the centroids. */
function overlapsAnyFighter(ctx: MatchContext, i: number): boolean {
  const radius = (f: Fighter) => Math.max(...f.shape.vertices.map((v) => Math.sqrt(v.x * v.x + v.y * v.y)));
  const a = ctx.fighters[i];
  const pa = a.body.translation();
  return ctx.fighters.some((b, j) => {
    if (j === i || b.state.ko) return false;
    const pb = b.body.translation();
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    const r = radius(a) + radius(b);
    return dx * dx + dy * dy < r * r;
  });
}

/**
 * The player left mid-match: their fighter is out for good, immediately (no
 * respawn delay, gone from the stage). If that leaves one fighter with stocks,
 * checkKOs ends the match as usual. Repeats are ignored.
 */
export function forfeit(ctx: MatchContext, i: number) {
  const f = ctx.fighters[i];
  if (f.state.stocks === 0) return;
  f.state.stocks = 0;
  f.state.ko = "left";
  f.state.respawnTimer = 0;
  f.state.ghostTimer = 0;
  f.state.charging = false;
  f.state.chargeTicks = 0;
  f.body.setEnabled(false);
  ctx.events.push({ type: "ko", fighter: i, reason: "left", stocksLeft: 0, final: false });
}

/** Dead bodies and post-respawn ghosts don't collide with other fighters. */
export function passesThroughFighters(ctx: MatchContext, i: number): boolean {
  const s = ctx.fighters[i].state;
  return s.ko !== null || s.ghostTimer > 0;
}
