// The fighter look from the eye sheet (concept/eyes.html), on the game canvas:
// white sticker outline, black block shadow, gradient body, thick ink line,
// shine marks, a sparkle, and the eyes at the incircle. Drawn from the
// fighter's real corners, so custom shapes get it too.
//
// Where things go is fighterLayout.ts (shared with the menu SVGs); colors and
// line weights are theme.ts. The sheet's paper texture and overspray are SVG
// filters, too costly to redraw every frame, so they're left out for now
// (docs/visual-language.md §5).

import type { Vec2 } from "../sim/geometry";
import { GOLD, HALO, INK, LINES, WHITE, mix, withAlpha } from "../theme";
import { EYE_MOODS, FACE_EXTENT, eyesSVG, type EyeMood } from "./eyes";
import { PLAY_OUTLINE, SHEET_PX, cornersFromWorld, fighterLayout } from "./fighterLayout";

/** Leaning past this (rad), the eyes go "wobble" (close to tipping). */
export const WOBBLE_LEAN = 0.42;

export interface StickerLook {
  color: string;
  eyes: number; // eye style index (src/look/eyes.ts)
}

export function moodOf(f: { ko: unknown; charge: number; angle: number }): EyeMood {
  if (f.ko) return "ko";
  if (f.charge > 0) return "charge";
  if (Math.abs(f.angle) > WOBBLE_LEAN) return "wobble";
  return "idle";
}

// ---- faces: each (style, mood, color) rasterized once ----
const FACE_PX = 256;
const faces = new Map<string, HTMLCanvasElement | null>(); // null = loading

function face(style: number, mood: EyeMood, color: string): HTMLCanvasElement | null {
  const key = `${style}|${mood}|${color}`;
  const hit = faces.get(key);
  if (hit !== undefined) return hit;
  faces.set(key, null);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = FACE_PX;
    c.getContext("2d")!.drawImage(img, 0, 0, FACE_PX, FACE_PX);
    faces.set(key, c);
  };
  img.onerror = () => faces.delete(key);
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(eyesSVG(style, mood, color, FACE_PX));
  return null;
}

/** Start rasterizing every mood for these looks (e.g. at a match start), so no face pops in late. */
export function preloadFaces(looks: StickerLook[]) {
  for (const l of looks) for (const m of EYE_MOODS) face(l.eyes, m, l.color);
}

/** How many faces are ready (for tests). */
export function facesReady(): number {
  return [...faces.values()].filter(Boolean).length;
}

// ---- drawing ----
/** Ink line on marks (LINES.markLine), and the thinnest one on a tiny mark (a sparkle). */
const MARK_INK = LINES.markLine;
const MARK_LINE_MIN = 0.022;

