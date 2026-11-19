// Match recordings: setup + every tick's inputs. Because the sim is
// deterministic, that's enough to reproduce a match exactly, anywhere (another
// browser, a server, a test). Fingerprints taken during recording let playback
// pinpoint the first tick where it diverges.
//
// Pure data and logic, no DOM: usable in the browser, in Node tests, and on a
// server (e.g. to verify ranked results).

import type { Stage } from "./geometry";
import type { Params } from "./params";
import { decodeInput, encodeInput } from "./inputCodec";
import { Sim, type Input, type MatchOptions } from "./sim";

export const RECORDING_FORMAT = 1;
/** Take a state fingerprint this often (ticks). */
const CHECKSUM_EVERY = 60;

export interface Recording {
  format: typeof RECORDING_FORMAT;
  stage: Stage;
  match: MatchOptions;
  /** Params at tick 0. */
  params: Params;
  /** Panel tweaks made mid-match, applied before the step at `tick`. */
  paramChanges: { tick: number; params: Params }[];
  /** One character per player per tick, see encodeInput. */
  inputs: string;
  ticks: number;
  /** State fingerprints (Sim.hash) after the step that produced `tick`. */
  checksums: { tick: number; hash: string }[];
}

export { decodeInput, encodeInput } from "./inputCodec";

/** Records a match as it's played. Call beforeStep() then afterStep() around every sim.step(). */
export class Recorder {
  private inputs: string[] = [];
  private paramChanges: Recording["paramChanges"] = [];
  private checksums: Recording["checksums"] = [];
  private lastParams: string;
  private readonly startParams: Params;

  constructor(
    private stage: Stage,
    private match: MatchOptions,
    params: Params,
  ) {
    this.startParams = structuredClone(params);
    this.lastParams = JSON.stringify(params);
  }

  /** `params` = the (possibly panel-edited) params this step will use. */
  beforeStep(sim: Sim, inputs: readonly Input[], params: Params) {
    const json = JSON.stringify(params);
    if (json !== this.lastParams) {
      this.paramChanges.push({ tick: sim.tick, params: structuredClone(params) });
      this.lastParams = json;
    }
    this.inputs.push(inputs.map(encodeInput).join(""));
  }

  afterStep(sim: Sim) {
    if (sim.tick % CHECKSUM_EVERY === 0 || sim.result.over) {
      const last = this.checksums.at(-1);
      if (!last || last.tick !== sim.tick) this.checksums.push({ tick: sim.tick, hash: sim.hash() });
    }
  }

  /** Low-level: one step's inputs, already encoded (one char per player). */
  addStep(encoded: string) {
    this.inputs.push(encoded);
  }

  /** Low-level: the fingerprint of the state after `tick` steps. */
  addChecksum(tick: number, hash: string) {
    if (this.checksums.at(-1)?.tick !== tick) this.checksums.push({ tick, hash });
  }

  get ticks(): number {
    return this.inputs.length;
  }

  finish(sim: Sim): Recording {
    this.addChecksum(sim.tick, sim.hash());
    return this.build();
  }

  /** The recording so far. The last checksum should be for the current tick count. */
  build(): Recording {
    return {
      format: RECORDING_FORMAT,
      stage: structuredClone(this.stage),
      match: structuredClone(this.match),
      params: structuredClone(this.startParams),
      paramChanges: structuredClone(this.paramChanges),
      inputs: this.inputs.join(""),
      ticks: this.inputs.length,
      checksums: structuredClone(this.checksums),
    };
  }
}

/**
 * Plays a recording back tick by tick. Owns its own copy of the params (the
 * live panel can't affect playback) and checks fingerprints as it goes.
 */
export class Playback {
  readonly sim: Sim;
  private readonly params: Params;
  private checksumIndex = 0;
  /** Set at the first fingerprint mismatch: the match diverged from the recording. */
  desync: { tick: number; expected: string; actual: string } | null = null;

  constructor(readonly recording: Recording) {
    if (recording.format !== RECORDING_FORMAT) throw new Error(`unsupported recording format ${recording.format}`);
    this.params = structuredClone(recording.params);
    this.sim = new Sim(recording.stage, this.params, recording.match);
  }

  get done(): boolean {
    return this.sim.tick >= this.recording.ticks;
  }

  inputsAt(tick: number): Input[] {
    const n = this.recording.match.players;
    return Array.from({ length: n }, (_, i) => decodeInput(this.recording.inputs[tick * n + i]));
  }

  /** Advance one tick. No-op once done. */
  step() {
    if (this.done) return;
    const tick = this.sim.tick;
    for (const c of this.recording.paramChanges) if (c.tick === tick) Object.assign(this.params, c.params);
    this.sim.step(this.inputsAt(tick));
    const expected = this.recording.checksums[this.checksumIndex];
    if (expected && expected.tick === this.sim.tick) {
      this.checksumIndex++;
      const actual = this.sim.hash();
      if (actual !== expected.hash && !this.desync) this.desync = { tick: this.sim.tick, expected: expected.hash, actual };
    }
  }
}

/** Replay a whole recording as fast as possible. */
export function verifyRecording(recording: Recording): { ok: boolean; desync: Playback["desync"]; finalHash: string } {
  const p = new Playback(recording);
  while (!p.done) p.step();
  const finalHash = p.sim.hash();
  p.sim.free();
  return { ok: p.desync === null, desync: p.desync, finalHash };
}
