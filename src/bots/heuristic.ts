// A hand-written bot. It only reads FighterView (the same info the renderer
// gets) and returns an Input, exactly like a keyboard would. No access to sim
// internals.
//
// Each tick it decides, in priority order:
//   1. Danger: leaning too far? Drop everything and get upright.
//   2. Edge: would we skid past the edge if we started braking now? Head back.
//   3. Attack: opponent close and we're steady? Plant, aim, charge, release = lunge.
//   4. Approach: move toward the opponent at a cruising speed.
//
// Movement is speed control, not position control: pick a target horizontal
// speed, lean in proportion to (target − current), and let the auto-hops push
// us along our lean. That way the bot brakes naturally instead of overshooting.
//
// Then a small controller turns "desired lean angle" into turn = -1/0/+1.
// Tuned for the defaults (servo rotation + auto jump).

import { clamp, platformTop, type Platform, type Stage } from "../sim/geometry";
import type { Params } from "../sim/params";
import type { FighterView, Input } from "../sim/sim";

export interface BotConfig {
  /**
   * The bot sees its opponent this many ticks late (~10–15 is human-ish).
   * That's the main handicap: it decides when to attack based on stale info.
   */
  reactionTicks: number;
  /**
   * The bot sees its *own* body this many ticks late. Kept small on purpose:
   * balancing on a point with a long delay is unstable (every correction
   * arrives too late and the wobble grows). People feel their own lean
   * continuously; reaction time mainly limits responding to the opponent.
   */
  selfReactionTicks: number;
  /** Cruising speed (m/s) when walking toward the opponent. */
  cruiseSpeed: number;
  /** Target speed per meter of distance, so it slows as it arrives. */
  approachGain: number;
  /** Lean (radians) per m/s of speed error. */
  leanPerSpeed: number;
  /** Max lean (radians) used for moving and braking. */
  maxLean: number;
  /** Lean (radians) while aiming a lunge. */
  attackLean: number;
  /** Start an attack when the opponent is within this many meters... */
  attackRange: number;
  /** ...and we're moving slower than this (m/s). */
  attackMaxSpeed: number;
  /** Release the lunge at this charge fraction (0..1). */
  attackCharge: number;
  /** Past this lean (radians), ignore everything else and recover. */
  dangerLean: number;
  /** Keep the predicted stopping point this far (m) from the edge. */
  edgeMargin: number;
  /** Stopping distance ≈ brakeCoef × speed². Measured, see scripts/bot-arena.ts. */
  brakeCoef: number;
  /** Controller damping: how much spin (rad/s) counts as lean (rad). */
  spinDamping: number;
  /** Don't twitch for errors smaller than this (radians). */
  deadband: number;
  /** Seed for the bot's own randomness (attack timing jitter). */
  seed: number;
}

export const DEFAULT_BOT: BotConfig = {
  reactionTicks: 12,
  selfReactionTicks: 2,
  cruiseSpeed: 2,
  approachGain: 1.5,
  leanPerSpeed: 0.12,
  maxLean: 0.3,
  attackLean: 0.25,
  attackRange: 1.6,
  attackMaxSpeed: 1.5,
  attackCharge: 0.5,
  dangerLean: 0.6,
  edgeMargin: 0.8,
  brakeCoef: 0.15,
  spinDamping: 0.1,
  deadband: 0.03,
  seed: 1,
};

export type BotMode = "move" | "brake" | "attack" | "recover" | "climb" | "drop";

export class HeuristicBot {
  private history: FighterView[][] = [];
  private rng: () => number;
  private chargeHeldTicks = 0;
  private cooldown = 0; // ticks before the next attack is allowed
  /** What the bot is doing, for the debug overlay. */
  mode: BotMode = "move";

  constructor(
    private me: number,
    private cfg: BotConfig = DEFAULT_BOT,
  ) {
    this.rng = mulberry32(cfg.seed);
    // Random delay before the first attack too, or two bots open identically.
    this.cooldown = Math.floor(this.rng() * 40);
  }

