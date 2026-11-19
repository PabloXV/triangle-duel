// How a fighter moves: the grounded check, rotation, jumping, and foot grip.
// These are the "feel" rules; most tuning happens via the params they read.

import { platformTop, rotate } from "./geometry";
import { footPosition, type Fighter, type MatchContext } from "./fighter";
import { distanceToSolid, isSolidFor } from "./platforms";
import { DT, type Input } from "./types";

/**
 * Grounded = foot within footTolerance of a surface. For jumpCooldownTicks after
 * a jump we count as airborne regardless: right after takeoff the foot is still
 * within tolerance, and without this one jump could trigger twice.
 */
export function updateGrounded(ctx: MatchContext, f: Fighter, i: number) {
  if (f.state.jumpCooldown > 0) f.state.jumpCooldown--;
  const nearSurface = distanceToSolid(ctx, footPosition(f), i) <= ctx.params.footTolerance;
  const grounded = nearSurface && f.state.jumpCooldown === 0;
  f.state.ticksSinceGrounded = grounded ? 0 : f.state.ticksSinceGrounded + 1;
}

/**
 * Either way, rotation is a capped torque: it competes with gravity, friction,
 * collisions and momentum, so it can be overpowered. The two modes differ in
 * what the player's input *means*:
 *
 *   "torque": holding the key applies rotateTorque. Spin builds up the longer
 *             you hold, and releasing does nothing; the momentum stays.
 *   "servo":  the key sets a target spin rate (servoSpeed, or 0 when
 *             released) and a motor pushes toward it with at most
 *             rotateTorque. Releasing actively brakes, but a big enough lean
 *             (or a hit) still beats the motor.
 */
export function applyRotation(ctx: MatchContext, f: Fighter, input: Input) {
  const p = ctx.params;
  const grounded = f.state.ticksSinceGrounded === 0;
  let scale = 1;
  if (!grounded) scale = p.airRotation ? p.airRotationScale : 0;
  const maxTorque = p.rotateTorque * scale;
  // turn=+1 means clockwise, which is negative in a y-up world.
  let torque: number;
  if (p.rotationMode === "torque") {
    torque = -input.turn * maxTorque;
  } else {
    const targetSpin = -input.turn * p.servoSpeed;
    // Proportional control: push harder the further we are from the target spin.
    // (Not "exact torque to hit the target in one tick": that needs the inertia,
    // which depends on whether we pivot about the center or the planted foot.)
    const needed = p.servoStiffness * (targetSpin - f.body.angvel());
    torque = Math.max(-maxTorque, Math.min(maxTorque, needed));
  }
  if (torque !== 0) f.body.applyTorqueImpulse(torque * DT, true);
}

/**
 * Two jump modes, both driven by the one charge button:
 *
 *   "auto":   Not holding: you hop (hopSpeed) every time your foot lands.
 *             Holding: the next landing plants you instead and you charge.
 *             Releasing jumps at the current charge; reaching full charge
 *             jumps automatically. Losing your footing (past coyote time)
 *             while charging throws the charge away.
 *
 *   "manual": Charge builds while held, even in the air, so you can
 *             pre-charge. Releasing jumps if grounded or within coyote time;
 *             otherwise the charge is thrown away. No auto-hop, no auto-release.
 */
export function applyJump(ctx: MatchContext, f: Fighter, input: Input) {
  const p = ctx.params;
  const s = f.state;
  const cap = Math.max(1, p.jumpChargeTicks);
  const canJump = s.ticksSinceGrounded <= p.coyoteTicks;
  const chargedSpeed = () => p.jumpMinSpeed + (p.jumpMaxSpeed - p.jumpMinSpeed) * (s.chargeTicks / cap);

  if (p.jumpMode === "manual") {
    if (input.charge) {
      s.chargeTicks = Math.min(s.chargeTicks + 1, cap);
    } else if (s.chargeWasHeld) {
      if (canJump) launch(ctx, f, chargedSpeed());
      s.chargeTicks = 0;
    }
  } else if (s.charging) {
    if (!canJump) {
      s.charging = false; // lost footing: charge is gone
      s.chargeTicks = 0;
    } else if (!input.charge) {
      launch(ctx, f, chargedSpeed()); // released
    } else if (++s.chargeTicks >= cap) {
      launch(ctx, f, chargedSpeed()); // hit the cap
    }
  } else if (s.ticksSinceGrounded === 0) {
    // Just landed (or still standing) and not yet charging.
    if (input.charge) s.charging = true;
    else launch(ctx, f, p.hopSpeed);
  }
  s.chargeWasHeld = input.charge;
}

/**
 * Jump along the body's own "up" (foot → top edge). This sets the velocity
 * along "up" to `speed` (or leaves it if already faster) rather than adding
 * `speed` on top. Auto-hops fire on the landing tick while we're still moving
 * down; adding would mostly cancel out and the hop would barely leave the
 * ground. Sideways velocity is untouched.
 */
function launch(ctx: MatchContext, f: Fighter, speed: number) {
  const p = ctx.params;
  const up = rotate({ x: 0, y: 1 }, f.body.rotation());
  const v = f.body.linvel();
  const along = v.x * up.x + v.y * up.y;
  const boost = Math.max(0, speed - along);
  f.body.setLinvel({ x: v.x + up.x * boost, y: v.y + up.y * boost }, true);
  f.state.ticksSinceGrounded = p.coyoteTicks + 1; // no second jump off coyote time
  f.state.jumpCooldown = p.jumpCooldownTicks; // airborne for a moment, no grip pulling us back
  f.state.charging = false;
  f.state.chargeTicks = 0;
}

/**
 * Foot grip: a downward pull on the foot vertex while it's near the top of a
 * platform. While the foot is in contact, the pull is cancelled by the
 * ground's push at the same point, so it adds no torque. Its effects are:
 *   1. more friction (friction scales with how hard you press down),
 *   2. if the foot starts to lift, it's pulled back down.
 * It's a capped force, so a hard enough hit still knocks the foot loose.
 * Only acts while grounded or within coyote time (so not mid-hop), and
 * only on platform tops, not sides or undersides. Returns whether it acted.
 */
export function applyGrip(ctx: MatchContext, f: Fighter, i: number): boolean {
  const p = ctx.params;
  if (p.gripStrength <= 0 || f.state.jumpCooldown > 0) return false;
  // Only hold a foot that was planted a moment ago. Without this, grip also
  // yanks you down out of a low hop as you descend through gripRange.
  if (f.state.ticksSinceGrounded > p.coyoteTicks) return false;
  const foot = footPosition(f);
  const nearTop = ctx.stage.platforms.some((plat, pi) => {
    if (!isSolidFor(ctx, i, pi)) return false;
    const top = platformTop(plat);
    const overX = Math.abs(foot.x - plat.center.x) <= plat.halfWidth;
    return overX && foot.y >= top - p.footTolerance && foot.y <= top + p.gripRange;
  });
  if (!nearTop) return false;
  const force = p.gripStrength * f.body.mass() * p.gravity;
  f.body.applyImpulseAtPoint({ x: 0, y: -force * DT }, foot, true);
  return true;
}
