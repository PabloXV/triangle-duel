// Canvas 2D renderer. Reads sim state, never writes it.

import { cornersFromWorld } from "./look/fighterLayout";
import { drawSticker, moodOf } from "./look/sticker";
import { DEBUG_COLORS, HALO, INK, SCENE, playerColor, withAlpha } from "./theme";
import type { CameraView } from "./camera";
import type { Platform, Stage, Vec2 } from "./sim/geometry";
import type { FighterView, MatchResult } from "./sim/sim";

/** Fighter colors, by fighter index (also used by the menus). */

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
}


export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
  }

  /** Canvas size in CSS px. */
  canvasSize() {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  /** Canvas width / height, for the camera to match. */
  aspect(): number {
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  private applyCamera(cam: CameraView) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.scale = Math.min(w / cam.width, h / cam.height); // fit the whole camera box
    // Origin at screen center, y up, 1 unit = 1 meter; then shake (tilt + offset).
    this.ctx.setTransform(dpr * this.scale, 0, 0, -dpr * this.scale, (dpr * w) / 2, (dpr * h) / 2);
    this.ctx.rotate(cam.tilt);
    this.ctx.translate(-(cam.center.x + cam.shake.x), -(cam.center.y + cam.shake.y));
  }

  /**
   * `prev` and `curr` are the fighter states from the last two ticks; `alpha`
   * (0..1) is how far between them the current frame falls. Interpolating keeps
   * motion smooth on displays faster than the 60Hz tick rate.
   */
  draw(
    stage: Stage,
    cam: CameraView,
    prev: FighterView[],
    curr: FighterView[],
    alpha: number,
    result: MatchResult,
    opts: RenderOptions,
  ) {
    const ctx = this.ctx;
    this.applyCamera(cam);

    // background, in screen space
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, SCENE.skyTop);
    g.addColorStop(1, SCENE.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    for (const plat of stage.platforms) this.drawPlatform(plat);

    curr.forEach((f, i) => {
      if (f.eliminated) return; // out of stocks: gone from the stage
      let p = prev[i] ?? f;
      // Respawning teleports the body; don't draw a smear between the two spots.
      if (Math.abs(p.x - f.x) + Math.abs(p.y - f.y) > 1) p = f;
      const verts = f.vertices.map((v, k) => lerpV(p.vertices[k], v, alpha));
      this.drawFighter(verts, f, playerColor(i), opts.eyes?.[i] ?? 0, opts.debug);
    });

    if (opts.replay) this.drawLetterbox();
    if (opts.hud) this.drawOffscreen(cam, curr);
    this.drawHud(curr, result, opts);
  }

  private drawPlatform(plat: Platform) {
    const ctx = this.ctx;
    const left = plat.center.x - plat.halfWidth;
    const bottom = plat.center.y - plat.halfHeight;
    const w = plat.halfWidth * 2;
    const h = plat.halfHeight * 2;
    ctx.fillStyle = plat.oneWay ? SCENE.platformPassable : SCENE.platform;
    ctx.fillRect(left, bottom, w, h);
    ctx.fillStyle = SCENE.groundLine; // walkable top edge
    ctx.fillRect(left, bottom + h - 0.06, w, 0.06);
    if (plat.oneWay) {
      // Dashed underside: a hint that you can jump up through it.
      ctx.save();
      ctx.setLineDash([0.15, 0.12]);
      ctx.strokeStyle = withAlpha(SCENE.groundLine, 0.6);
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(left + w, bottom);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawFighter(verts: Vec2[], f: FighterView, color: string, eyes: number, debug: boolean) {
    const ctx = this.ctx;
    const px = 1 / this.scale; // one screen pixel in meters
    // Dead: faded. Ghost (just respawned): blinking.
    const blink = Math.floor(performance.now() / 100) % 2 === 0;
    const alpha = f.ko ? 0.6 : f.ghost ? (blink ? 0.35 : 0.8) : 1;
    if (alpha < 1) {
      // Fade the fighter as a whole: drawn layer by layer at partial opacity,
      // its shadow and outline would show through the body.
      const layer = this.fadeLayer();
      layer.setTransform(ctx.getTransform());
      drawSticker(layer, verts, f.footIndex, { color, eyes }, moodOf(f));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    } else drawSticker(ctx, verts, f.footIndex, { color, eyes }, moodOf(f));
    ctx.globalAlpha = alpha;

    if (debug) this.drawFootMarker(verts, f, px);

    // Jump charge bar above the fighter.
    if (f.charge > 0) {
      const top = Math.max(verts[0].y, verts[1].y, verts[2].y) + 0.35;
      const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
      ctx.fillStyle = withAlpha(INK, 0.8);
      ctx.fillRect(cx - 0.52, top - 0.02, 1.04, 0.16);
      ctx.fillStyle = HALO;
      ctx.fillRect(cx - 0.5, top, f.charge, 0.12);
    }
    ctx.globalAlpha = 1;
  }

  private layer: CanvasRenderingContext2D | null = null;
  /** A scratch canvas the size of the game canvas, for fading a fighter as one piece. */
  private fadeLayer(): CanvasRenderingContext2D {
    if (!this.layer) this.layer = document.createElement("canvas").getContext("2d")!;
    const c = this.layer.canvas;
    if (c.width !== this.canvas.width || c.height !== this.canvas.height) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    return this.layer;
  }

  private drawFootMarker(verts: Vec2[], f: FighterView, px: number) {
    const ctx = this.ctx;
    // Foot marker: green = grounded, yellow = coyote time, grey = airborne.
    const foot = verts[f.footIndex];
    ctx.beginPath();
    ctx.arc(foot.x, foot.y, 6 * px, 0, Math.PI * 2);
    ctx.fillStyle = f.grounded ? DEBUG_COLORS.grounded : f.canJump ? DEBUG_COLORS.coyote : DEBUG_COLORS.airborne;
    ctx.fill();
    if (f.gripActive) {
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, 11 * px, 0, Math.PI * 2);
      ctx.strokeStyle = DEBUG_COLORS.grounded;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  }

  /** Cinematic bars during the final-KO replay. */
  private drawLetterbox() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bar = this.canvas.height * 0.09;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, this.canvas.width, bar);
    ctx.fillRect(0, this.canvas.height - bar, this.canvas.width, bar);
    ctx.restore();
  }

  /**
   * Stock row: one small copy of each fighter's own shape per life, hollow
   * once lost. All icons share one scale, so relative sizes show (a tall
   * fighter's icons are taller), capped so the tallest fits. Screen pixels.
   */
  private drawStocks(fighters: FighterView[], names: string[], totalStocks: number, cx: number, y: number) {
    const ctx = this.ctx;
    const label = (i: number) => (names[i] ?? `P${i + 1}`).slice(0, 10);
    ctx.font = "bold 13px system-ui, sans-serif";
    const labelW = Math.max(28, ...fighters.map((_, i) => ctx.measureText(label(i)).width + 8));
    // Each fighter standing upright (its own frame; fighterLayout.ts).
    const shapes = fighters.map((f) => {
      const c = cornersFromWorld(f.vertices, f.footIndex);
      return [c.F, c.L, c.R];
    });
    const extent = (s: Vec2[], axis: "x" | "y") => Math.max(...s.map((p) => p[axis])) - Math.min(...s.map((p) => p[axis]));
    const ICON_PX_PER_M = 9; // the standard fighter (~1.2 m) comes out ~11 px tall
    const MAX_ICON_PX = 15;
    const scale = Math.min(ICON_PX_PER_M, MAX_ICON_PX / Math.max(...shapes.map((s) => extent(s, "y"))));
    const iconW = Math.max(...shapes.map((s) => extent(s, "x"))) * scale;
    const step = iconW + 5;
    const slot = labelW + totalStocks * step + 14; // px per player
    const midY = y + 7; // icons centered on the label's line
    fighters.forEach((f, i) => {
      const color = playerColor(i);
      const x0 = cx - (fighters.length * slot) / 2 + i * slot;
      ctx.globalAlpha = f.stocks > 0 ? 1 : 0.35;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.textAlign = "left";
      ctx.fillText(label(i), x0, y);
      const s = shapes[i];
      const minX = Math.min(...s.map((p) => p.x));
      const midYm = (Math.max(...s.map((p) => p.y)) + Math.min(...s.map((p) => p.y))) / 2;
      for (let n = 0; n < totalStocks; n++) {
        const left = x0 + labelW + n * step + (iconW - extent(s, "x") * scale) / 2;
        ctx.beginPath();
        s.forEach((p, k) => {
          const px = left + (p.x - minX) * scale;
          const py = midY - (p.y - midYm) * scale; // screen y points down
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        if (n < f.stocks) ctx.fill();
        else ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  /**
   * An arrow at the screen edge, in the fighter's color, pointing at each
   * fighter outside the view (on tall screens the camera can't always fit
   * everyone). Skips anyone below the stage: they're falling to a KO.
   */
  private drawOffscreen(cam: CameraView, fighters: FighterView[]) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const M = 18; // px from the edge
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fighters.forEach((f, i) => {
      if (f.ko || f.eliminated) return;
      const sx = w / 2 + (f.x - cam.center.x) * this.scale;
      const sy = h / 2 - (f.y - cam.center.y) * this.scale;
      const inside = sx > -10 && sx < w + 10 && sy > -10 && sy < h + 10;
      if (inside || sy > h) return;
      const ex = Math.min(w - M, Math.max(M, sx));
      const ey = Math.min(h - M, Math.max(M, sy));
      const a = Math.atan2(sy - ey, sx - ex);
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fillStyle = playerColor(i);
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ctx.restore();
  }

  private drawHud(fighters: FighterView[], result: MatchResult, opts: RenderOptions) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "13px ui-monospace, monospace";
    ctx.textBaseline = "top";

    if (opts.debug) {
      fighters.forEach((f, i) => {
        const lines = [
          `${opts.labels[i] ?? `P${i + 1}`}${f.ko ? `  KO (${f.ko})` : ""}`,
          `angle  ${((f.angle * 180) / Math.PI).toFixed(1)}°`,
          `ω      ${f.angularVelocity.toFixed(2)} rad/s`,
          `ground ${f.grounded ? "yes" : f.canJump ? "coyote" : "no"}`,
          `grip   ${f.gripActive ? "on" : "off"}`,
          `charge ${(f.charge * 100).toFixed(0)}%`,
        ];
        ctx.fillStyle = playerColor(i);
        lines.forEach((l, k) => ctx.fillText(l, 12 + i * 220, 12 + k * 16));
      });
    }

    if (opts.hud) {
      ctx.fillStyle = withAlpha(HALO, 0.55);
      ctx.textAlign = "center";
      ctx.fillText(opts.controls.join("   ·   "), w / 2, h - 28);
      this.drawStocks(fighters, opts.names, opts.totalStocks, w / 2, h - 64);
    }

    if (opts.status) {
      ctx.font = "bold 15px ui-monospace, monospace";
      ctx.fillStyle = opts.status.includes("DESYNC") ? playerColor(0) : withAlpha(HALO, 0.8);
      ctx.textAlign = "center";
      ctx.fillText(opts.status, w / 2, opts.debug ? 118 : 14); // below the debug overlay if shown
    }

    if (opts.hud && result.over && !opts.replay) {
      ctx.textAlign = "center"; // (the stock row leaves it at "left")
      ctx.font = "bold 48px system-ui, sans-serif";
      ctx.fillStyle = result.winner === null ? HALO : playerColor(result.winner);
      const winner = result.winner === null ? "" : (opts.names[result.winner] ?? `P${result.winner + 1}`);
      ctx.fillText(result.winner === null ? "DRAW" : `${winner.toUpperCase()} WINS`, w / 2, h * 0.2);
    }
    ctx.restore();
  }
}

function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
