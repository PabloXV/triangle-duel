// Canvas 2D renderer. Reads sim state, never writes it.

import { cornersFromWorld } from "./look/fighterLayout";
import { drawPlatform } from "./look/platforms";
import { drawSticker, moodOf } from "./look/sticker";
import { fillTexture, preloadTextures } from "./look/texture";
import { DEBUG_COLORS, FONTS, HALO, INK, LINES, WALL, playerColor, withAlpha } from "./theme";
import { stickerSVGFromCorners } from "./look/stickerSVG";
import type { CameraView } from "./camera";
import type { Stage, Vec2 } from "./sim/geometry";
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
  colors?: string[]; // per fighter: body color (default: by player number)
}


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

    this.drawWall(cam);
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
    if (opts.hud) this.drawOffscreen(cam, curr, opts);
    this.drawHud(curr, result, opts);
  }

  /**
   * The backdrop: a dark wall (visual-language.md §10). A gradient in screen
   * space; faint brick courses and spray speckle locked to the world.
   */
  private drawWall(cam: CameraView) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, WALL.top);
    g.addColorStop(1, WALL.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    // Bricks: courses 1.32 m tall, bricks 2.8 m wide, staggered.
    const COURSE = 1.32;
    const BRICK = 2.8;
    const x0 = cam.center.x - cam.width;
    const x1 = cam.center.x + cam.width;
    const y0 = cam.center.y - cam.height;
    const y1 = cam.center.y + cam.height;
    const px = 1 / this.scale;
    ctx.save();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = withAlpha(INK, 0.14);
    ctx.beginPath();
    for (let y = Math.floor(y0 / COURSE) * COURSE; y < y1; y += COURSE) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.strokeStyle = withAlpha(INK, 0.1);
    ctx.beginPath();
    for (let y = Math.floor(y0 / COURSE) * COURSE; y < y1; y += COURSE) {
      const offset = Math.round(y / COURSE) % 2 ? 0 : BRICK / 2;
      for (let x = Math.floor((x0 - offset) / BRICK) * BRICK + offset; x < x1; x += BRICK) {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + COURSE);
      }
    }
    ctx.stroke();
    ctx.restore();

    const world = ctx.getTransform();
    fillTexture(ctx, "speckLight", world, 0.45);
    fillTexture(ctx, "speckDark", world, 0.55);
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

    // Jump charge meter above the fighter: a mark (pill, ink line), filling with the fighter's color.
    if (f.charge > 0) {
      const top = Math.max(verts[0].y, verts[1].y, verts[2].y) + 0.38;
      const cx = (verts[0].x + verts[1].x + verts[2].x) / 3;
      const W = 1;
      const H = 0.16;
      const pill = (x: number, w: number) => {
        ctx.beginPath();
        ctx.roundRect(x, top, w, H, H / 2);
      };
      pill(cx - W / 2, W);
      ctx.fillStyle = withAlpha(INK, 0.75);
      ctx.fill();
      pill(cx - W / 2, Math.max(H, W * f.charge));
      ctx.fillStyle = color;
      ctx.fill();
      pill(cx - W / 2, W);
      ctx.strokeStyle = INK;
      ctx.lineWidth = LINES.markLine;
      ctx.stroke();
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
  /**
   * Stock row: per player, the name (Permanent Marker, ink stroke) and one
   * mini fighter per life, each the player's own shape, color and eyes with
   * the full sticker look; lost lives fade out. All icons share one scale,
   * so relative sizes show. Screen pixels.
   */
  private drawStocks(fighters: FighterView[], names: string[], eyes: number[], colors: string[], totalStocks: number, cx: number, y: number) {
    const ctx = this.ctx;
    const label = (i: number) => (names[i] ?? `P${i + 1}`).slice(0, 10);
    ctx.font = `15px ${FONTS.label}`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const labelW = Math.max(28, ...fighters.map((_, i) => ctx.measureText(label(i)).width + 10));
    const icons = fighters.map((f, i) => hudIcon(f, colors[i], eyes[i] ?? 0));
    const iconW = Math.max(...icons.map((ic) => ic?.w ?? 0), 16);
    const step = iconW + 2;
    const slot = labelW + totalStocks * step + 18; // px per player
    fighters.forEach((f, i) => {
      const x0 = cx - (fighters.length * slot) / 2 + i * slot;
      ctx.globalAlpha = f.stocks > 0 ? 1 : 0.4;
      ctx.textAlign = "left";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.strokeText(label(i), x0, y);
      ctx.fillStyle = colors[i];
      ctx.fillText(label(i), x0, y);
      const ic = icons[i];
      if (!ic) return;
      for (let n = 0; n < totalStocks; n++) {
        ctx.globalAlpha = n < f.stocks ? 1 : 0.22;
        ctx.drawImage(ic.img, x0 + labelW + n * step + (iconW - ic.w) / 2, y - ic.h / 2, ic.w, ic.h);
      }
    });
    ctx.globalAlpha = 1;
  }

  /**
   * An arrow at the screen edge, in the fighter's color, pointing at each
   * fighter outside the view (on tall screens the camera can't always fit
   * everyone). Skips anyone below the stage: they're falling to a KO.
   */
  private drawOffscreen(cam: CameraView, fighters: FighterView[], opts: RenderOptions) {
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
    ctx.restore();
  }

  private drawHud(fighters: FighterView[], result: MatchResult, opts: RenderOptions) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `13px ${FONTS.mono}`;
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
        ctx.fillStyle = colorOf(opts, i);
        lines.forEach((l, k) => ctx.fillText(l, 12 + i * 220, 12 + k * 16));
      });
    }

    if (opts.hud) {
      ctx.font = `13px ${FONTS.body}`;
      ctx.fillStyle = withAlpha(HALO, 0.6);
      ctx.textAlign = "center";
      ctx.fillText(opts.controls.join("   ·   "), w / 2, h - 28);
      this.drawStocks(fighters, opts.names, opts.eyes ?? [], fighters.map((_, i) => colorOf(opts, i)), opts.totalStocks, w / 2, h - 52);
      ctx.textBaseline = "top";
    }

    if (opts.status) {
      ctx.font = `500 15px ${FONTS.body}`;
      ctx.fillStyle = opts.status.includes("DESYNC") ? playerColor(0) : withAlpha(HALO, 0.8);
      ctx.textAlign = "center";
      ctx.fillText(opts.status, w / 2, opts.debug ? 118 : 14); // below the debug overlay if shown
    }

    if (opts.hud && result.over && !opts.replay) {
      // Title style (visual-language.md §11): graffiti handstyle, an ink
      // stroke behind the fill, a solid ink copy offset down-right, a slight tilt.
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
    ctx.restore();
  }
}

function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---- stock icons: each fighter's sticker, rasterized once per shape/color/eyes ----
const HUD_PX_PER_M = 19; // the standard fighter comes out ~24 px tall
const hudIcons = new Map<string, { img: HTMLImageElement; w: number; h: number } | null>();

function hudIcon(f: FighterView, color: string, eyes: number) {
  const c = cornersFromWorld(f.vertices, f.footIndex);
  const key = `${[c.L, c.R].map((v) => `${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(";")}|${color}|${eyes}`;
  const hit = hudIcons.get(key);
  if (hit !== undefined) return hit;
  hudIcons.set(key, null);
  const svg = stickerSVGFromCorners(c, color, eyes, "idle", HUD_PX_PER_M * 2); // 2x for sharp screens
  const img = new Image();
  img.onload = () => hudIcons.set(key, { img, w: img.width / 2, h: img.height / 2 });
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  return null;
}

/** Fighter i's body color: as chosen (opts.colors), else by player number. */
function colorOf(opts: RenderOptions, i: number): string {
  return opts.colors?.[i] ?? playerColor(i);
}
