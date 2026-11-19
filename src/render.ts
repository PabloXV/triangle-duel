// Canvas 2D renderer. Reads sim state, never writes it.

import type { CameraView } from "./camera";
import type { Platform, Stage, Vec2 } from "./sim/geometry";
import type { FighterView, MatchResult } from "./sim/sim";

const COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a78bfa"];

export interface RenderOptions {
  debug: boolean;
  labels: string[]; // per fighter, for the debug overlay
  humans: boolean[]; // per fighter: keyboard-controlled? (for the controls hint)
  totalStocks: number; // stocks each player started with
  replay: boolean; // showing the final-KO replay: letterbox, no banner yet
  status?: string; // shown at the top center (e.g. "REPLAY")
}

const CONTROL_HINTS = ["P1: ←/→ rotate, ↓ charge", "P2: A/D rotate, S charge"];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
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
    g.addColorStop(0, "#1e1b2e");
    g.addColorStop(1, "#2b2340");
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
      this.drawFighter(verts, f, COLORS[i % COLORS.length]);
    });

    if (opts.replay) this.drawLetterbox();
    this.drawHud(curr, result, opts);
  }

  private drawPlatform(plat: Platform) {
    const ctx = this.ctx;
    const left = plat.center.x - plat.halfWidth;
    const bottom = plat.center.y - plat.halfHeight;
    const w = plat.halfWidth * 2;
    const h = plat.halfHeight * 2;
    ctx.fillStyle = plat.oneWay ? "#7a6f96" : "#5c5470";
    ctx.fillRect(left, bottom, w, h);
    ctx.fillStyle = "#b9b4c7"; // walkable top edge
    ctx.fillRect(left, bottom + h - 0.06, w, 0.06);
    if (plat.oneWay) {
      // Dashed underside: a hint that you can jump up through it.
      ctx.save();
      ctx.setLineDash([0.15, 0.12]);
      ctx.strokeStyle = "#b9b4c799";
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(left + w, bottom);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawFighter(verts: Vec2[], f: FighterView, color: string) {
    const ctx = this.ctx;
    const px = 1 / this.scale; // one screen pixel in meters
    // Dead: faded. Ghost (just respawned): blinking.
    const blink = Math.floor(performance.now() / 100) % 2 === 0;
    ctx.globalAlpha = f.ko ? 0.4 : f.ghost ? (blink ? 0.3 : 0.75) : 1;

    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    ctx.lineTo(verts[1].x, verts[1].y);
    ctx.lineTo(verts[2].x, verts[2].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = "#0008";
    ctx.stroke();

    // Foot marker: green = grounded, yellow = coyote time, grey = airborne.
    const foot = verts[f.footIndex];
    ctx.beginPath();
    ctx.arc(foot.x, foot.y, 6 * px, 0, Math.PI * 2);
    ctx.fillStyle = f.grounded ? "#6bff8f" : f.canJump ? "#ffd93d" : "#888";
    ctx.fill();
    if (f.gripActive) {
      ctx.beginPath();
      ctx.arc(foot.x, foot.y, 11 * px, 0, Math.PI * 2);
      ctx.strokeStyle = "#6bff8f";
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }

    // Jump charge bar above the fighter.
    if (f.charge > 0) {
      const top = Math.max(verts[0].y, verts[1].y, verts[2].y) + 0.25;
      const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
      ctx.fillStyle = "#0006";
      ctx.fillRect(cx - 0.5, top, 1, 0.12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(cx - 0.5, top, f.charge, 0.12);
    }
    ctx.globalAlpha = 1;
  }

  /** Cinematic bars during the final-KO replay. */
  private drawLetterbox() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bar = this.canvas.height * 0.09;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, bar);
    ctx.fillRect(0, this.canvas.height - bar, this.canvas.width, bar);
    ctx.restore();
  }

  /** Stock row: one small triangle per life, hollow once lost. Screen pixels. */
  private drawStocks(fighters: FighterView[], totalStocks: number, cx: number, y: number) {
    const ctx = this.ctx;
    const slot = 46 + totalStocks * 16; // px per player
    fighters.forEach((f, i) => {
      const color = COLORS[i % COLORS.length];
      const x0 = cx - (fighters.length * slot) / 2 + i * slot;
      ctx.globalAlpha = f.stocks > 0 ? 1 : 0.35;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.font = "bold 13px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`P${i + 1}`, x0, y);
      for (let s = 0; s < totalStocks; s++) {
        const sx = x0 + 28 + s * 16;
        ctx.beginPath();
        ctx.moveTo(sx, y + 2);
        ctx.lineTo(sx + 11, y + 2);
        ctx.lineTo(sx + 5.5, y + 13);
        ctx.closePath();
        if (s < f.stocks) ctx.fill();
        else ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
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
        ctx.fillStyle = COLORS[i % COLORS.length];
        lines.forEach((l, k) => ctx.fillText(l, 12 + i * 220, 12 + k * 16));
      });
    }

    ctx.fillStyle = "#fff8";
    ctx.textAlign = "center";
    const hints = CONTROL_HINTS.filter((_, i) => opts.humans[i]);
    ctx.fillText([...hints, "R restart"].join("   ·   "), w / 2, h - 28);
    this.drawStocks(fighters, opts.totalStocks, w / 2, h - 64);

    if (opts.status) {
      ctx.font = "bold 15px ui-monospace, monospace";
      ctx.fillStyle = opts.status.includes("DESYNC") ? "#ff6b6b" : "#fffc";
      ctx.textAlign = "center";
      ctx.fillText(opts.status, w / 2, opts.debug ? 118 : 14); // below the debug overlay if shown
    }

    if (result.over && !opts.replay) {
      ctx.font = "bold 48px system-ui, sans-serif";
      ctx.fillStyle = result.winner === null ? "#fff" : COLORS[result.winner % COLORS.length];
      ctx.fillText(result.winner === null ? "DRAW" : `P${result.winner + 1} WINS`, w / 2, h * 0.2);
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillStyle = "#fffc";
      ctx.fillText("press R to restart", w / 2, h * 0.2 + 60);
    }
    ctx.restore();
  }
}

function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
