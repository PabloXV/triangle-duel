import { beforeAll, describe, expect, it } from "vitest";
import type { Stage } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";
import { HopTapper } from "../src/input";

beforeAll(async () => {
  await initPhysics();
});

const stage: Stage = {
  platforms: [{ center: { x: 0, y: -0.5 }, halfWidth: 6, halfHeight: 0.5 }],
  spawnLine: { minX: -3, maxX: 3, y: 0.001 },
  respawnY: 3,
  blastZone: { minX: -14, maxX: 14, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2 }, width: 18, height: 10 },
};

/** Hops off; stand still, then press the hop key once (or hold it) at tick 60. Returns the peak height of fighter 0's center and how many times it left the ground. */
function run(hold: boolean) {
  const sim = new Sim(stage, { ...DEFAULT_PARAMS, idleHop: false }, { players: 2, stocks: 1, spawns: [{ x: -2, y: 0.001 }, { x: 2, y: 0.001 }] });
  const hop = new HopTapper();
  const y0 = (() => {
    for (let t = 0; t < 60; t++) sim.step([NO_INPUT, NO_INPUT]);
    return sim.view()[0].y;
  })();
  let peak = y0;
  let takeoffs = 0;
  let wasGrounded = true;
  for (let t = 0; t < 300; t++) {
    const me = sim.view()[0];
    const charge = hop.next(t === 0, hold, me.grounded);
    sim.step([{ ...NO_INPUT, charge }, NO_INPUT]);
    const v = sim.view()[0];
    peak = Math.max(peak, v.y);
    if (wasGrounded && !v.canJump) takeoffs++;
    wasGrounded = v.grounded;
  }
  sim.free();
  return { rise: peak - y0, takeoffs };
}

describe("hop key (a tap of charge)", () => {
  it("one press: one minimum-charge jump, then stand still", () => {
    const { rise, takeoffs } = run(false);
    expect(takeoffs).toBe(1);
    // A minimum jump (jumpMinSpeed) rises v²/2g; a full charge would be ~2.3× higher.
    const g = DEFAULT_PARAMS.gravity;
    expect(rise).toBeGreaterThan(0.6 * (DEFAULT_PARAMS.jumpMinSpeed ** 2 / (2 * g)));
    expect(rise).toBeLessThan(1.3 * (DEFAULT_PARAMS.jumpMinSpeed ** 2 / (2 * g)));
  });
  it("held: hops again on every landing", () => {
    expect(run(true).takeoffs).toBeGreaterThan(2);
  });
});
