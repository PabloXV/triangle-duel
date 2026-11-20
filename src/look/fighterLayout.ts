// Where everything on a fighter goes: the shared geometry behind both fighter
// renderers (the game canvas, sticker.ts, and menu SVGs, stickerSVG.ts), so
// they can't drift apart. Pure math, in meters, in the fighter's own upright
// frame (origin at the foot, y up, x to its right). Recipe and sizes:
// docs/visual-language.md §2 (the Object stack) and §8 (characters).

import type { FighterShape, Vec2 } from "../sim/geometry";
import { DEFAULT_PARAMS } from "../sim/params";
import { LINES } from "../theme";

/** The standard fighter's area (m²); every fighter has this area. */
export const STANDARD_AREA = (DEFAULT_PARAMS.triWidth * DEFAULT_PARAMS.triHeight) / 2;
/** Meters per pixel of the eye sheet (concept/eyes.html), where the standard fighter is 7000 px². For sheet-sized details. */
export const SHEET_PX = Math.sqrt(STANDARD_AREA / 7000);
/** The face spans this many incircle radii per face unit. */
export const FACE_SCALE = 1.38;

/** A fighter's corners in its upright frame: foot F (the origin), top-left L, top-right R. */
export interface Corners {
  F: Vec2;
  L: Vec2;
  R: Vec2;
}

/** How the outline is drawn: thin and inset for fighters in play, chunky for menu icons. */
export interface OutlineStyle {
  /** Visible white past the ink line (m). */
  band: number;
  /** Block shadow offset, down and right (m). */
  shadow: number;
  /** Draw inside the body, so the white outline's outer edge is the physics edge (what looks like a collision is one). */
  inset: boolean;
}
export const PLAY_OUTLINE: OutlineStyle = { band: LINES.bandMoving, shadow: LINES.shadowMoving, inset: true };
/** The eye sheet's chunky proportions; fine where nothing collides. */
export const ICON_OUTLINE: OutlineStyle = { band: LINES.bandStatic, shadow: 0.1, inset: false };

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
  /** The drawn triangle (inset from the corners if the style says so): F, L, R. */
  body: [Vec2, Vec2, Vec2];
  /** Stroke widths: the white outline (behind) and the ink line. */
  haloWidth: number;
  lineWidth: number;
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

  const haloWidth = LINES.line + 2 * style.band;
  const shrink = style.inset ? Math.max(0.5, (r - haloWidth / 2) / r) : 1;
  const inset = (v: Vec2) => lerp(I, v, shrink);
  const body: [Vec2, Vec2, Vec2] = [inset(F), inset(L), inset(R)];
  const [Fi, Li, Ri] = body;

  const xs = body.map((v) => v.x);
  const ys = body.map((v) => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return {
    body,
    haloWidth,
    lineWidth: LINES.line,
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
