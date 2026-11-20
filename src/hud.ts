// The in-game interface, drawn on the canvas in screen pixels over the scene:
// the stock row, the winner banner, status and control hints, off-screen
// arrows, and the debug overlay. Reads state, never writes it.

import type { CameraView } from "./camera";
import { cornersFromWorld } from "./look/fighterLayout";
import { stickerSVGFromCorners } from "./look/stickerSVG";
import { SvgImages } from "./look/svgImage";
import type { FighterView, MatchResult } from "./sim/sim";
import { FONTS, HALO, INK, playerColor, withAlpha } from "./theme";

export interface RenderOptions {
  hud: boolean; // false = no in-game interface (e.g. the bot match behind the menus)
  debug: boolean;
  labels: string[]; // per fighter, for the debug overlay
  names: string[]; // per fighter, for the stock row and the winner banner
  controls: string[]; // control hints for the bottom line, e.g. "P1: ←/→ rotate, ↓ charge"
  totalStocks: number; // stocks each player started with
  replay: boolean; // showing the final-KO replay: letterbox, no banner yet
  status?: string; // shown at the top center (e.g. "REPLAY")
  eyes?: number[]; // per fighter: eye style (src/look/eyes.ts)
  colors?: string[]; // per fighter: body color (default: by player number)
}

/** Fighter i's body color: as chosen (opts.colors), else by player number. */
export function colorOf(opts: RenderOptions, i: number): string {
  return opts.colors?.[i] ?? playerColor(i);
}

/** The screen: CSS pixels, device pixel ratio, and pixels per meter (the camera's zoom). */
export interface Screen {
  w: number;
  h: number;
  dpr: number;
  scale: number;
}

export function drawHud(ctx: CanvasRenderingContext2D, screen: Screen, cam: CameraView, fighters: FighterView[], result: MatchResult, opts: RenderOptions) {
  const { w, h, dpr } = screen;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (opts.hud) drawOffscreen(ctx, screen, cam, fighters, opts);
  ctx.font = `13px ${FONTS.mono}`;
  ctx.textBaseline = "top";
  if (opts.debug) drawDebug(ctx, fighters, opts);

  if (opts.hud) {
    ctx.font = `13px ${FONTS.body}`;
    ctx.fillStyle = withAlpha(HALO, 0.6);
    ctx.textAlign = "center";
    ctx.fillText(opts.controls.join("   ·   "), w / 2, h - 28);
    drawStocks(ctx, fighters, opts, w / 2, h - 52);
    ctx.textBaseline = "top";
  }

  if (opts.status) {
    ctx.font = `500 15px ${FONTS.body}`;
    ctx.fillStyle = opts.status.includes("DESYNC") ? playerColor(0) : withAlpha(HALO, 0.8);
    ctx.textAlign = "center";
    ctx.fillText(opts.status, w / 2, opts.debug ? 118 : 14); // below the debug overlay if shown
  }

  if (opts.hud && result.over && !opts.replay) drawBanner(ctx, w, h, result, opts);
  ctx.restore();
}

/**
 * Stock row: per player, the name (Permanent Marker, ink stroke) and one mini
 * fighter per life, each the player's own shape, color and eyes with the full
 * sticker look; lost lives fade out. All icons share one scale, so relative
 * sizes show.
 */
