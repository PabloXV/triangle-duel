// The simulation. Rules:
//   - No DOM, no wall-clock time, no randomness. Runs the same in a browser, in
//     Node (tests), and on a server or in a rollback loop.
//   - Fixed timestep. One call to step() = one tick = 1/60 s.
//   - The only way to influence a match is the per-tick inputs passed to step().
//     Keyboard, bots and network peers all go through that same door.
//   - Params are read every tick (see params.ts for which ones are "live").
//
// Rapier owns the physics state (positions, velocities, contacts). This file
// sets up the world and runs each tick in a fixed order; the game rules live in:
//   movement.ts   grounded check, rotation, jumping, foot grip
//   lives.ts      KOs, stocks, respawning, ghosting, match end
//   platforms.ts  one-way platform solidity
// and fighter.ts holds the shared match context those modules operate on.

import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type { Params } from "./params";
import { invertedIsosceles, spawnPoints, type Stage } from "./geometry";
import { freshFighterState, worldVertices, type MatchContext } from "./fighter";
import { applyGrip, applyJump, applyRotation, updateGrounded } from "./movement";
import { checkKOs, forfeit, passesThroughFighters, updateDead, updateGhost } from "./lives";
import { updateOneWaySolidity } from "./platforms";
import { scaleShape } from "./shapes";
import {
  DEFAULT_MATCH,
  DT,
  NO_INPUT,
  type FighterView,
  type Input,
  type MatchOptions,
  type MatchResult,
  type SimEvent,
  type SimState,
} from "./types";

export * from "./types";

