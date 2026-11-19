// The simulation. Rules:
//   - No DOM, no wall-clock time, no randomness. Runs the same in a browser, in
//     Node (tests), and eventually on a server or in a rollback loop.
//   - Fixed timestep. One call to step() = one tick = 1/60 s.
//   - The only way to influence a match is the per-tick inputs passed to step().
//     Keyboard, bots and network peers all go through that same door.
//   - Params are read every tick (see params.ts for which ones are "live").
//
// Rapier owns the physics state (positions, velocities, contacts). This file adds
// the game rules on top: rotation control, jumping, foot grip, and KOs.

import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type { Params } from "./params";
import {
  distanceToPlatform,
  invertedIsosceles,
  rotate,
  spawnPoints,
  type FighterShape,
  type Stage,
  type Vec2,
} from "./geometry";

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** How far (m) below a one-way platform's top a vertex may be and still count as "above" it. */
const ONE_WAY_ALLOWANCE = 0.05;

let rapierReady: Promise<void> | null = null;
/** Loads Rapier's WASM. Must be awaited once before creating a Sim. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface Input {
  /** -1 = rotate left (counterclockwise), +1 = rotate right (clockwise), 0 = none. */
  turn: -1 | 0 | 1;
  /** Held state of the charge button. What it does depends on jumpMode, see applyJump. */
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

/** A fighter: its fixed setup, its live Rapier objects, and its rule state. */
interface FighterRules {
  shape: FighterShape;
  spawn: Vec2; // spawn point (foot)
  body: RAPIER.RigidBody; // re-fetched by handle after restore()
  collider: RAPIER.Collider;
  state: FighterState;
}

/** Read-only snapshot of a fighter, for rendering and debugging. */
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

export type MatchResult = { over: false } | { over: true; winner: number | null; tick: number };

export class Sim {
  readonly stage: Stage;
  private params: Params;
  private world: RAPIER.World;
  private fighters: FighterRules[] = [];
  private platformColliders: RAPIER.Collider[] = [];
  private platformByCollider = new Map<number, number>(); // collider handle → platform index
  private fighterByBody = new Map<number, number>(); // body handle → fighter index
  private fighterByCollider = new Map<number, number>(); // collider handle → fighter index
  /** oneWaySolid[fighter][platform]: does this one-way platform block this fighter this tick? */
  private oneWaySolid: boolean[][] = [];
  private hooks: RAPIER.PhysicsHooks;
  // Collects Rapier's contact-force events (for SimEvent impacts). Also needed
  // for a Rapier quirk: world.step() silently ignores physics hooks unless an
  // event queue is passed too (see rapier's PhysicsPipeline.step).
  private eventQueue = new RAPIER.EventQueue(false);
  private gripActive: boolean[] = [];
  readonly match: MatchOptions;
  /** Events from the most recent step(). Replaced every step. */
  events: SimEvent[] = [];
  tick = 0;
  result: MatchResult = { over: false };

