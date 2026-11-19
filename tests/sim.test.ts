import { beforeAll, describe, expect, it } from "vitest";
import { FLAT_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics, type FighterView, type Input } from "../src/sim/sim";

beforeAll(() => initPhysics());

const params = (over: Partial<Params> = {}): Params => ({ ...DEFAULT_PARAMS, ...over });
const MANUAL: Partial<Params> = { jumpMode: "manual" };
// Mechanics tests: one life, so a KO ends the match (stocks are tested separately).
const ONE_STOCK = { stocks: 1 };

function run(sim: Sim, ticks: number, inputs: (t: number) => Input[]) {
  for (let t = 0; t < ticks; t++) sim.step(inputs(t));
}

/** Runs P1 with the given input script (P2 idle), recording P1's view after each tick. */
function record(over: Partial<Params>, ticks: number, p1: (t: number) => Input): FighterView[] {
  const sim = new Sim(FLAT_STAGE, params(over), ONE_STOCK);
  const views: FighterView[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.step([p1(t), NO_INPUT]);
    views.push(sim.view()[0]);
  }
  sim.free();
  return views;
}

const peakY = (views: FighterView[]) => Math.max(...views.map((v) => v.y));
const startY = () => new Sim(FLAT_STAGE, params(), ONE_STOCK).view()[0].y;

describe("sim", () => {
  it("is deterministic: same inputs → bit-identical physics state", () => {
    const script = (t: number): Input[] => [
      { turn: t % 90 < 30 ? 1 : 0, charge: t % 70 > 40 },
      { turn: t % 80 < 25 ? -1 : 0, charge: t % 60 > 35 },
    ];
    const a = new Sim(FLAT_STAGE, params(), ONE_STOCK);
    const b = new Sim(FLAT_STAGE, params(), ONE_STOCK);
    run(a, 600, script);
    run(b, 600, script);
    expect(a.physicsSnapshot()).toEqual(b.physicsSnapshot());
    expect(a.view()).toEqual(b.view());
  });

  it("an upright fighter with no input stays standing (manual mode, no hopping)", () => {
    const sim = new Sim(FLAT_STAGE, params(MANUAL), ONE_STOCK);
    run(sim, 180, () => [NO_INPUT, NO_INPUT]);
    expect(sim.view().map((f) => f.ko)).toEqual([null, null]);
    expect(sim.view()[0].grounded).toBe(true);
  });

  it("rotating with no resistance tips you over → KO by touching", () => {
    const sim = new Sim(FLAT_STAGE, params({ ...MANUAL, rotationMode: "torque" }), ONE_STOCK);
    run(sim, 600, () => [{ turn: 1, charge: false }, NO_INPUT]);
    expect(sim.view()[0].ko).toBe("touched");
    expect(sim.result).toMatchObject({ over: true, winner: 1 });
  });

  it("falling off the platform is a KO", () => {
    const sim = new Sim(FLAT_STAGE, params({ ...MANUAL, rotationMode: "torque" }), ONE_STOCK);
    run(sim, 900, (t) => [{ turn: t % 20 < 3 ? 1 : 0, charge: t % 30 < 10 }, NO_INPUT]);
    expect(sim.view()[0].ko).not.toBeNull();
  });
});

describe("manual jump mode", () => {
  it("a full charge jumps higher than a tap", () => {
    const tap = peakY(record(MANUAL, 120, (t) => ({ turn: 0, charge: t < 1 })));
    const full = peakY(record(MANUAL, 120, (t) => ({ turn: 0, charge: t < DEFAULT_PARAMS.jumpChargeTicks })));
    expect(tap).toBeGreaterThan(startY() + 0.3);
    expect(full).toBeGreaterThan(tap + 1);
  });

  it("can't jump while airborne once coyote time runs out", () => {
    // Two identical sims; one tries a second jump mid-air. If the mid-air jump
    // is correctly ignored, the two trajectories must be identical.
    const jumpThenMaybeAgain = (tryAgain: boolean) => {
      const sim = new Sim(FLAT_STAGE, params({ ...MANUAL, coyoteTicks: 0 }), ONE_STOCK);
      // A tap jump (5 m/s vs 20 m/s² gravity) is airborne ~30 ticks. Retry at tick 10.
      run(sim, 25, (t) => [{ turn: 0, charge: t === 0 || (tryAgain && t === 10) }, NO_INPUT]);
      return sim.view()[0];
    };
    const once = jumpThenMaybeAgain(false);
    expect(once.grounded).toBe(false); // sanity: we really are mid-air
    expect(jumpThenMaybeAgain(true)).toEqual(once);
  });
});

