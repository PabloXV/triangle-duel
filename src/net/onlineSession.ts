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
/**
 * Input delay, as in GGPO-style fighting games: an input I decide at step s
 * takes effect at step s + INPUT_DELAY, on my screen and everyone else's.
 * The delay covers part of the trip to the relay, so the present needn't run
 * as far ahead: fewer and shallower rollbacks (smoother), and my inputs are
 * rarely late. The cost is that many steps of responsiveness (about 50 ms).
 */
export const INPUT_DELAY = 3;
const MARGIN_MAX = 12;
const MARGIN_RELAX_STEPS = 600;
/** Until a ping has been measured, assume this round trip. */
const DEFAULT_RTT_MS = 100;
/**
 * The relay's clock, as this browser sees it. Steps leave the relay at a steady
 * 60/s but don't arrive that way: measured on a real link, about twice a
 * second nothing comes for ~100 ms, then several steps at once. Pacing by
 * "the newest step received" froze everyone's screen at each hiccup (the
 * host's too). Instead: the least-delayed arrivals show the relay's schedule
 * (arrival time - step × 16.7 ms is smallest when nothing held the step up);
 * the minimum over the last few seconds (so it can also go up, if the route
 * gets slower) gives "where the relay is now", and the present paces by that.
 * Through a hiccup it keeps moving, predicting a few steps further, and the
 * late steps are folded in by rollback when they land.
 */
const CLOCK_BUCKET_STEPS = 60;
const CLOCK_BUCKETS = 4;
/** Never predict further than this past the confirmed timeline (½ s): stall instead. */
export const MAX_PREDICTION = 30;
/**
 * Pacing: the present moves one step per frame, absorbing small drift
 * gradually (relay ticks often arrive in bursts) instead of freezing and then
 * jumping: wait only when more than AHEAD_SLACK steps ahead; when behind,
 * catch up 2 steps per frame, or up to MAX_STEPS_PER_FRAME when far behind.
 */
const AHEAD_SLACK = 2;
/**
 * Inside the slack, drift was never corrected: measured (npm run netlog, 4
 * tabs), guests sat 2 steps past their target for a whole match, predicting
 * 3 steps instead of 1 (15 rollbacks/s instead of 6). So: off target by a
 * step or more, wait (or run an extra step) once every SLEW_EVERY frames.
 * That's a 10% speed change for a moment, too small to see; GGPO-style
 * games do the same ("time sync").
 */
const SLEW_EVERY = 10;
const FAR_BEHIND = 12;
/**
 * Further behind than this (a hidden tab doesn't draw, so it doesn't step, but
 * steps keep arriving), catch up at once, silently: every step must still be
 * simulated (that's what keeps everyone in sync), but there's no point showing
 * them; replaying them a few per frame looked like a hyperspeed mess. Within
 * a time budget per frame, then the screen snaps to the present (takeJumped).
 */
const CATCH_UP_FROM = 60;
const CATCH_UP_BUDGET_MS = 30;
const MAX_STEPS_PER_FRAME = 10;

const IDLE = encodeInput(NO_INPUT);
const STEP_MS = 1000 / 60;

export interface RollbackStats {
  rollbacks: number; // times the present had to be corrected
  resimulated: number; // total steps re-simulated
  maxDepth: number; // deepest single rollback (steps)
  maxCorrection: number; // largest visible jump of any fighter when the present was corrected (m)
  totalCorrection: number; // sum of those jumps (m), for averages
  ownLate: number; // rollbacks caused by my own fighter's input arriving late (the relay moved it to a later step)
  stalls: number; // step() calls that ran no step (the present waited)
  bursts: number; // step() calls that ran 3+ steps at once (the present jumped)
  resimMs: number; // total time spent rewinding and re-simulating (ms of CPU)
  slews: number; // frames that waited or ran an extra step to stay on target (time sync)
  capped: number; // steps refused because prediction hit MAX_PREDICTION (a freeze: the connection can't keep up)
  maxResimMs: number; // the longest single rollback (ms)
}

export class OnlineSession implements Session {
  readonly sim: Sim; // the present timeline (what's drawn)
  private params: MatchSetup["params"];
  private players: number;

  /** Official inputs per step (one char per fighter), for steps not yet folded into `confirmed`. */
  private official = new Map<number, string>();
  private lastOfficial: string; // official inputs as of the newest official step
  private newest = -1; // newest official step received
  /** Local time in ms (overridden by the test harness's fake network). */
  clock: () => number = () => performance.now();
  private clockBuckets: number[] = []; // per CLOCK_BUCKET_STEPS steps: min(arrival - t × STEP_MS)
  private clockBucketMin = Infinity;
  /** Inputs actually used for each simulated step past `confirmed` (to detect mispredictions). */
  private used = new Map<number, string>();
  /** What I decided for the fighters I drive, by the step it takes effect (what I sent the relay): step → fighter → input. */
  private mine = new Map<number, Map<number, string>>();
  /** Present steps at which I've already asked my sources (once each, also across rewinds). */
  private asked = new Set<number>();
  /** State at the start of each step past `confirmed` (for rewinding). */
  private snapshots = new Map<number, SimState>();
  /** Steps 0..confirmed-1 were simulated with official inputs and are final. */
  private confirmed = 0;
  private lastSent = new Map<number, string>(); // per driven fighter
  private margin = MARGIN_MIN; // see MARGIN_MIN
  private jumped = false; // caught up at once since the last takeJumped()
  private slewCount = 0; // frames since the last time-sync adjustment (SLEW_EVERY)
  private lastLate = 0; // confirmed step when my input last arrived late
  private recorder: Recorder;