  /**
   * `params` is the game's public tuning (gravity, jump speeds...). The bot uses
   * it the way a player uses experience: to judge how much charge a jump needs.
   */
  think(fighters: FighterView[], stage: Stage, params: Params): Input {
    const c = this.cfg;
    this.history.push(fighters);
    const keep = Math.max(c.reactionTicks, c.selfReactionTicks) + 1;
    while (this.history.length > keep) this.history.shift();
    const ago = (n: number) => this.history[Math.max(0, this.history.length - 1 - n)];

    const me = ago(c.selfReactionTicks)[this.me];
    if (me.ko) return { turn: 0, charge: false };
    const opp = nearestOpponent(ago(c.reactionTicks), this.me, me);
    const plat = platformUnder(me, stage);
    if (this.cooldown > 0) this.cooldown--;

    let desiredLean = 0; // radians, + = lean left (counterclockwise)
    let charge = false;
    const edge = plat ? edgeDanger(me, plat, stage, c) : 0;

    if (Math.abs(me.angle) > c.dangerLean) {
      // 1. Danger
      this.abortAttack();
      this.mode = "recover";
    } else if (edge !== 0) {
      // 2. Edge: head back toward the middle (edge = +1 means right edge).
      this.abortAttack();
      this.mode = "brake";
      desiredLean = leanForSpeed(me, -edge * c.cruiseSpeed, c);
    } else if (opp && (this.mode === "climb" || isAbove(opp, me, stage))) {
      // 3a. Climb: opponent stands on a higher platform. Get under them, charge
      // just enough, and jump up through it (one-way platforms allow that).
      this.climb(me, opp, stage, params, (lean, chg) => ((desiredLean = lean), (charge = chg)));
    } else if (opp && plat && isAbove(me, opp, stage)) {
      // 3b. Drop: opponent is below us. Walk off an edge that has ground under it.
      this.mode = "drop";
      const edgeX = safeDropEdge(plat, stage, opp.x);
      if (edgeX === null) desiredLean = leanForSpeed(me, 0, c); // nowhere safe: hold
      else {
        const past = edgeX + Math.sign(edgeX - plat.center.x) * 0.8; // aim a bit past the edge
        desiredLean = leanForSpeed(me, clamp((past - me.x) * c.approachGain, -c.cruiseSpeed, c.cruiseSpeed), c);
      }
    } else if (opp) {
      const dx = opp.x - me.x;
      const canStartAttack =
        this.cooldown === 0 &&
        Math.abs(dx) < c.attackRange &&
        Math.abs(opp.y - me.y) < 1 &&
        Math.abs(me.vx) < c.attackMaxSpeed;
      if (this.mode === "attack" || canStartAttack) {
        // 3. Attack: hold charge (plants us on the next landing), aim, release.
        this.mode = "attack";
        desiredLean = -Math.sign(dx) * c.attackLean;
        charge = true;
        this.chargeHeldTicks++;
        const charged = me.charge >= c.attackCharge;
        const gaveUp = this.chargeHeldTicks > 90; // e.g. never managed to land
        if (charged || gaveUp) {
          charge = false; // release = lunge
          this.abortAttack();
        }
      } else {
        // 4. Approach
        this.mode = "move";
        const targetVx = clamp(dx * c.approachGain, -c.cruiseSpeed, c.cruiseSpeed);
        desiredLean = leanForSpeed(me, targetVx, c);
      }
    }

    return { turn: steer(me, desiredLean, c), charge };
  }

  private climb(
    me: FighterView,
    opp: FighterView,
    stage: Stage,
    params: Params,
    out: (lean: number, charge: boolean) => void,
  ) {
    const c = this.cfg;
    const target = platformUnder(opp, stage)!;
    const top = platformTop(target);
    // Charge needed so the foot clears the top: v = sqrt(2 g h), then map v
    // onto the charge range [jumpMinSpeed, jumpMaxSpeed].
    const rise = top - me.vertices[me.footIndex].y + CLIMB_CLEARANCE;
    const speed = Math.sqrt(2 * params.gravity * Math.max(rise, 0));
    const span = params.jumpMaxSpeed - params.jumpMinSpeed;
    const needed = span > 0 ? (speed - params.jumpMinSpeed) / span : 0;
    if (needed > 1) {
      // Out of reach with these jump settings: just hang around underneath.
      this.mode = "move";
      out(leanForSpeed(me, clamp((opp.x - me.x) * c.approachGain, -c.cruiseSpeed, c.cruiseSpeed), c), false);
      return;
    }
    // Jump from under the target platform, a bit in from its ends.
    const left = target.center.x - target.halfWidth + 0.6;
    const right = target.center.x + target.halfWidth - 0.6;
    const launchX = clamp(opp.x, left, right);
    const inPosition = Math.abs(me.x - launchX) < 0.6 && Math.abs(me.vx) < 1;
    if (this.mode === "climb" || inPosition) {
      this.mode = "climb";
      this.chargeHeldTicks++;
      if (me.charge >= Math.max(needed, 0) + 0.08 || this.chargeHeldTicks > 90) {
        this.mode = "move"; // release = jump straight up
        this.chargeHeldTicks = 0;
        out(0, false);
      } else out(0, true);
    } else {
      this.mode = "move";
      out(leanForSpeed(me, clamp((launchX - me.x) * c.approachGain, -c.cruiseSpeed, c.cruiseSpeed), c), false);
    }
  }

