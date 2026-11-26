// Where everything on a fighter goes: the shared geometry behind both fighter
// renderers (the game canvas, sticker.ts, and menu SVGs, stickerSVG.ts), so
// they can't drift apart. Pure math, in meters, in the fighter's own upright
// frame (origin at the foot, y up, x to its right). Recipe and sizes:
// docs/visual-language.md §2 (the Object stack) and §8 (characters).

import type { FighterShape, Vec2 } from "../sim/geometry";
import { DEFAULT_PARAMS } from "../sim/params";
import { LINES, PAINT, cornerRadius } from "../theme";

/** The standard fighter's area (m²); every fighter has this area. */
export const STANDARD_AREA = (DEFAULT_PARAMS.triWidth * DEFAULT_PARAMS.triHeight) / 2;
/** Meters per pixel of the eye sheet (concept/eyes.html), where the standard fighter is 7000 px². For sheet-sized details. */
export const SHEET_PX = Math.sqrt(STANDARD_AREA / 7000);
/** The face spans this many incircle radii per face unit. */
const FACE_SCALE = 1.38;

/** A fighter's corners in its upright frame: foot F (the origin), top-left L, top-right R. */
export interface Corners {
  F: Vec2;
  L: Vec2;
  R: Vec2;
}

/** The white outline and shadow, both outside the ink edge (they never collide). */
export interface OutlineStyle {
  /** White past the ink line (m). */
  band: number;
  /** Block shadow offset, down and right (m). */
  shadow: number;
}
/** One fighter look everywhere: in play, in menus and in the HUD. */
export const FIGHTER_OUTLINE: OutlineStyle = { band: LINES.bandFighter, shadow: LINES.shadowFighter };

/** World corners → the upright frame, plus where that frame sits in the world. */
export function cornersFromWorld(verts: readonly Vec2[], footIndex: number): Corners & { foot: Vec2; angle: number } {
  const foot = verts[footIndex];
  const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
  const cy = (verts[0].y + verts[1].y + verts[2].y) / 3;
  // Balanced shapes stand with the center of mass straight above the foot.
  const len = Math.hypot(cx - foot.x, cy - foot.y) || 1;
  const up = { x: (cx - foot.x) / len, y: (cy - foot.y) / len };
  const right = { x: up.y, y: -up.x };
  const local = (v: Vec2) => {
    const d = { x: v.x - foot.x, y: v.y - foot.y };
    return { x: d.x * right.x + d.y * right.y, y: d.x * up.x + d.y * up.y };
  };
  return { foot, angle: Math.atan2(right.y, right.x), ...topsFrom(verts.filter((_, i) => i !== footIndex).map(local)) };
}

/** A balanced unit shape (area 1, as stored for custom fighters) → its upright frame, at true size. */
export function cornersFromShape(shape: FighterShape): Corners {
  const k = Math.sqrt(STANDARD_AREA); // unit shape → meters
  const foot = shape.vertices[shape.footIndex];
  return topsFrom(shape.vertices.filter((_, i) => i !== shape.footIndex).map((v) => ({ x: (v.x - foot.x) * k, y: (v.y - foot.y) * k })));
}

function topsFrom(tops: Vec2[]): Corners {
  const [L, R] = tops[0].x <= tops[1].x ? tops : [tops[1], tops[0]];
  return { F: { x: 0, y: 0 }, L, R };
}

