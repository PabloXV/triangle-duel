// An online match with rollback. This browser runs its own copy of the match
// on two timelines:
//
//   confirmed  steps the relay has finalized; their inputs are official
//   present    what's on screen, running a little ahead of confirmed. For
//              steps not yet confirmed, other players are predicted to keep
//              doing what they last did, and your own input applies at once.
//
// When official inputs arrive that differ from what was predicted, the sim
// rewinds to that step (Sim.restore) and re-simulates up to the present with
// the corrected inputs. Inputs change rarely (only on key press/release), so
// the prediction is usually right and there's nothing to redo.
//
// Recordings and desync fingerprints use only the confirmed timeline, so they
// mean the same thing on every client. Nothing about game state crosses the
// network: only inputs, and a fingerprint every second.
//
// No DOM: the network is behind MatchTransport and the local player is an
// InputSource, so tests wire this to an in-process relay.

import type { InputSource, Session } from "../session";
import { decodeInput, encodeInput } from "../sim/inputCodec";
import { Recorder, type Recording } from "../sim/recording";
import { Sim, NO_INPUT, hashState, type FighterView, type SimState } from "../sim/sim";
import { HASH_EVERY, type MatchSetup } from "./protocol";

/** What the session needs from the network. NetClient implements it. */
export interface MatchTransport {
  sendInput(step: number, input: string): void;
  sendHash(step: number, hash: string): void;
}

/** Run ahead of the newest official step by one round trip plus this many steps. */
const MARGIN_STEPS = 2;
/** Until a ping has been measured, assume this round trip. */
const DEFAULT_RTT_MS = 100;
/** Never predict further than this past the confirmed timeline (½ s): stall instead. */
export const MAX_PREDICTION = 30;
/** Fallen behind the target? Catch up, at most this many steps per frame. */
const MAX_STEPS_PER_FRAME = 10;

const IDLE = encodeInput(NO_INPUT);
const STEP_MS = 1000 / 60;

export interface RollbackStats {
  rollbacks: number; // times the present had to be corrected
  resimulated: number; // total steps re-simulated
  maxDepth: number; // deepest single rollback (steps)
  maxCorrection: number; // largest visible jump of any fighter when the present was corrected (m)
  totalCorrection: number; // sum of those jumps (m), for averages
}

export class OnlineSession implements Session {
  readonly sim: Sim; // the present timeline (what's drawn)
  private params: MatchSetup["params"];
  private players: number;

  /** Official inputs per step (one char per fighter), for steps not yet folded into `confirmed`. */
  private official = new Map<number, string>();
  private lastOfficial: string; // official inputs as of the newest official step
  private newest = -1; // newest official step received
  /** Inputs actually used for each simulated step past `confirmed` (to detect mispredictions). */
  private used = new Map<number, string>();
  /** My own input for each step I've simulated (what I sent the relay). */
  private mine = new Map<number, string>();
  /** State at the start of each step past `confirmed` (for rewinding). */
  private snapshots = new Map<number, SimState>();
  /** Steps 0..confirmed-1 were simulated with official inputs and are final. */
  private confirmed = 0;
  private localNow = IDLE; // my current input, sampled each frame
  private lastSent = IDLE;
  private recorder: Recorder;

  /** Inputs (one char per fighter) of the newest simulated step. For tests and debugging. */
  lastStepInputs = "";
  /** The latest rollback correction (present before vs after), until taken. For visual smoothing. */
  private correction: { before: FighterView[]; after: FighterView[] } | null = null;
  readonly stats: RollbackStats = { rollbacks: 0, resimulated: 0, maxDepth: 0, maxCorrection: 0, totalCorrection: 0 };
  desync: { step: number } | null = null;
  disconnected = false;

  constructor(
    setup: MatchSetup,
    readonly you: number,
    private names: string[],
    private local: InputSource,
    private transport: MatchTransport,
    private room = "",
    private rtt: () => number | null = () => null,
  ) {
    // Our own copy of the setup: the local panel can't change an online match.
    this.params = structuredClone(setup.params);
    this.sim = new Sim(setup.stage, this.params, setup.match);
    this.players = setup.match.players;
    this.lastOfficial = IDLE.repeat(this.players);
    this.recorder = new Recorder(setup.stage, this.sim.match, this.params);
  }

  // ---- network in ------------------------------------------------------------

  /** The relay finalized step `t` (steps arrive in order: one WebSocket). */
  receiveTick(t: number, changes: [number, string][]) {
    const inputs = this.lastOfficial.split("");
    for (const [fighter, input] of changes) inputs[fighter] = input;
    this.lastOfficial = inputs.join("");
    this.official.set(t, this.lastOfficial);
    this.newest = t;
  }

  receiveDesync(step: number) {
    this.desync ??= { step };
  }

  // ---- per frame / per step ---------------------------------------------------

  /** Once per rendered frame: sample my input (applied at the next present step). */
  frame() {
    if (!this.disconnected) this.localNow = encodeInput(this.local.next(this.sim.view(), this.sim));
  }