  /** Requires initPhysics() to have resolved. */
  constructor(stage: Stage, params: Params, match: Partial<MatchOptions> = {}) {
    this.stage = stage;
    this.params = params;
    this.match = { ...DEFAULT_MATCH, ...match };
    const spawns = this.match.spawns ?? spawnPoints(stage, this.match.players);
    this.world = new RAPIER.World({ x: 0, y: -params.gravity });
    this.world.timestep = DT;

    for (const plat of stage.platforms) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(plat.center.x, plat.center.y),
      );
      const desc = RAPIER.ColliderDesc.cuboid(plat.halfWidth, plat.halfHeight);
      // One-way platforms ask our filterContactPair hook before every contact.
      if (plat.oneWay) desc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const collider = this.world.createCollider(desc, body);
      this.platformByCollider.set(collider.handle, this.platformColliders.length);
      this.platformColliders.push(collider);
    }

    for (let i = 0; i < this.match.players; i++) {
      const shape = invertedIsosceles(params.triWidth, params.triHeight);
      const spawn = spawns[i % spawns.length];
      // Spawn so the foot (not the centroid) sits at the spawn point.
      const foot = shape.vertices[shape.footIndex];
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(spawn.x - foot.x, spawn.y - foot.y)
          .setCcdEnabled(true), // fast jumps shouldn't tunnel through platforms
      );
      const points = new Float32Array(shape.vertices.flatMap((v) => [v.x, v.y]));
      const desc = RAPIER.ColliderDesc.convexHull(points);
      if (!desc) throw new Error("degenerate fighter shape");
      // Fighters also go through the contact hook, so ghosts can pass through each other.
      desc.setDensity(params.density).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      // Report contact forces (threshold 0 = every contact); we keep fighter-vs-fighter ones.
      desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0);
      const collider = this.world.createCollider(desc, body);
      this.fighterByCollider.set(collider.handle, i);
      this.fighterByBody.set(body.handle, i);
      this.fighters.push({
        shape,
        spawn,
        body,
        collider,
        state: {
          chargeTicks: 0,
          charging: false,
          chargeWasHeld: false,
          ticksSinceGrounded: 0,
          jumpCooldown: 0,
          ko: null,
          stocks: this.match.stocks,
          respawnTimer: 0,
          ghostTimer: 0,
        },
      });
    }
    this.oneWaySolid = this.fighters.map(() => stage.platforms.map(() => false));
    this.hooks = {
      // Called by Rapier during world.step() for every contact pair involving a
      // fighter or a one-way platform. Returning null = no collision this tick.
      filterContactPair: (c1, c2, b1, b2) => {
        const f1 = this.fighterByBody.get(b1);
        const f2 = this.fighterByBody.get(b2);
        if (f1 !== undefined && f2 !== undefined) {
          // Fighter vs fighter: ghosts and dead bodies pass through everyone.
          return this.passesThroughFighters(f1) || this.passesThroughFighters(f2)
            ? null
            : RAPIER.SolverFlags.COMPUTE_IMPULSE;
        }
        const plat = this.platformByCollider.get(c1) ?? this.platformByCollider.get(c2);
        const fighter = f1 ?? f2;
        // Fighter vs platform: only one-way platforms can let a fighter through.
        const passable = plat !== undefined && this.stage.platforms[plat].oneWay;
        if (passable && fighter !== undefined && !this.oneWaySolid[fighter][plat]) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
    this.syncLiveParams();
  }

  /** Swap in a new params object. Live params take effect next tick. */
  setParams(params: Params) {
    this.params = params;
  }

  /** Advance one tick. `inputs[i]` drives fighter i. */
  step(inputs: readonly Input[]) {
    this.events = [];
    this.syncLiveParams();
    this.updateOneWaySolidity();

    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.state.ko) {
        this.updateDead(f);
        continue; // dead fighters ignore input
      }
      this.updateGhost(f, i);
      const input = inputs[i] ?? NO_INPUT;
      this.updateGrounded(f, i);
      this.applyRotation(f, input);
      this.applyJump(f, input);
      this.gripActive[i] = this.applyGrip(f, i);
    }

    this.world.step(this.eventQueue, this.hooks);
    this.eventQueue.drainContactForceEvents((e) => {
      const a = this.fighterByCollider.get(e.collider1());
      const b = this.fighterByCollider.get(e.collider2());
      if (a !== undefined && b !== undefined) this.events.push({ type: "impact", a, b, force: e.totalForceMagnitude() });
    });
    this.eventQueue.clear();
    this.tick++;

    this.checkKOs();
  }

  // ---- rules -------------------------------------------------------------

  /**
   * Grounded = foot within footTolerance of a surface. For jumpCooldownTicks after
   * a jump we count as airborne regardless: right after takeoff the foot is still
   * within tolerance, and without this one jump could trigger twice.
   */
  private updateGrounded(f: FighterRules, i: number) {
    if (f.state.jumpCooldown > 0) f.state.jumpCooldown--;
    const foot = this.worldVertices(f)[f.shape.footIndex];
    const nearSurface = this.distanceToSolid(foot, i) <= this.params.footTolerance;
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
  private applyRotation(f: FighterRules, input: Input) {
    const p = this.params;
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
  private applyJump(f: FighterRules, input: Input) {
    const p = this.params;
    const cap = Math.max(1, p.jumpChargeTicks);
    const canJump = f.state.ticksSinceGrounded <= p.coyoteTicks;
    const chargedSpeed = () => p.jumpMinSpeed + (p.jumpMaxSpeed - p.jumpMinSpeed) * (f.state.chargeTicks / cap);

    if (p.jumpMode === "manual") {
      if (input.charge) {
        f.state.chargeTicks = Math.min(f.state.chargeTicks + 1, cap);
      } else if (f.state.chargeWasHeld) {
        if (canJump) this.launch(f, chargedSpeed());
        f.state.chargeTicks = 0;
      }
    } else if (f.state.charging) {
      if (!canJump) {
        f.state.charging = false; // lost footing: charge is gone
        f.state.chargeTicks = 0;
      } else if (!input.charge) {
        this.launch(f, chargedSpeed()); // released
      } else if (++f.state.chargeTicks >= cap) {
        this.launch(f, chargedSpeed()); // hit the cap
      }
    } else if (f.state.ticksSinceGrounded === 0) {
      // Just landed (or still standing) and not yet charging.
      if (input.charge) f.state.charging = true;
      else this.launch(f, p.hopSpeed);
    }
    f.state.chargeWasHeld = input.charge;
  }

  /**
   * Jump along the body's own "up" (foot → top edge). This sets the velocity
   * along "up" to `speed` (or leaves it if already faster) rather than adding
   * `speed` on top. Auto-hops fire on the landing tick while we're still moving
   * down; adding would mostly cancel out and the hop would barely leave the
   * ground. Sideways velocity is untouched.
   */
  private launch(f: FighterRules, speed: number) {
    const p = this.params;
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
  private applyGrip(f: FighterRules, i: number): boolean {
    const p = this.params;
    if (p.gripStrength <= 0 || f.state.jumpCooldown > 0) return false;
    // Only hold a foot that was planted a moment ago. Without this, grip also
    // yanks you down out of a low hop as you descend through gripRange.
    if (f.state.ticksSinceGrounded > p.coyoteTicks) return false;
    const foot = this.worldVertices(f)[f.shape.footIndex];
    const nearTop = this.stage.platforms.some((plat, pi) => {
      if (plat.oneWay && !this.oneWaySolid[i][pi]) return false;
      const top = plat.center.y + plat.halfHeight;
      const overX = Math.abs(foot.x - plat.center.x) <= plat.halfWidth;
      return overX && foot.y >= top - p.footTolerance && foot.y <= top + p.gripRange;
    });
    if (!nearTop) return false;
    const force = p.gripStrength * f.body.mass() * p.gravity;
    f.body.applyImpulseAtPoint({ x: 0, y: -force * DT }, foot, true);
    return true;
  }

  private checkKOs() {
    const p = this.params;
    const bz = this.stage.blastZone;
    // Uses this tick's one-way solidity (decided before world.step), so a
    // fighter passing up through a wing can't be KO'd by brushing it.
    this.fighters.forEach((f, i) => {
      if (f.state.ko) return;
      const verts = this.worldVertices(f);
      // Ghosts (just respawned) can't be KO'd by touching, only by falling off.
      const touched =
        f.state.ghostTimer === 0 &&
        verts.some((v, idx) => idx !== f.shape.footIndex && this.distanceToSolid(v, i) <= p.koTolerance);
      const c = f.body.translation();
      const fell = c.x < bz.minX || c.x > bz.maxX || c.y < bz.minY || c.y > bz.maxY;
      if (touched) this.knockOut(f, "touched");
      else if (fell) this.knockOut(f, "fell");
    });
    if (!this.result.over) {
      const remaining = this.fighters.flatMap((f, i) => (f.state.stocks > 0 ? [i] : []));
      // Last fighters losing their last stocks on the same tick = draw (winner null).
      if (remaining.length <= 1) {
        this.result = { over: true, winner: remaining[0] ?? null, tick: this.tick };
        // The KO(s) this tick ended the match.
        for (const e of this.events) if (e.type === "ko") e.final = true;
      }
    }
  }

  // ---- stocks & respawning ------------------------------------------------

  private knockOut(f: FighterRules, reason: KoReason) {
    f.state.ko = reason;
    f.state.stocks--;
    const fighter = this.fighters.indexOf(f);
    this.events.push({ type: "ko", fighter, reason, stocksLeft: f.state.stocks, final: false });
    f.state.respawnTimer = this.match.respawnDelayTicks;
    f.state.ghostTimer = 0;
    f.state.charging = false;
    f.state.chargeTicks = 0;
  }

  /**
   * A KO'd body lies where it fell (passing through other fighters) for
   * respawnDelayTicks. Then it respawns if it has stocks left, otherwise it's
   * removed from the stage for good.
   */
  private updateDead(f: FighterRules) {
    if (f.state.respawnTimer > 0 && --f.state.respawnTimer > 0) return;
    if (f.state.stocks > 0) this.respawn(f);
    else if (f.body.isEnabled()) f.body.setEnabled(false); // eliminated
  }

  /** Drop back in, upright and still, above this fighter's own spawn point. */
  private respawn(f: FighterRules) {
    const foot = f.shape.vertices[f.shape.footIndex];
    f.body.setTranslation({ x: f.spawn.x - foot.x, y: this.stage.respawnY - foot.y }, true);
    f.body.setRotation(0, true);
    f.body.setLinvel({ x: 0, y: 0 }, true);
    f.body.setAngvel(0, true);
    f.state.ko = null;
    f.state.ghostTimer = this.match.ghostTicks;
    f.state.ticksSinceGrounded = this.params.coyoteTicks + 1; // airborne, no coyote jump
    f.state.jumpCooldown = 0;
    f.state.chargeWasHeld = false;
  }

  /**
   * Count down post-respawn ghosting. It doesn't end while we overlap another
   * fighter: switching collisions back on mid-overlap makes Rapier shove the
   * two bodies apart violently.
   */
  private updateGhost(f: FighterRules, i: number) {
    if (f.state.ghostTimer === 0) return;
    if (f.state.ghostTimer > 1 || !this.overlapsAnyFighter(i)) f.state.ghostTimer--;
  }

  /** Rough overlap test: bounding circles around the centroids. */
  private overlapsAnyFighter(i: number): boolean {
    const radius = (f: FighterRules) => Math.max(...f.shape.vertices.map((v) => Math.sqrt(v.x * v.x + v.y * v.y)));
    const a = this.fighters[i];
    const pa = a.body.translation();
    return this.fighters.some((b, j) => {
      if (j === i || b.state.ko) return false;
      const pb = b.body.translation();
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const r = radius(a) + radius(b);
      return dx * dx + dy * dy < r * r;
    });
  }

  /** Dead bodies and post-respawn ghosts don't collide with other fighters. */
  private passesThroughFighters(i: number): boolean {
    const f = this.fighters[i];
    return f.state.ko !== null || f.state.ghostTimer > 0;
  }

  /**
   * Whether each one-way platform blocks each fighter this tick. Decided once
   * per tick, before physics, and used by the contact hook, the grounded
   * check, grip, and KO checks alike, so they always agree.
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
  private updateOneWaySolidity() {
    this.fighters.forEach((f, i) => {
      const lowest = Math.min(...this.worldVertices(f).map((v) => v.y));
      const fallPerTick = Math.max(0, -f.body.linvel().y) * DT;
      this.stage.platforms.forEach((plat, pi) => {
        if (!plat.oneWay) return;
        const top = plat.center.y + plat.halfHeight;
        const allowance = this.oneWaySolid[i][pi]
          ? 2 * plat.halfHeight // already standing on it: stay solid
          : ONE_WAY_ALLOWANCE + 2 * fallPerTick; // 2x: safety margin
        this.oneWaySolid[i][pi] = lowest >= top - allowance;
      });
    });
  }

  /** Distance from a point to the nearest platform that is solid for fighter i. */
  private distanceToSolid(point: Vec2, i: number): number {
    let best = Infinity;
    this.stage.platforms.forEach((plat, pi) => {
      if (plat.oneWay && !this.oneWaySolid[i][pi]) return;
      best = Math.min(best, distanceToPlatform(point, plat));
    });
    return best;
  }

  private syncLiveParams() {
    const p = this.params;
    this.world.gravity = { x: 0, y: -p.gravity };
    for (const f of this.fighters) {
      f.collider.setFriction(p.friction);
      f.collider.setRestitution(p.restitution);
      f.body.setAngularDamping(p.angularDamping);
    }
    for (const c of this.platformColliders) {
      c.setFriction(p.friction);
      c.setRestitution(p.restitution);
    }
  }

  // ---- queries -----------------------------------------------------------

  private worldVertices(f: FighterRules): Vec2[] {
    const t = f.body.translation();
    const a = f.body.rotation();
    return f.shape.vertices.map((v) => {
      const r = rotate(v, a);
      return { x: t.x + r.x, y: t.y + r.y };
    });
  }

  view(): FighterView[] {
    const p = this.params;
    return this.fighters.map((f, i) => {
      const t = f.body.translation();
      return {
        x: t.x,
        y: t.y,
        angle: f.body.rotation(),
        angularVelocity: f.body.angvel(),
        vx: f.body.linvel().x,
        vy: f.body.linvel().y,
        vertices: this.worldVertices(f),
        footIndex: f.shape.footIndex,
        grounded: f.state.ticksSinceGrounded === 0,
        canJump: f.state.ticksSinceGrounded <= p.coyoteTicks,
        gripActive: this.gripActive[i] ?? false,
        charge: p.jumpChargeTicks > 0 ? f.state.chargeTicks / p.jumpChargeTicks : 0,
        ko: f.state.ko,
        stocks: f.state.stocks,
        eliminated: f.state.stocks === 0 && !f.body.isEnabled(),
        ghost: f.state.ghostTimer > 0,
      };
    });
  }

  /** Physics snapshot bytes. Used by the determinism test; later, by rollback. */
  physicsSnapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  /**
   * Everything needed to resume this match exactly from this tick: Rapier's
   * world plus our rule state. The returned object is a deep copy; later steps
   * don't change it. Used for rollback (save every tick, restore on a
   * misprediction) and for replays.
   *
   * Not included: stage, match options and params. Those are match setup, the
   * same on every client for the whole match. (Tweaking params mid-match from
   * the panel is a local-only convenience and makes saved states stale.)
   */
  save(): SimState {
    return {
      physics: this.world.takeSnapshot(),
      fighters: structuredClone(this.fighters.map((f) => f.state)),
      oneWaySolid: structuredClone(this.oneWaySolid),
      gripActive: [...this.gripActive],
      tick: this.tick,
      result: structuredClone(this.result),
      events: structuredClone(this.events),
    };
  }

  /**
   * A short fingerprint of the full match state (FNV-1a, 32-bit, as 8 hex
   * chars). Two sims with the same hash are, for all practical purposes, in
   * the same state. Used to detect desyncs (replays now, online clients later).
   * JSON.stringify of numbers is exactly specified, so this is engine-independent.
   */
  hash(): string {
    const s = this.save();
    const rules = JSON.stringify([s.fighters, s.oneWaySolid, s.tick, s.result]);
    let h = 0x811c9dc5;
    const mix = (byte: number) => {
      h ^= byte;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (const b of s.physics) mix(b);
    for (let i = 0; i < rules.length; i++) mix(rules.charCodeAt(i) & 0xff);
    return h.toString(16).padStart(8, "0");
  }

  /** Rewind (or jump) to a state from save(). The state object isn't modified. */
  restore(s: SimState) {
    // Rapier restores into a brand-new World; rebind our objects by handle
    // (handles survive snapshots).
    const bodyHandles = this.fighters.map((f) => f.body.handle);
    const colliderHandles = this.fighters.map((f) => f.collider.handle);
    const platformHandles = this.platformColliders.map((c) => c.handle);
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(s.physics);
    this.world.timestep = DT;
    this.fighters.forEach((f, i) => {
      f.body = this.world.getRigidBody(bodyHandles[i]);
      f.collider = this.world.getCollider(colliderHandles[i]);
    });
    this.platformColliders = platformHandles.map((h) => this.world.getCollider(h));

    this.fighters.forEach((f, i) => (f.state = structuredClone(s.fighters[i])));
    this.oneWaySolid = structuredClone(s.oneWaySolid);
    this.gripActive = [...s.gripActive];
    this.tick = s.tick;
    this.result = structuredClone(s.result);
    this.events = structuredClone(s.events);
  }

  free() {
    this.world.free();
    this.eventQueue.free();
  }
}