describe("auto jump mode", () => {
  const AUTO: Partial<Params> = { jumpMode: "auto" };
  const cap = DEFAULT_PARAMS.jumpChargeTicks;

  it("with no input, hops repeatedly, small hops, and stays alive", () => {
    const views = record(AUTO, 180, () => NO_INPUT);
    // The hop fires on the landing tick, so `grounded` is never visible after a
    // step. Count takeoffs instead: local minima of the foot's height.
    const footY = views.map((v) => v.vertices[v.footIndex].y);
    const takeoffs = footY.filter((y, t) => t > 0 && t < footY.length - 1 && y < footY[t - 1] && y < footY[t + 1]).length;
    expect(takeoffs).toBeGreaterThanOrEqual(5);
    expect(peakY(views)).toBeLessThan(startY() + 0.5); // small
    expect(views.at(-1)!.ko).toBeNull();
  });

  it("holding charge plants you, then auto-jumps at full power when the cap is hit", () => {
    const views = record(AUTO, 120, () => ({ turn: 0, charge: true }));
    // Spawned on the ground holding charge: planted while charging...
    for (let t = 0; t < cap - 1; t++) expect(views[t].grounded).toBe(true);
    expect(views[cap - 2].charge).toBeGreaterThan(0.9);
    // ...then launched at the cap, without releasing.
    expect(views[cap + 5].grounded).toBe(false);
    const hop = peakY(record(AUTO, 120, () => NO_INPUT));
    expect(peakY(views)).toBeGreaterThan(hop + 2);
  });

  it("releasing early jumps at partial charge: higher than a hop, lower than full", () => {
    const hop = peakY(record(AUTO, 120, () => NO_INPUT));
    const full = peakY(record(AUTO, 120, () => ({ turn: 0, charge: true })));
    const partial = peakY(record(AUTO, 120, (t) => ({ turn: 0, charge: t < cap / 2 })));
    expect(partial).toBeGreaterThan(hop);
    expect(partial).toBeLessThan(full);
  });

  it("holding charge in the air doesn't charge until you land", () => {
    // Hop first (no input on tick 0), then hold charge from mid-air.
    const views = record(AUTO, 60, (t) => ({ turn: 0, charge: t >= 3 }));
    const airborneHolding = views.slice(3).filter((v) => !v.canJump);
    expect(airborneHolding.length).toBeGreaterThan(0); // sanity: we were in the air
    for (const v of airborneHolding) expect(v.charge).toBe(0);
    expect(views.some((v) => v.grounded && v.charge > 0)).toBe(true); // charged after landing
  });
});

describe("rotation modes", () => {
  const leanThenRelease = (over: Partial<Params>) => {
    const sim = new Sim(FLAT_STAGE, params({ ...MANUAL, ...over }), ONE_STOCK);
    run(sim, 3 + 240, (t) => [{ turn: t < 3 ? 1 : 0, charge: false }, NO_INPUT]);
    return sim.view()[0];
  };

  it("torque mode: spin persists after release, so even a tiny lean falls", () => {
    expect(leanThenRelease({ rotationMode: "torque" }).ko).toBe("touched");
  });

  it("servo mode: releasing brakes the spin, so a tiny lean is recoverable", () => {
    const f = leanThenRelease({ rotationMode: "servo" });
    expect(f.ko).toBeNull();
    expect(Math.abs(f.angle)).toBeLessThan(0.2); // settled near upright
  });
});
