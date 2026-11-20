import { describe, expect, it } from "vitest";
import { WINGS_STAGE, type FighterShape, type Vec2 } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { verifyRecording, Recorder } from "../src/sim/recording";
import { SHAPE_LIMITS, STANDARD_SHAPE, balanceShape, shapeIssue, triangleArea } from "../src/sim/shapes";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

const centroid = (v: readonly Vec2[]) => ({ x: (v[0].x + v[1].x + v[2].x) / 3, y: (v[0].y + v[1].y + v[2].y) / 3 });
const lopsided: Vec2[] = [{ x: 0, y: 0 }, { x: 1.4, y: 1.3 }, { x: -0.3, y: 1.0 }]; // foot = 0

describe("balancing a shape", () => {
  it("centroid at the origin, foot straight below it, area 1", () => {
    const s = balanceShape(lopsided, 0)!;
    const c = centroid(s.vertices);
    expect(Math.abs(c.x)).toBeLessThan(1e-12);
    expect(Math.abs(c.y)).toBeLessThan(1e-12);
    expect(s.vertices[0].x).toBe(0);
    expect(s.vertices[0].y).toBeLessThan(0);
    expect(triangleArea(s.vertices)).toBeCloseTo(1, 12);
  });

  it("doesn't care where the triangle was, how it was rotated, or how big", () => {
    const a = balanceShape(lopsided, 0)!;
    const moved = lopsided.map((p) => {
      const [c, s] = [Math.cos(0.7), Math.sin(0.7)];
      return { x: 3 + 2.5 * (c * p.x - s * p.y), y: -1 + 2.5 * (s * p.x + c * p.y) };
    });
    const b = balanceShape(moved, 0)!;
    b.vertices.forEach((v, i) => {
      expect(v.x).toBeCloseTo(a.vertices[i].x, 9);
      expect(v.y).toBeCloseTo(a.vertices[i].y, 9);
    });
  });

  it("rejects flat triangles", () => {
    expect(balanceShape([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], 0)).toBeNull();
  });
});

describe("shape limits", () => {
  it("the standard fighter is allowed", () => {
    expect(shapeIssue(STANDARD_SHAPE)).toBeNull();
  });

  it("too tall, too wide, a top corner too low, and garbage are rejected", () => {
    // A thin needle: at equal area it becomes very tall.
    expect(shapeIssue(balanceShape([{ x: 0, y: 0 }, { x: 0.15, y: 3 }, { x: -0.15, y: 3 }], 0)!)).toBe("too tall");
    // A flat wedge: very wide.
    expect(shapeIssue(balanceShape([{ x: 0, y: 0 }, { x: 3, y: 0.3 }, { x: -3, y: 0.3 }], 0)!)).toBe("too wide");
    // So lopsided that, once balanced, one top corner sits barely above the foot.
    expect(shapeIssue(balanceShape([{ x: 0, y: 0 }, { x: -2, y: 0.1 }, { x: 0.1, y: 0.5 }], 0)!)).toBe("a top corner is too low");
    expect(shapeIssue({ vertices: [{ x: 0, y: 0 }], footIndex: 0 } as unknown as FighterShape)).toBe("not a triangle");
    expect(shapeIssue({ ...STANDARD_SHAPE, vertices: STANDARD_SHAPE.vertices.map((v) => ({ x: v.x * 2, y: v.y * 2 })) as FighterShape["vertices"] })).toBe(
      "wrong size",
    );
  });

  it("limits are relative to the standard fighter", () => {
    expect(SHAPE_LIMITS.maxHeight).toBeGreaterThan(1.9 * (STANDARD_SHAPE.vertices[1].y - STANDARD_SHAPE.vertices[0].y));
  });
});

describe("custom shapes in a match", () => {
  const custom = balanceShape(lopsided, 0)!;
  const STILL = { ...DEFAULT_PARAMS, jumpMode: "manual" as const };

  it("sanity: the lopsided test shape is allowed", () => {
    expect(shapeIssue(custom)).toBeNull();
  });

  it("a balanced custom shape stands on its own, upright, with the same mass (area) as the standard fighter", () => {
    const sim = new Sim(WINGS_STAGE, STILL, { players: 2, shapes: [custom, null] });
    for (let t = 0; t < 180; t++) sim.step([NO_INPUT, NO_INPUT]);
    const [mine, standard] = sim.view();
    expect(mine.ko).toBeNull();
    expect(mine.grounded).toBe(true);
    expect(Math.abs(mine.angle)).toBeLessThan(0.05); // didn't tip: its center of mass is above its foot
    expect(triangleArea(mine.vertices)).toBeCloseTo(triangleArea(standard.vertices), 6);
    expect(mine.vertices.map((v) => v.y)).not.toEqual(standard.vertices.map((v) => v.y)); // and it really is a different shape
  });

  it("matches with custom shapes are recorded and replay exactly", () => {
    const match = { players: 2, stocks: 3, respawnDelayTicks: 60, ghostTicks: 120, shapes: [custom, null] };
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, match);
    const rec = new Recorder(WINGS_STAGE, sim.match, DEFAULT_PARAMS);
    for (let t = 0; t < 300; t++) {
      const inputs = [{ turn: (t % 40 < 10 ? 1 : 0) as 0 | 1, charge: t % 70 > 50 }, NO_INPUT];
      rec.beforeStep(sim, inputs, DEFAULT_PARAMS);
      sim.step(inputs);
      rec.afterStep(sim);
    }
    const r = verifyRecording(JSON.parse(JSON.stringify(rec.finish(sim))));
    expect(r.ok).toBe(true);
    expect(r.finalHash).toBe(sim.hash());
  });
});
