// Marks (docs/visual-language.md §6): the small effects. Fill-style marks are
// a flat fill with an ink line: no gradient, outline or shadow. One shape set,
// shared by the fighters, platforms, eyes and menus.

import { HALO, INK, LINES, withAlpha } from "../theme";
import { sparklePoints } from "./sparkle";

/** Ink line on marks (LINES.markLine), and the thinnest one on a tiny mark (a sparkle). */
export const MARK_INK = LINES.markLine;
const MARK_LINE_MIN = 0.022;

/** A fill-style mark: flat `fill`, ink line (even-odd, so a path can have a hole). */
export function mark(ctx: CanvasRenderingContext2D, fill: string, path: () => void) {
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
export function band(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, width: number) {
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
export function spike(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, halfWidth: number) {
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

/** A 4-point sparkle (sheet: star4), in the current transform's units. */
export function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  sparklePoints(x, y, r).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(r * 0.2, MARK_LINE_MIN);
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
}


/** The jump-charge meter above a fighter (world units): an ink-lined pill filling with the fighter's color. */
export function drawChargeMeter(ctx: CanvasRenderingContext2D, verts: readonly { x: number; y: number }[], charge: number, color: string) {
  const top = Math.max(verts[0].y, verts[1].y, verts[2].y) + 0.38;
  const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
  const W = 1;
  const H = 0.16;
  const pill = (w: number) => {
    ctx.beginPath();
    ctx.roundRect(cx - W / 2, top, w, H, H / 2);
  };
  pill(W);
  ctx.fillStyle = withAlpha(INK, 0.75);
  ctx.fill();
  pill(Math.max(H, W * charge));
  ctx.fillStyle = color;
  ctx.fill();
  pill(W);
  ctx.strokeStyle = INK;
  ctx.lineWidth = MARK_INK;
  ctx.stroke();
}
