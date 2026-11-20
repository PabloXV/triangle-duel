import { describe, expect, it } from "vitest";
import { randomBotShape } from "../src/bots/shapes";
import { mulberry32 } from "../src/rng";
import { STANDARD_SHAPE, shapeIssue, triangleArea } from "../src/sim/shapes";

const rng = mulberry32; // seeded, so the test is repeatable

describe("random bot shapes", () => {
  const samples = Array.from({ length: 500 }, (_, i) => randomBotShape(rng(i + 1)));
  // How far each shape's top corners are from the standard fighter's.
  const offsets = samples.flatMap((s) => [1, 2].map((i) => ({ x: s.vertices[i].x - STANDARD_SHAPE.vertices[i].x, y: s.vertices[i].y - STANDARD_SHAPE.vertices[i].y })));

  it("every one is legal, balanced, and the standard mass", () => {
    for (const s of samples) {
      expect(shapeIssue(s)).toBeNull();
      expect(triangleArea(s.vertices)).toBeCloseTo(1, 9);
    }
  });

  it("scattered around the standard shape: centered on it, with real variety", () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    // Centered: average corner offsets near zero.
    expect(Math.abs(mean(offsets.map((o) => o.x)))).toBeLessThan(0.05);
    expect(Math.abs(mean(offsets.map((o) => o.y)))).toBeLessThan(0.05);
    // What players see: sizes vary, but most bots stay near the standard fighter.
    // (Corner offsets end up tighter than BOT_SHAPE_SPREAD: balancing re-rotates
    // and rescales each shape, absorbing part of the random offset.)
    expect(sd(offsets.map((o) => o.x))).toBeGreaterThan(0.05);
    const size = (s: typeof STANDARD_SHAPE) => {
      const ys = s.vertices.map((v) => v.y);
      const xs = s.vertices.map((v) => v.x);
      return { h: Math.max(...ys) - s.vertices[0].y, w: Math.max(...xs) - Math.min(...xs) };
    };
    const std = size(STANDARD_SHAPE);
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
    const widths = samples.map((s) => size(s).w / std.w);
    const heights = samples.map((s) => size(s).h / std.h);
    expect(q(widths, 0.9) - q(widths, 0.1)).toBeGreaterThan(0.2); // real variety (measured: 81%–116%)
    expect(q(heights, 0.9) - q(heights, 0.1)).toBeGreaterThan(0.2); // (measured: 94%–139%)
    expect(q(widths, 0.5)).toBeGreaterThan(0.85); // typical bot near standard...
    expect(q(widths, 0.5)).toBeLessThan(1.15);
    expect(q(heights, 0.5)).toBeLessThan(1.3); // (slightly taller on average: any lopsidedness, once balanced, lifts a corner)
  });

  it("the same random source gives the same shape", () => {
    expect(randomBotShape(rng(42))).toEqual(randomBotShape(rng(42)));
  });

  it("wild offsets are pulled back toward standard until legal", () => {
    const wild = randomBotShape(rng(7), 10); // σ = 10: nearly always out of limits at first
    expect(shapeIssue(wild)).toBeNull();
  });
});
