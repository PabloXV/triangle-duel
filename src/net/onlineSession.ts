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
import { Sim, NO_INPUT, hashState, type FighterView, type MatchResult, type SimEvent, type SimState } from "../sim/sim";
import { HASH_EVERY, type MatchSetup } from "./protocol";

/** What the session needs from the network. NetClient implements it. */
export interface MatchTransport {
  /** An input for `fighter` (mine, or a bot I drive) from `step` on. */
  sendInput(step: number, input: string, fighter: number): void;
  sendHash(step: number, hash: string): void;
}

/**
 * Run ahead of the newest official step by one round trip plus a margin, so
 * my inputs reach the relay before their step. Too thin, and an input arrives
 * late: the relay moves it to the next open step, and my own fighter snaps
 * (it was predicted with the input earlier). Small rotation changes decide
 * whether a launch goes forward or tips you over, so this matters. The margin
 * adapts: each late input adds a step (connections differ: measured, a steady
 * one needs ~3, 100 ms ~6, jittery wifi more); 10 s without one gives one back.
 */
const MARGIN_MIN = 3;
const MARGIN_MAX = 12;
const MARGIN_RELAX_STEPS = 600;
/** Until a ping has been measured, assume this round trip. */
const DEFAULT_RTT_MS = 100;
/** Never predict further than this past the confirmed timeline (½ s): stall instead. */
export const MAX_PREDICTION = 30;
/**
 * Pacing: the present moves one step per frame, absorbing small drift
 * gradually (relay ticks often arrive in bursts) instead of freezing and then
 * jumping: wait only when more than AHEAD_SLACK steps ahead; when behind,
 * catch up 2 steps per frame, or up to MAX_STEPS_PER_FRAME when far behind.
 */
const AHEAD_SLACK = 2;
const FAR_BEHIND = 12;
const MAX_STEPS_PER_FRAME = 10;

const IDLE = encodeInput(NO_INPUT);
const STEP_MS = 1000 / 60;

export interface RollbackStats {
  rollbacks: number; // times the present had to be corrected
  resimulated: number; // total steps re-simulated
  maxDepth: number; // deepest single rollback (steps)
  maxCorrection: number; // largest visible jump of any fighter when the present was corrected (m)
  totalCorrection: number; // sum of those jumps (m), for averages
  ownLate: number; // rollbacks caused by my own input arriving late (the relay moved it to a later step)
  stalls: number; // step() calls that ran no step (the present waited)
  bursts: number; // step() calls that ran 3+ steps at once (the present jumped)
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
  /** What I decided for the fighters I drive, per step (what I sent the relay): step → fighter → input. */
  private mine = new Map<number, Map<number, string>>();
  /** State at the start of each step past `confirmed` (for rewinding). */
  private snapshots = new Map<number, SimState>();
  /** Steps 0..confirmed-1 were simulated with official inputs and are final. */
  private confirmed = 0;
  private lastSent = new Map<number, string>(); // per driven fighter
  private margin = MARGIN_MIN; // see MARGIN_MIN
  private lastLate = 0; // confirmed step when my input last arrived late
  private recorder: Recorder;

  /** Events of every step run since the last takeEvents() (including re-simulated ones). */
  private stepEvents: SimEvent[] = [];
  /** Inputs (one char per fighter) of the newest simulated step. For tests and debugging. */
  lastStepInputs = "";
  /** The latest rollback correction (present before vs after), until taken. For visual smoothing. */
  private correction: { before: FighterView[]; after: FighterView[] } | null = null;
  readonly stats: RollbackStats = { rollbacks: 0, resimulated: 0, maxDepth: 0, maxCorrection: 0, totalCorrection: 0, ownLate: 0, stalls: 0, bursts: 0 };
  desync: { step: number } | null = null;
  disconnected = false;

