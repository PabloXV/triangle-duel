import { describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Recorder, decodeInput, encodeInput, verifyRecording, type Recording } from "../src/sim/recording";
import { DEFAULT_MATCH, Sim, initPhysics, type Input, type MatchOptions } from "../src/sim/sim";

await initPhysics(); // top-level: the match below is recorded during test collection

/** Record a 4-bot match, with a mid-match gravity tweak (like dragging the panel slider). */
function recordMatch(): { recording: Recording; liveHash: string } {
  const match: MatchOptions = { ...DEFAULT_MATCH, players: 4, stocks: 2 };
  const params = { ...DEFAULT_PARAMS };
  const sim = new Sim(WINGS_STAGE, params, match);
  const rec = new Recorder(WINGS_STAGE, match, params);
  const bots = [0, 1, 2, 3].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: i + 3 }));
  for (let t = 0; t < 1500 && !sim.result.over; t++) {
    if (t === 500) params.gravity = 14; // panel edit mid-match
    const inputs = bots.map((b) => b.think(sim.view(), sim.stage, params));
    rec.beforeStep(sim, inputs, params);
    sim.step(inputs);
    rec.afterStep(sim);
  }
  const recording = rec.finish(sim);
  const liveHash = sim.hash();
  sim.free();
  return { recording, liveHash };
}

const { recording, liveHash } = recordMatch();

describe("recordings", () => {
  it("encodes every input as one character and back", () => {
    for (const turn of [-1, 0, 1] as const)
      for (const charge of [false, true]) {
        const c = encodeInput({ turn, charge });
        expect(c).toHaveLength(1);
        expect(decodeInput(c)).toEqual({ turn, charge });
      }
  });

  it("plays back exactly: every fingerprint matches, final state = live final state", () => {
    expect(recording.paramChanges).toHaveLength(1); // the gravity tweak was captured
    const r = verifyRecording(recording);
    expect(r.desync).toBeNull();
    expect(r.finalHash).toBe(liveHash);
  });

  it("survives a round trip through JSON (the file format)", () => {
    const fromFile = JSON.parse(JSON.stringify(recording)) as Recording;
    expect(verifyRecording(fromFile).finalHash).toBe(liveHash);
  });

  it("one changed input → desync reported at the next fingerprint", () => {
    // Flip P1's turn at tick 700 (P1 is alive then; checked below).
    const n = recording.match.players;
    const i = 700 * n;
    const original = decodeInput(recording.inputs[i]);
    const flipped: Input = { ...original, turn: original.turn === 1 ? -1 : 1 };
    const tampered = { ...recording, inputs: recording.inputs.slice(0, i) + encodeInput(flipped) + recording.inputs.slice(i + 1) };
    const r = verifyRecording(tampered);
    expect(r.ok).toBe(false);
    expect(r.desync?.tick).toBe(720); // first fingerprint after tick 700
  });

  it("dropping the mid-match param change → desync after it", () => {
    const r = verifyRecording({ ...recording, paramChanges: [] });
    expect(r.ok).toBe(false);
    expect(r.desync!.tick).toBeGreaterThan(500);
  });
});
