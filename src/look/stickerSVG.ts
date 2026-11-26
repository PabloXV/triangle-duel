// The sticker fighter as an SVG document, for menus (the eye picker, room
// icons, the HUD). Same layout and outline as the canvas version
// (fighterLayout.ts), so a fighter looks the same everywhere.

import type { FighterShape, Vec2 } from "../sim/geometry";
import { STANDARD_SHAPE } from "../sim/shapes";
import { HALO, INK, WHITE, mix, withAlpha } from "../theme";
import { eyesMarkup, type EyeMood } from "./eyes";
import { sparkleSVG } from "./sparkle";
import { FIGHTER_OUTLINE, cornersFromShape, cornersFromWorld, fighterLayout, type Corners, type FighterLayout } from "./fighterLayout";

const f = (n: number) => Math.round(n * 1000) / 1000;
let gid = 0;

/**
 * A whole fighter: `shape` (a balanced unit shape; null = standard), body
 * `color`, eye style `eyes`, in `mood`.
 */
export function stickerSVG(shape: FighterShape | null, color: string, eyes: number, mood: EyeMood = "idle"): string {
  return stickerSVGFromCorners(cornersFromShape(shape ?? STANDARD_SHAPE), color, eyes, mood);
}

/** The fighter's layers in its upright frame (SVG coordinates, y down): block shadow, white outline, and the front (ink, body, details). */
function layers(lay: FighterLayout, color: string, eyes: number, mood: EyeMood) {
  const p = (v: Vec2) => `${f(v.x)},${f(-v.y)}`; // the layout is y up
  const edge = lay.edge.map(p).join(" ");
  const pts = lay.body.map(p).join(" ");
  const id = `stk${++gid}`;
  const { from, to } = lay.gradient;
  const round = `stroke-linejoin="round"`;
  const shadow = `<polygon points="${edge}" fill="${withAlpha(INK, 0.8)}" stroke="${withAlpha(INK, 0.8)}" stroke-width="${f(lay.haloWidth)}" ${round}/>`;
  const halo = `<polygon points="${edge}" fill="${HALO}" stroke="${HALO}" stroke-width="${f(lay.haloWidth)}" ${round}/>`;
  const front =
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(from.x)}" y1="${f(-from.y)}" x2="${f(to.x)}" y2="${f(-to.y)}"><stop offset="0" stop-color="${mix(color, WHITE, 0.35)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${mix(color, INK, 0.3)}"/></linearGradient>` +
    `<clipPath id="${id}c"><polygon points="${pts}"/></clipPath></defs>` +
    `<polygon points="${edge}" fill="${INK}"/>` +
    `<polygon points="${pts}" fill="url(#${id})"/>` +
    `<path d="${lay.gloss.map(([a, b]) => `M${p(a)}L${p(b)}`).join("")}" stroke="${WHITE}" stroke-width="${f(lay.glossWidth)}" stroke-linecap="round"/>` +
    sparkleSVG(lay.sparkle.x, -lay.sparkle.y, lay.sparkle.r) +
    `<g clip-path="url(#${id}c)"><g transform="translate(${f(lay.face.x)} ${f(-lay.face.y)}) rotate(${f((-lay.face.angle * 180) / Math.PI)}) scale(${f(lay.face.scale)})">${eyesMarkup(eyes, mood, color)}</g></g>`;
  return { shadow, halo, front };
}

/**
 * The same, from a fighter's upright corners (meters). `pxPerMeter` sets the
 * document's pixel size (for rasterizing); otherwise it scales to its container.
 */
export function stickerSVGFromCorners(c: Corners, color: string, eyes: number, mood: EyeMood = "idle", pxPerMeter?: number): string {
  const lay = fighterLayout(c, FIGHTER_OUTLINE);
  const xs = lay.edge.map((v) => v.x);
  const ys = lay.edge.map((v) => -v.y);
  const pad = lay.haloWidth / 2 + lay.shadow + 0.02;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  const { shadow, halo, front } = layers(lay, color, eyes, mood);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}"${pxPerMeter ? ` width="${Math.ceil(w * pxPerMeter)}" height="${Math.ceil(h * pxPerMeter)}"` : ""}>` +
    `<g transform="translate(${f(lay.shadow)} ${f(lay.shadow)})">${shadow}</g>${halo}${front}</svg>`
  );
}

/**
 * A fighter exactly as it looks in play, at its world position: SVG elements
 * for an SVG whose units are meters, y down (world y negated). `verts` are its
 * world corners. `back` (shadow and white outline) goes behind the scene's
 * other objects and `front` in front, as in play, so ink meets ink where they touch.
 */
export function stickerInWorld(verts: readonly Vec2[], footIndex: number, color: string, eyes: number, mood: EyeMood = "idle"): { back: string; front: string } {
  const c = cornersFromWorld(verts, footIndex);
  const lay = fighterLayout(c, FIGHTER_OUTLINE);
  const { shadow, halo, front } = layers(lay, color, eyes, mood);
  const rot = f((-c.angle * 180) / Math.PI);
  const at = `translate(${f(c.foot.x)} ${f(-c.foot.y)}) rotate(${rot})`;
  // The shadow is offset down-right in the world, whichever way the fighter leans.
  return {
    back: `<g transform="translate(${f(c.foot.x + lay.shadow)} ${f(-c.foot.y + lay.shadow)}) rotate(${rot})">${shadow}</g><g transform="${at}">${halo}</g>`,
    front: `<g transform="${at}">${front}</g>`,
  };
}
