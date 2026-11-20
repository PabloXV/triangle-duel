// A session is what the game loop drives: a sim plus wherever its inputs come
// from. main.ts only ever talks to the Session interface, so adding online play
// means adding a session type, not another mode to the loop.
//
//   LiveSession      one InputSource per player (keyboard, bot, later network),
//                    recorded as it's played
//   PlaybackSession  a recorded match played back exactly, with desync checks
//
// No DOM here (keyboard input lives in input.ts), so sessions run in Node tests.

import type { Stage } from "./sim/geometry";
import type { Params } from "./sim/params";
import { Playback, Recorder, type Recording } from "./sim/recording";
import { Sim, type FighterView, type Input, type MatchOptions, type SimEvent } from "./sim/sim";

/** Produces one player's input each tick. */
export interface InputSource {
  readonly isHuman: boolean;
  /** Short description for the debug overlay, e.g. "human" or "bot (attack)". */
  describe(): string;
  /** Called once per tick, before the step, with the state the step starts from. */
  next(view: FighterView[], sim: Sim): Input;
}

export interface Session {
  readonly sim: Sim;
  /** Advance one tick. False if there was nothing to do (e.g. playback finished). */
  step(): boolean;
  /** The match so far as a recording (null if this session doesn't record). */
  recording(): Recording | null;
  isHuman(player: number): boolean;
  describe(player: number): string;
  /**
   * Events from every step the last step() call ran, oldest first, if the
   * session can run several (online: rollback re-simulates steps). Without
   * this, only the last step's events (sim.events) would be seen.
   */
  takeEvents?(): SimEvent[];
  /** A status line for the top of the screen, if any. */
  status(): string | undefined;
  free(): void;
}

export class LiveSession implements Session {
  readonly sim: Sim;
  private recorder: Recorder | null;
  private finished: Recording | null = null;

  /** `params` stays shared with the caller (panel tweaks apply live, and get recorded). */
  constructor(
    stage: Stage,
    private params: Params,
    match: Partial<MatchOptions>,
    private sources: InputSource[],
  ) {
    this.sim = new Sim(stage, params, match);
    if (sources.length !== this.sim.match.players) {
      throw new Error(`${sources.length} input sources for ${this.sim.match.players} players`);
    }
    this.recorder = new Recorder(stage, this.sim.match, params);
  }

  /** Swap who controls a player mid-match (e.g. human ↔ bot from the panel). */
  setSource(player: number, source: InputSource) {
    this.sources[player] = source;
  }

  step(): boolean {
    const view = this.sim.view();
    const inputs = this.sources.map((s) => s.next(view, this.sim));
    this.recorder?.beforeStep(this.sim, inputs, this.params);
    this.sim.step(inputs);
    this.recorder?.afterStep(this.sim);
    if (this.sim.result.over && this.recorder) {
      this.finished = this.recorder.finish(this.sim); // the match is decided; stop recording
      this.recorder = null;
    }
    return true;
  }

  recording(): Recording | null {
    return this.finished ?? this.recorder?.finish(this.sim) ?? null;
  }

  isHuman(player: number) {
    return this.sources[player].isHuman;
  }

  describe(player: number) {
    return `P${player + 1} ${this.sources[player].describe()}`;
  }

  status() {
    return undefined;
  }

  free() {
    this.sim.free();
  }
}

export class PlaybackSession implements Session {
  private playback: Playback;

  constructor(private rec: Recording) {
    this.playback = new Playback(rec);
  }

  get sim() {
    return this.playback.sim;
  }

  step(): boolean {
    if (this.playback.done) return false;
    this.playback.step();
    return true;
  }

  recording() {
    return this.rec;
  }

  isHuman() {
    return false;
  }

  describe(player: number) {
    return `P${player + 1}`;
  }

  status() {
    const d = this.playback.desync;
    if (d) return `REPLAY — DESYNC at tick ${d.tick}`;
    return this.playback.done ? "REPLAY — end (R for a new match)" : "REPLAY";
  }

  free() {
    this.sim.free();
  }
}
