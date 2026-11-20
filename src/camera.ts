// Camera: smooth follow (pan + zoom to fit the action) and screen shake.
// Presentation only; never feeds back into the sim.

import { clamp, type Stage, type Vec2 } from "./sim/geometry";
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
  /** The fighter this screen's player controls, kept in view when not everyone fits. */
  focus?: FighterView;
}

const MIN_WIDTH = 11; // never zoom in tighter than this (m)
const PAD_X = 3; // breathing room around the fighters (m)
const PAD_BOTTOM = 1.5;
const PAD_TOP = 2.5; // more above: that's where jumps go
/**
 * Never show more height than a screen this wide (relative to its height) would
 * at full zoom-out. Wide screens are unaffected; on tall ones (a phone in
 * portrait) showing the whole stage width would make everyone tiny, so the
 * view zooms in and follows the action, keeping you in frame; edge arrows
 * (render.ts) point to anyone outside it.
 */
const MAX_HEIGHT_ASPECT = 1.4;
const PAN_RATE = 4; // 1/s: higher = snappier
// Dead zones, so the camera ignores hop-sized motion (every fighter auto-hops
// ~4.5 times a second; a camera framing their exact bounding box bobs and
// breathes with every hop, which reads as stutter: measured ~28 px of stage
// movement per quarter second before these).
const ZOOM_IN_BAND = 0.15; // only zoom in once the action needs 15% less width
const RECENTER_RATE = 0.4; // 1/s: slow vertical drift back toward the action
const ZOOM_OUT_RATE = 4; // zooming out is urgent (someone's leaving frame)...
const ZOOM_IN_RATE = 1.5; // ...zooming in can be lazy
const MAX_SHAKE = 0.35; // m of offset at full trauma
const MAX_TILT = 0.02; // radians at full trauma
const TRAUMA_DECAY = 1.6; // per second

export class CameraRig {
  private center: Vec2;
  private width: number;
  private trauma = 0; // 0..1; shake strength is trauma², so small hits stay subtle
  // The framing the camera is easing toward. Remembered between frames, because
  // the dead zones are relative to it.
  private targetY: number;
  private targetWidth: number;
  private time = 0;

  constructor(private stage: Stage) {
    this.center = { ...stage.camera.center };
    this.width = stage.camera.width;
    this.targetY = this.center.y;
    this.targetWidth = this.width;
  }

  /** Frame a different stage (new match) and snap to it. */
  setStage(stage: Stage) {
    this.stage = stage;
    this.reset();
  }

  reset() {
    this.center = { ...this.stage.camera.center };
    this.width = this.stage.camera.width;
    this.targetY = this.center.y;
    this.targetWidth = this.width;
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

    const target = s.follow ? this.framing(fighters, aspect, dt, s.focus) : this.stageFraming(aspect);
    // Frame-rate independent smoothing: close a fixed fraction of the gap per second.
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    this.center.x += (target.center.x - this.center.x) * ease(PAN_RATE);
    this.center.y += (target.center.y - this.center.y) * ease(PAN_RATE);
    const zoomRate = target.width > this.width ? ZOOM_OUT_RATE : ZOOM_IN_RATE;
    this.width += (target.width - this.width) * ease(zoomRate);
    // On a tall screen, never sit wider than allowed (e.g. at a match start, or
    // after rotating the phone): snap in rather than ease from the stage width.
    if (s.follow) this.width = Math.min(this.width, this.maxWidth(aspect));

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

  /**
   * Fit all given fighters, within zoom limits, without chasing fallers into
   * the void, and without reacting to hop-sized motion:
   *   - zoom out as soon as the action needs it, but only zoom in once it has
   *     clearly shrunk (ZOOM_IN_BAND);
   *   - vertically, a "push" camera: no movement while everyone fits, then just
   *     enough to keep them in, plus a slow drift back toward the action;
   *   - horizontally, center on the action (sideways motion is deliberate).
   */
  /** The widest view allowed at this aspect (see MAX_HEIGHT_ASPECT). */
  private maxWidth(aspect: number): number {
    const full = this.stage.camera.width * 1.25;
    return Math.min(full, (full / MAX_HEIGHT_ASPECT) * aspect);
  }

  private framing(fighters: FighterView[], aspect: number, dt: number, focus?: FighterView): { center: Vec2; width: number } {
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

    const maxWidth = this.maxWidth(aspect);
    const needed = clamp(Math.max(maxX - minX, (maxY - minY) * aspect), Math.min(MIN_WIDTH, maxWidth), maxWidth);
    if (needed > this.targetWidth || needed < this.targetWidth * (1 - ZOOM_IN_BAND)) this.targetWidth = needed;
    const height = this.targetWidth / aspect;
    // The view's lowest allowed bottom edge. On a tall screen the view is taller
    // than the stage framing; put part of the extra below the stage, so the
    // action sits mid-screen instead of at the bottom under a tall empty sky.
    const viewFloor = floorLimit - Math.max(0, height - cam.height) * 0.4;

    // Vertical: drift slowly toward the action's center, then push just enough
    // to keep everyone inside the view.
    const drift = 1 - Math.exp(-RECENTER_RATE * dt);
    this.targetY += ((minY + maxY) / 2 - this.targetY) * drift;
    if (minY < this.targetY - height / 2) this.targetY = minY + height / 2;
    if (maxY > this.targetY + height / 2) this.targetY = maxY - height / 2;
    // Keep the bottom of the view at or above the floor limit.
    this.targetY = Math.max(this.targetY, viewFloor + height / 2);

    // Center on the action; if it doesn't all fit, slide over to keep the focus fighter in view.
    let x = (minX + maxX) / 2;
    if (focus && !focus.ko) {
      const fx = focus.vertices.map((v) => v.x);
      const half = Math.max(0, this.targetWidth / 2 - PAD_X);
      x = clamp(x, Math.max(...fx) - half, Math.min(...fx) + half);
    }
    return { center: { x, y: this.targetY }, width: this.targetWidth };
  }

  /** The stage's fixed framing, widened if needed to fit the screen's aspect. */
  private stageFraming(aspect: number): { center: Vec2; width: number } {
    const cam = this.stage.camera;
    return { center: { ...cam.center }, width: Math.min(Math.max(cam.width, cam.height * aspect), this.maxWidth(aspect)) };
  }
}
