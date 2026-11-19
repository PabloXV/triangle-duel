import { describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Sim, initPhysics, type Input, type MatchOptions } from "../src/sim/sim";

// Top-level await, not beforeAll: the match below is recorded while tests are
// being collected, which happens before beforeAll hooks run.
await initPhysics();

// Rollback netcode depends on these: a client that rewinds and re-simulates
// must end up bit-identical to one that never stopped.

const MATCH: Partial<MatchOptions> = { players: 4, stocks: 2 };
const TICKS = 1800; // 30 s: long enough for KOs, respawns, ghosting, eliminations
const newSim = () => new Sim(WINGS_STAGE, DEFAULT_PARAMS, MATCH);

/** Record a 4-bot match's inputs once, so every run below replays the same inputs. */
function recordInputs(): Input[][] {
  const sim = newSim();
  const bots = [0, 1, 2, 3].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: i + 7 }));
  const inputs: Input[][] = [];
  for (let t = 0; t < TICKS; t++) {
    const tick = bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS));
    inputs.push(tick);
    sim.step(tick);
  }
  sim.free();
  return inputs;
}

/** Everything observable about a sim, for exact comparison. */
const fingerprint = (sim: Sim) => {
  const s = sim.save();
  return { physics: s.physics, rules: s.fighters, view: sim.view(), tick: sim.tick, result: sim.result };
};

/** Garbage inputs: what a client might wrongly predict. */
const wrong = (t: number): Input[] => [0, 1, 2, 3].map((i) => ({ turn: ((t + i) % 3) - 1, charge: (t + i) % 7 < 3 }) as Input);

describe("save / restore", () => {
  const inputs = recordInputs();
  const straight = newSim();
  const kos: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    straight.step(inputs[t]);
    if (straight.events.some((e) => e.type === "ko")) kos.push(t);
  }
  const expected = fingerprint(straight);

  it("sanity: the recorded match has KOs, so respawn/ghost state gets exercised", () => {
    expect(kos.length).toBeGreaterThanOrEqual(2);
  });

  it.each([1, 300, 900, 1500])("save at tick %i → restore into a fresh sim → continue = never stopped", (at) => {
    const a = newSim();
    for (let t = 0; t < at; t++) a.step(inputs[t]);
    const saved = a.save();
    a.free();
    const b = newSim();
    b.restore(saved);
    for (let t = at; t < TICKS; t++) b.step(inputs[t]);
    expect(fingerprint(b)).toEqual(expected);
  });

  it("rollback: mispredict for a while, rewind, re-simulate correctly = never stopped", () => {
    // Every 100 ticks: save, run 8 ticks of wrong inputs, rewind, redo correctly.
    const sim = newSim();
    for (let t = 0; t < TICKS; t++) {
      if (t % 100 === 0) {
        const saved = sim.save();
        for (let k = 0; k < 8; k++) sim.step(wrong(t + k));
        sim.restore(saved);
      }
      sim.step(inputs[t]);
    }
    expect(fingerprint(sim)).toEqual(expected);
  });

  it("a saved state is a deep copy: stepping afterwards doesn't change it", () => {
    const sim = newSim();
    for (let t = 0; t < 600; t++) sim.step(inputs[t]);
    const saved = sim.save();
    const before = structuredClone(saved);
    for (let t = 600; t < 900; t++) sim.step(inputs[t]);
    expect(saved).toEqual(before);
  });
});

describe("save / restore: one-way platform landing", () => {
  // Whether a wing is solid for you depends on last tick's answer (once you've
  // landed, it stays solid while Rapier pushes you out of the overlap). So a
  // save taken mid-landing must carry it, or the restored fighter falls through.
  const wing = WINGS_STAGE.platforms[2];
  const dropOntoWing: Partial<MatchOptions> = {
    stocks: 1,
    spawns: [{ x: wing.center.x, y: 6 }, { x: -4, y: 0.001 }], // P1 falls ~4 m onto the wing
  };
  const params = { ...DEFAULT_PARAMS, jumpMode: "manual" as const }; // no hopping: just land
  const idle: Input[] = [{ turn: 0, charge: false }, { turn: 0, charge: false }];
  const TOTAL = 120;

  it("restoring at any tick of the landing continues exactly like never stopping", () => {
    const straight = new Sim(WINGS_STAGE, params, dropOntoWing);
    for (let t = 0; t < TOTAL; t++) straight.step(idle);
    const f = straight.view()[0];
    expect(f.vertices[f.footIndex].y).toBeCloseTo(wing.center.y + wing.halfHeight, 1); // sanity: landed on it
    const expected = fingerprint(straight);

    for (let at = 40; at < 80; at++) {
      const a = new Sim(WINGS_STAGE, params, dropOntoWing);
      for (let t = 0; t < at; t++) a.step(idle);
      const saved = a.save();
      const b = new Sim(WINGS_STAGE, params, dropOntoWing);
      b.restore(saved);
      for (let t = at; t < TOTAL; t++) b.step(idle);
      expect(fingerprint(b), `restored at tick ${at}`).toEqual(expected);
    }
  });
});
