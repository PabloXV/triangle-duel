// The sticker fighter (see sticker.ts) as SVG markup, for menus: the eye
// picker, room icons. Same build as the eye sheet (concept/eyes.html), minus
// its texture filters.

import type { FighterShape, Vec2 } from "../sim/geometry";
import { STANDARD_SHAPE } from "../sim/shapes";
import { eyesMarkup, type EyeMood } from "./eyes";

const INK = "#15101f";
const HALO = "#f3eefc";
const SHEET_AREA = 7000;
const f = (n: number) => Math.round(n * 1000) / 1000;
let gid = 0;

function mix(hex: string, other: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Corners in SVG coordinates (y down), foot at the origin, standing upright: foot F, top-left L, top-right R. */
function corners(shape: FighterShape) {
  const foot = shape.vertices[shape.footIndex];
  const tops = shape.vertices.filter((_, i) => i !== shape.footIndex).map((v) => ({ x: v.x - foot.x, y: -(v.y - foot.y) }));
  const [L, R] = tops[0].x <= tops[1].x ? tops : [tops[1], tops[0]];
  return { F: { x: 0, y: 0 }, L, R };
}

/**
 * A whole fighter as an SVG document: `shape` (a balanced unit shape; null =
 * standard), body `color`, eye style `eyes`, in `mood`.
 */
export function stickerSVG(shape: FighterShape | null, color: string, eyes: number, mood: EyeMood = "idle"): string {
  const { F, L, R } = corners(shape ?? STANDARD_SHAPE);
  const a = Math.hypot(L.x - R.x, L.y - R.y);
  const b = Math.hypot(F.x - R.x, F.y - R.y);
  const c = Math.hypot(F.x - L.x, F.y - L.y);
  const p = a + b + c;
  const area = Math.abs((L.x - F.x) * (R.y - F.y) - (L.y - F.y) * (R.x - F.x)) / 2;
  const I = { x: (a * F.x + b * L.x + c * R.x) / p, y: (a * F.y + b * L.y + c * R.y) / p };
  const r = (2 * area) / p;
  const k = Math.sqrt(area / SHEET_AREA);
  const pts = [F, L, R].map((q) => `${f(q.x)},${f(q.y)}`).join(" ");
  const lerp = (u: Vec2, v: Vec2, t: number) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const d1a = lerp(lerp(F, L, 0.34), I, 0.18);
  const d1b = lerp(lerp(F, L, 0.62), I, 0.18);
  const d2a = lerp(lerp(F, L, 0.7), I, 0.18);
  const d2b = lerp(lerp(F, L, 0.76), I, 0.18);
  const id = `stk${++gid}`;
  const xs = [F.x, L.x, R.x];
  const ys = [F.y, L.y, R.y];
  const pad = 22 * k;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  const faceAng = (Math.atan2(R.y - L.y, R.x - L.x) * 180) / Math.PI;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="${mix(color, "#ffffff", 0.35)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${mix(color, INK, 0.3)}"/></linearGradient></defs>` +
    `<polygon points="${pts}" fill="${HALO}" stroke="${HALO}" stroke-width="${f(26 * k)}" stroke-linejoin="round" transform="translate(${f(4 * k)} ${f(4 * k)})"/>` +
    `<polygon points="${pts}" fill="${INK}" stroke="${INK}" stroke-width="${f(10 * k)}" stroke-linejoin="round" transform="translate(${f(9 * k)} ${f(10 * k)})"/>` +
    `<polygon points="${pts}" fill="url(#${id})"/>` +
    `<path d="M${f(d1a.x)} ${f(d1a.y)}L${f(d1b.x)} ${f(d1b.y)}M${f(d2a.x)} ${f(d2a.y)}L${f(d2b.x)} ${f(d2b.y)}" stroke="#fff" stroke-width="${f(5 * k)}" stroke-linecap="round"/>` +
    `<polygon points="${pts}" fill="none" stroke="${INK}" stroke-width="${f(7 * k)}" stroke-linejoin="round"/>` +
    `<g transform="translate(${f(I.x)} ${f(I.y)}) rotate(${f(faceAng)}) scale(${f(r * 1.38)})">${eyesMarkup(eyes, mood, color)}</g>` +
    `</svg>`
  );
}
