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
import { GOLD, HALO, INK, WHITE, mix, withAlpha } from "../theme";
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
/** Stroke width of stroke-style marks (charge ring, speed lines, arcs), meters. */
const MARK_W = 5 * SHEET_PX;
/** The thinnest ink line on a small mark (a sparkle's outline). */
const MARK_LINE_MIN = 0.022;

/** A stroke-style mark: an ink stroke twice as wide underneath, then the color. */
function cased(ctx: CanvasRenderingContext2D, color: string, width: number, path: () => void) {
  ctx.beginPath();
  path();
  ctx.strokeStyle = INK;
  ctx.lineWidth = width * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
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
export function drawSticker(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number, look: StickerLook, mood: EyeMood, hopping = false) {
  const c = cornersFromWorld(verts, footIndex);
  const lay = fighterLayout(c, PLAY_OUTLINE);
  const k = SHEET_PX; // effects keep the eye sheet's sizes
  const col = look.color;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.translate(c.foot.x, c.foot.y);
  ctx.rotate(c.angle);

  // Mood effects behind the body: marks, ink-cased (visual-language.md §6).
  if (mood === "charge") {
    cased(ctx, col, MARK_W, () => ctx.ellipse(0, -3 * k, 48 * k, 9 * k, 0, 0, Math.PI * 2));
    cased(ctx, HALO, MARK_W, () => {
      for (const [x1, y1, x2, y2] of [
        [-32, 4, -56, 22],
        [32, 4, 56, 22],
        [-44, -4, -72, -2],
        [44, -4, 72, -2],
      ]) {
        ctx.moveTo(x1 * k, y1 * k);
        ctx.lineTo(x2 * k, y2 * k);
      }
    });
  } else if (mood === "wobble") {
    cased(ctx, HALO, MARK_W, () => {
      ctx.moveTo(-24 * k, 26 * k);
      ctx.quadraticCurveTo(-36 * k, 12 * k, -24 * k, -2 * k);
      ctx.moveTo(24 * k, 26 * k);
      ctx.quadraticCurveTo(36 * k, 12 * k, 24 * k, -2 * k);
    });
  }
  if (hopping && mood === "idle") {
    // Motion arcs under the foot, level with the world (not the lean).
    ctx.save();
    ctx.rotate(-c.angle);
    cased(ctx, HALO, MARK_W * 0.8, () => {
      ctx.moveTo(-26 * k, -22 * k);
      ctx.quadraticCurveTo(0, -40 * k, 26 * k, -22 * k);
      ctx.moveTo(-18 * k, -38 * k);
      ctx.quadraticCurveTo(0, -50 * k, 18 * k, -38 * k);
    });
    ctx.restore();
  }

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