  constructor(
    setup: MatchSetup,
    readonly you: number,
    private names: string[],
    /** Who drives each of the fighters this browser controls: me (keyboard), plus bots if I host. */
    private sources: Map<number, InputSource>,
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

  /** Start driving another fighter mid-match (a bot whose driver, the old host, left). */
  takeOver(fighter: number, source: InputSource) {
    this.sources.set(fighter, source);
    // Its official input right now (likely idle): only send when our bot changes it.
    this.lastSent.set(fighter, this.lastOfficial[fighter] ?? IDLE);
  }

  /** No fighters to drive: watching. A spectator stays on the confirmed timeline (no guessing). */
  get spectating(): boolean {
    return this.sources.size === 0;
  }

  /**
   * Spectator joining mid-match: take every step so far (`log` = [step,
   * changes] for steps with changes; steps before `next` are final) and
   * simulate them all now, so we're caught up before the first frame.
   */
  catchUp(log: [number, [number, string][]][], next: number) {
    const changesAt = new Map(log);
    for (let t = 0; t < next; t++) this.receiveTick(t, changesAt.get(t) ?? []);
    while (this.sim.tick <= this.newest) {
      this.advance();
      this.reconcile();
    }
  }

  // ---- per frame / per step ---------------------------------------------------

  /**
   * Fold in new official steps (rewinding if a prediction was wrong), then
   * advance the present toward its target: about one round trip ahead of the
   * newest official step, so my inputs reach the relay before it finalizes
   * their step.
   */
  step(): boolean {
    this.reconcile();
    const target = this.newest + this.aheadSteps();
    const drift = this.sim.tick - target;
    // (Spectators never step past the newest official step: they don't guess.)
    if (drift > (this.spectating ? 0 : AHEAD_SLACK)) {
      if (!this.sim.result.over) this.stats.stalls++;
      return false; // well ahead: let the relay catch up
    }
    const steps = drift < -FAR_BEHIND ? MAX_STEPS_PER_FRAME : drift < -AHEAD_SLACK ? 2 : 1;
    let n = 0;
    while (n < steps && this.advance()) n++;
    if (n >= 3) this.stats.bursts++;
    return n > 0;
  }

  private aheadSteps(): number {
    if (this.spectating) return 0; // nothing to make responsive: show only final steps
    const rtt = this.rtt() ?? DEFAULT_RTT_MS;
    return Math.ceil(rtt / STEP_MS) + this.margin;
  }

  /** Simulate one present step. False if we're too far past the confirmed timeline. */
  private advance(): boolean {
    const s = this.sim.tick;
    if (s - this.confirmed >= MAX_PREDICTION) return false; // connection trouble: stall, don't guess wildly
    if (!this.mine.has(s)) {
      // First time at this step: ask each source once (bots think exactly once per
      // step; on a rewind we reuse this decision), and send what changed.
      const view = this.sim.view();
      const decided = new Map<number, string>();
      for (const [fighter, source] of this.sources) {
        const input = this.disconnected ? IDLE : encodeInput(source.next(view, this.sim));
        decided.set(fighter, input);
        if (input !== (this.lastSent.get(fighter) ?? IDLE)) {
          this.transport.sendInput(s, input, fighter); // for this very step
          this.lastSent.set(fighter, input);
        }
      }
      this.mine.set(s, decided);
    }
    this.runStep(s);
    return true;
  }

  /** Inputs for step s: official if known; otherwise predicted. */
  private inputsFor(s: number): string {
    const known = this.official.get(s);
    if (known !== undefined) return known;
    // Prediction: everyone keeps their latest official input, except the fighters
    // I drive: I know theirs.
    const inputs = this.lastOfficial.split("");
    for (const fighter of this.sources.keys()) {
      inputs[fighter] = this.mine.get(s)?.get(fighter) ?? this.lastSent.get(fighter) ?? IDLE;
    }
    return inputs.join("");
  }

  private runStep(s: number) {
    this.snapshots.set(s, this.sim.save());
    const inputs = this.inputsFor(s);
    this.used.set(s, inputs);
    this.lastStepInputs = inputs;
    this.sim.step(inputs.split("").map(decodeInput));
    this.stepEvents.push(...this.sim.events);
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
      // My own input changed there? Then it arrived late and the relay moved it.
      const used = this.used.get(mismatch)!;
      const official = this.official.get(mismatch)!;
      if ([...this.sources.keys()].some((f) => used[f] !== official[f])) {
        this.stats.ownLate++;
        this.margin = Math.min(MARGIN_MAX, this.margin + 1); // run further ahead from now on
        this.lastLate = this.confirmed;
      }
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
    if (this.margin > MARGIN_MIN && this.confirmed - this.lastLate > MARGIN_RELAX_STEPS) {
      this.margin--; // a while with no late inputs: tighten up again
      this.lastLate = this.confirmed;
    }
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

  /**
   * Events from every step since the last call, re-simulated steps included
   * (a leave or KO often first happens in a re-simulation, when the official
   * input arrives for a step already shown). May repeat an event if a step is
   * re-simulated more than once.
   */
  takeEvents(): SimEvent[] {
    const e = this.stepEvents;
    this.stepEvents = [];
    return e;
  }

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

  /** The match result on the confirmed timeline (the present can briefly show a win a rollback undoes). */
  get confirmedResult(): MatchResult {
    return this.confirmedState().result;
  }

  /**
   * Each fighter's lives on the confirmed timeline. The HUD shows these: the
   * present's count can flicker as predicted KOs get undone by rollbacks.
   */
  confirmedStocks(): number[] {
    const snap = this.snapshots.get(this.confirmed);
    return snap ? snap.fighters.map((f) => f.stocks) : this.sim.view().map((f) => f.stocks); // no snapshot: the present is confirmed
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
    if (this.spectating) return `SPECTATING ${this.room}`;
    if (this.disconnected) return `ONLINE ${this.room} — disconnected (R to leave)`;
    const rtt = this.rtt();
    const ping = rtt === null ? "" : ` · ping ${Math.round(rtt)} ms`;
    return `ONLINE ${this.room} — you are P${this.you + 1}${ping} · ${this.predicting} ahead · ${this.stats.rollbacks} rollbacks`;
  }

  free() {
    this.sim.free();
  }
}
