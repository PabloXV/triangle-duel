// Custom fighter shapes. A player can drag their triangle's corners; the shape
// is then "balanced" and normalized:
//
//   - balanced: rotated so the center of mass sits directly above the foot,
//     so the fighter stands upright on its own (as a real object would settle);
//   - unit area: scaled to area 1, so every fighter has the same mass (density
//     is shared). The sim scales unit shapes to the standard fighter's area.
//
// and must fit the limits below (checked by the editor, the relay, and the sim
// setup alike). Pure arithmetic and sqrt only, no trig: the relay re-checks
// shapes, and validation must give the same answer on every machine.

import { invertedIsosceles, type FighterShape, type Vec2 } from "./geometry";
import { DEFAULT_PARAMS } from "./params";

/** Twice the signed area of triangle abc (positive = counterclockwise). */
function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function triangleArea(v: readonly Vec2[]): number {
  return Math.abs(cross(v[0], v[1], v[2])) / 2;
}

/** Uniformly scale a shape (about its centroid, which is the origin). */
export function scaleShape(shape: FighterShape, k: number): FighterShape {
  return {
    vertices: shape.vertices.map((v) => ({ x: v.x * k, y: v.y * k })) as FighterShape["vertices"],
    footIndex: shape.footIndex,
  };
}

/**
 * Any triangle (any position, rotation, size) → the balanced unit-area shape:
 * centroid at the origin, foot straight below it, area 1. Returns null for a
 * degenerate (flat) triangle.
 */
export function balanceShape(points: readonly Vec2[], footIndex: 0 | 1 | 2): FighterShape | null {
  const area = triangleArea(points);
  if (!(area > 1e-9) || !Number.isFinite(area)) return null;
  const cx = (points[0].x + points[1].x + points[2].x) / 3;
  const cy = (points[0].y + points[1].y + points[2].y) / 3;
  const rel = points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  // Rotate so the foot vector f points straight down: R·f = (0, -|f|).
  // With c = -fy/|f| and s = -fx/|f| (no trig needed):
  const f = rel[footIndex];
  const len = Math.sqrt(f.x * f.x + f.y * f.y);
  if (!(len > 1e-9)) return null;
  const c = -f.y / len;
  const s = -f.x / len;
  const k = 1 / Math.sqrt(area); // → area 1
  const vertices = rel.map((p) => ({ x: (c * p.x - s * p.y) * k, y: (s * p.x + c * p.y) * k })) as FighterShape["vertices"];
  vertices[footIndex] = { x: 0, y: vertices[footIndex].y }; // exactly below (kill rounding)
  return { vertices, footIndex };
}

/** The standard fighter (everyone's default), as a balanced unit-area shape. */
export const STANDARD_SHAPE: FighterShape = balanceShape(
  invertedIsosceles(DEFAULT_PARAMS.triWidth, DEFAULT_PARAMS.triHeight).vertices,
  0,
)!;

function extents(shape: FighterShape) {
  const xs = shape.vertices.map((v) => v.x);
  const ys = shape.vertices.map((v) => v.y);
  const foot = shape.vertices[shape.footIndex];
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - foot.y };
}

const standard = extents(STANDARD_SHAPE);

/** Limits, relative to the standard fighter (all shapes have the same area). */
export const SHAPE_LIMITS = {
  maxHeight: 2 * standard.height,
  maxWidth: 2 * standard.width,
  /** Both top corners must be at least this far above the foot (fraction of the standard height). */
  minCornerRise: 0.3 * standard.height,
};

/**
 * Why a shape isn't allowed, or null if it's fine. Expects a balanced
 * unit-area shape (as from balanceShape); checks that too, since shapes also
 * arrive from the network.
 */
export function shapeIssue(shape: FighterShape): string | null {
  const v = shape?.vertices;
  if (!Array.isArray(v) || v.length !== 3 || ![0, 1, 2].includes(shape.footIndex)) return "not a triangle";
  if (!v.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return "not a triangle";
  if (Math.abs(triangleArea(v) - 1) > 1e-6) return "wrong size";
  const foot = v[shape.footIndex];
  const cx = (v[0].x + v[1].x + v[2].x) / 3;
  const cy = (v[0].y + v[1].y + v[2].y) / 3;
  if (Math.abs(cx) > 1e-6 || Math.abs(cy) > 1e-6 || Math.abs(foot.x) > 1e-6 || !(foot.y < 0)) return "not balanced";
  const { width, height } = extents(shape);
  if (height > SHAPE_LIMITS.maxHeight) return "too tall";
  if (width > SHAPE_LIMITS.maxWidth) return "too wide";
  const lowCorner = Math.min(...v.filter((_, i) => i !== shape.footIndex).map((p) => p.y));
  if (lowCorner - foot.y < SHAPE_LIMITS.minCornerRise) return "a top corner is too low";
  return null;
}

/** Height and width of a unit shape at the standard fighter's size (m), for display. */
export function shapeSize(shape: FighterShape, standardArea: number) {
  const k = Math.sqrt(standardArea);
  const e = extents(shape);
  return { width: e.width * k, height: e.height * k };
}