  /** Events of every step run since the last takeEvents() (including re-simulated ones). */
  private stepEvents: SimEvent[] = [];
  /** Inputs (one char per fighter) of the newest simulated step. For tests and debugging. */
  lastStepInputs = "";
  /** The latest rollback correction (present before vs after), until taken. For visual smoothing. */
  private correction: { before: FighterView[]; after: FighterView[] } | null = null;
  readonly stats: RollbackStats = { rollbacks: 0, resimulated: 0, maxDepth: 0, maxCorrection: 0, totalCorrection: 0, ownLate: 0, stalls: 0, bursts: 0, resimMs: 0, maxResimMs: 0, slews: 0, capped: 0 };
  desync: { step: number } | null = null;
  disconnected = false;
  /** Called after each rollback (the net log listens): steps redone, CPU ms, largest visible jump (m), caused by my own late input? */
  onRollback: ((r: { depth: number; ms: number; jump: number; ownLate: boolean }) => void) | null = null;

  constructor(
    setup: MatchSetup,
    readonly you: number,
    private names: string[],
    /** Who drives each of the fighters this browser controls: me (keyboard), plus bots if I host. */
    private sources: Map<number, InputSource>,
    private transport: MatchTransport,
    private room = "",
    private rtt: () => number | null = () => null,
    /** Steps between deciding an input and it taking effect (see INPUT_DELAY). */
    readonly inputDelay = INPUT_DELAY,
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
    this.clockBucketMin = Math.min(this.clockBucketMin, this.clock() - t * STEP_MS);
    if (t % CLOCK_BUCKET_STEPS === CLOCK_BUCKET_STEPS - 1) {
      this.clockBuckets.push(this.clockBucketMin);
      if (this.clockBuckets.length > CLOCK_BUCKETS) this.clockBuckets.shift();
      this.clockBucketMin = Infinity;
    }
  }

  /**
   * The newest step the relay has (very likely) finalized and sent by now, by
   * its schedule (see CLOCK_BUCKET_STEPS), even if it hasn't arrived yet;
   * never less than what has arrived.
   */
  private relayStep(): number {
    const offset = Math.min(this.clockBucketMin, ...this.clockBuckets);
    if (!Number.isFinite(offset)) return this.newest;
    return Math.max(this.newest, Math.floor((this.clock() - offset) / STEP_MS));
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
    // Spectators follow what has arrived (they don't guess); players pace by the relay's clock.
    const target = (this.spectating ? this.newest : this.relayStep()) + this.aheadSteps();
    const drift = this.sim.tick - target;
    // (Spectators never step past the newest official step: they don't guess.)
    if (drift > (this.spectating ? 0 : AHEAD_SLACK)) {
      if (!this.sim.result.over) this.stats.stalls++;
      return false; // well ahead: let the relay catch up
    }
    if (drift < -CATCH_UP_FROM) return this.catchUpNow(target);
    let steps = drift < -FAR_BEHIND ? MAX_STEPS_PER_FRAME : drift < -AHEAD_SLACK ? 2 : 1;
    if (!this.spectating && Math.abs(drift) >= 1 && Math.abs(drift) <= AHEAD_SLACK && ++this.slewCount >= SLEW_EVERY) {
      this.slewCount = 0;
      this.stats.slews++;
      if (drift > 0) return false; // a step ahead: wait one frame
      steps = 2; // a step behind: catch one up
    }
    let n = 0;
    while (n < steps && this.advance()) n++;
    if (n >= 3) this.stats.bursts++;
    return n > 0;
  }

  /** Far behind: simulate the missed steps now (they're all official), within a time budget. */
  private catchUpNow(target: number): boolean {
    const until = performance.now() + CATCH_UP_BUDGET_MS;
    let n = 0;
    while (this.sim.tick < target && performance.now() < until) {
      if (!this.advance()) {
        this.reconcile(); // confirm what's been simulated, so prediction room frees up
        if (!this.advance()) break;
      }
      n++;
      if (n % 30 === 0) this.reconcile();
    }
    this.reconcile();
    this.jumped = true;
    return n > 0;
  }

  /** True once after a silent catch-up: the caller should snap its picture (no smoothing, no effects for the skipped steps). */
  takeJumped(): boolean {
    const j = this.jumped;
    this.jumped = false;
    return j;
  }

