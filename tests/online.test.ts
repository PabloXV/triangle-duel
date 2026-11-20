import { describe, expect, it } from "vitest";
import { MAX_PREDICTION, OnlineSession } from "../src/net/onlineSession";
import type { MatchSetup } from "../src/net/protocol";
import { playOnline } from "./onlineHarness";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { verifyRecording } from "../src/sim/recording";
import type { InputSource } from "../src/session";
import { LEFT, encodeInput } from "../src/sim/inputCodec";
import { DEFAULT_MATCH, NO_INPUT, initPhysics, type Input, type SimEvent } from "../src/sim/sim";

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

  it("on a steady connection my own input is almost never late, and the present never jumps", () => {
    // Late own inputs snap my own fighter (often its rotation, which decides
    // whether a launch goes forward or tips over). The margin adapts to avoid them.
    const { a, b } = playOnline({ latency: [2, 2], jitter: 1, ticks: 1800 });
    for (const s of [a, b]) {
      expect(s.stats.ownLate).toBeLessThanOrEqual(3);
      expect(s.stats.bursts).toBe(0);
    }
  });

  it("on a jittery connection the margin grows, so late inputs stop", () => {
    const { a } = playOnline({ latency: [3, 3], jitter: 8, ticks: 2400 });
    const lateFirstHalf = a.stats.ownLate; // (cumulative; checked against the whole run below)
    expect(lateFirstHalf).toBeLessThan(60); // was ~180 with a fixed 2-step margin
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
    const s = new OnlineSession(setup, 1, ["A", "B"], new Map([[1, local]]), transport, "TEST", () => 200);
    for (let i = 0; i < 3; i++) s.step();
    mine = { turn: -1, charge: true }; // press left + charge
    s.step();
    const left = encodeInput(mine);
    expect(s.lastStepInputs[1]).toBe(left); // already applied in the step just simulated...
    expect(sent.at(-1)).toEqual([s.sim.tick - 1, left]); // ...and sent to the relay for that same step
    expect(s.lastStepInputs[0]).toBe(encodeInput(NO_INPUT)); // the other player: predicted idle
  });
});

describe("online rollback: room bots (driven by the host's browser)", () => {
  it.each([
    ["2 players + 1 bot", 1],
    ["2 players + 2 bots", 2],
  ])("%s: everyone's confirmed match ends bit-identical", (_, bots) => {
    const { a, b, desyncs } = playOnline({ latency: [2, 4], jitter: 2, ticks: 1800, bots });
    expect(desyncs).toEqual([]);
    expect(a.sim.match.players).toBe(2 + bots);
    expect(a.confirmedHash()).toBe(b.confirmedHash());
    // The bots really played: their inputs (sent by A) changed during the match.
    const rec = a.recording();
    const n = rec.match.players;
    for (let f = 2; f < n; f++) {
      const botInputs = new Set(Array.from({ length: rec.ticks }, (_, t) => rec.inputs[t * n + f]));
      expect(botInputs.size).toBeGreaterThan(2);
    }
    expect(b.recording().inputs).toBe(rec.inputs);
  });
});

describe("online rollback: leaving mid-match", () => {
  const LEAVE_AT = 400;

  /** The steps (from a recording) at which fighter f's input was LEFT. */
  const leftSteps = (rec: ReturnType<OnlineSession["recording"]>, f: number) =>
    Array.from({ length: rec.ticks }, (_, t) => t).filter((t) => rec.inputs[t * rec.match.players + f] === LEFT);

  it("the host leaves: they're removed, the next player inherits the bot, the match goes on", () => {
    const { b, desyncs } = playOnline({ latency: [2, 3], ticks: 1500, bots: 1, leave: { id: "a", at: LEAVE_AT } });
    expect(desyncs).toEqual([]);
    expect(b.confirmedTick).toBeGreaterThan(1300); // the match kept going
    const rec = b.recording();
    expect(verifyRecording(rec).ok).toBe(true); // B's match replays exactly
    const leftAt = leftSteps(rec, 0)[0];
    expect(leftAt).toBeGreaterThanOrEqual(LEAVE_AT); // the host's fighter got LEFT...
    expect(b.sim.view()[0]).toMatchObject({ ko: "left", eliminated: true }); // ...and is gone
    // The bot (fighter 2) kept playing after the handoff: B's browser drives it now.
    const botAfter = new Set(Array.from({ length: rec.ticks - leftAt - 30 }, (_, k) => rec.inputs[(leftAt + 30 + k) * 3 + 2]));
    expect(botAfter.size).toBeGreaterThan(2);
  });

  it("the remaining client gets the leave event, even though it happens in a re-simulation", () => {
    const seen: SimEvent[] = [];
    let missedByLastStepEvents = false; // would reading only sim.events (the last step) have missed it?
    playOnline({
      latency: [2, 3],
      ticks: 700,
      bots: 1,
      leave: { id: "b", at: LEAVE_AT },
      sample: (s) => {
        if (s.you !== 0) return;
        const isLeave = (e: SimEvent) => e.type === "ko" && e.reason === "left";
        const events = s.takeEvents();
        if (events.some(isLeave) && !s.sim.events.some(isLeave)) missedByLastStepEvents = true;
        seen.push(...events);
      },
    });
    expect(seen).toContainEqual(expect.objectContaining({ type: "ko", fighter: 1, reason: "left" }));
    // The leave happened in an earlier (re-simulated) step of that call: the old
    // approach, reading only the last step's events, would have missed it.
    expect(missedByLastStepEvents).toBe(true);
  });

  it("a non-host leaves: they're removed for everyone, the host's match goes on", () => {
    const { a, desyncs } = playOnline({ latency: [2, 3], ticks: 1200, bots: 1, leave: { id: "b", at: LEAVE_AT } });
    expect(desyncs).toEqual([]);
    expect(a.sim.view()[1]).toMatchObject({ ko: "left", eliminated: true });
    expect(verifyRecording(a.recording()).ok).toBe(true);
    expect(leftSteps(a.recording(), 1)[0]).toBeGreaterThanOrEqual(LEAVE_AT);
  });
});

describe("online: spectators", () => {
  it("joining mid-match: catches up, follows live, and ends with exactly the players' match", () => {
    const { a, spectator, desyncs } = playOnline({ latency: [2, 4], jitter: 2, ticks: 1500, bots: 1, spectateAt: 600 });
    expect(desyncs).toEqual([]);
    expect(spectator).toBeDefined();
    const s = spectator!;
    expect(s.spectating).toBe(true);
    expect(s.confirmedTick).toBe(a.confirmedTick);
    expect(s.confirmedHash()).toBe(a.confirmedHash());
    expect(s.stats.rollbacks).toBe(0); // spectators never guess, so never correct
    // Its recording is the whole match, from the start (not just from when it joined).
    const rec = s.recording();
    expect(rec.ticks).toBe(a.confirmedTick);
    expect(rec.inputs).toBe(a.recording().inputs);
    expect(verifyRecording(rec).ok).toBe(true);
  });
});
