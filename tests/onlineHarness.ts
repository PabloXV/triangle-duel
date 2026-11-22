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
  bots?: number; // bot seats the host adds before starting (driven by client A, the host)
  leave?: { id: "a" | "b"; at: number }; // disconnect this client at this tick
  spectateAt?: number; // a spectator ("s") joins at this tick (same latency as A)
  asleep?: { id: string; from: number; to: number }; // this client's tab is hidden: it receives but doesn't step
  inputDelay?: number; // the players' input delay (default: OnlineSession's)
  /** Relay → client hiccups (measured on a real link: ~100 ms, about twice a second): every `every` ticks, nothing arrives for `hold` ticks, then it all lands at once. */
  hiccups?: { every: number; hold: number };
}) {
  let now = 0;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const inFlight: { at: number; deliver: () => void }[] = [];
  const lastAt = new Map<string, number>(); // per channel, to keep order
  const send = (channel: string, delay: number, deliver: () => void) => {
    let at = Math.max(now + delay + Math.floor(rand() * ((opts.jitter ?? 0) + 1)), lastAt.get(channel) ?? 0);
    const h = opts.hiccups;
    if (h && channel.startsWith("down-")) {
      const phase = at % h.every;
      if (phase < h.hold) at += h.hold - phase;
    }
    lastAt.set(channel, at);
    inFlight.push({ at, deliver });
  };
  const flush = () => {
    inFlight.sort((x, y) => x.at - y.at);
    while (inFlight.length && inFlight[0].at <= now) inFlight.shift()!.deliver();
  };

  const ids = ["a", "b"];
  const latencyOf = (id: string) => opts.latency[id === "b" ? 1 : 0];
  const room = new RoomCore("TEST");
  const sessions = new Map<string, OnlineSession>();
  const left = new Map<string, OnlineSession>(); // clients that disconnected (frozen)
  const desyncs: number[] = [];

  const toClient = (id: string, msg: ServerMsg) => {
    const s = sessions.get(id);
    if (msg.type === "tick") s?.receiveTick(msg.t, msg.c ?? []);
    if (msg.type === "spectate") {
      // Joined mid-match: watch, after catching up on everything so far.
      const transport = { sendInput: () => {}, sendHash: (step: number, hash: string) => toRoom(id, { type: "hash", step, hash }) };
      const spectator = new OnlineSession(msg.setup, -1, msg.names, new Map(), transport, "TEST", () => 2 * latencyOf(id) * (1000 / 60));
      spectator.clock = () => now * (1000 / 60);
      spectator.catchUp(msg.log, msg.next);
      sessions.set(id, spectator);
    }
    if (msg.type === "drive" && s) {
      // We inherited bots (the host left): run them from now on.
      for (const f of msg.fighters) s.takeOver(f, new BotSource(new HeuristicBot(f, { ...DEFAULT_BOT, seed: 50 + f }), DEFAULT_PARAMS));
    }
    if (msg.type === "desync") {
      desyncs.push(msg.step);
      s?.receiveDesync(msg.step);
    }
  };
  const route = (out: Outgoing[]) => {
    for (const o of out) {
      for (const id of o.to === "all" ? ids : [o.to]) {
        if (o.msg.type === "start") startClient(id, o.msg.setup, o.msg.you, o.msg.drive);
        else send(`down-${id}`, latencyOf(id), () => toClient(id, o.msg));
      }
    }
  };
  const toRoom = (id: string, msg: object) =>
    send(`up-${id}`, latencyOf(id), () => route(room.receive(id, JSON.stringify(msg))));

  function startClient(id: string, setup: MatchSetup, you: number, drive: number[]) {
    const mySetup = id === "b" && opts.tamper ? opts.tamper(setup) : setup;
    // Bots play every fighter this client drives (its own "human" one, plus room bots if host).
    const sources = new Map(drive.map((f) => [f, new BotSource(new HeuristicBot(f, { ...DEFAULT_BOT, seed: 10 + f }), mySetup.params)]));
    const transport = {
      sendInput: (step: number, input: string, fighter: number) => toRoom(id, { type: "input", tick: step, input, fighter }),
      sendHash: (step: number, hash: string) => toRoom(id, { type: "hash", step, hash }),
    };
    const trueRtt = 2 * latencyOf(id) * (1000 / 60);
    const rtt = () => (opts.rttMs ? opts.rttMs(id) : trueRtt);
    const session = new OnlineSession(mySetup, you, ["A", "B", "bot 1", "bot 2"], sources, transport, "TEST", rtt, opts.inputDelay);
    session.clock = () => now * (1000 / 60); // the fake network's time
    sessions.set(id, session);
  }

  for (const id of ids) {
    room.connect(id);
    route(room.receive(id, JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, name: id })));
  }
  for (let i = 0; i < (opts.bots ?? 0); i++) route(room.receive("a", JSON.stringify({ type: "addBot" })));
  const players = 2 + (opts.bots ?? 0);
  const setup: MatchSetup = { stage: WINGS_STAGE, match: { ...DEFAULT_MATCH, players, stocks: 2 }, params: DEFAULT_PARAMS };
  route(room.receive("a", JSON.stringify({ type: "start", setup })));

  // Each loop = 1/60 s: network delivers, the relay finalizes a step, each
  // client sends input and simulates, as the game loop would.
  for (; now < opts.ticks; now++) {
    flush();
    if (opts.spectateAt === now) {
      ids.push("s");
      room.connect("s");
      toRoom("s", { type: "hello", version: PROTOCOL_VERSION, name: "spectator" });
    }
    if (opts.leave && now === opts.leave.at) {
      route(room.disconnect(opts.leave.id)); // they close the tab
      left.set(opts.leave.id, sessions.get(opts.leave.id)!);
      sessions.delete(opts.leave.id);
    }
    route(room.advance());
    for (const [id, s] of sessions) {
      if (opts.asleep && id === opts.asleep.id && now >= opts.asleep.from && now < opts.asleep.to) continue;
      s.step();
      opts.sample?.(s);
    }
  }
  // Relay stops; let everything in flight arrive and both clients catch up.
  for (let k = 0; k < 200; k++, now++) {
    flush();
    for (const s of sessions.values()) s.step();
  }
  const get = (id: string) => (sessions.get(id) ?? left.get(id))!;
  return { a: get("a"), b: get("b"), spectator: sessions.get("s"), desyncs };
}

