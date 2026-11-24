// Browser side of the relay connection: one WebSocket to a room, the lobby
// state, and the official tick stream. main.ts forwards ticks to the
// OnlineSession, which uses this as its MatchTransport.

import { decodeInput } from "../sim/inputCodec";
import type { Input } from "../sim/types";
import type { FighterShape } from "../sim/geometry";
import type { MatchTransport } from "./onlineSession";
import { LoopbackSocket, type SocketLike } from "./loopback";
import {
  DEFAULT_ROOM_SETTINGS,
  PROTOCOL_VERSION,
  type BotLevel,
  type ClientMsg,
  type MatchSetup,
  type RoomSettings,
  type RosterEntry,
  type ServerMsg,
} from "./protocol";

/**
 * Where the relay lives. A deployed game is served by the same Worker as the
 * relay, so it's this page's own address. In dev (`npm run dev`), it's
 * `npm run relay` on this machine. VITE_RELAY_URL overrides both.
 */
export const RELAY_URL: string =
  import.meta.env.VITE_RELAY_URL ??
  (import.meta.env.DEV || typeof location === "undefined" ? "ws://localhost:8787" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

export type NetPhase = "offline" | "connecting" | "lobby" | "match";

/** A room to set up when creating it: its settings and bots (your last setup, remembered). */
export interface RoomSetup {
  settings: RoomSettings;
  bots: BotLevel[];
}

export class NetClient implements MatchTransport {
  phase: NetPhase = "offline";
  room = "";
  slot: number | null = null;
  roster: RosterEntry[] = [];
  spectators: string[] = [];
  settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };
  /** My fighter shape (null = standard), sent after joining and whenever it changes. */
  shape: FighterShape | null = null;
  /** My eye style, sent after joining and whenever it changes. */
  eyes = 0;
  /** The color I'd like (granted if free), sent after joining and whenever it changes. */
  color: number | null = null;
  rttMs: number | null = null;
  error: string | null = null;
  /** The room is on this machine (the relay couldn't be reached): nobody else can join. */
  local = false;
  /** During a match: my fighter index, and the latest official step and inputs. */
  you: number | null = null;
  setup: MatchSetup | null = null;
  lastStep = -1;
  inputs: string[] = [];

  /** Called when a match starts, and for every official step. */
  onStart?: (setup: MatchSetup, you: number, drive: number[]) => void;
  onTick?: (t: number, changes: [number, string][]) => void;
  onDesync?: (step: number) => void;
  /** The host ended the match (back to the lobby). */
  onLobby?: () => void;
  /** You joined mid-match (or the room was full): watch, after catching up on `log`. */
  onSpectate?: (setup: MatchSetup, names: string[], log: [number, [number, string][]][], next: number) => void;
  /** Mid-match: start driving these fighters too (bots inherited when the host left). */
  onDrive?: (fighters: number[]) => void;
  /** During a match: the lobby slot of each fighter. */
  fighters: number[] = [];

  private ws: SocketLike | null = null;
  /** Creating a room: set it up like this once we're in (see handle "roster"). */
  private createWith: RoomSetup | null = null;
  private listeners = new Set<(c: NetClient) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSent = new Map<number, number>();
  private pingId = 0;
  private onVisible: (() => void) | null = null;

  /** Svelte-store-compatible: call `fn` now and whenever anything changes. */
  subscribe(fn: (c: NetClient) => void): () => void {
    this.listeners.add(fn);
    fn(this);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn(this);
  }

  get isHost(): boolean {
    return this.roster.find((p) => p.slot === this.slot)?.host ?? false;
  }

  /**
   * Join room `room` on the relay. With `create`, it's a new room: set it up
   * like that once in, and if the relay can't be reached, open it on this
   * machine instead (bots only).
   */
  connect(room: string, name: string, create?: RoomSetup) {
    this.open(room, name, new WebSocket(`${RELAY_URL}/api/room/${room}/ws`), create ?? null);
  }

  private open(room: string, name: string, ws: SocketLike, create: RoomSetup | null) {
    this.leave();
    this.phase = "connecting";
    this.room = room;
    this.error = null;
    this.local = ws instanceof LoopbackSocket;
    this.createWith = create;
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: "hello", version: PROTOCOL_VERSION, name });
      if (this.shape) this.send({ type: "shape", shape: this.shape });
      if (this.eyes) this.send({ type: "eyes", eyes: this.eyes });
      if (this.color !== null) this.send({ type: "color", color: this.color });
      this.pingTimer = setInterval(() => this.ping(), 1000);
      // Measure right away (a few quick pings): the match's input delay is picked
      // from the ping when it starts, and that can be soon after joining.
      for (const ms of [0, 200, 400]) setTimeout(() => this.ws === ws && this.ping(), ms);
      // Back from a hidden tab: forget pings sent before it slept, and measure afresh.
      this.onVisible ??= () => {
        if (document.hidden) return;
        this.pingSent.clear();
        this.ping();
      };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
    };
    ws.onmessage = (e: { data: unknown }) =>
      this.fakeLag.down(() => {
        if (this.ws !== ws) return;
        this.handle(JSON.parse(String(e.data)) as ServerMsg);
        this.notify();
      });
    ws.onclose = () => {
      if (this.ws !== ws) return; // a newer connection replaced this one
      this.cleanup();
      if (!this.error) this.error = "disconnected from the room";
      this.notify();
    };
    ws.onerror = () => {
      if (this.phase === "connecting" && create && !this.local) {
        // No relay: the room opens on this machine instead.
        this.open(room, name, new LoopbackSocket(room), create);
        return;
      }
      if (this.phase === "connecting") this.error = `couldn't reach the relay at ${RELAY_URL}`;
      this.notify();
    };
    this.notify();
  }

  leave() {
    const ws = this.ws;
    this.cleanup();
    ws?.close();
    this.notify();
  }

  /** Host, in the lobby: change the room's settings. */
  setSettings(settings: RoomSettings) {
    this.send({ type: "settings", settings });
  }

  /** Ask for a color (sent now if connected, else after joining). */
  setColor(color: number) {
    this.color = color;
    this.send({ type: "color", color });
  }

  /** Change my eye style (sent now if connected, else after joining). */
  setEyes(eyes: number) {
    this.eyes = eyes;
    this.send({ type: "eyes", eyes });
  }

  /** Change my fighter shape (sent now if connected, else after joining). */
  setShape(shape: FighterShape | null) {
    this.shape = shape;
    this.send({ type: "shape", shape });
  }

  /** Host: remove the player (or bot) in `slot`. */
  kick(slot: number) {
    this.send({ type: "kick", slot });
  }

  /** Host: start a match with everyone in the room. */
  start(setup: MatchSetup) {
    this.send({ type: "start", setup });
  }

  /** Host: end the match. */
  backToLobby() {
    this.send({ type: "lobby" });
  }

  /** An input for `fighter` (mine, or a bot I drive) from step `tick` on. Only call when it changes. */
  sendInput(tick: number, input: string, fighter: number) {
    this.send({ type: "input", tick, input, fighter });
  }

  /** Host, in the lobby: add a bot (in `slot`, if given). Remove one with kick(). */
  addBot(slot?: number, level: BotLevel = "normal") {
    this.send({ type: "addBot", ...(slot !== undefined && { slot }), level });
  }

  /** Host, in the lobby: change a bot's difficulty. */
  setBotLevel(slot: number, level: BotLevel) {
    this.send({ type: "botLevel", slot, level });
  }

  /** The level of the bot playing fighter `i` this match (normal if unknown). */
  levelOf(i: number): BotLevel {
    return this.roster.find((p) => p.slot === this.fighters[i])?.level ?? "normal";
  }

  /** My state fingerprint after step `step` (the relay compares everyone's). */
  sendHash(step: number, hash: string) {
    this.send({ type: "hash", step, hash });
  }

  /** Display name of fighter `i` in the current match. */
  /** Fighter i's color number (the room keeps them unique). */
  colorOf(i: number): number {
    return this.roster.find((p) => p.slot === this.fighters[i])?.color ?? i;
  }

  eyesOf(i: number): number {
    return this.roster.find((p) => p.slot === this.fighters[i])?.eyes ?? 0;
  }

  nameOf(i: number): string {
    return this.roster.find((p) => p.slot === this.fighters[i])?.name ?? `P${i + 1}`;
  }

  /** The latest official input of fighter `i`. */
  inputOf(i: number): Input | null {
    const c = this.inputs[i];
    return c ? decodeInput(c) : null;
  }

  private handle(m: ServerMsg) {
    switch (m.type) {
      case "welcome":
        this.slot = m.slot;
        this.phase = "lobby";
        break;
      case "roster":
        this.roster = m.players;
        this.spectators = m.spectators;
        this.settings = m.settings;
        // A room we just created (we're alone in it, hosting): set it up.
        if (this.createWith) {
          const setup = this.createWith;
          this.createWith = null;
          if (this.isHost && m.players.length === 1) {
            this.send({ type: "settings", settings: setup.settings });
            for (const level of setup.bots) this.send({ type: "addBot", level });
          }
        }
        break;
      case "spectate":
        this.phase = "match";
        this.setup = m.setup;
        this.you = null;
        this.onSpectate?.(m.setup, m.names, m.log, m.next);
        break;
      case "kicked":
        this.error = "the host removed you from the room";
        break;
      case "start":
        this.phase = "match";
        this.setup = m.setup;
        this.you = m.you;
        this.lastStep = -1;
        this.inputs = m.fighters.map(() => "1");
        this.fighters = m.fighters;
        this.onStart?.(m.setup, m.you, m.drive);
        break;
      case "tick":
        this.lastStep = m.t;
        for (const [f, input] of m.c ?? []) this.inputs[f] = input;
        this.onTick?.(m.t, m.c ?? []);
        break;
      case "lobby":
        this.phase = "lobby";
        this.you = null;
        this.setup = null;
        this.onLobby?.();
        break;
      case "pong": {
        let sent = this.pingSent.get(m.id);
        this.pingSent.delete(m.id);
        if (typeof document !== "undefined" && document.hidden) sent = undefined; // timed while asleep: ignore
        if (sent !== undefined && performance.now() - sent > 3000) sent = undefined; // stale (sent before a sleep)
        // Smoothed (a moving average), so one slow ping doesn't swing how far
        // ahead the match runs (OnlineSession) or the ping shown in the room.
        if (sent !== undefined) {
          const sample = performance.now() - sent;
          this.rttMs = this.rttMs === null ? sample : this.rttMs + (sample - this.rttMs) * 0.25;
        }
        break;
      }
      case "desync":
        this.onDesync?.(m.step);
        break;
      case "drive":
        this.onDrive?.(m.fighters);
        break;
      case "error":
        this.error = m.message;
        break;
    }
  }

  private ping() {
    // Hidden tabs handle messages late, so a ping timed there would read as a
    // round trip of seconds and swing how far ahead the match runs.
    if (typeof document !== "undefined" && document.hidden) return;
    const id = ++this.pingId;
    this.pingSent.set(id, performance.now());
    this.send({ type: "ping", id });
  }

  private send(m: ClientMsg) {
    const ws = this.ws;
    const text = JSON.stringify(m);
    this.fakeLag.up(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(text);
    });
  }

  /** Testing: ?lag=MS (one way, each direction) and &jitter=MS add a fake delay to every message. */
  private fakeLag = FakeLag.fromUrl();

  private cleanup() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.onVisible && typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
    this.pingSent.clear();
    this.ws = null;
    this.phase = "offline";
    this.slot = null;
    this.roster = [];
    this.spectators = [];
    this.you = null;
    this.setup = null;
    this.lastStep = -1;
    this.rttMs = null;
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
    this.createWith = null;
    this.local = false;
  }
}

