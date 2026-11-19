// Camera: smooth follow (pan + zoom to fit the action) and screen shake.
// Presentation only; never feeds back into the sim.

import type { Stage, Vec2 } from "./sim/geometry";
import type { FighterView } from "./sim/sim";

/** What the renderer needs to draw a frame. All in meters except tilt (radians). */
export interface CameraView {
  center: Vec2;
  width: number;
  height: number;
  shake: Vec2; // offset added to center
  tilt: number; // shake rotation
}

export interface CameraSettings {
  follow: boolean; // false = fixed stage framing
  shakeScale: number; // 0 = no shake, 1 = default
}

const MIN_WIDTH = 11; // never zoom in tighter than this (m)
const PAD_X = 3; // breathing room around the fighters (m)
const PAD_BOTTOM = 1.5;
const PAD_TOP = 2.5; // more above: that's where jumps go
const PAN_RATE = 4; // 1/s: higher = snappier
const ZOOM_OUT_RATE = 4; // zooming out is urgent (someone's leaving frame)...
const ZOOM_IN_RATE = 1.5; // ...zooming in can be lazy
const MAX_SHAKE = 0.35; // m of offset at full trauma
const MAX_TILT = 0.02; // radians at full trauma
const TRAUMA_DECAY = 1.6; // per second

export class CameraRig {
  private center: Vec2;
  private width: number;
  private trauma = 0; // 0..1; shake strength is trauma², so small hits stay subtle
  private time = 0;

  constructor(private stage: Stage) {
    this.center = { ...stage.camera.center };
    this.width = stage.camera.width;
  }

  reset() {
    this.center = { ...this.stage.camera.center };
    this.width = this.stage.camera.width;
    this.trauma = 0;
  }

  /** Add shake. Takes the max rather than summing, so a long shove doesn't pile up. */
  shake(amount: number) {
    this.trauma = Math.min(1, Math.max(this.trauma, amount));
  }

  /**
   * Advance by `dt` seconds toward framing `fighters` (pass only the ones that
   * should be in frame). `aspect` = canvas width / height.
   */
  update(fighters: FighterView[], dt: number, aspect: number, s: CameraSettings): CameraView {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);

    const target = s.follow ? this.framing(fighters, aspect) : this.stageFraming(aspect);
    // Frame-rate independent smoothing: close a fixed fraction of the gap per second.
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.center.x += (target.center.x - this.center.x) * ease(PAN_RATE);
    this.center.y += (target.center.y - this.center.y) * ease(PAN_RATE);
    const zoomRate = target.width > this.width ? ZOOM_OUT_RATE : ZOOM_IN_RATE;
    this.width += (target.width - this.width) * ease(zoomRate);

    // Shake: smooth pseudo-noise (sums of sines at unrelated frequencies).
    const t = this.time;
    const k = this.trauma * this.trauma * s.shakeScale;
    const nx = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4;
    const ny = Math.sin(t * 43.3 + 2.1) * 0.6 + Math.sin(t * 71.9 + 0.7) * 0.4;
    const nr = Math.sin(t * 29.3 + 4.2);

    return {
      center: { ...this.center },
      width: this.width,
      height: this.width / aspect,
      shake: { x: nx * MAX_SHAKE * k, y: ny * MAX_SHAKE * k },
      tilt: nr * MAX_TILT * k,
    };
  }

  /** Fit all given fighters, within zoom limits, without chasing fallers into the void. */
  private framing(fighters: FighterView[], aspect: number): { center: Vec2; width: number } {
    const cam = this.stage.camera;
    if (fighters.length === 0) return this.stageFraming(aspect);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of fighters) {
      for (const v of f.vertices) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
    minX -= PAD_X;
    maxX += PAD_X;
    minY -= PAD_BOTTOM;
    maxY += PAD_TOP;
    // Don't follow anyone below the stage framing's bottom edge: they're falling
    // to a KO, and the camera should stay on the stage, not dive after them.
    const floorLimit = cam.center.y - cam.height / 2;
    minY = Math.max(minY, floorLimit);
    maxY = Math.max(maxY, minY + 1);

    const maxWidth = cam.width * 1.25;
    const width = clamp(Math.max(maxX - minX, (maxY - minY) * aspect), MIN_WIDTH, maxWidth);
    const height = width / aspect;
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    // Keep the bottom of the view at or above the floor limit.
    center.y = Math.max(center.y, floorLimit + height / 2);
    return { center, width };
  }

  /** The stage's fixed framing, widened if needed to fit the screen's aspect. */
  private stageFraming(aspect: number): { center: Vec2; width: number } {
    const cam = this.stage.camera;
    return { center: { ...cam.center }, width: Math.max(cam.width, cam.height * aspect) };
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
