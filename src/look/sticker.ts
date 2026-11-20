// The fighter look from the eye sheet (concept/eyes.html), on the game canvas:
// white sticker outline, black block shadow, gradient body, thick ink line,
// shine marks, a sparkle, and the eyes at the incircle. Drawn from the
// fighter's real corners, so custom shapes get it too.
//
// Sizes come from the sheet, where the standard fighter has an area of 7000
// px²; here they scale with the fighter (k = meters per sheet pixel). The
// sheet's paper texture and overspray are SVG filters, too costly to redraw
// every frame, so they're left out.

import type { Vec2 } from "../sim/geometry";
import { EYE_MOODS, FACE_EXTENT, eyesSVG, type EyeMood } from "./eyes";

const INK = "#15101f";
const HALO = "#f3eefc";
const GOLD = "#ffd23d";
const SHEET_AREA = 7000; // the sheet's standard fighter, px²
/** The face is this many incircle radii across its ±1 units (the sheet's FACE_S). */
const FACE_SCALE = 1.38;
/**
 * Outline sizes, in sheet pixels. Thinner than the sheet's (26 px outline, 9-10
 * px shadow): there the outline and shadow stuck out well past the body, so in
 * play fighters looked like they touched before they collided.
 */
const HALO_W = 12;
const SHADOW_OFFSET = 4;
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

