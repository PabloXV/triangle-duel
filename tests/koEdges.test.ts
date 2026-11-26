import { beforeAll, describe, expect, it } from "vitest";
import { koEdges, segmentDistanceToPlatform, type Stage } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { balanceShape } from "../src/sim/shapes";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

beforeAll(() => initPhysics());

describe("segmentDistanceToPlatform", () => {
  const box = { center: { x: 0, y: -0.5 }, halfWidth: 2, halfHeight: 0.5 };
  it("is 0 for a segment lying on the top, or crossing the box", () => {
    expect(segmentDistanceToPlatform({ x: 1, y: 0 }, { x: 5, y: 0 }, box)).toBe(0);
    expect(segmentDistanceToPlatform({ x: -3, y: -0.5 }, { x: 3, y: -0.5 }, box)).toBe(0);
  });
  it("measures to the nearest corner or end", () => {
    expect(segmentDistanceToPlatform({ x: -1, y: 0.2 }, { x: 1, y: 0.2 }, box)).toBeCloseTo(0.2);
    // Passing over the top-right corner, diagonally: closest at the corner.
    expect(segmentDistanceToPlatform({ x: 1.5, y: 0.7 }, { x: 2.7, y: -0.5 }, box)).toBeCloseTo(0.2 / Math.SQRT2);
    expect(segmentDistanceToPlatform({ x: 3, y: 1 }, { x: 4, y: 1 }, box)).toBeCloseTo(Math.SQRT2);
  });
});

describe("koEdges", () => {
  it("leaves out the foot and the start of its two edges", () => {
    const verts = [{ x: 0, y: 0 }, { x: -1, y: 2 }, { x: 1, y: 2 }];
    const [top, left, right] = koEdges(verts, 0, 0.25);
    expect(top).toEqual([verts[1], verts[2]]);
    expect(Math.hypot(left[0].x, left[0].y)).toBeCloseTo(0.25);
    expect(left[1]).toEqual(verts[1]);
    expect(Math.hypot(right[0].x, right[0].y)).toBeCloseTo(0.25);
  });
});

/**
 * The exploit: a long skinny fighter lying flat on a platform, one edge along
 * the top, its top corners hanging off the end, so no corner touches anything.
 */
function lieAcrossLedge(params: Params) {
  // The platform's top is y = 0, its right end x = 2.
  const stage: Stage = {
    platforms: [{ center: { x: -1, y: -0.5 }, halfWidth: 3, halfHeight: 0.5 }],
    spawnLine: { minX: -3, maxX: -2, y: 0.001 },
    respawnY: 3,
    blastZone: { minX: -14, maxX: 14, minY: -8, maxY: 20 },
    camera: { center: { x: 0, y: 2 }, width: 18, height: 10 },
  };
  // Tallest allowed: 0.625 m wide, 2.4 m tall (as a unit shape).
  const shape = balanceShape([{ x: 0, y: 0 }, { x: -0.3125, y: 2.4 }, { x: 0.3125, y: 2.4 }], 0)!;
  const sim = new Sim(stage, params, { players: 2, stocks: 1, shapes: [shape, null], spawns: [{ x: -2.5, y: 0.001 }, { x: -1, y: 0.001 }] });
  const f = (sim as any).ctx.fighters[0];
  const [F, A, B] = f.shape.vertices as { x: number; y: number }[];
  // Turn so edge F→A points along +x; B ends up above it (y > 0) or below (then use F→B).
  const turn = (v: { x: number; y: number }) => -Math.atan2(v.y - F.y, v.x - F.x);
  const rot = (v: { x: number; y: number }, a: number) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  let a = turn(A);
  if (rot({ x: B.x - F.x, y: B.y - F.y }, a).y < 0) a = turn(B);
  const foot = rot(F, a);
  // Foot at x = 0 on the top: the far corners reach x ≈ 2.4, past the end.
  f.body.setRotation(a, true);
  f.body.setTranslation({ x: 0 - foot.x, y: 0.005 - foot.y }, true);
  for (let t = 0; t < 20 && !sim.view()[0].ko; t++) sim.step([NO_INPUT, NO_INPUT]);
  const view = sim.view()[0];
  sim.free();
  return view;
}

describe("KO by an edge", () => {
  const manual: Params = { ...DEFAULT_PARAMS, jumpMode: "manual" };
  it("lying flat across a ledge, corners hanging off: KO", () => {
    expect(lieAcrossLedge(manual).ko).toBe("touched");
  });
  it("old recordings (no koFootZone) keep the corners-only rule", () => {
    const old = { ...manual } as Partial<Params>;
    delete old.koFootZone;
    expect(lieAcrossLedge(old as Params).ko).toBeNull();
  });
});