/** The fingerprint of a saved state (see Sim.hash). */
export function hashState(s: SimState): string {
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

let rapierReady: Promise<void> | null = null;
/** Loads Rapier's WASM. Must be awaited once before creating a Sim. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class Sim {
  private ctx: MatchContext;
  private world: RAPIER.World;
  private platformColliders: RAPIER.Collider[] = [];
  private platformByCollider = new Map<number, number>(); // collider handle → platform index
  private fighterByBody = new Map<number, number>(); // body handle → fighter index
  private fighterByCollider = new Map<number, number>(); // collider handle → fighter index
  private hooks: RAPIER.PhysicsHooks;
  // Collects Rapier's contact-force events (for SimEvent impacts). Also needed
  // for a Rapier quirk: world.step() silently ignores physics hooks unless an
  // event queue is passed too (see rapier's PhysicsPipeline.step).
  private eventQueue = new RAPIER.EventQueue(false);

  get stage(): Stage {
    return this.ctx.stage;
  }
  get match(): MatchOptions {
    return this.ctx.match;
  }
  get tick(): number {
    return this.ctx.tick;
  }
  get result(): MatchResult {
    return this.ctx.result;
  }
  /** Events from the most recent step(). Replaced every step. */
  get events(): SimEvent[] {
    return this.ctx.events;
  }

  /**
   * Requires initPhysics() to have resolved. `params` is read every tick, so
   * editing the object (e.g. from the panel) affects the running match.
   */
  constructor(stage: Stage, params: Params, match: Partial<MatchOptions> = {}) {
    const fullMatch = { ...DEFAULT_MATCH, ...match };
    const spawns = fullMatch.spawns ?? spawnPoints(stage, fullMatch.players);
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

    const fighters = Array.from({ length: fullMatch.players }, (_, i) => {
      // Custom shapes are unit-area; scale them to the standard fighter's area (same mass).
      const custom = fullMatch.shapes?.[i];
      const shape = custom
        ? scaleShape(custom, Math.sqrt((params.triWidth * params.triHeight) / 2))
        : invertedIsosceles(params.triWidth, params.triHeight);
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
      return { shape, spawn, body, collider, state: freshFighterState(fullMatch.stocks) };
    });

    this.ctx = {
      stage,
      params,
      match: fullMatch,
      fighters,
      oneWaySolid: fighters.map(() => stage.platforms.map(() => false)),
      gripActive: [],
      events: [],
      tick: 0,
      result: { over: false },
    };

    this.hooks = {
      // Called by Rapier during world.step() for every contact pair involving a
      // fighter or a one-way platform. Returning null = no collision this tick.
      filterContactPair: (c1, c2, b1, b2) => {
        const f1 = this.fighterByBody.get(b1);
        const f2 = this.fighterByBody.get(b2);
        if (f1 !== undefined && f2 !== undefined) {
          // Fighter vs fighter: ghosts and dead bodies pass through everyone.
          return passesThroughFighters(this.ctx, f1) || passesThroughFighters(this.ctx, f2)
            ? null
            : RAPIER.SolverFlags.COMPUTE_IMPULSE;
        }
        const plat = this.platformByCollider.get(c1) ?? this.platformByCollider.get(c2);
        const fighter = f1 ?? f2;
        // Fighter vs platform: only one-way platforms can let a fighter through.
        const passable = plat !== undefined && this.ctx.stage.platforms[plat].oneWay;
        if (passable && fighter !== undefined && !this.ctx.oneWaySolid[fighter][plat]) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
    this.syncLiveParams();
  }

  /** Advance one tick. `inputs[i]` drives fighter i. The order here is part of the game rules. */
  step(inputs: readonly Input[]) {
    const ctx = this.ctx;
    ctx.events = [];
    this.syncLiveParams();
    updateOneWaySolidity(ctx);
    // Players who left this step are removed first, wherever they are (even mid-respawn).
    ctx.fighters.forEach((_, i) => {
      if (inputs[i]?.left) forfeit(ctx, i);
    });

    ctx.fighters.forEach((f, i) => {
      if (f.state.ko) {
        updateDead(ctx, f);
        return; // dead fighters ignore input
      }
      updateGhost(ctx, i);
      const input = inputs[i] ?? NO_INPUT;
      updateGrounded(ctx, f, i);
      applyRotation(ctx, f, input);
      applyJump(ctx, f, input);
      ctx.gripActive[i] = applyGrip(ctx, f, i);
    });

    this.world.step(this.eventQueue, this.hooks);
    this.eventQueue.drainContactForceEvents((e) => {
      const a = this.fighterByCollider.get(e.collider1());
      const b = this.fighterByCollider.get(e.collider2());
      if (a !== undefined && b !== undefined) ctx.events.push({ type: "impact", a, b, force: e.totalForceMagnitude() });
    });
    this.eventQueue.clear();
    ctx.tick++;

    checkKOs(ctx);
  }

  /** Push the live (panel-tunable) physical params into Rapier. */
  private syncLiveParams() {
    const p = this.ctx.params;
    this.world.gravity = { x: 0, y: -p.gravity };
    for (const f of this.ctx.fighters) {
      f.collider.setFriction(p.friction);
      f.collider.setRestitution(p.restitution);
      f.body.setAngularDamping(p.angularDamping);
    }
    for (const c of this.platformColliders) {
      c.setFriction(p.friction);
      c.setRestitution(p.restitution);
    }
  }

  // ---- reading the state -------------------------------------------------

  view(): FighterView[] {
    const { params: p, fighters, gripActive } = this.ctx;
    return fighters.map((f, i) => {
      const t = f.body.translation();
      return {
        x: t.x,
        y: t.y,
        angle: f.body.rotation(),
        angularVelocity: f.body.angvel(),
        vx: f.body.linvel().x,
        vy: f.body.linvel().y,
        vertices: worldVertices(f),
        footIndex: f.shape.footIndex,
        grounded: f.state.ticksSinceGrounded === 0,
        canJump: f.state.ticksSinceGrounded <= p.coyoteTicks,
        gripActive: gripActive[i] ?? false,
        charge: p.jumpChargeTicks > 0 ? f.state.chargeTicks / p.jumpChargeTicks : 0,
        ko: f.state.ko,
        stocks: f.state.stocks,
        eliminated: f.state.stocks === 0 && !f.body.isEnabled(),
        ghost: f.state.ghostTimer > 0,
      };
    });
  }

  // ---- save / restore / fingerprint -----------------------------------------

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
    const ctx = this.ctx;
    return {
      physics: this.world.takeSnapshot(),
      fighters: structuredClone(ctx.fighters.map((f) => f.state)),
      oneWaySolid: structuredClone(ctx.oneWaySolid),
      gripActive: [...ctx.gripActive],
      tick: ctx.tick,
      result: structuredClone(ctx.result),
      events: structuredClone(ctx.events),
    };
  }

  /** Rewind (or jump) to a state from save(). The state object isn't modified. */
  restore(s: SimState) {
    const ctx = this.ctx;
    // Rapier restores into a brand-new World; rebind our objects by handle
    // (handles survive snapshots).
    const bodyHandles = ctx.fighters.map((f) => f.body.handle);
    const colliderHandles = ctx.fighters.map((f) => f.collider.handle);
    const platformHandles = this.platformColliders.map((c) => c.handle);
    this.world.free();
    this.world = RAPIER.World.restoreSnapshot(s.physics);
    this.world.timestep = DT;
    ctx.fighters.forEach((f, i) => {
      f.body = this.world.getRigidBody(bodyHandles[i]);
      f.collider = this.world.getCollider(colliderHandles[i]);
    });
    this.platformColliders = platformHandles.map((h) => this.world.getCollider(h));

    ctx.fighters.forEach((f, i) => (f.state = structuredClone(s.fighters[i])));
    ctx.oneWaySolid = structuredClone(s.oneWaySolid);
    ctx.gripActive = [...s.gripActive];
    ctx.tick = s.tick;
    ctx.result = structuredClone(s.result);
    ctx.events = structuredClone(s.events);
  }

  /**
   * A short fingerprint of the full match state (FNV-1a, 32-bit, as 8 hex
   * chars). Two sims with the same hash are, for all practical purposes, in
   * the same state. Used to detect desyncs (replays now, online clients later).
   * JSON.stringify of numbers is exactly specified, so this is engine-independent.
   */
  hash(): string {
    return hashState(this.save());
  }

  free() {
    this.world.free();
    this.eventQueue.free();
  }
}