  /**
   * Fold in new official steps (rewinding if a prediction was wrong), then
   * advance the present toward its target: about one round trip ahead of the
   * newest official step, so my inputs reach the relay before it finalizes
   * their step.
   */
  step(): boolean {
    this.reconcile();
    const target = this.newest + this.aheadSteps();
    if (this.sim.tick > target) return false; // ahead of where we should be: let the relay catch up
    let n = 0;
    while (n < MAX_STEPS_PER_FRAME && (n === 0 || this.sim.tick < target - 1) && this.advance()) n++;
    return n > 0;
  }

  private aheadSteps(): number {
    const rtt = this.rtt() ?? DEFAULT_RTT_MS;
    return Math.ceil(rtt / STEP_MS) + MARGIN_STEPS;
  }

  /** Simulate one present step. False if we're too far past the confirmed timeline. */
  private advance(): boolean {
    const s = this.sim.tick;
    if (s - this.confirmed >= MAX_PREDICTION) return false; // connection trouble: stall, don't guess wildly
    if (!this.mine.has(s)) {
      this.mine.set(s, this.localNow);
      if (this.localNow !== this.lastSent) {
        this.transport.sendInput(s, this.localNow); // for this very step
        this.lastSent = this.localNow;
      }
    }
    this.runStep(s);
    return true;
  }

  /** Inputs for step s: official if known; otherwise predicted. */
  private inputsFor(s: number): string {
    const known = this.official.get(s);
    if (known !== undefined) return known;
    // Prediction: everyone keeps their latest official input, except me: I know mine.
    const inputs = this.lastOfficial.split("");
    inputs[this.you] = this.mine.get(s) ?? this.lastSent;
    return inputs.join("");
  }

  private runStep(s: number) {
    this.snapshots.set(s, this.sim.save());
    const inputs = this.inputsFor(s);
    this.used.set(s, inputs);
    this.lastStepInputs = inputs;
    this.sim.step(inputs.split("").map(decodeInput));
  }

  /** Compare new official steps against what we simulated; rewind on a mismatch; extend `confirmed`. */
  private reconcile() {
    const present = this.sim.tick;
    let mismatch: number | null = null;
    for (let t = this.confirmed; t <= this.newest && t < present; t++) {
      if (this.used.get(t) !== this.official.get(t)) {
        mismatch = t;
        break;
      }
    }
    if (mismatch !== null) {
      // Rewind to the first wrong step and redo everything up to the present.
      const before = this.sim.view();
      this.sim.restore(this.snapshots.get(mismatch)!);
      for (let s = mismatch; s < present; s++) this.runStep(s);
      const after = this.sim.view();
      const jump = Math.max(0, ...after.map((f, i) => Math.hypot(f.x - before[i].x, f.y - before[i].y)));
      this.stats.maxCorrection = Math.max(this.stats.maxCorrection, jump);
      this.stats.totalCorrection += jump;
      this.correction = { before, after }; // at most one per step(); take it after each step()
      const depth = present - mismatch;
      this.stats.rollbacks++;
      this.stats.resimulated += depth;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
    }
    // Every simulated step that now has official inputs is final.
    while (this.confirmed <= this.newest && this.confirmed < this.sim.tick) this.confirm(this.confirmed);
  }

  /** Step `t` is final: record it, fingerprint if due, forget its rollback data. */
  private confirm(t: number) {
    this.recorder.addStep(this.official.get(t)!);
    this.confirmed = t + 1;
    if (this.confirmed % HASH_EVERY === 0) {
      const hash = hashState(this.confirmedState());
      this.recorder.addChecksum(this.confirmed, hash);
      this.transport.sendHash(this.confirmed, hash);
    }
    this.official.delete(t);
    this.used.delete(t);
    this.mine.delete(t);
    this.snapshots.delete(t);
  }

  /** The state after all confirmed steps (start of the first unconfirmed step). */
  private confirmedState(): SimState {
    return this.snapshots.get(this.confirmed) ?? this.sim.save();
  }

  // ---- reading ----------------------------------------------------------------

  /** The correction made by the last step() call (before/after views), if any. Call after each step(). */
  takeCorrection(): { before: FighterView[]; after: FighterView[] } | null {
    const c = this.correction;
    this.correction = null;
    return c;
  }

  /** Fingerprint of the confirmed timeline (the same on every client). */
  confirmedHash(): string {
    return hashState(this.confirmedState());
  }

  get confirmedTick(): number {
    return this.confirmed;
  }

  /** How many steps the present is ahead of the confirmed timeline. */
  get predicting(): number {
    return this.sim.tick - this.confirmed;
  }

  recording(): Recording {
    this.recorder.addChecksum(this.confirmed, this.confirmedHash());
    return this.recorder.build();
  }

  isHuman(player: number) {
    return player === this.you;
  }

  describe(player: number) {
    return `P${player + 1} ${this.names[player] ?? ""}${player === this.you ? " (you)" : ""}`;
  }

  status() {
    if (this.desync) return `ONLINE ${this.room} — DESYNC at step ${this.desync.step}`;
    if (this.disconnected) return `ONLINE ${this.room} — disconnected (R to leave)`;
    const rtt = this.rtt();
    const ping = rtt === null ? "" : ` · ping ${Math.round(rtt)} ms`;
    return `ONLINE ${this.room} — you are P${this.you + 1}${ping} · ${this.predicting} ahead · ${this.stats.rollbacks} rollbacks`;
  }

  free() {
    this.sim.free();
  }
}
