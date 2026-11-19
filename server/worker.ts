// The relay Worker: routes /api/room/<CODE>/ws WebSocket upgrades to that
// room's Durable Object. Everything else 404s.

import { ROOM_CODE } from "../src/net/protocol";

export { Room } from "./room-do";

interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Z]+)\/ws$/);
    if (m) {
      if (!ROOM_CODE.test(m[1])) return new Response("bad room code", { status: 400 });
      // idFromName: everyone who uses the same code reaches the same instance.
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(request);
    }
    if (url.pathname === "/") return new Response("triangle-duel relay");
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
