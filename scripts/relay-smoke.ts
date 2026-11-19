// End-to-end check of the relay on the real (local) Cloudflare runtime:
// starts `wrangler dev`, connects two WebSocket clients to a room, starts a
// match, exchanges inputs, and checks both receive the identical official
// tick stream at ~60 Hz.
//
// Usage: npm run relay:smoke

import { spawn } from "node:child_process";
import { PROTOCOL_VERSION, type MatchSetup, type ServerMsg } from "../src/net/protocol";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { DEFAULT_MATCH } from "../src/sim/types";

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;
const ROOM = "SMKT";
const TICKS = 180; // 3 s of match

const relay = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
let relayLog = "";
relay.stdout.on("data", (d) => (relayLog += d));
relay.stderr.on("data", (d) => (relayLog += d));

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  ticks: { t: number; c?: [number, string][] }[] = [];
  open: Promise<void>;
  constructor(readonly name: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/api/room/${ROOM}/ws`);
    this.open = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error(`${name}: connection failed`));
    });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      this.msgs.push(m);
      if (m.type === "tick") this.ticks.push(m);
    };
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  waitFor<T extends ServerMsg["type"]>(type: T, timeout = 5000): Promise<Extract<ServerMsg, { type: T }>> {
    const t0 = Date.now();
    return new Promise((res, rej) => {
      const check = () => {
        const m = this.msgs.find((x) => x.type === type);
        if (m) return res(m as Extract<ServerMsg, { type: T }>);
        if (Date.now() - t0 > timeout) return rej(new Error(`${this.name}: no "${type}" within ${timeout} ms`));
        setTimeout(check, 10);
      };
      check();
    });
  }
}

function check(ok: boolean, what: string) {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) process.exitCode = 1;
}

try {
  // Wait for wrangler to serve.
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try {
      up = (await fetch(BASE)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!up) throw new Error(`relay didn't start:\n${relayLog}`);

  check((await fetch(`${BASE}/api/room/abc!/ws`)).status === 400 || (await fetch(`${BASE}/api/room/OOOO/ws`)).status === 400, "rejects bad room codes");

  const a = new Client("A");
  const b = new Client("B");
  await Promise.all([a.open, b.open]);
  a.send({ type: "hello", version: PROTOCOL_VERSION, name: "Ana" });
  const wa = await a.waitFor("welcome");
  b.send({ type: "hello", version: PROTOCOL_VERSION, name: "Bo" });
  const wb = await b.waitFor("welcome");
  check(wa.slot === 0 && wb.slot === 1, `seated in order (A slot ${wa.slot}, B slot ${wb.slot})`);

  // RTT
  const t0 = performance.now();
  a.send({ type: "ping", id: 1 });
  await a.waitFor("pong");
  const rtt = performance.now() - t0;
  check(rtt < 100, `ping round trip ${rtt.toFixed(1)} ms (local)`);

  const setup: MatchSetup = { stage: WINGS_STAGE, match: { ...DEFAULT_MATCH, players: 2 }, params: DEFAULT_PARAMS };
  a.send({ type: "start", setup });
  const [sa, sb] = await Promise.all([a.waitFor("start"), b.waitFor("start")]);
  check(sa.you === 0 && sb.you === 1, "each client told its fighter index");

  // Both send a few input changes, scheduled a little ahead (as clients will).
  const startedAt = performance.now();
  const plan: [Client, number, string][] = [
    [a, 20, "2"],
    [b, 30, "0"],
    [a, 60, "5"],
    [b, 90, "4"],
    [a, 120, "1"],
  ];
  for (const [who, tick, input] of plan) {
    while (who.ticks.length < tick - 6) await new Promise((r) => setTimeout(r, 5));
    who.send({ type: "input", tick, input });
  }
  while (a.ticks.length < TICKS || b.ticks.length < TICKS) await new Promise((r) => setTimeout(r, 10));
  const seconds = (performance.now() - startedAt) / 1000;

  const streamA = JSON.stringify(a.ticks.slice(0, TICKS));
  const streamB = JSON.stringify(b.ticks.slice(0, TICKS));
  check(streamA === streamB, `both clients received the identical stream of ${TICKS} steps`);
  check(a.ticks.slice(0, TICKS).every((m, i) => m.t === i), "steps numbered 0, 1, 2, ... with no gaps");
  const changes = a.ticks.flatMap((m) => (m.c ?? []).map(([f, inp]) => `${m.t}:${f}=${inp}`));
  check(
    JSON.stringify(changes.slice(0, 5)) === JSON.stringify(["20:0=2", "30:1=0", "60:0=5", "90:1=4", "120:0=1"]),
    `inputs applied at their scheduled steps: ${changes.slice(0, 5).join(", ")}`,
  );
  const rate = TICKS / seconds;
  check(rate > 50 && rate < 70, `tick rate ${rate.toFixed(1)}/s (target 60)`);

  a.ws.close();
  b.ws.close();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  relay.kill();
}
