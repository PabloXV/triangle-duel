// Visual smoothing of rollback corrections. When a rollback moves a fighter
// (the prediction was wrong), we draw it at an offset that starts at "where it
// was drawn before the correction" and fades to zero, so it glides to the
// corrected spot instead of jumping. Presentation only: the sim is untouched,
// so this can't affect sync.

import type { Vec2 } from "./sim/geometry";
import type { FighterView } from "./sim/sim";

/** Time constant of the fade (s). ~63% of the correction is gone after this long. */
const FADE = 0.08;
/** Corrections bigger than this (m) are teleports (e.g. a respawn): don't smooth those. */
const MAX_SMOOTHED = 3;

export class CorrectionSmoother {
  private offsets: Vec2[][] = []; // [fighter][vertex], meters

  /** A rollback changed the present from `before` to `after` (same tick). */
  add(before: FighterView[], after: FighterView[]) {
    after.forEach((f, i) => {
      const b = before[i];
      if (!b || Math.hypot(b.x - f.x, b.y - f.y) > MAX_SMOOTHED) return;
      const off = (this.offsets[i] ??= f.vertices.map(() => ({ x: 0, y: 0 })));
      f.vertices.forEach((v, k) => {
        off[k].x += b.vertices[k].x - v.x;
        off[k].y += b.vertices[k].y - v.y;
      });
    });
  }

  /** Fade the offsets by `dt` seconds. */
  update(dt: number) {
    const keep = Math.exp(-dt / FADE);
    for (const off of this.offsets) for (const o of off ?? []) (o.x *= keep), (o.y *= keep);
  }

  /** `views` with the current offsets applied to their vertices. */
  apply(views: FighterView[]): FighterView[] {
    return views.map((f, i) => {
      const off = this.offsets[i];
      if (!off || off.every((o) => Math.abs(o.x) + Math.abs(o.y) < 1e-4)) return f;
      return { ...f, vertices: f.vertices.map((v, k) => ({ x: v.x + off[k].x, y: v.y + off[k].y })) };
    });
  }

  /** The largest current offset (m), e.g. for tests and debugging. */
  get largest(): number {
    return Math.max(0, ...this.offsets.flatMap((off) => (off ?? []).map((o) => Math.hypot(o.x, o.y))));
  }

  reset() {
    this.offsets = [];
  }
}