  private aheadSteps(): number {
    if (this.spectating) return 0; // nothing to make responsive: show only final steps
    const rtt = this.rtt() ?? DEFAULT_RTT_MS;
    // The input delay covers part of the round trip: run that much less ahead.
    return Math.max(1, Math.ceil(rtt / STEP_MS) + this.margin - this.inputDelay);
  }

  /** Simulate one present step. False if we're too far past the confirmed timeline. */
  private advance(): boolean {
    const s = this.sim.tick;
    if (s - this.confirmed >= MAX_PREDICTION) {
      this.stats.capped++;
      return false; // connection trouble: stall, don't guess wildly
    }
    const at = s + this.inputDelay; // when what I decide now takes effect
    if (!this.asked.has(s) && this.official.has(at)) {
      this.asked.add(s); // already final (we're catching up): nothing to decide or send
    } else if (!this.asked.has(s)) {
      // First time at this step: ask each source once (bots think exactly once per
      // step; on a rewind we reuse this decision), and send what changed, for the
      // step it takes effect.
      this.asked.add(s);
      const view = this.sim.view();
      const decided = new Map<number, string>();
      for (const [fighter, source] of this.sources) {
        const input = this.disconnected ? IDLE : encodeInput(source.next(view, this.sim));
        decided.set(fighter, input);
        if (input !== (this.lastSent.get(fighter) ?? IDLE)) {
          this.transport.sendInput(at, input, fighter);
          this.lastSent.set(fighter, input);
        }
      }
      this.mine.set(at, decided);
    }
    this.runStep(s);
    return true;
  }

  /** My latest decided input for `fighter` taking effect at or before step s (idle if none yet). */
  private latestMine(fighter: number, s: number): string {
    for (let t = s; t >= this.confirmed - 1 && t >= 0; t--) {
      const m = this.mine.get(t)?.get(fighter);
      if (m !== undefined) return m;
    }
    return this.lastOfficial[fighter] ?? IDLE;
  }

  /** Inputs for step s: official if known; otherwise predicted. */
  private inputsFor(s: number): string {
    const known = this.official.get(s);
    if (known !== undefined) return known;
    // Prediction: everyone keeps their latest official input, except the fighters
    // I drive: I know theirs.
    const inputs = this.lastOfficial.split("");
    for (const fighter of this.sources.keys()) {
      // Decided inputDelay steps ago; before any decision takes effect, my last
      // sent input still holds (idle at the start, as on the relay).
      inputs[fighter] = this.mine.get(s)?.get(fighter) ?? this.latestMine(fighter, s);
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
      // My own input changed there? Then it arrived late and the relay moved it:
      // run further ahead from now on. Only my own fighter's input counts: room
      // bots I drive (as host) change input every few steps, and widening the
      // margin for them made everyone predict deeper (bots then jittered on the
      // other screens) for no gain in feel.
      const used = this.used.get(mismatch)!;
      const official = this.official.get(mismatch)!;
      // Late inputs during the countdown don't matter (inputs are ignored then),
      // and at the start the relay is always a little ahead of us: don't count those.
      const ownLate = this.you >= 0 && used[this.you] !== official[this.you] && mismatch >= (this.sim.match.countdownTicks ?? 0);
      if (ownLate) {
        this.stats.ownLate++;
        // Grow at most once per round trip: inputs already in flight were sent
        // with the old margin, and would each count again (measured: 3 -> 11 in
        // a second, then stuck at the max all match, predicting ~9 steps too far).
        if (this.margin < MARGIN_MAX && this.confirmed - this.lastLate > this.aheadSteps() + this.inputDelay) this.margin++;
        this.lastLate = this.confirmed;
      }
      // Rewind to the first wrong step and redo everything up to the present.
      const before = this.sim.view();
      const t0 = performance.now();
      this.sim.restore(this.snapshots.get(mismatch)!);
      for (let s = mismatch; s < present; s++) this.runStep(s);
      const ms = performance.now() - t0;
      this.stats.resimMs += ms;
      this.stats.maxResimMs = Math.max(this.stats.maxResimMs, ms);
      const after = this.sim.view();
      const jump = Math.max(0, ...after.map((f, i) => Math.hypot(f.x - before[i].x, f.y - before[i].y)));
      this.stats.maxCorrection = Math.max(this.stats.maxCorrection, jump);
      this.stats.totalCorrection += jump;
      this.correction = { before, after }; // at most one per step(); take it after each step()
      const depth = present - mismatch;
      this.stats.rollbacks++;
      this.stats.resimulated += depth;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
      this.onRollback?.({ depth, ms, jump, ownLate });
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
    this.asked.delete(t);
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
  /** Ping to the relay (ms, moving average), if measured. */
  get rttMs(): number | null {
    return this.rtt();
  }

  /** For the net log: the pacing's view of things. */
  get pacing() {
    return {
      newest: this.newest, // newest official step received
      relayStep: this.spectating ? this.newest : this.relayStep(), // where the relay is, by its clock (see CLOCK_BUCKET_STEPS)
      target: (this.spectating ? this.newest : this.relayStep()) + this.aheadSteps(), // where the present is heading
      margin: this.margin,
      aheadSteps: this.aheadSteps(),
    };
  }

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
