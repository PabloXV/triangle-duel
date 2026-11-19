import { describe, expect, it } from "vitest";
import { MAX_PREDICTION, OnlineSession } from "../src/net/onlineSession";
import type { MatchSetup } from "../src/net/protocol";
import { playOnline } from "./onlineHarness";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { verifyRecording } from "../src/sim/recording";
import type { InputSource } from "../src/session";
import { encodeInput } from "../src/sim/inputCodec";
import { DEFAULT_MATCH, NO_INPUT, initPhysics, type Input } from "../src/sim/sim";

await initPhysics();

const maxAhead: number[] = [];

describe("online rollback (in-process relay + two clients)", () => {
  it.each([
    ["equal latency", [3, 3], 0],
    ["lopsided latency (B's inputs arrive late and get moved)", [1, 12], 0],
    ["jittery network", [2, 4], 6],
  ] as const)("%s: both clients' confirmed matches end bit-identical", (_, latency, jitter) => {
    const { a, b, desyncs } = playOnline({ latency: [...latency], jitter, ticks: 2400 });
    expect(desyncs).toEqual([]);
    expect(a.confirmedTick).toBeGreaterThan(2300); // sanity: the match actually ran
    expect(a.confirmedTick).toBe(b.confirmedTick);
    expect(a.confirmedHash()).toBe(b.confirmedHash());
    // Sanity: real play happened (inputs changed, someone got KO'd).
    const rec = a.recording();
    expect(new Set(rec.inputs).size).toBeGreaterThan(2);
    expect(a.sim.view().some((f) => f.stocks < 2)).toBe(true);
    // Both clients' recordings are the same match, and replay exactly.
    expect(b.recording().inputs).toBe(rec.inputs);
    expect(verifyRecording(rec).ok).toBe(true);
  });

  it("predictions go wrong and get corrected: rollbacks happen, confirmed matches still agree", () => {
    const { a, b, desyncs } = playOnline({ latency: [2, 4], jitter: 6, ticks: 1500 });
    expect(a.stats.rollbacks + b.stats.rollbacks).toBeGreaterThan(10);
    expect(desyncs).toEqual([]);
    expect(a.confirmedHash()).toBe(b.confirmedHash());
  });

  it("my own input arriving late (round trip underestimated) is moved by the relay and corrected", () => {
    // Both believe the round trip is 0 ms, so they run barely ahead and their
    // inputs reach the relay after it has finalized those steps.
    const { a, b, desyncs } = playOnline({ latency: [8, 8], ticks: 1200, rttMs: () => 0 });
    expect(desyncs).toEqual([]);
    expect(a.confirmedHash()).toBe(b.confirmedHash());
    expect(a.stats.rollbacks).toBeGreaterThan(0);
  });

  it("never predicts more than MAX_PREDICTION steps ahead, even on a terrible connection", () => {
    const { a, b } = playOnline({ latency: [25, 25], ticks: 900, sample: (s) => maxAhead.push(s.predicting) });
    expect(Math.max(...maxAhead)).toBeLessThanOrEqual(MAX_PREDICTION);
    expect(a.stats.maxDepth).toBeLessThanOrEqual(MAX_PREDICTION);
    expect(a.confirmedHash()).toBe(b.confirmedHash());
  });

  it("control: a client with a different setup is caught as a desync within a second", () => {
    const { a, desyncs } = playOnline({
      latency: [2, 2],
      ticks: 600,
      tamper: (s) => ({ ...s, params: { ...s.params, gravity: s.params.gravity + 0.01 } }),
    });
    expect(desyncs.length).toBeGreaterThan(0);
    expect(desyncs[0]).toBe(60); // the first fingerprint comparison
    expect(a.status()).toMatch(/DESYNC at step 60/);
  });
});

describe("online rollback: responsiveness", () => {
  it("my own input is used on the very next step, with no round-trip delay", () => {
    let mine: Input = NO_INPUT;
    const local: InputSource = { isHuman: true, describe: () => "me", next: () => mine };
    const sent: [number, string][] = [];
    const transport = { sendInput: (step: number, input: string) => sent.push([step, input]), sendHash: () => {} };
    const setup: MatchSetup = { stage: WINGS_STAGE, match: { ...DEFAULT_MATCH, players: 2 }, params: DEFAULT_PARAMS };
    // A slow connection (200 ms) and no official steps yet: lockstep would wait; rollback doesn't.
    const s = new OnlineSession(setup, 1, ["A", "B"], local, transport, "TEST", () => 200);
    for (let i = 0; i < 3; i++) {
      s.frame();
      s.step();
    }
    mine = { turn: -1, charge: true }; // press left + charge
    s.frame();
    s.step();
    const left = encodeInput(mine);
    expect(s.lastStepInputs[1]).toBe(left); // already applied in the step just simulated...
    expect(sent.at(-1)).toEqual([s.sim.tick - 1, left]); // ...and sent to the relay for that same step
    expect(s.lastStepInputs[0]).toBe(encodeInput(NO_INPUT)); // the other player: predicted idle
  });
});
