import { describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { LEFT } from "../src/sim/inputCodec";
import { Playback, Recorder, decodeInput, encodeInput, verifyRecording, type Recording } from "../src/sim/recording";
import { DEFAULT_MATCH, Sim, initPhysics, type MatchOptions } from "../src/sim/sim";

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
    // Replace one input of a fighter still in the match with LEFT ("left the
    // match"), which always changes the state. (Flipping a turn doesn't always:
    // in servo mode, "no input" brakes the spin, so when spinning left, "none"
    // and "turn right" can both saturate the same max torque and give
    // identical physics.)
    const n = recording.match.players;
    const p = new Playback(recording);
    while (p.sim.tick < 700 && !p.done) p.step();
    const at = p.sim.tick;
    const who = p.sim.view().findIndex((f) => f.stocks > 0);
    p.sim.free();
    expect(who).toBeGreaterThanOrEqual(0);
    const i = at * n + who;
    const tampered = { ...recording, inputs: recording.inputs.slice(0, i) + LEFT + recording.inputs.slice(i + 1) };
    const r = verifyRecording(tampered);
    expect(r.ok).toBe(false);
    expect(r.desync?.tick).toBe(Math.ceil((at + 1) / 60) * 60); // the first fingerprint after the change
  });

  it("dropping the mid-match param change → desync after it", () => {
    const r = verifyRecording({ ...recording, paramChanges: [] });
    expect(r.ok).toBe(false);
    expect(r.desync!.tick).toBeGreaterThan(500);
  });
});
