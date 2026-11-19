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
import { CameraRig } from "./camera";
import { KeyboardSource, installKeyboard } from "./input";
import { FinalKoReplay, History } from "./koReplay";
import { NetClient } from "./net/client";
import { OnlineSession } from "./net/onlineSession";
import { loadParams } from "./panel";
import { Renderer } from "./render";
import { LiveSession, PlaybackSession, type InputSource, type Session } from "./session";
import type { Params } from "./sim/params";
import type { Recording } from "./sim/recording";
import { DT, type FighterView, type MatchResult, type SimEvent } from "./sim/sim";
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
}

/** Presentation settings (the debug panel's "Juice" section edits these). */
export interface GameSettings {
  debug: boolean;
  cameraFollow: boolean;
  shakeScale: number;
  finalKoReplay: boolean;
}

const KEYS = ["←/→ rotate, ↓ charge", "A/D rotate, S charge"]; // by keyboard binding

export class Game {
  readonly params: Params = loadParams();
  readonly settings: GameSettings = { debug: false, cameraFollow: true, shakeScale: 1, finalKoReplay: true };
  readonly net = new NetClient();
  playerName = "player";

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

  private state: GameState = { mode: "attract", paused: false, ended: false, winnerName: null };
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
    this.begin("attract", new LiveSession(stage, this.params, { players: 4, stocks: 2 }, sources), ["", "", "", ""]);
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
        sources.push(new KeyboardSource(i));
        names.push(i === 0 ? this.playerName : "player 2");
      } else {
        sources.push(this.bot(i, reaction));
        names.push(`bot ${i - humans + 1}`);
      }
    }
    const stage = stageById(setup.stageId).stage;
    this.begin("local", new LiveSession(stage, this.params, { players, stocks: setup.stocks }, sources), names);
  }

  /** Same local setup again (R, or "play again"). */
  playAgain() {
    this.playLocal(this.localSetup);
  }

  /** For tests and the console: the running match at a glance. */
  get info() {
    const sim = this.session.sim;
    return { mode: this.state.mode, tick: sim.tick, players: sim.match.players, stocks: sim.match.stocks, platforms: sim.stage.platforms.length };
  }

  get lastLocalSetup(): LocalSetup {
    return this.localSetup;
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
    this.begin("replay", new PlaybackSession(recording), []);
  }

  /** "Last match" = the most recently ended one (falls back to the current one). */
  latestRecording(): Recording | null {
    return this.lastRecording ?? (this.state.mode === "attract" ? null : this.session.recording());
  }

  // ---- internals ---------------------------------------------------------------

  private bot(i: number, reaction: number): BotSource {
    const bot = new HeuristicBot(i, { ...DEFAULT_BOT, reactionTicks: reaction, seed: this.matchNumber * 4 + i + 1 });
    return new BotSource(bot, this.params);
  }

  private update(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Swap in a new session and reset everything that follows it. */
  private begin(mode: GameMode, next: Session, names: string[]) {
    if (this.session && this.state.mode !== "attract") this.lastRecording = this.session.recording() ?? this.lastRecording;
    this.session?.free();
    this.session = next;
    this.names = names;
    this.matchNumber++;
    this.curr = next.sim.view();
    this.prev = this.curr;
    this.history.clear();
    this.koReplay = null;
    this.camera.setStage(next.sim.stage);
    this.smoother.reset();
    this.attractRestartAt = 0;
    this.update({ mode, paused: false, ended: false, winnerName: null });
  }

  private wireNet() {
    const net = this.net;
    // The relay started a match: play it as an OnlineSession, driven by its stream.
    // Online, you always use the arrow keys, whichever fighter you are. If you
    // host, your browser also drives the room's bots.
    net.onStart = (setup, you, drive) => {
      const names = Array.from({ length: setup.match.players }, (_, i) => net.nameOf(i));
      const sources = new Map<number, InputSource>([[you, new KeyboardSource(0)]]);
      for (const f of drive) {
        if (f === you) continue;
        const bot = new HeuristicBot(f, { ...DEFAULT_BOT, seed: this.matchNumber * 4 + f + 1 });
        sources.set(f, new BotSource(bot, setup.params));
      }
      this.begin("online", new OnlineSession(setup, you, names, sources, net, net.room, () => net.rttMs), names);
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
      else if (e.type === "ko") {
        this.camera.shake(0.6);
        if (e.final) final = true;
      }
    }
    return final;
  }

  private startKoReplay() {
    const sim = this.session.sim;
    const loser = sim.events.find((e) => e.type === "ko" && e.final);
    if (!sim.result.over || !loser || loser.type !== "ko") return;
    this.koReplay = new FinalKoReplay(this.history.snapshot(), loser.fighter);
  }

  /** Once the match is decided and its replay is done: tell the menus (or restart the backdrop). */
  private checkEnded(now: number) {
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

  private controlHints(): string[] {
    const s = this.session;
    if (s instanceof OnlineSession) return [`you (P${s.you + 1}): ${KEYS[0]}`];
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
        if (this.handleEvents(sim.events) && this.settings.finalKoReplay) {
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
    const cam = this.camera.update(inFrame, dt, this.renderer.aspect(), { follow: s.cameraFollow, shakeScale: s.shakeScale });
    const players = Array.from({ length: sim.match.players }, (_, i) => i);
    const hud = this.state.mode !== "attract";
    this.renderer.draw(sim.stage, cam, shown.prev, shown.curr, shown.alpha, sim.result, {
      hud,
      replay: this.koReplay !== null,
      debug: s.debug,
      labels: players.map((i) => session.describe(i)),
      names: players.map((i) => this.names[i] ?? `P${i + 1}`),
      controls: hud && !this.state.ended ? this.controlHints() : [],
      totalStocks: sim.match.stocks,
      status: session.status(),
    });
  }
}
