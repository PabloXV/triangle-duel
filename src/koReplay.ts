// Final-KO instant replay. Presentation only: it plays back recorded frames,
// it never re-runs or slows the sim (so it stays compatible with netcode).
//
// Why a replay instead of slowing time at the KO: most KOs are falls, and a
// fall only registers when the body leaves the blast zone, a second or two
// after the shove that decided it (and off-screen). Slowing down at the KO
// would show slow-motion empty sky. So we rewind to the decisive moment.

import type { FighterView, SimEvent } from "./sim/sim";

export interface Frame {
  views: FighterView[];
  events: SimEvent[];
}

/** The last few seconds of frames, oldest first. */
export class History {
  private frames: Frame[] = [];
  constructor(private capacity = 300) {} // 5 s at 60 Hz

  push(frame: Frame) {
    this.frames.push(frame);
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  clear() {
    this.frames = [];
  }

  snapshot(): Frame[] {
    return [...this.frames];
  }
}

const LEAD_IN = 20; // ticks shown before the decisive moment
const SLOW_SPAN = 60; // ticks (from the start) played in slow motion
const SLOW_SPEED = 0.3;
const FAST_SPEED = 1.5; // the remainder (falling away) plays briskly
const FALLBACK_TICKS = 60; // no decisive moment found: replay the last second

export class FinalKoReplay {
  private readonly start: number; // frame index where playback begins
  private readonly decisive: number; // frame index of the decisive moment
  private pos: number; // playback position (fractional frame index)
  /** Fighters to keep in frame: the loser, plus whoever hit them (if anyone). */
  readonly focus: number[];
  /** Set for one update() when playback crosses the decisive moment. */
  hitNow = false;

  constructor(
    private frames: Frame[],
    loser: number,
  ) {
    const { index, partner } = findDecisiveMoment(frames, loser);
    this.decisive = index;
    this.start = Math.max(0, index - LEAD_IN);
    this.pos = this.start;
    this.focus = partner === null ? [loser] : [loser, partner];
  }

  /** Advance playback by `dt` real seconds. Returns false once finished. */
  update(dt: number): boolean {
    const before = this.pos;
    const slow = this.pos < this.start + SLOW_SPAN;
    this.pos += dt * 60 * (slow ? SLOW_SPEED : FAST_SPEED);
    this.hitNow = before < this.decisive && this.pos >= this.decisive;
    return this.pos < this.frames.length - 1;
  }

  /** The two recorded frames around the playback position, and how far between them. */
  current(): { prev: FighterView[]; curr: FighterView[]; alpha: number } {
    const i = Math.min(Math.floor(this.pos), this.frames.length - 2);
    return { prev: this.frames[i].views, curr: this.frames[i + 1].views, alpha: this.pos - i };
  }
}

/**
 * The decisive moment: the loser's last collision with another fighter (the
 * hit that sent them off). If there was none, their last moment on the
 * ground; failing that, one second before the end.
 */
function findDecisiveMoment(frames: Frame[], loser: number): { index: number; partner: number | null } {
  for (let i = frames.length - 1; i >= 0; i--) {
    for (const e of frames[i].events) {
      if (e.type === "impact" && (e.a === loser || e.b === loser)) {
        return { index: i, partner: e.a === loser ? e.b : e.a };
      }
    }
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].views[loser]?.grounded) return { index: i, partner: null };
  }
  return { index: Math.max(0, frames.length - FALLBACK_TICKS), partner: null };
}