function drawStocks(ctx: CanvasRenderingContext2D, fighters: FighterView[], opts: RenderOptions, cx: number, y: number) {
  const label = (i: number) => (opts.names[i] ?? `P${i + 1}`).slice(0, 10);
  ctx.font = `15px ${FONTS.label}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const labelW = Math.max(28, ...fighters.map((_, i) => ctx.measureText(label(i)).width + 10));
  const icons = fighters.map((f, i) => hudIcon(f, colorOf(opts, i), opts.eyes?.[i] ?? 0));
  const iconW = Math.max(...icons.map((ic) => ic?.w ?? 0), 16);
  const step = iconW + 2;
  const slot = labelW + opts.totalStocks * step + 18; // px per player
  fighters.forEach((f, i) => {
    const x0 = cx - (fighters.length * slot) / 2 + i * slot;
    ctx.globalAlpha = f.stocks > 0 ? 1 : 0.4;
    ctx.textAlign = "left";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeText(label(i), x0, y);
    ctx.fillStyle = colorOf(opts, i);
    ctx.fillText(label(i), x0, y);
    const ic = icons[i];
    if (!ic) return;
    for (let n = 0; n < opts.totalStocks; n++) {
      ctx.globalAlpha = n < f.stocks ? 1 : 0.22;
      ctx.drawImage(ic.img, x0 + labelW + n * step + (iconW - ic.w) / 2, y - ic.h / 2, ic.w, ic.h);
    }
  });
  ctx.globalAlpha = 1;
}

/** The winner banner, in the title style (visual-language.md §11): graffiti handstyle, ink stroke, offset ink copy, a slight tilt. */
function drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number, result: Extract<MatchResult, { over: true }>, opts: RenderOptions) {
  const winner = result.winner === null ? "" : (opts.names[result.winner] ?? `P${result.winner + 1}`);
  const text = result.winner === null ? "Draw!" : `${winner} wins!`;
  ctx.save();
  ctx.translate(w / 2, h * 0.2);
  ctx.rotate((-4 * Math.PI) / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.min(72, w / 9)}px ${FONTS.title}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.fillStyle = ctx.strokeStyle = INK;
  ctx.strokeText(text, 6, 6);
  ctx.fillText(text, 6, 6);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = result.winner === null ? HALO : colorOf(opts, result.winner);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * An arrow at the screen edge, in the fighter's color, pointing at each
 * fighter outside the view (on tall screens the camera can't always fit
 * everyone). Skips anyone below the stage: they're falling to a KO.
 */
function drawOffscreen(ctx: CanvasRenderingContext2D, screen: Screen, cam: CameraView, fighters: FighterView[], opts: RenderOptions) {
  const { w, h, dpr, scale } = screen;
  const M = 18; // px from the edge
  fighters.forEach((f, i) => {
    if (f.ko || f.eliminated) return;
    const sx = w / 2 + (f.x - cam.center.x) * scale;
    const sy = h / 2 - (f.y - cam.center.y) * scale;
    const inside = sx > -10 && sx < w + 10 && sy > -10 && sy < h + 10;
    if (inside || sy > h) return;
    const ex = Math.min(w - M, Math.max(M, sx));
    const ey = Math.min(h - M, Math.max(M, sy));
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(sy - ey, sx - ex));
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = colorOf(opts, i);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });
}

/** Per-fighter numbers (the ` debug toggle). */
function drawDebug(ctx: CanvasRenderingContext2D, fighters: FighterView[], opts: RenderOptions) {
  fighters.forEach((f, i) => {
    const lines = [
      `${opts.labels[i] ?? `P${i + 1}`}${f.ko ? `  KO (${f.ko})` : ""}`,
      `angle  ${((f.angle * 180) / Math.PI).toFixed(1)}°`,
      `ω      ${f.angularVelocity.toFixed(2)} rad/s`,
      `ground ${f.grounded ? "yes" : f.canJump ? "coyote" : "no"}`,
      `grip   ${f.gripActive ? "on" : "off"}`,
      `charge ${(f.charge * 100).toFixed(0)}%`,
    ];
    ctx.fillStyle = colorOf(opts, i);
    lines.forEach((l, k) => ctx.fillText(l, 12 + i * 220, 12 + k * 16));
  });
}

// ---- stock icons: each fighter's sticker, rasterized once per shape/color/eyes ----
const HUD_PX_PER_M = 19; // the standard fighter comes out ~24 px tall
const hudIcons = new SvgImages((img) => ({ img, w: img.width / 2, h: img.height / 2 })); // drawn at 2x for sharp screens

function hudIcon(f: FighterView, color: string, eyes: number) {
  const c = cornersFromWorld(f.vertices, f.footIndex);
  const key = `${[c.L, c.R].map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(";")}|${color}|${eyes}`;
  return hudIcons.get(key, () => stickerSVGFromCorners(c, color, eyes, "idle", HUD_PX_PER_M * 2));
}
