// An online match, lockstep version: this browser runs its own full copy of
// the match and steps it only with the relay's official, finalized inputs.
// Every client does the same, and the sim is deterministic, so every copy
// plays out identically. Nothing about game state crosses the network, only
// inputs (plus a fingerprint every second, so a divergence is caught).
//
// Trade-off: even your own input waits for the round trip (INPUT_LEAD steps
// plus network delay) before you see it. Rollback (next) removes that by
// simulating ahead on predicted inputs.
//
// No DOM: the network is behind MatchTransport and the local player is an
// InputSource, so tests wire this to an in-process relay.

import type { InputSource, Session } from "../session";
import { decodeInput, encodeInput } from "../sim/inputCodec";
import { Recorder, type Recording } from "../sim/recording";
import { Sim, NO_INPUT, type Input } from "../sim/sim";
import { HASH_EVERY, type MatchSetup } from "./protocol";

/** What the session needs from the network. NetClient implements it. */
export interface MatchTransport {
  sendInput(step: number, input: string): void;
  sendHash(step: number, hash: string): void;
}

/** Schedule my inputs this many steps ahead of the newest official step (~50 ms). */
export const INPUT_LEAD = 3;
/** Hold back this many received steps to absorb network jitter (smoother, +1 step latency). */
const JITTER_BUFFER = 1;
/** Fallen this far behind the relay? Catch up faster. */
const CATCH_UP_AT = 6;
/** ...but at most this many steps per frame, to avoid a long freeze. */
const MAX_STEPS_PER_FRAME = 20;

const IDLE = encodeInput(NO_INPUT);

export class OnlineSession implements Session {
  readonly sim: Sim;
  /** Official steps received but not yet simulated: [step, changes]. */
  private queue: [number, [number, string][]][] = [];
  private official: string[]; // every fighter's input as of the last simulated step
  private newestStep = -1; // newest official step received
  private lastSent = IDLE;
  private recorder: Recorder;
  private params: MatchSetup["params"];
  /** Set if the relay reports clients diverged. */
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
    this.official = Array.from({ length: setup.match.players }, () => IDLE);
    this.recorder = new Recorder(setup.stage, this.sim.match, this.params);
  }

  /** The relay finalized step `t`. Steps arrive in order (one WebSocket). */
  receiveTick(t: number, changes: [number, string][]) {
    this.newestStep = t;
    this.queue.push([t, changes]);
  }

  receiveDesync(step: number) {
    this.desync ??= { step };
  }

  /** Once per rendered frame: send my input if it changed. */
  frame() {
    if (this.disconnected) return;
    const code = encodeInput(this.local.next(this.sim.view(), this.sim));
    if (code === this.lastSent) return;
    this.lastSent = code;
    this.transport.sendInput(this.newestStep + 1 + INPUT_LEAD, code);
  }

  /** Simulate the next official step if we have it (plus catch-up if far behind). */
  step(): boolean {
    if (this.queue.length <= JITTER_BUFFER) return false;
    this.runOne();
    for (let n = 1; this.queue.length > CATCH_UP_AT && n < MAX_STEPS_PER_FRAME; n++) this.runOne();
    return true;
  }

  private runOne() {
    const [t, changes] = this.queue.shift()!;
    if (t !== this.sim.tick) throw new Error(`official step ${t} arrived but the sim is at ${this.sim.tick}`);
    for (const [fighter, input] of changes) this.official[fighter] = input;
    const inputs: Input[] = this.official.map(decodeInput);
    this.recorder.beforeStep(this.sim, inputs, this.params);
    this.sim.step(inputs);
    this.recorder.afterStep(this.sim);
    if (this.sim.tick % HASH_EVERY === 0) this.transport.sendHash(this.sim.tick, this.sim.hash());
  }

  recording(): Recording {
    return this.recorder.finish(this.sim);
  }

  isHuman(player: number) {
    return player === this.you;
  }

  describe(player: number) {
    return `P${player + 1} ${this.names[player] ?? ""}${player === this.you ? " (you)" : ""}`;
  }

  /** How many official steps we hold that aren't simulated yet. */
  get buffered() {
    return this.queue.length;
  }

  status() {
    if (this.desync) return `ONLINE ${this.room} — DESYNC at step ${this.desync.step}`;
    if (this.disconnected) return `ONLINE ${this.room} — disconnected (R to leave)`;
    const rtt = this.rtt();
    const ping = rtt === null ? "" : ` · ping ${Math.round(rtt)} ms`;
    return `ONLINE ${this.room} — you are P${this.you + 1}${ping}`;
  }

  free() {
    this.sim.free();
  }
}
