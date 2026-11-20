import { describe, expect, it } from "vitest";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();
const MASH = { turn: 1 as const, charge: true };

describe("match start: countdown and drop-in", () => {
  it("during the countdown nobody's input counts; after it, it does", () => {
    const a = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, countdownTicks: 60 });
    const b = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, countdownTicks: 60 });
    for (let t = 0; t < 60; t++) {
      a.step([NO_INPUT, NO_INPUT]);
      b.step([MASH, MASH]); // mashing during the countdown...
    }
    expect(b.hash()).toBe(a.hash()); // ...changes nothing
    for (let t = 0; t < 20; t++) {
      a.step([NO_INPUT, NO_INPUT]);
      b.step([MASH, MASH]);
    }
    expect(b.hash()).not.toBe(a.hash());
    a.free();
    b.free();
  });

  it("drop-in: fighters start up at the respawn height, then land upright on their spawn points", () => {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, dropIn: true, countdownTicks: 120 });
    const feet = () => sim.view().map((f) => f.vertices[f.footIndex]);
    for (const foot of feet()) expect(foot.y).toBeCloseTo(WINGS_STAGE.respawnY, 1);
    for (let t = 0; t < 120; t++) sim.step([NO_INPUT, NO_INPUT]);
    for (const f of sim.view()) {
      expect(f.ko).toBeNull();
      expect(Math.abs(f.angle)).toBeLessThan(0.2);
      expect(f.vertices[f.footIndex].y).toBeLessThan(0.5); // down on the floor
    }
    sim.free();
  });
});

describe("respawns", () => {
  /** P0 starts off the stage, over nothing (falls to a KO); P1 waits at x = -6. Where does P0 come back? */
  function respawnX(smartRespawn: boolean) {
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, stocks: 3, smartRespawn, spawns: [{ x: 15, y: 0 }, { x: -6, y: 0.001 }] });
    let x = NaN;
    for (let t = 0; t < 400 && Number.isNaN(x); t++) {
      const wasKo = sim.view()[0].ko !== null;
      sim.step([NO_INPUT, NO_INPUT]);
      if (wasKo && sim.view()[0].ko === null) x = sim.view()[0].x;
    }
    sim.free();
    return x;
  }

  it("smart respawn: above the spawn point farthest from the opponent", () => {
    // Wings' 4-player spawn points are x = -6, -2, 2, 6; the opponent is at -6.
    expect(respawnX(true)).toBeCloseTo(6, 0);
  });

  it("without it: above your own spawn point", () => {
    expect(respawnX(false)).toBeCloseTo(15, 0);
  });
});
