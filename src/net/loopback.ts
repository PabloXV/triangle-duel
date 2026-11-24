// A room on this machine, for when the relay can't be reached: the same
// RoomCore the relay runs, behind something shaped like a WebSocket. The lobby
// works exactly as online (seats, bots, colors, settings), but nobody else can
// join, so matches are always just you and bots, which run locally anyway
// (Game.playRoom). The match clock never runs here: online matches need the relay.

import { RoomCore, type Outgoing } from "./room";

const ME = "me";

/** The subset of WebSocket that NetClient uses. */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((e: any) => unknown) | null;
  onmessage: ((e: any) => unknown) | null;
  onclose: ((e: any) => unknown) | null;
  onerror: ((e: any) => unknown) | null;
  send(text: string): void;
  close(): void;
}

export class LoopbackSocket implements SocketLike {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((e: any) => unknown) | null = null;
  onmessage: ((e: any) => unknown) | null = null;
  onclose: ((e: any) => unknown) | null = null;
  onerror: ((e: any) => unknown) | null = null;
  private core: RoomCore;

  constructor(code: string) {
    this.core = new RoomCore(code);
    this.core.connect(ME);
    // Open on the next turn, like a real socket.
    setTimeout(() => {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.(null);
    });
  }

  send(text: string) {
    if (this.readyState !== WebSocket.OPEN) return;
    this.deliver(this.core.receive(ME, text));
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.core.disconnect(ME);
    setTimeout(() => this.onclose?.(null));
  }

  /** Replies arrive asynchronously, in order, like messages from a real relay. */
  private deliver(out: Outgoing[]) {
    for (const o of out) {
      if (o.to !== "all" && o.to !== ME) continue;
      const data = JSON.stringify(o.msg);
      setTimeout(() => {
        if (this.readyState === WebSocket.OPEN) this.onmessage?.({ data });
      });
      if (o.close) this.close();
    }
  }
}