/**
 * A fake network delay for testing online play on localhost: each message
 * waits `lag` ms plus up to `jitter` ms, in order (like a real WebSocket: a
 * delayed message holds up the ones behind it).
 */
class FakeLag {
  private queues = { up: [] as { at: number; fn: () => void }[], down: [] as { at: number; fn: () => void }[] };
  constructor(
    private lag: number,
    private jitter: number,
  ) {}
  static fromUrl(): FakeLag {
    const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
    return new FakeLag(Math.max(0, Number(q.get("lag")) || 0), Math.max(0, Number(q.get("jitter")) || 0));
  }
  get active() {
    return this.lag > 0 || this.jitter > 0;
  }
  up(fn: () => void) {
    this.push("up", fn);
  }
  down(fn: () => void) {
    this.push("down", fn);
  }
  /** One queue per direction, delivered strictly in order (separate timers could fire out of order). */
  private push(dir: "up" | "down", fn: () => void) {
    if (!this.active) return fn();
    const q = this.queues[dir];
    const at = Math.max(performance.now() + this.lag + Math.random() * this.jitter, q.at(-1)?.at ?? 0);
    q.push({ at, fn });
    if (q.length === 1) this.drain(dir);
  }
  private drain(dir: "up" | "down") {
    const q = this.queues[dir];
    while (q.length && q[0].at <= performance.now()) q.shift()!.fn();
    if (q.length) setTimeout(() => this.drain(dir), q[0].at - performance.now());
  }
}