  private abortAttack() {
    if (this.mode === "attack") {
      this.cooldown = 30 + Math.floor(this.rng() * 40); // jitter so bots don't mirror
    }
    this.mode = "move";
    this.chargeHeldTicks = 0;
  }
}

/** Extra height (m) to clear when jumping up onto a platform. */
const CLIMB_CLEARANCE = 0.5;

/** Is `a` standing on (or hopping just above) a platform clearly higher than `b`'s? */
function isAbove(a: FighterView, b: FighterView, stage: Stage): boolean {
  const pa = platformUnder(a, stage);
  const pb = platformUnder(b, stage);
  if (!pa || !pb) return false;
  const nearItsPlatform = a.vertices[a.footIndex].y - platformTop(pa) < 1;
  return nearItsPlatform && platformTop(pa) > platformTop(pb) + 0.5;
}

/** Is there a platform below this x, lower than `plat`? (So stepping off here is safe.) */
function groundBelow(x: number, plat: Platform, stage: Stage): boolean {
  return stage.platforms.some(
    (p) => p !== plat && platformTop(p) < platformTop(plat) && Math.abs(x - p.center.x) <= p.halfWidth,
  );
}

/** The x of an edge of `plat` with ground below it, preferring the one nearer `towardX`. */
function safeDropEdge(plat: Platform, stage: Stage, towardX: number): number | null {
  const edges = [plat.center.x - plat.halfWidth, plat.center.x + plat.halfWidth]
    .filter((x) => groundBelow(x + Math.sign(x - plat.center.x) * 0.6, plat, stage))
    .sort((a, b) => Math.abs(a - towardX) - Math.abs(b - towardX));
  return edges[0] ?? null;
}

/** Lean that pushes our speed toward targetVx. Lean right (negative) to speed up rightward. */
function leanForSpeed(me: FighterView, targetVx: number, c: BotConfig): number {
  return -clamp((targetVx - me.vx) * c.leanPerSpeed, -c.maxLean, c.maxLean);
}

/**
 * Bang-bang controller with a little damping. Error = how much further left we
 * lean than desired, plus some spin, so we let off before overshooting.
 * Leaning too far left → turn clockwise (+1). Keep spinDamping small in servo
 * mode, since releasing the key already brakes the spin.
 */
function steer(me: FighterView, desiredLean: number, c: BotConfig): Input["turn"] {
  const err = me.angle - desiredLean + c.spinDamping * me.angularVelocity;
  if (err > c.deadband) return 1;
  if (err < -c.deadband) return -1;
  return 0;
}

/**
 * Would we skid past the edge if we started braking now? Uses the predicted
 * stopping point (stopping distance grows with speed²). +1 = right edge, -1 = left.
 * Only edges with nothing below them count.
 */
function edgeDanger(me: FighterView, plat: Platform, stage: Stage, c: BotConfig): -1 | 0 | 1 {
  const stopX = me.x + me.vx * Math.abs(me.vx) * c.brakeCoef;
  const right = plat.center.x + plat.halfWidth;
  const left = plat.center.x - plat.halfWidth;
  // Edges with ground below them (like a wing's inner end) are safe to leave.
  const rightSafe = groundBelow(right + 0.6, plat, stage);
  const leftSafe = groundBelow(left - 0.6, plat, stage);
  if (!rightSafe && Math.max(me.x, stopX) > right - c.edgeMargin) return 1;
  if (!leftSafe && Math.min(me.x, stopX) < left + c.edgeMargin) return -1;
  return 0;
}

function nearestOpponent(fighters: FighterView[], meIndex: number, me: FighterView): FighterView | null {
  let best: FighterView | null = null;
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i];
    if (i === meIndex || f.ko) continue;
    if (!best || Math.abs(f.x - me.x) < Math.abs(best.x - me.x)) best = f;
  }
  return best;
}

/** The highest platform below us that we're over (or the nearest one if none). */
function platformUnder(me: FighterView, stage: Stage): Platform | null {
  let best: Platform | null = null;
  for (const p of stage.platforms) {
    const over = Math.abs(me.x - p.center.x) <= p.halfWidth;
    const below = platformTop(p) <= me.y;
    if (over && below && (!best || p.center.y > best.center.y)) best = p;
  }
  if (best) return best;
  let nearest: Platform | null = null;
  for (const p of stage.platforms) {
    if (!nearest || Math.abs(p.center.x - me.x) < Math.abs(nearest.center.x - me.x)) nearest = p;
  }
  return nearest;
}

/** Tiny seeded PRNG, so a bot with the same seed makes the same choices. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
