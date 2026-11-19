import { beforeAll, describe, expect, it } from "vitest";
import { FinalKoReplay, type Frame } from "../src/koReplay";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics, type FighterView, type SimEvent } from "../src/sim/sim";

beforeAll(() => initPhysics());

const STILL: Params = { ...DEFAULT_PARAMS, jumpMode: "manual", rotationMode: "torque" };

describe("sim events", () => {
  function eventsUntilKo(stocks: number): SimEvent[] {
    const sim = new Sim(WINGS_STAGE, STILL, { stocks });
    for (let t = 0; t < 2000; t++) {
      sim.step([{ turn: 1, charge: false }, NO_INPUT]);
      if (sim.events.some((e) => e.type === "ko")) return sim.events;
    }
    throw new Error("no KO");
  }

  it("a KO emits a ko event; only the match-ending one is final", () => {
    expect(eventsUntilKo(2)).toContainEqual({ type: "ko", fighter: 0, reason: "touched", stocksLeft: 1, final: false });
    expect(eventsUntilKo(1)).toContainEqual({ type: "ko", fighter: 0, reason: "touched", stocksLeft: 0, final: true });
  });

  it("fighters pushing on each other emit impact events with a force", () => {
    // Spawned close, both leaning in (torque mode keeps pushing): they collide.
    const sim = new Sim(WINGS_STAGE, STILL, { spawns: [{ x: -0.8, y: 0.001 }, { x: 0.8, y: 0.001 }] });
    const impacts: SimEvent[] = [];
    for (let t = 0; t < 60; t++) {
      sim.step([{ turn: 1, charge: false }, { turn: -1, charge: false }]);
      impacts.push(...sim.events.filter((e) => e.type === "impact"));
    }
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0]).toMatchObject({ type: "impact", a: expect.any(Number), b: expect.any(Number) });
    expect(Math.max(...impacts.map((e) => (e.type === "impact" ? e.force : 0)))).toBeGreaterThan(0);
  });
});

describe("final KO replay", () => {
  // 200 synthetic frames: fighter 1 gets hit by fighter 0 at frame 100, then falls.
  const view = (grounded: boolean) => ({ grounded }) as FighterView;
  const frames: Frame[] = Array.from({ length: 200 }, (_, i) => ({
    views: [view(true), view(i < 100)],
    events: i === 100 ? [{ type: "impact", a: 0, b: 1, force: 120 }] : [],
  }));

  it("rewinds to the hit that decided it and focuses on loser + hitter", () => {
    const r = new FinalKoReplay(frames, 1);
    expect(r.focus).toEqual([1, 0]);
    expect(r.current().curr).toBe(frames[81].views); // starts 20 frames before the hit
  });

  it("plays the hit in slow motion, flags the hit moment once, then finishes", () => {
    const r = new FinalKoReplay(frames, 1);
    r.update(1); // 1 real second in slow motion = 0.3 × 60 = 18 frames
    expect(r.current().curr).toBe(frames[80 + 18 + 1].views);
    let hits = 0;
    let steps = 0;
    while (r.update(1 / 60)) {
      if (r.hitNow) hits++;
      steps++;
    }
    expect(hits).toBe(1);
    expect(steps).toBeLessThan(60 * 10); // finishes in reasonable time
  });

  it("with no hit, falls back to the loser's last moment on the ground", () => {
    const noHits = frames.map((f) => ({ ...f, events: [] }));
    const r = new FinalKoReplay(noHits, 1);
    expect(r.focus).toEqual([1]);
    expect(r.current().curr).toBe(noHits[79 + 1].views); // last grounded = frame 99, minus 20
  });
});
