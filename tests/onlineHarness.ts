// An in-process online match, shared by tests/online.test.ts and
// scripts/netsim.ts: the real relay logic (RoomCore) and one OnlineSession per
// player, connected by a fake network. Not a test file itself.

import { BotSource, DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { OnlineSession } from "../src/net/onlineSession";
import { PROTOCOL_VERSION, type MatchSetup, type ServerMsg } from "../src/net/protocol";
import { RoomCore, type Outgoing } from "../src/net/room";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { DEFAULT_MATCH } from "../src/sim/sim";


/**
 * A whole online match in one process: the real relay logic (RoomCore) and
 * one OnlineSession per player, connected by a fake network that delays
 * messages (in 1/60 s ticks) but keeps each direction in order, like a
 * WebSocket. Bots play, each reading its own client's copy of the match.
 */
export function playOnline(opts: {
  latency: [number, number]; // one-way delay per client, in ticks
  jitter?: number; // extra random delay, up to this many ticks
  ticks: number;
  tamper?: (setup: MatchSetup) => MatchSetup; // corrupt client B's setup (desync test)
  rttMs?: (id: string) => number; // what each client believes its round trip is (default: the true one)
  sample?: (s: OnlineSession) => void; // called for each client after every step
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
    const trueRtt = 2 * opts.latency[ids.indexOf(id)] * (1000 / 60);
    const rtt = () => (opts.rttMs ? opts.rttMs(id) : trueRtt);
    sessions.set(id, new OnlineSession(mySetup, you, ["A", "B"], bot, transport, "TEST", rtt));
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
      opts.sample?.(s);
    }
  }
  // Relay stops; let everything in flight arrive and both clients catch up.
  for (let k = 0; k < 200; k++, now++) {
    flush();
    for (const s of sessions.values()) s.step();
  }
  return { a: sessions.get("a")!, b: sessions.get("b")!, desyncs };
}

