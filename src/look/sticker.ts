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
import { band, mark, sparkle, spike } from "./marks";
import { SvgImages } from "./svgImage";
import { EYE_MOODS, FACE_EXTENT, eyesSVG, type EyeMood } from "./eyes";
import { FIGHTER_OUTLINE, SHEET_PX, cornersFromWorld, fighterLayout } from "./fighterLayout";

/** Leaning past this (rad), the eyes go "wobble" (close to tipping). */
const WOBBLE_LEAN = 0.42;

interface StickerLook {
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
const FACE_PX = 192; // plenty: a face is rarely over ~80 px on screen
const faces = new SvgImages<HTMLCanvasElement>(
  (img) => {
    const c = document.createElement("canvas");
    c.width = c.height = FACE_PX;
    const g = c.getContext("2d");
    if (!g) throw new Error("no canvas memory"); // the cache retries later
    g.drawImage(img, 0, 0, FACE_PX, FACE_PX);
    return c;
  },
  96, // 4 fighters x 4 moods for several matches; older ones are dropped
  (c) => (c.width = c.height = 0), // free the pixels now (iOS counts canvas memory)
);
const face = (style: number, mood: EyeMood, color: string) => faces.get(`${style}|${mood}|${color}`, () => eyesSVG(style, mood, color, FACE_PX));

/** Start rasterizing every mood for these looks (e.g. at a match start), so no face pops in late. */
export function preloadFaces(looks: StickerLook[]) {
  for (const l of looks) for (const m of EYE_MOODS) face(l.eyes, m, l.color);
}

/** How many faces are ready (for tests). */
export function facesReady(): number {
  return faces.readyCount;
}

// ---- drawing ----
/** A closed polygon path. */
function tri(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Move the canvas into the fighter's upright frame (origin at the foot, y up). */
function enter(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number) {
  const c = cornersFromWorld(verts, footIndex);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.translate(c.foot.x, c.foot.y);
  ctx.rotate(c.angle);
  return { c, lay: fighterLayout(c, FIGHTER_OUTLINE) };
}

/**
 * The back pass: block shadow and white outline, both outside the ink edge.
 * Drawn for every object before any body (render.ts), so where a fighter
 * touches a platform or another fighter, ink meets ink and the white is hidden.
 */
export function drawStickerBack(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number) {
  const { c, lay } = enter(ctx, verts, footIndex);
  // Block shadow (with the white outline's thickness): offset down-right in
  // the world, so there's one light for everyone, whichever way they lean.
  ctx.save();
  ctx.rotate(-c.angle);
  ctx.translate(lay.shadow, -lay.shadow);
  ctx.rotate(c.angle);
  tri(ctx, lay.edge);
  ctx.fillStyle = ctx.strokeStyle = withAlpha(INK, 0.8);
  ctx.lineWidth = lay.haloWidth;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  tri(ctx, lay.edge);
  ctx.fillStyle = ctx.strokeStyle = HALO;
  ctx.lineWidth = lay.haloWidth;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Clear the fighter's own silhouette (for fading a fighter: its back pass mustn't show through its body). */
export function clearStickerSilhouette(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number) {
  const { lay } = enter(ctx, verts, footIndex);
  ctx.globalCompositeOperation = "destination-out";
  tri(ctx, lay.edge);
  ctx.fill();
  ctx.restore();
}

/**
 * The front pass: mood effects, the body inside its ink edge, gloss, sparkle,
 * face. World units, y up; `verts` are the fighter's corners (the collision
 * edge, which is the ink line's outer edge). Layout: fighterLayout.ts.
 */
export function drawStickerFront(ctx: CanvasRenderingContext2D, verts: Vec2[], footIndex: number, look: StickerLook, mood: EyeMood, hopping = false, charge = 0) {
  const { c, lay } = enter(ctx, verts, footIndex);
  const k = SHEET_PX; // effects keep the eye sheet's sizes
  const col = look.color;

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

  // Ink: the whole real triangle (just rounded and wiggled within the slop
  // budget), so the foot touches the floor exactly where the physics does.
  tri(ctx, lay.edge);
  ctx.fillStyle = INK;
  ctx.fill();

  // Body: lit from the top left, inside the ink line.
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