// ---- geometry ----
function mix(hex: string, other: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/**
 * The fighter in its own upright frame: origin at the foot, y up along foot →
 * center of mass (balanced shapes stand that way), x to its right. Returns the
 * frame's rotation and the corners in it: foot F, top-left L, top-right R.
 */
function frame(verts: Vec2[], footIndex: number) {
  const foot = verts[footIndex];
  const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
  const cy = (verts[0].y + verts[1].y + verts[2].y) / 3;
  const len = Math.hypot(cx - foot.x, cy - foot.y) || 1;
  const up = { x: (cx - foot.x) / len, y: (cy - foot.y) / len };
  const right = { x: up.y, y: -up.x };
  const local = (v: Vec2) => {
    const d = { x: v.x - foot.x, y: v.y - foot.y };
    return { x: d.x * right.x + d.y * right.y, y: d.x * up.x + d.y * up.y };
  };
  const tops = verts.filter((_, i) => i !== footIndex).map(local);
  const [L, R] = tops[0].x <= tops[1].x ? tops : [tops[1], tops[0]];
  return { foot, angle: Math.atan2(right.y, right.x), F: { x: 0, y: 0 }, L, R };
}

function incircle(F: Vec2, L: Vec2, R: Vec2) {
  const a = Math.hypot(L.x - R.x, L.y - R.y);
  const b = Math.hypot(F.x - R.x, F.y - R.y);
  const c = Math.hypot(F.x - L.x, F.y - L.y);
  const p = a + b + c;
  const area = Math.abs((L.x - F.x) * (R.y - F.y) - (L.y - F.y) * (R.x - F.x)) / 2;
  return { x: (a * F.x + b * L.x + c * R.x) / p, y: (a * F.y + b * L.y + c * R.y) / p, r: (2 * area) / p, area };
}

const lerp = (a: Vec2, b: Vec2, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function tri(ctx: CanvasRenderingContext2D, F: Vec2, L: Vec2, R: Vec2) {
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
  ctx.lineWidth = r * 0.18;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * Draw one fighter (world units, y up). `verts` are its corners in the world,
 * `mood` picks the eyes and effects.
 */
export function drawSticker(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number, look: StickerLook, mood: EyeMood) {
  const { foot, angle, F, L, R } = frame(verts, footIndex);
  const inc = incircle(F, L, R);
  const k = Math.sqrt(inc.area / SHEET_AREA); // meters per sheet pixel
  // What you see colliding should be what collides: the drawing sits inside
  // the physics body, with the white outline's outer edge exactly on its edge.
  // (Scaling about the incircle center moves every edge in by the same amount.)
  const shrink = Math.max(0.5, (inc.r - (HALO_W / 2) * k) / inc.r);
  const inset = (v: Vec2) => ({ x: inc.x + (v.x - inc.x) * shrink, y: inc.y + (v.y - inc.y) * shrink });
  const [Fi, Li, Ri] = [inset(F), inset(L), inset(R)];
  const col = look.color;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.translate(foot.x, foot.y);
  ctx.rotate(angle);

  // Mood effects behind the body.
  if (mood === "charge") {
    ctx.beginPath();
    ctx.ellipse(0, -3 * k, 48 * k, 9 * k, 0, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 5 * k;
    ctx.stroke();
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of [
      [-32, 4, -56, 22],
      [32, 4, 56, 22],
      [-44, -4, -72, -2],
      [44, -4, 72, -2],
    ]) {
      ctx.moveTo(x1 * k, y1 * k);
      ctx.lineTo(x2 * k, y2 * k);
    }
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  } else if (mood === "wobble") {
    ctx.beginPath();
    ctx.moveTo(-24 * k, 26 * k);
    ctx.quadraticCurveTo(-36 * k, 12 * k, -24 * k, -2 * k);
    ctx.moveTo(24 * k, 26 * k);
    ctx.quadraticCurveTo(36 * k, 12 * k, 24 * k, -2 * k);
    ctx.strokeStyle = "#ffffffd9";
    ctx.lineWidth = 5 * k;
    ctx.stroke();
  }

  // Sticker outline: its outer edge is the physics edge.
  tri(ctx, Fi, Li, Ri);
  ctx.fillStyle = HALO;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = HALO_W * k;
  ctx.fill();
  ctx.stroke();
  // Block shadow over it: offset down-right in the world (one light for
  // everyone, whichever way a fighter leans), so the halo shows up-left.
  ctx.save();
  ctx.rotate(-angle);
  ctx.translate(SHADOW_OFFSET * k, -SHADOW_OFFSET * k);
  ctx.rotate(angle);
  tri(ctx, Fi, Li, Ri);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4 * k;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Body: light top-left to dark bottom.
  const ys = [Fi.y, Li.y, Ri.y];
  const xs = [Fi.x, Li.x, Ri.x];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const g = ctx.createLinearGradient(minX, maxY, minX + 0.25 * (maxX - minX), minY);
  g.addColorStop(0, mix(col, "#ffffff", 0.35));
  g.addColorStop(0.55, col);
  g.addColorStop(1, mix(col, INK, 0.3));
  tri(ctx, Fi, Li, Ri);
  ctx.fillStyle = g;
  ctx.fill();

  // Shine marks along the left edge.
  const I = inc;
  const d1a = lerp(lerp(Fi, Li, 0.34), I, 0.18);
  const d1b = lerp(lerp(Fi, Li, 0.62), I, 0.18);
  const d2a = lerp(lerp(Fi, Li, 0.7), I, 0.18);
  const d2b = lerp(lerp(Fi, Li, 0.76), I, 0.18);
  ctx.beginPath();
  ctx.moveTo(d1a.x, d1a.y);
  ctx.lineTo(d1b.x, d1b.y);
  ctx.moveTo(d2a.x, d2a.y);
  ctx.lineTo(d2b.x, d2b.y);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 5 * k;
  ctx.stroke();

  // Ink line.
  tri(ctx, Fi, Li, Ri);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7 * k;
  ctx.stroke();

  // Sparkle near the top-right corner.
  sparkle(ctx, Ri.x - 22 * k, Ri.y - 15 * k, 6 * k, "#fff");

  // Face: at the incircle, along the top edge.
  const img = face(look.eyes, mood, col);
  if (img) {
    const s = I.r * shrink * FACE_SCALE;
    ctx.save();
    ctx.translate(I.x, I.y);
    ctx.rotate(Math.atan2(Ri.y - Li.y, Ri.x - Li.x));
    ctx.scale(s, -s); // face units are y down
    ctx.drawImage(img, -FACE_EXTENT, -FACE_EXTENT, 2 * FACE_EXTENT, 2 * FACE_EXTENT);
    ctx.restore();
  }

  // KO'd: gold stars overhead.
  if (mood === "ko") {
    const top = Math.max(L.y, R.y);
    sparkle(ctx, -46 * k, top + 20 * k, 9 * k, GOLD);
    sparkle(ctx, 2 * k, top + 34 * k, 11 * k, GOLD);
    sparkle(ctx, 48 * k, top + 16 * k, 8 * k, GOLD);
  }
  ctx.restore();
}
