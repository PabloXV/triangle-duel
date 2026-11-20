// The game: owns the canvas loop and whatever is being played, and exposes a
// small API for the menus (src/ui/*.svelte). The loop drives a Session (local,
// online, playback, see session.ts) and feeds the presentation: camera, shake,
// the final-KO replay, rollback smoothing, and the renderer.
//
// Modes:
//   attract  a bot match playing behind the menus
//   local    a match on this machine (you, maybe a 2nd keyboard player, bots)
//   online   a match through the relay (OnlineSession)
//   replay   watching a recording

import { BotSource, DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { randomBotShape } from "./bots/shapes";
import { CameraRig, type CameraView } from "./camera";
import { KeyboardSource, installKeyboard, isTouchDevice } from "./input";
import { FinalKoReplay, History } from "./koReplay";
import { NetClient } from "./net/client";
import { OnlineSession } from "./net/onlineSession";
import { loadParams } from "./panel";
import { COLORS, Renderer } from "./render";
import { EYE_STYLES, eyeStyle } from "./look/eyes";
import { facesReady, preloadFaces } from "./look/sticker";
import { LiveSession, PlaybackSession, type InputSource, type Session } from "./session";
import type { FighterShape } from "./sim/geometry";
import type { Params } from "./sim/params";
import type { Recording } from "./sim/recording";
import { DEFAULT_MATCH, DT, type FighterView, type MatchResult, type SimEvent } from "./sim/sim";
import { CorrectionSmoother } from "./smoothing";
import { STAGES, stageById } from "./stages";

export type GameMode = "attract" | "local" | "online" | "replay";
export type BotLevel = "easy" | "normal" | "hard";

/** Bot reaction delay (ticks) per difficulty. */
const BOT_REACTION: Record<BotLevel, number> = { easy: 24, normal: 12, hard: 4 };

export interface LocalSetup {
  stageId: string;
  bots: number; // 1–3 (fewer if a second player joins)
  stocks: number;
  botLevel: BotLevel;
  secondPlayer: boolean; // a 2nd human on the same keyboard (A/D/S)
}

export const DEFAULT_LOCAL_SETUP: LocalSetup = { stageId: STAGES[0].id, bots: 1, stocks: 3, botLevel: "normal", secondPlayer: false };

/** What the menus need to know. */
export interface GameState {
  mode: GameMode;
  paused: boolean;
  /** The match is decided and its final-KO replay (if any) has finished: show end-of-match options. */
  ended: boolean;
  winnerName: string | null; // null = draw (when ended)
  /** A short message to show, e.g. "Bo left the match". */
  notice: string | null;
  /** The fighter this screen controls (null: watching: menus backdrop, replay, spectating). */
  me: number | null;
}

/** Presentation settings (the debug panel's "Juice" section edits these). */
export interface GameSettings {
  debug: boolean;
  cameraFollow: boolean;
  shakeScale: number;
  finalKoReplay: boolean;
}

const KEYS = ["←/→ rotate, ↓ charge", "A/D rotate, S charge"]; // by keyboard binding
/** After an online match ends, how long the winner shows before everyone returns to the room. */
const BACK_TO_ROOM_MS = 3500;

export class Game {
  readonly params: Params = loadParams();
  readonly settings: GameSettings = { debug: false, cameraFollow: true, shakeScale: 1, finalKoReplay: true };
  readonly net = new NetClient();
  playerName = "player";
  /** My custom fighter (balanced unit-area shape), or null for the standard one. */
  playerShape: FighterShape | null = null;
  /** My eye style (an index into EYE_STYLES). */
  playerEyes = 0;
  /** Each fighter's eye style, this match. */
  private eyes: number[] = [];

  private renderer: Renderer;
  private camera = new CameraRig(STAGES[0].stage);
  private history = new History();
  private smoother = new CorrectionSmoother();
  private session!: Session;
  private names: string[] = [];
  private prev: FighterView[] = [];
  private curr: FighterView[] = [];
  private koReplay: FinalKoReplay | null = null;
  private lastRecording: Recording | null = null;
  private matchNumber = 0;
  private localSetup: LocalSetup = DEFAULT_LOCAL_SETUP;
  private attractRestartAt = 0; // when the attract match should restart (ms), after it ends
  private backToRoomAt = 0; // host: when to send the room back to the lobby after an online match (ms)

  private state: GameState = { mode: "attract", paused: false, ended: false, winnerName: null, notice: null, me: null };
  private noticeUntil = 0;
  private announcedLeaves = new Set<number>(); // fighters whose leaving we've announced this match
  private onlineParams: Params | null = null; // the current online match's params (for inherited bots)
  private listeners = new Set<(s: GameState) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.wireNet();
    installKeyboard((code) => {
      if (code === "KeyR" && this.state.mode === "local") this.playAgain();
    });
    this.attract();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- API for the menus -------------------------------------------------------

  get current(): GameState {
    return this.state;
  }

  /** Svelte-store-compatible: call `fn` now and on every change. */
  subscribe(fn: (s: GameState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** A bot match behind the menus. */
  attract() {
    const stage = STAGES[this.matchNumber % STAGES.length].stage;
    const sources = [0, 1, 2, 3].map((i) => this.bot(i, 12));
    const shapes = sources.map(() => randomBotShape(Math.random));
    const eyes = sources.map(() => randomEyes());
    this.begin("attract", new LiveSession(stage, this.params, { players: 4, stocks: 2, shapes }, sources), ["", "", "", ""], eyes);
  }

  playLocal(setup: LocalSetup) {
    this.localSetup = setup;
    const reaction = BOT_REACTION[setup.botLevel];
    const humans = setup.secondPlayer ? 2 : 1;
    const players = humans + setup.bots;
    const sources: InputSource[] = [];
    const names: string[] = [];
    for (let i = 0; i < players; i++) {
      if (i < humans) {
        sources.push(new KeyboardSource(i, i));
        names.push(i === 0 ? this.playerName : "player 2");
      } else {
        sources.push(this.bot(i, reaction));
        names.push(`bot ${i - humans + 1}`);
      }
    }
    const stage = stageById(setup.stageId).stage;
    // My custom shape for me; a 2nd local player is standard; bots get random
    // shapes near the standard one (fresh each match).
    const shapes = Array.from({ length: players }, (_, i) => (i === 0 ? this.playerShape : i < humans ? null : randomBotShape(Math.random)));
    // My eyes for me; a 2nd local player gets the default; bots, random ones.
    const eyes = Array.from({ length: players }, (_, i) => (i === 0 ? this.playerEyes : i < humans ? 0 : randomEyes()));
    this.begin("local", new LiveSession(stage, this.params, { players, stocks: setup.stocks, shapes }, sources), names, eyes);
  }

  /** Same local setup again (R, or "play again"). */
  playAgain() {
    this.playLocal(this.localSetup);
  }

  /** For tests and the console: the running match at a glance. */
  get info() {
    const sim = this.session.sim;
    return {
      mode: this.state.mode,
      tick: sim.tick,
      players: sim.match.players,
      stocks: sim.match.stocks,
      platforms: sim.stage.platforms.length,
      eliminated: sim.view().map((f) => f.eliminated),
      me: this.state.me,
      angles: sim.view().map((f) => f.angle),
      ko: sim.view().map((f) => f.ko),
      lives: sim.view().map((f) => f.stocks),
      eyes: this.eyes,
      facesReady: facesReady(),
      grounded: sim.view().map((f) => f.grounded),
      lastInputs: (this.session as { lastInputs?: unknown }).lastInputs ?? null,
      charge: sim.view().map((f) => f.charge),
      positions: sim.view().map((f) => ({ x: f.x, y: f.y, vx: f.vx })),
      camera: this.lastCamera,
      canvas: { width: this.renderer.canvasSize().width, height: this.renderer.canvasSize().height },
      // Each fighter's shape at a glance: height, width, area (= mass, since density is shared).
      shapes: sim.view().map((f) => {
        const xs = f.vertices.map((v) => v.x);
        const ys = f.vertices.map((v) => v.y);
        const [a, b, c] = f.vertices;
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
        return { height: Math.max(...ys) - Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), area };
      }),
      status: this.session.status(),
    };
  }

  get lastLocalSetup(): LocalSetup {
    return this.localSetup;
  }

  /** Host: start an online match with everyone in the room, using the room's settings. */
  startOnline() {
    const net = this.net;
    if (!net.isHost) return;
    // Everyone's shape, as the relay knows it (validated there; bots' picked by the relay).
    const shapes = net.roster.map((p) => p.shape);
    const match = { ...DEFAULT_MATCH, players: net.roster.length, stocks: net.settings.stocks, shapes };
    net.start({ stage: stageById(net.settings.stageId).stage, match, params: structuredClone(this.params) });
  }

  /** Set my eye style (src/look/eyes.ts); also tells the room if I'm in one. */
  setPlayerEyes(eyes: number) {
    this.playerEyes = eyeStyle(eyes);
    this.net.setEyes(this.playerEyes);
  }

  /** Set my fighter shape (null = standard); also tells the room if I'm in one. */
  setPlayerShape(shape: FighterShape | null) {
    this.playerShape = shape;
    this.net.setShape(shape);
  }

  /** Pause a local match (online matches can't pause). */
  setPaused(paused: boolean) {
    if (this.state.mode !== "local" && this.state.mode !== "replay") paused = false;
    this.update({ paused });
  }

  /** Leave whatever is playing and go back to the menu backdrop. */
  leaveToMenu() {
    if (this.state.mode === "online") this.net.leave();
    this.attract();
  }

  watch(recording: Recording) {
    this.begin("replay", new PlaybackSession(recording), [], []);
  }

  /** "Last match" = the most recently ended one (falls back to the current one). */
  latestRecording(): Recording | null {
    return this.lastRecording ?? (this.state.mode === "attract" ? null : this.session.recording());
  }

  // ---- internals ---------------------------------------------------------------

  /**
   * Test switch: with ?bots=still, local bots give no input (they just hop in
   * place), so browser tests get a predictable opponent.
   */
  private readonly stillBots = new URLSearchParams(location.search).get("bots") === "still";

  private bot(i: number, reaction: number): InputSource {
    if (this.stillBots) return { isHuman: false, describe: () => "bot (still)", next: () => ({ turn: 0, charge: false }) };
    const bot = new HeuristicBot(i, { ...DEFAULT_BOT, reactionTicks: reaction, seed: this.matchNumber * 4 + i + 1 });
    return new BotSource(bot, this.params);
  }

  private update(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Swap in a new session and reset everything that follows it. */
  private begin(mode: GameMode, next: Session, names: string[], eyes: number[]) {
    if (this.session && this.state.mode !== "attract") this.lastRecording = this.session.recording() ?? this.lastRecording;
    this.session?.free();
    this.session = next;
    this.names = names;
    this.eyes = eyes;
    preloadFaces(eyes.map((e, i) => ({ eyes: e, color: COLORS[i % COLORS.length] })));
    this.matchNumber++;
    this.curr = next.sim.view();
    this.prev = this.curr;
    this.history.clear();
    this.koReplay = null;
    this.camera.setStage(next.sim.stage);
    this.smoother.reset();
    this.attractRestartAt = 0;
    this.announcedLeaves.clear();
    this.backToRoomAt = 0;
    const me = mode === "local" ? 0 : next instanceof OnlineSession && !next.spectating ? next.you : null;
    this.update({ mode, paused: false, ended: false, winnerName: null, notice: null, me });
  }

  private wireNet() {
    const net = this.net;
    // The relay started a match: play it as an OnlineSession, driven by its stream.
    // Online, you always use the arrow keys, whichever fighter you are. If you
    // host, your browser also drives the room's bots.
    net.onStart = (setup, you, drive) => {
      const names = Array.from({ length: setup.match.players }, (_, i) => net.nameOf(i));
      const sources = new Map<number, InputSource>([[you, new KeyboardSource(0, you)]]);
      for (const f of drive) {
        if (f === you) continue;
        const bot = new HeuristicBot(f, { ...DEFAULT_BOT, seed: this.matchNumber * 4 + f + 1 });
        sources.set(f, new BotSource(bot, setup.params));
      }
      this.onlineParams = setup.params;
      const eyes = Array.from({ length: setup.match.players }, (_, i) => net.eyesOf(i));
      this.begin("online", new OnlineSession(setup, you, names, sources, net, net.room, () => net.rttMs), names, eyes);
    };
    // Joined mid-match (or waiting in a full room): watch, caught up to now.
    net.onSpectate = (setup, names, log, next) => {
      const s = new OnlineSession(setup, -1, names, new Map(), net, net.room, () => net.rttMs);
      s.catchUp(log, next);
      this.begin("online", s, names, names.map((_, i) => net.eyesOf(i)));
    };
    // The host left mid-match and we're the new host: run their bots from now on.
    net.onDrive = (fighters) => {
      const s = this.session;
      if (!(s instanceof OnlineSession) || !this.onlineParams) return;
      for (const f of fighters) {
        const bot = new HeuristicBot(f, { ...DEFAULT_BOT, seed: this.matchNumber * 4 + f + 1 });
        s.takeOver(f, new BotSource(bot, this.onlineParams));
      }
    };
    net.onTick = (t, changes) => {
      if (this.session instanceof OnlineSession) this.session.receiveTick(t, changes);
    };
    net.onDesync = (step) => {
      if (this.session instanceof OnlineSession) this.session.receiveDesync(step);
    };
    net.onLobby = () => {
      if (this.session instanceof OnlineSession) this.attract(); // host ended the match
    };
  }

  /** Map a contact force (N) to shake trauma. Measured in bot matches: median
   *  contact peaks ~39 N, top 10% > 62 N, top 1% > 126 N. Ordinary bumps barely
   *  register (shake goes with trauma²); only big hits really shake. */
  private handleEvents(events: SimEvent[]): boolean {
    let final = false;
    for (const e of events) {
      if (e.type === "impact") this.camera.shake(Math.min(1, Math.max(0, (e.force - 30) / 100)));
      else if (e.type === "ko" && e.reason === "left") {
        // Someone left: say so, once. (No shake, and no final-KO replay: nothing to replay.)
        if (this.announcedLeaves.has(e.fighter)) continue;
        this.announcedLeaves.add(e.fighter);
        this.notify(`${this.names[e.fighter] ?? `P${e.fighter + 1}`} left the match`);
      } else if (e.type === "ko") {
        this.camera.shake(0.6);
        if (e.fighter === this.state.me) navigator.vibrate?.(80); // a buzz when you're KO'd (where supported)
        if (e.final) final = true;
      }
    }
    return final;
  }

  private notify(message: string) {
    this.noticeUntil = performance.now() + 3000;
    this.update({ notice: message });
  }

  private startKoReplay() {
    const sim = this.session.sim;
    const loser = sim.events.find((e) => e.type === "ko" && e.final);
    if (!sim.result.over || !loser || loser.type !== "ko") return;
    this.koReplay = new FinalKoReplay(this.history.snapshot(), loser.fighter);
  }

  /** Once the match is decided and its replay is done: tell the menus (or restart the backdrop). */
  private checkEnded(now: number) {
    if (this.state.notice && now > this.noticeUntil) this.update({ notice: null });
    this.checkBackToRoom(now);
    const result: MatchResult = this.session.sim.result;
    if (!result.over || this.koReplay || this.state.ended) return;
    if (this.state.mode === "attract") {
      this.attractRestartAt ||= now + 2500;
      if (now >= this.attractRestartAt) this.attract();
      return;
    }
    const winnerName = result.winner === null ? null : (this.names[result.winner] ?? `P${result.winner + 1}`);
    this.update({ ended: true, winnerName });
  }

  /**
   * Online, the relay doesn't simulate, so it doesn't know when a match is
   * over. Every client does, identically; the host tells the relay a few
   * seconds after the end (time for the banner), and everyone returns to the
   * room together. Decided on the confirmed timeline: the present can briefly
   * show a win that a rollback undoes.
   */
  private checkBackToRoom(now: number) {
    const s = this.session;
    if (!(s instanceof OnlineSession) || !this.net.isHost || !this.state.ended) return;
    if (!s.confirmedResult.over) return;
    this.backToRoomAt ||= now + BACK_TO_ROOM_MS;
    if (now >= this.backToRoomAt && this.backToRoomAt > 0) {
      this.backToRoomAt = -1; // sent
      this.net.backToLobby();
    }
  }

  private readonly touchScreen = isTouchDevice();
  private lastCamera: CameraView | null = null;

  private controlHints(): string[] {
    const s = this.session;
    // On a touch screen the on-screen buttons are the hint.
    if (this.touchScreen) return s instanceof OnlineSession && s.spectating ? ["spectating"] : [];
    if (s instanceof OnlineSession) return s.spectating ? ["spectating · Esc to leave"] : [`you (P${s.you + 1}): ${KEYS[0]}`];
    const players = Array.from({ length: s.sim.match.players }, (_, i) => i);
    return players.filter((i) => s.isHuman(i)).map((i) => `${this.names[i] ?? `P${i + 1}`}: ${KEYS[i]}`);
  }

  // Fixed timestep: the sim always advances in exact 1/60 s ticks regardless of
  // frame rate. Leftover time carries to the next frame; the renderer
  // interpolates between the last two ticks using that leftover.
  private accumulator = 0;
  private last = performance.now();

  private frame(now: number) {
    // Schedule the next frame first, so an error in this one shows up in the
    // console instead of stopping the game loop for good.
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.last) / 1000, 0.1);
    // Cap the catch-up so a backgrounded tab doesn't simulate seconds at once.
    this.accumulator += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    const session = this.session;
    if (session instanceof OnlineSession && this.net.phase === "offline") session.disconnected = true;
    const sim = session.sim;

    if (this.state.paused) {
      this.accumulator = 0;
    } else if (this.koReplay) {
      // Final-KO replay: the sim is paused; we play back recorded frames.
      this.accumulator = 0;
      const playing = this.koReplay.update(dt);
      if (this.koReplay.hitNow) this.camera.shake(1);
      if (!playing) this.koReplay = null; // done: back to the live view
    } else {
      while (this.accumulator >= DT) {
        if (!session.step()) {
          this.accumulator = 0; // nothing to do (playback finished, or online and waiting for the relay)
          break;
        }
        this.prev = this.curr;
        this.curr = sim.view();
        if (session instanceof OnlineSession) {
          const c = session.takeCorrection();
          if (c) {
            // A rollback replaced the state we were drawing. Glide from the old picture
            // (offset = before - after), and interpolate from the corrected state.
            this.smoother.add(c.before, c.after);
            this.prev = c.after;
          }
        }
        this.history.push({ views: this.curr, events: sim.events });
        this.accumulator -= DT;
        const events = session.takeEvents?.() ?? sim.events;
        if (this.handleEvents(events) && this.settings.finalKoReplay) {
          this.startKoReplay();
          break;
        }
      }
    }
    this.checkEnded(now);

    this.smoother.update(dt);
    // What to show: the KO replay's recorded frames, or the sim (with rollback corrections smoothed).
    const shown = this.koReplay
      ? this.koReplay.current()
      : { prev: this.smoother.apply(this.prev), curr: this.smoother.apply(this.curr), alpha: this.accumulator / DT };
    const inFrame = this.koReplay
      ? this.koReplay.focus.map((i) => shown.curr[i])
      : shown.curr.filter((f) => !f.ko && !f.eliminated);
    const s = this.settings;
    const cam = (this.lastCamera = this.camera.update(inFrame, dt, this.renderer.aspect(), {
      follow: s.cameraFollow,
      shakeScale: s.shakeScale,
      focus: this.state.me !== null && !this.koReplay ? shown.curr[this.state.me] : undefined,
    }));
    const players = Array.from({ length: sim.match.players }, (_, i) => i);
    const hud = this.state.mode !== "attract";
    this.renderer.draw(sim.stage, cam, shown.prev, shown.curr, shown.alpha, sim.result, {
      hud,
      replay: this.koReplay !== null,
      debug: s.debug,
      labels: players.map((i) => session.describe(i)),
      names: players.map((i) => this.names[i] ?? `P${i + 1}`),
      eyes: this.eyes,
      controls: hud && !this.state.ended ? this.controlHints() : [],
      totalStocks: sim.match.stocks,
      status: session.status(),
    });
  }
}

/** A random eye style (bots, the menu backdrop). */
function randomEyes(): number {
  return Math.floor(Math.random() * EYE_STYLES.length);
}
