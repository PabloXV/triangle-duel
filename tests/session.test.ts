import { describe, expect, it } from "vitest";
import { BotSource, DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { LiveSession, PlaybackSession, type InputSource } from "../src/session";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { verifyRecording } from "../src/sim/recording";
import { NO_INPUT, initPhysics } from "../src/sim/sim";

await initPhysics();

const bot = (i: number, seed: number) => new BotSource(new HeuristicBot(i, { ...DEFAULT_BOT, seed }), DEFAULT_PARAMS);
const idle: InputSource = { isHuman: false, describe: () => "idle", next: () => NO_INPUT };

describe("sessions", () => {
  it("a live session records the match; playing the recording reproduces it", () => {
    const live = new LiveSession(WINGS_STAGE, DEFAULT_PARAMS, { stocks: 1 }, [bot(0, 1), bot(1, 2)]);
    while (!live.sim.result.over && live.sim.tick < 60 * 120) live.step();
    expect(live.sim.result.over).toBe(true);
    const rec = live.recording()!;
    expect(verifyRecording(rec).finalHash).toBe(live.sim.hash());

    const playback = new PlaybackSession(rec);
    while (playback.step());
    expect(playback.sim.hash()).toBe(live.sim.hash());
    expect(playback.status()).toBe("REPLAY — end (R for a new match)");
    expect(playback.step()).toBe(false); // nothing left to play
  });

  it("recording() mid-match gives a valid partial recording", () => {
    const live = new LiveSession(WINGS_STAGE, DEFAULT_PARAMS, {}, [bot(0, 3), bot(1, 4)]);
    for (let t = 0; t < 300; t++) live.step();
    const rec = live.recording()!;
    expect(rec.ticks).toBe(300);
    expect(verifyRecording(rec).ok).toBe(true);
  });

  it("swapping who controls a player mid-match is still recorded faithfully", () => {
    const live = new LiveSession(WINGS_STAGE, DEFAULT_PARAMS, {}, [bot(0, 5), idle]);
    for (let t = 0; t < 200; t++) live.step();
    live.setSource(1, bot(1, 6)); // e.g. P2 switched from human to bot in the panel
    for (let t = 0; t < 200; t++) live.step();
    expect(live.describe(1)).toMatch(/^P2 bot/);
    expect(verifyRecording(live.recording()!).finalHash).toBe(live.sim.hash());
  });

  it("rejects a source count that doesn't match the player count", () => {
    expect(() => new LiveSession(WINGS_STAGE, DEFAULT_PARAMS, { players: 3 }, [idle, idle])).toThrow(/2 input sources for 3 players/);
  });
});