/** A fill-style mark: flat `fill`, ink line (even-odd, so a path can have a hole). */
function mark(ctx: CanvasRenderingContext2D, fill: string, path: () => void) {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill("evenodd");
  ctx.strokeStyle = INK;
  ctx.lineWidth = MARK_INK;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** A white band along an arc (center, radius, from/to angle), thickest in the middle, tapered at the ends. */
function band(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, width: number) {
  const N = 16;
  const at = (u: number, side: number) => {
    const a = a0 + (a1 - a0) * u;
    const w = width * (0.2 + 0.8 * Math.sin(Math.PI * u));
    const rr = r + (side * w) / 2;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  mark(ctx, HALO, () => {
    for (let i = 0; i <= N; i++) {
      const [x, y] = at(i / N, 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const [x, y] = at(i / N, -1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  });
}

/** A white spike: base centered at (x, y), `len` long toward angle `a`. */
function spike(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, halfWidth: number) {
  const px = -Math.sin(a) * halfWidth;
  const py = Math.cos(a) * halfWidth;
  mark(ctx, HALO, () => {
    ctx.moveTo(x + px, y + py);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineTo(x - px, y - py);
    ctx.quadraticCurveTo(x - Math.cos(a) * halfWidth, y - Math.sin(a) * halfWidth, x + px, y + py);
    ctx.closePath();
  });
}

function tri(ctx: CanvasRenderingContext2D, [F, L, R]: readonly Vec2[]) {
  ctx.beginPath();
  ctx.moveTo(F.x, F.y);
  ctx.lineTo(L.x, L.y);
  ctx.lineTo(R.x, R.y);
  ctx.closePath();
}

/** A 4-point sparkle (sheet: star4), in the current transform's units. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  const q = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  ctx.lineTo(x + q, y + q);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + q, y - q);
  ctx.lineTo(x, y - r);
  ctx.lineTo(x - q, y - q);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - q, y + q);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(r * 0.2, MARK_LINE_MIN);
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * Draw one fighter (world units, y up). `verts` are its corners in the world,
 * `mood` picks the eyes and effects. Layout: fighterLayout.ts.
 */
export function drawSticker(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number, look: StickerLook, mood: EyeMood, hopping = false, charge = 0) {
  const c = cornersFromWorld(verts, footIndex);
  const lay = fighterLayout(c, PLAY_OUTLINE);
  const k = SHEET_PX; // effects keep the eye sheet's sizes
  const col = look.color;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.translate(c.foot.x, c.foot.y);
  ctx.rotate(c.angle);

  // Mood effects behind the body: fill-style marks (flat fill + ink line,
  // visual-language.md §6), level with the ground rather than the lean.
  ctx.save();
  ctx.rotate(-c.angle);
  if (mood === "charge") {
    // A ring at the foot in the fighter's color, and spikes bursting out;
    // both grow as the charge builds.
    const rx = 0.36 + 0.3 * charge;
    const ry = rx * 0.26;
    mark(ctx, col, () => {
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.ellipse(0, 0, rx - 0.11, ry - 0.045, 0, Math.PI * 2, 0, true);
    });
    for (const deg of [18, 52, 128, 162]) {
      const a = (deg * Math.PI) / 180;
      spike(ctx, Math.cos(a) * (rx + 0.06), 0.05 + Math.sin(a) * (ry + 0.08), a, 0.18 + 0.2 * charge, 0.05);
    }
  } else if (mood === "wobble") {
    // "( )": two tapered crescents beside the foot.
    band(ctx, 0, 0.18, 0.4, -0.7, 0.7, 0.09);
    band(ctx, 0, 0.18, 0.4, Math.PI - 0.7, Math.PI + 0.7, 0.09);
  }
  if (hopping && mood === "idle") {
    // Motion arcs: two tapered smiles under the foot.
    band(ctx, 0, 0.15, 0.3, Math.PI * 1.25, Math.PI * 1.75, 0.075);
    band(ctx, 0, 0.15, 0.46, Math.PI * 1.33, Math.PI * 1.67, 0.06);
  }
  ctx.restore();

  // Block shadow (with the white outline's thickness): offset down-right in
  // the world, so there's one light for everyone, whichever way they lean.
  ctx.save();
  ctx.rotate(-c.angle);
  ctx.translate(lay.shadow, -lay.shadow);
  ctx.rotate(c.angle);
  tri(ctx, lay.body);
  ctx.fillStyle = ctx.strokeStyle = withAlpha(INK, 0.8);
  ctx.lineWidth = lay.haloWidth;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // White outline.
  tri(ctx, lay.body);
  ctx.fillStyle = ctx.strokeStyle = HALO;
  ctx.lineWidth = lay.haloWidth;
  ctx.fill();
  ctx.stroke();

  // Body: lit from the top left.
  const g = ctx.createLinearGradient(lay.gradient.from.x, lay.gradient.from.y, lay.gradient.to.x, lay.gradient.to.y);
  g.addColorStop(0, mix(col, WHITE, 0.35));
  g.addColorStop(0.55, col);
  g.addColorStop(1, mix(col, INK, 0.3));
  tri(ctx, lay.body);
  ctx.fillStyle = g;
  ctx.fill();

  // Gloss.
  ctx.beginPath();
  for (const [a, b] of lay.gloss) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = lay.glossWidth;
  ctx.stroke();

  // Ink line.
  tri(ctx, lay.body);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lay.lineWidth;
  ctx.stroke();

  sparkle(ctx, lay.sparkle.x, lay.sparkle.y, lay.sparkle.r, WHITE);

  // Face (rasterized once per style, mood and color), kept inside the body:
  // wide styles (mask, shades) would stick out of a skinny custom shape.
  const img = face(look.eyes, mood, col);
  if (img) {
    ctx.save();
    tri(ctx, lay.body);
    ctx.clip();
    ctx.translate(lay.face.x, lay.face.y);
    ctx.rotate(lay.face.angle);
    ctx.scale(lay.face.scale, -lay.face.scale); // face units are y down
    ctx.drawImage(img, -FACE_EXTENT, -FACE_EXTENT, 2 * FACE_EXTENT, 2 * FACE_EXTENT);
    ctx.restore();
  }

  // KO'd: gold stars overhead.
  if (mood === "ko") {
    const top = Math.max(c.L.y, c.R.y);
    sparkle(ctx, -46 * k, top + 20 * k, 9 * k, GOLD);
    sparkle(ctx, 2 * k, top + 34 * k, 11 * k, GOLD);
    sparkle(ctx, 48 * k, top + 16 * k, 8 * k, GOLD);
  }
  ctx.restore();
}
