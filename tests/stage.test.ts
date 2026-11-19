import { beforeAll, describe, expect, it } from "vitest";
import { WINGS_STAGE, type Stage } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics, type Input } from "../src/sim/sim";

beforeAll(() => initPhysics());

const wing = WINGS_STAGE.platforms[2]; // right wing
const wingTop = wing.center.y + wing.halfHeight;

/** WINGS_STAGE, with the right wing's one-way-ness switchable. */
function withWing(oneWay: boolean): Stage {
  return { ...WINGS_STAGE, platforms: WINGS_STAGE.platforms.map((p, i) => (i === 2 ? { ...p, oneWay } : p)) };
}
// P1 on the main floor, right under the right wing. One stock, so a bonk = match over.
const UNDER_WING = { stocks: 1, spawns: [{ x: wing.center.x - 0.5, y: 0.001 }, { x: -4, y: 0.001 }] };

/** Manual mode (no auto-hop), hold charge to full, release: a straight-up max jump. */
function maxJumpUnderWing(oneWay: boolean) {
  const sim = new Sim(withWing(oneWay), { ...DEFAULT_PARAMS, jumpMode: "manual" }, UNDER_WING);
  const hold = DEFAULT_PARAMS.jumpChargeTicks;
  let maxFootY = -Infinity;
  for (let t = 0; t < 180 && !sim.view()[0].ko; t++) {
    sim.step([{ turn: 0, charge: t < hold } as Input, NO_INPUT]);
    maxFootY = Math.max(maxFootY, sim.view()[0].vertices[0].y);
  }
  return { f: sim.view()[0], maxFootY };
}

describe("one-way wing platforms", () => {
  it("sanity: a max jump can clear the wing's top", () => {
    expect(maxJumpUnderWing(true).maxFootY).toBeGreaterThan(wingTop + 0.1);
  });

  it("you jump up through a wing from below and land on top of it", () => {
    const { f } = maxJumpUnderWing(true);
    expect(f.ko).toBeNull();
    expect(f.grounded).toBe(true);
    expect(f.vertices[0].y).toBeCloseTo(wingTop, 1); // standing on the wing
  });

  it("control: the same jump under a *solid* wing bonks your head → KO", () => {
    expect(maxJumpUnderWing(false).f.ko).toBe("touched");
  });
});
