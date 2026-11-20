// Analog touch stick on top of digital input. The sim (and the network) only
// ever see ordinary left / none / right inputs; this picks them each tick,
// like a very fast player tapping the arrow keys.
//
// What the stick's sideways position means depends on what you're doing:
//   - moving: your target SPEED. A held lean isn't stable in this game
//     (leaning makes you hop sideways ever faster until a landing topples
//     you), so like the bots (src/bots/heuristic.ts) we lean in proportion
//     to the speed error and let the hops carry us. Centered = stop, balance.
//   - charging (planted): your AIM, a lean angle for the lunge. Planted, a
//     lean holds.
//
// Angles: radians, counterclockwise positive (y-up), so leaning right is
// negative. turn = +1 is clockwise. Stick x: -1 (full left) .. +1 (full right).

import type { Input } from "./sim/types";
import type { FighterView } from "./sim/sim";

export const STICK = {
  /** m/s at full stick. */
  maxSpeed: 4,
  /** Lean (rad) per m/s of speed error, and the most we lean to change speed. */
  leanPerSpeed: 0.12,
  maxMoveLean: 0.35,
  /** Lean (rad) at full stick while charging: the steepest aim. */
  maxAimLean: 0.6,
  /** Past this lean (rad), forget the stick and get upright. */
  dangerLean: 0.6,
  /** Spin (rad/s) counted as lean, so we let off before overshooting. */
  spinDamping: 0.1,
  /**
   * The same while charging. Planted, a lean past ~0.6 rad can't be held
   * (gravity beats the motor), so approach the aim gently instead of
   * overshooting into a topple.
   */
  chargeSpinDamping: 0.25, // measured: full aim peaks at 0.51 rad (0.89 with 0.1, toppling)
  /** Start turning past this lean error (rad); stop once within releaseBand. */
  deadband: 0.05,
  releaseBand: 0.02,
};

export class StickController {
  private turn: Input["turn"] = 0;

  /** The lean (rad) the stick asks for right now. */
  desiredLean(me: FighterView, x: number, charging: boolean): number {
    const s = STICK;
    if (Math.abs(me.angle) > s.dangerLean && !charging) return 0;
    if (charging) return -x * s.maxAimLean;
    const targetVx = x * s.maxSpeed;
    return -clamp((targetVx - me.vx) * s.leanPerSpeed, -s.maxMoveLean, s.maxMoveLean);
  }

  /** The turn input for this tick. */
  next(me: FighterView, x: number, charging: boolean): Input["turn"] {
    const s = STICK;
    const damping = charging ? s.chargeSpinDamping : s.spinDamping;
    const err = me.angle - this.desiredLean(me, x, charging) + damping * me.angularVelocity;
    if (err > s.deadband) this.turn = 1;
    else if (err < -s.deadband) this.turn = -1;
    else if (Math.abs(err) < s.releaseBand) this.turn = 0;
    return this.turn;
  }

  reset() {
    this.turn = 0;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