const lerp = (a: Vec2, b: Vec2, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export interface FighterLayout {
  /**
   * The ink line's outer edge, filled in ink: the real triangle (the collision
   * edge) with slightly rounded corners and a little wiggle, within the slop
   * budget (theme.ts PAINT). A closed polyline.
   */
  edge: Vec2[];
  /** The body fill: the edge moved in by the ink line's width. A closed polyline. */
  body: Vec2[];
  /** The white outline: the edge stroked this wide (round joins), so the white shows `band` past it. */
  haloWidth: number;
  /** Block shadow offset (down and right, in the world). */
  shadow: number;
  /** Body gradient, top-left (light) to bottom (dark). */
  gradient: { from: Vec2; to: Vec2 };
  /** The two gloss strokes along the upper-left edge. */
  gloss: [Vec2, Vec2][];
  glossWidth: number;
  /** The sparkle near the top-right corner. */
  sparkle: { x: number; y: number; r: number };
  /** The face: center, rotation (along the top edge; radians, y up) and scale (meters per face unit). */
  face: { x: number; y: number; angle: number; scale: number };
}

export function fighterLayout(c: Corners, style: OutlineStyle): FighterLayout {
  const { F, L, R } = c;
  // Incircle: the face's home, and the center for insetting (scaling about it
  // moves every edge in by the same distance).
  const a = Math.hypot(L.x - R.x, L.y - R.y);
  const b = Math.hypot(F.x - R.x, F.y - R.y);
  const cc = Math.hypot(F.x - L.x, F.y - L.y);
  const per = a + b + cc;
  const area = Math.abs((L.x - F.x) * (R.y - F.y) - (L.y - F.y) * (R.x - F.x)) / 2;
  const I = { x: (a * F.x + b * L.x + cc * R.x) / per, y: (a * F.y + b * L.y + cc * R.y) / per };
  const r = (2 * area) / per;

  // Scaling about the incenter moves every edge in by the same distance: the
  // ink line's width. (Never a stroke centered on the edge: round joins would
  // blunt sharp corners, and a skinny fighter's foot would float above the
  // floor it stands on.)
  const shrink = Math.max(0.3, (r - LINES.line) / r);
  const inset = (v: Vec2) => lerp(I, v, shrink);
  const tri = [inset(F), inset(L), inset(R)];
  const [Fi, Li, Ri] = tri;

  // Rounded corners: each as round as the slop budget allows (the foot,
  // always on the floor, gets a smaller one). The body's corners share the
  // ink's arc centers, so the ink line keeps its width around them.
  const corners = [F, L, R];
  const radii = corners.map((_, i) => cornerRadius(angleAt(corners, i), i === 0 ? PAINT.footGap : PAINT.cornerGap));
  const paint = (pts: Vec2[], rs: number[]) => rounded(pts, rs).map((q) => wiggled(q, F));
  const edge = paint(corners, radii);
  const body = paint(tri, radii.map((rr) => Math.max(0, rr - LINES.line)));

  const xs = tri.map((v) => v.x);
  const ys = tri.map((v) => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return {
    edge,
    body,
    haloWidth: 2 * style.band,
    shadow: style.shadow,
    gradient: { from: { x: minX, y: Math.max(...ys) }, to: { x: minX + 0.25 * (maxX - minX), y: Math.min(...ys) } },
    gloss: [
      [lerp(lerp(Fi, Li, 0.34), I, 0.18), lerp(lerp(Fi, Li, 0.62), I, 0.18)],
      [lerp(lerp(Fi, Li, 0.7), I, 0.18), lerp(lerp(Fi, Li, 0.76), I, 0.18)],
    ],
    glossWidth: 5 * SHEET_PX,
    sparkle: { x: Ri.x - 22 * SHEET_PX, y: Ri.y - 15 * SHEET_PX, r: 6 * SHEET_PX },
    face: { x: I.x, y: I.y, angle: Math.atan2(Ri.y - Li.y, Ri.x - Li.x), scale: r * shrink * FACE_SCALE },
  };
}

// ---- the painted outline ----

/** Interior angle at corner i of a triangle (rad). */
function angleAt(v: readonly Vec2[], i: number): number {
  const p = v[i];
  const a = v[(i + 2) % 3];
  const b = v[(i + 1) % 3];
  const u = { x: a.x - p.x, y: a.y - p.y };
  const w = { x: b.x - p.x, y: b.y - p.y };
  return Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)))));
}

/** Points along the edges, this far apart at most, so the wiggle shows. */
const STEP = 0.06;

/** A triangle with corner i rounded to radius rs[i], as a closed polyline sampled finely enough to wiggle. */
function rounded(v: readonly Vec2[], rs: number[]): Vec2[] {
  const out: Vec2[] = [];
  const ends: { t1: Vec2; t2: Vec2 }[] = [];
  const arcs: Vec2[][] = [];
  for (let i = 0; i < 3; i++) {
    const p = v[i];
    const a = v[(i + 2) % 3];
    const b = v[(i + 1) % 3];
    const la = Math.hypot(a.x - p.x, a.y - p.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const u1 = { x: (a.x - p.x) / la, y: (a.y - p.y) / la };
    const u2 = { x: (b.x - p.x) / lb, y: (b.y - p.y) / lb };
    const half = angleAt(v, i) / 2;
    // Never let the arc use up more than a third of either edge.
    const r = Math.min(rs[i], (Math.min(la, lb) / 3) * Math.tan(half));
    if (!(r > 1e-4)) {
      ends.push({ t1: p, t2: p });
      arcs.push([p]);
      continue;
    }
    const t = r / Math.tan(half); // corner to tangent point
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bl = Math.hypot(bis.x, bis.y);
    const d = r / Math.sin(half); // corner to arc center
    const c = { x: p.x + (bis.x / bl) * d, y: p.y + (bis.y / bl) * d };
    const t1 = { x: p.x + u1.x * t, y: p.y + u1.y * t };
    const t2 = { x: p.x + u2.x * t, y: p.y + u2.y * t };
    const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    let da = Math.atan2(t2.y - c.y, t2.x - c.x) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = 6;
    arcs.push(Array.from({ length: n + 1 }, (_, k) => ({ x: c.x + r * Math.cos(a1 + (da * k) / n), y: c.y + r * Math.sin(a1 + (da * k) / n) })));
    ends.push({ t1, t2 });
  }
  for (let i = 0; i < 3; i++) {
    out.push(...arcs[i]);
    // The straight edge to the next corner, subdivided.
    const from = ends[i].t2;
    const to = ends[(i + 1) % 3].t1;
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP));
    for (let k = 1; k < n; k++) out.push(lerp(from, to, k / n));
  }
  return out;
}

/**
 * Nudge a point by a smooth, fixed wiggle field (the painted look; it rotates
 * with the fighter, like paint on a sticker). Fades out near the foot, so the
 * foot always meets the floor exactly.
 */
function wiggled(p: Vec2, foot: Vec2): Vec2 {
  const k = 2 * Math.PI * 1.3; // about 1.3 waves per meter
  const near = Math.min(1, Math.hypot(p.x - foot.x, p.y - foot.y) / 0.35);
  const amp = PAINT.wiggle * near;
  const dx = 0.6 * Math.sin(k * p.y + 1.7) + 0.4 * Math.sin(k * (1.9 * p.x + 0.7 * p.y) + 0.4);
  const dy = 0.6 * Math.sin(k * p.x + 4.1) + 0.4 * Math.sin(k * (2.1 * p.y - 0.5 * p.x) + 2.3);
  return { x: p.x + amp * dx, y: p.y + amp * dy };
}
