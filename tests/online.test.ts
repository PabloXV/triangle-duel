import { describe, expect, it } from "vitest";
import { BotSource, DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { OnlineSession } from "../src/net/onlineSession";
import { PROTOCOL_VERSION, type MatchSetup, type ServerMsg } from "../src/net/protocol";
import { RoomCore, type Outgoing } from "../src/net/room";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { verifyRecording } from "../src/sim/recording";
import { DEFAULT_MATCH, initPhysics } from "../src/sim/sim";

await initPhysics();

/**
 * A whole online match in one process: the real relay logic (RoomCore) and
 * one OnlineSession per player, connected by a fake network that delays
 * messages (in 1/60 s ticks) but keeps each direction in order, like a
 * WebSocket. Bots play, each reading its own client's copy of the match.
 */
function playOnline(opts: {
  latency: [number, number]; // one-way delay per client, in ticks
  jitter?: number; // extra random delay, up to this many ticks
  ticks: number;
  tamper?: (setup: MatchSetup) => MatchSetup; // corrupt client B's setup (desync test)
}) {
  let now = 0;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const inFlight: { at: number; deliver: () => void }[] = [];
  const lastAt = new Map<string, number>(); // per channel, to keep order
  const send = (channel: string, delay: number, deliver: () => void) => {
    const at = Math.max(now + delay + Math.floor(rand() * ((opts.jitter ?? 0) + 1)), lastAt.get(channel) ?? 0);
    lastAt.set(channel, at);
    inFlight.push({ at, deliver });
  };
  const flush = () => {
    inFlight.sort((x, y) => x.at - y.at);
    while (inFlight.length && inFlight[0].at <= now) inFlight.shift()!.deliver();
  };

  const ids = ["a", "b"];
  const room = new RoomCore("TEST");
  const sessions = new Map<string, OnlineSession>();
  const desyncs: number[] = [];

  const toClient = (id: string, msg: ServerMsg) => {
    const s = sessions.get(id);
    if (msg.type === "tick") s?.receiveTick(msg.t, msg.c ?? []);
    if (msg.type === "desync") {
      desyncs.push(msg.step);
      s?.receiveDesync(msg.step);
    }
  };
  const route = (out: Outgoing[]) => {
    for (const o of out) {
      for (const id of o.to === "all" ? ids : [o.to]) {
        if (o.msg.type === "start") startClient(id, o.msg.setup, o.msg.you);
        else send(`down-${id}`, opts.latency[ids.indexOf(id)], () => toClient(id, o.msg));
      }
    }
  };
  const toRoom = (id: string, msg: object) =>
    send(`up-${id}`, opts.latency[ids.indexOf(id)], () => route(room.receive(id, JSON.stringify(msg))));

  function startClient(id: string, setup: MatchSetup, you: number) {
    const mySetup = id === "b" && opts.tamper ? opts.tamper(setup) : setup;
    const bot = new BotSource(new HeuristicBot(you, { ...DEFAULT_BOT, seed: 10 + you }), mySetup.params);
    const transport = {
      sendInput: (step: number, input: string) => toRoom(id, { type: "input", tick: step, input }),
      sendHash: (step: number, hash: string) => toRoom(id, { type: "hash", step, hash }),
    };
    sessions.set(id, new OnlineSession(mySetup, you, ["A", "B"], bot, transport));
  }

  for (const id of ids) {
    room.connect(id);
    route(room.receive(id, JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, name: id })));
  }
  const setup: MatchSetup = { stage: WINGS_STAGE, match: { ...DEFAULT_MATCH, players: 2, stocks: 2 }, params: DEFAULT_PARAMS };
  route(room.receive("a", JSON.stringify({ type: "start", setup })));

  // Each loop = 1/60 s: network delivers, the relay finalizes a step, each
  // client sends input and simulates, as the game loop would.
  for (; now < opts.ticks; now++) {
    flush();
    route(room.advance());
    for (const s of sessions.values()) {
      s.frame();
      s.step();
    }
  }
  // Relay stops; let everything in flight arrive and both clients catch up.
  for (let k = 0; k < 200; k++, now++) {
    flush();
    for (const s of sessions.values()) s.step();
  }
  return { a: sessions.get("a")!, b: sessions.get("b")!, desyncs };
}

describe("online lockstep (in-process relay + two clients)", () => {
  it.each([
    ["equal latency", [3, 3], 0],
    ["lopsided latency (B's inputs arrive late and get moved)", [1, 12], 0],
    ["jittery network", [2, 4], 6],
  ] as const)("%s: both copies of the match end bit-identical", (_, latency, jitter) => {
    const { a, b, desyncs } = playOnline({ latency: [...latency], jitter, ticks: 1500 });
    expect(desyncs).toEqual([]);
    expect(a.sim.tick).toBeGreaterThan(1400); // sanity: the match actually ran
    expect(a.sim.tick).toBe(b.sim.tick);
    expect(a.sim.hash()).toBe(b.sim.hash());
    // Sanity: real play happened (inputs changed, someone got KO'd).
    const rec = a.recording();
    expect(new Set(rec.inputs).size).toBeGreaterThan(2);
    expect(a.sim.view().some((f) => f.stocks < 2)).toBe(true);
    // Both clients' recordings are the same match, and replay exactly.
    expect(b.recording().inputs).toBe(rec.inputs);
    expect(verifyRecording(rec).ok).toBe(true);
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
