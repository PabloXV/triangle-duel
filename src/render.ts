// Canvas 2D renderer: the scene (wall, platforms, fighters, paint grain) in
// world units, then the HUD (hud.ts) in screen pixels. Reads sim state, never
// writes it.

import type { CameraView } from "./camera";
import { colorOf, drawHud, type RenderOptions } from "./hud";
import { drawChargeMeter } from "./look/marks";
import { drawPlatform } from "./look/platforms";
import { drawSticker, moodOf } from "./look/sticker";
import { fillTexture, preloadTextures } from "./look/texture";
import { drawWall } from "./look/wall";
import type { Stage, Vec2 } from "./sim/geometry";
import type { FighterView, MatchResult } from "./sim/sim";
import { DEBUG_COLORS, INK } from "./theme";

export type { RenderOptions } from "./hud";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    preloadTextures();
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
    const dpr = canvasDpr();
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

    drawWall(ctx, cam, this.scale);
    stage.platforms.forEach((plat, i) => drawPlatform(ctx, plat, i));

    curr.forEach((f, i) => {
      if (f.eliminated) return; // out of stocks: gone from the stage
      let p = prev[i] ?? f;
      // Respawning teleports the body; don't draw a smear between the two spots.
      if (Math.abs(p.x - f.x) + Math.abs(p.y - f.y) > 1) p = f;
      const verts = f.vertices.map((v, k) => lerpV(p.vertices[k], v, alpha));
      this.drawFighter(verts, f, colorOf(opts, i), opts.eyes?.[i] ?? 0, opts.debug);
    });

    // Paint grain over the whole scene (not the HUD: it must stay crisp).
    fillTexture(ctx, "grain", ctx.getTransform(), 1, "multiply");

    if (opts.replay) this.drawLetterbox();
    const screen = { w: this.canvas.clientWidth, h: this.canvas.clientHeight, dpr: canvasDpr(), scale: this.scale };
    drawHud(ctx, screen, cam, curr, result, opts);
  }

  private drawFighter(verts: Vec2[], f: FighterView, color: string, eyes: number, debug: boolean) {
    const ctx = this.ctx;
    const px = 1 / this.scale; // one screen pixel in meters
    // Dead: faded. Ghost (just respawned): blinking.
    const blink = Math.floor(performance.now() / 100) % 2 === 0;
    const alpha = f.ko ? 0.6 : f.ghost ? (blink ? 0.35 : 0.8) : 1;
    const hopping = !f.grounded && f.vy > 0.5; // rising from a hop: motion arcs
    if (alpha < 1) {
      // Fade the fighter as a whole: drawn layer by layer at partial opacity,
      // its shadow and outline would show through the body.
      const layer = this.fadeLayer();
      layer.setTransform(ctx.getTransform());
      drawSticker(layer, verts, f.footIndex, { color, eyes }, moodOf(f), hopping, f.charge);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    } else drawSticker(ctx, verts, f.footIndex, { color, eyes }, moodOf(f), hopping, f.charge);
    ctx.globalAlpha = alpha;

    if (debug) this.drawFootMarker(verts, f, px);

    if (f.charge > 0) drawChargeMeter(ctx, verts, f.charge, color);
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
}

/**
 * Canvas pixels per CSS pixel: the screen's, capped at 2. Phones are often 3x;
 * at their size 2x looks the same, and every frame fills 2.25x fewer pixels
 * (the wall, grain and fades are full-screen fills).
 */
function canvasDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
