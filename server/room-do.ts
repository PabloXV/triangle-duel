// One Durable Object per room code. Cloudflare guarantees a single live
// instance per room worldwide, single-threaded, so every player's messages are
// handled in one place, in order, with no locking.
//
// All game logic is in src/net/room.ts (tested in Node). This wrapper only:
//   - accepts WebSockets and feeds their events to RoomCore,
//   - runs the 60 Hz match clock,
//   - sends RoomCore's outgoing messages.
//
// Note on cost: sockets are accept()ed normally (not the Hibernation API), so
// the object stays in memory, and billed for duration, while anyone is
// connected, even idle in a lobby. Simple and fine for friends; switch to
// hibernation (with state persisted between wakeups) if lobby time ever adds up.

import { DurableObject } from "cloudflare:workers";
import { RoomCore, type Outgoing } from "../src/net/room";
import { TICK_RATE } from "../src/sim/types";

const STEP_MS = 1000 / TICK_RATE;
/** Never finalize more than this many steps in one timer callback (after a stall). */
const MAX_CATCH_UP = 10;

export class Room extends DurableObject {
  private core: RoomCore | null = null;
  private sockets = new Map<string, WebSocket>();
  private clock: ReturnType<typeof setInterval> | null = null;
  private clockStart = 0; // Date.now() when step 0 was due

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a WebSocket", { status: 426 });
    const code = new URL(request.url).pathname.split("/")[3]; // /api/room/<CODE>/ws
    this.core ??= new RoomCore(code);

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const id = crypto.randomUUID();
    this.sockets.set(id, server);
    this.deliver(this.core.connect(id));

    server.addEventListener("message", (e) => this.deliver(this.core!.receive(id, e.data)));
    const gone = () => {
      if (!this.sockets.delete(id)) return;
      this.deliver(this.core!.disconnect(id));
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);

    return new Response(null, { status: 101, webSocket: client });
  }

  private deliver(out: Outgoing[]) {
    for (const o of out) {
      const data = JSON.stringify(o.msg);
      const targets = o.to === "all" ? [...this.sockets.entries()] : [[o.to, this.sockets.get(o.to)] as const];
      for (const [id, ws] of targets) {
        if (!ws) continue;
        try {
          ws.send(data);
          if (o.close) ws.close(1008, "rejected");
        } catch {
          this.sockets.delete(id); // already closed
        }
      }
    }
    this.syncClock();
  }

  /** Run the 60 Hz clock exactly while a match is on. */
  private syncClock() {
    const running = this.core?.phase === "match";
    if (running && !this.clock) {
      this.clockStart = Date.now() - this.core!.nextStep * STEP_MS;
      this.clock = setInterval(() => this.onClock(), STEP_MS);
    } else if (!running && this.clock) {
      clearInterval(this.clock);
      this.clock = null;
    }
  }

  /** Finalize every step that's due by now (timers drift; wall time doesn't). */
  private onClock() {
    const core = this.core;
    if (!core || core.phase !== "match") return this.syncClock();
    const due = Math.floor((Date.now() - this.clockStart) / STEP_MS) + 1;
    let n = 0;
    while (core.nextStep < due && n++ < MAX_CATCH_UP) this.deliver(core.advance());
    // If we fell far behind (e.g. the object was paused), skip ahead rather than burst.
    if (core.nextStep < due) this.clockStart = Date.now() - core.nextStep * STEP_MS;
  }
}
