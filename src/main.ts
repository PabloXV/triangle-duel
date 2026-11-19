// Wires everything together: the fixed-timestep loop drives a Session (live or
// playback, see session.ts) and feeds the presentation: camera, shake, the
// final-KO replay, and the renderer.

import { BotSource, DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { CameraRig } from "./camera";
import { BINDINGS, KeyboardSource, installKeyboard, readInput } from "./input";
import { FinalKoReplay, History } from "./koReplay";
import { NetClient } from "./net/client";
import { ROOM_CODE, randomRoomCode } from "./net/protocol";
import { buildPanel, loadParams, type UiState } from "./panel";
import { Renderer } from "./render";
import { LiveSession, PlaybackSession, type InputSource, type Session } from "./session";
import { WINGS_STAGE } from "./sim/geometry";
import { encodeInput, type Recording } from "./sim/recording";
import { DEFAULT_MATCH, DT, initPhysics, type FighterView, type SimEvent } from "./sim/sim";

await initPhysics();

const params = loadParams();
const ui: UiState = {
  debug: true,
  players: 2,
  stocks: DEFAULT_MATCH.stocks,
  p1: "human",
  p2: "bot",
  botReaction: DEFAULT_BOT.reactionTicks,
  cameraFollow: true,
  shakeScale: 1,
  finalKoReplay: true,
  netName: "player",
  netRoom: "",
  netStatus: "offline",
};
const renderer = new Renderer(document.getElementById("game") as HTMLCanvasElement);
const camera = new CameraRig(WINGS_STAGE);
const history = new History();

let session: Session;
let prev: FighterView[];
let curr: FighterView[];
let koReplay: FinalKoReplay | null = null; // non-null while showing the final-KO replay
let lastRecording: Recording | null = null;
let matchNumber = 0;

// ---- sessions ---------------------------------------------------------------

/** Who controls player i: P1/P2 follow the panel; P3 and P4 are always bots. */
function sourceFor(i: number): InputSource {
  const human = i < BINDINGS.length && (i === 0 ? ui.p1 : ui.p2) === "human";
  if (human) return new KeyboardSource(i);
  // New seed each match so matches differ.
  const bot = new HeuristicBot(i, { ...DEFAULT_BOT, reactionTicks: ui.botReaction, seed: matchNumber * 4 + i + 1 });
  return new BotSource(bot, params);
}

/** Panel changed who controls P1/P2, or the bot settings: apply to the running match. */
function controllersChanged() {
  if (session instanceof LiveSession) {
    for (let i = 0; i < session.sim.match.players; i++) session.setSource(i, sourceFor(i));
  }
}

/** Swap in a new session and reset everything that follows it. */
function begin(next: Session) {
  lastRecording = session?.recording() ?? lastRecording; // keep the outgoing match watchable
  session?.free();
  session = next;
  curr = session.sim.view();
  prev = curr;
  history.clear();
  koReplay = null;
  camera.reset();
}

/** Start a new live match (R). */
function restart() {
  matchNumber++;
  // The only place the panel's player count is read: the slider changes
  // ui.players while you drag it, and a running match must not see that.
  const players = ui.players;
  const sources = Array.from({ length: players }, (_, i) => sourceFor(i));
  begin(new LiveSession(WINGS_STAGE, params, { players, stocks: ui.stocks }, sources));
}

function watch(recording: Recording) {
  begin(new PlaybackSession(recording));
}

/** The current match if it has a recording (works mid-match), else the previous one. */
function latestRecording(): Recording | null {
  return session.recording() ?? lastRecording;
}

function watchLast() {
  const rec = latestRecording();
  if (rec) watch(rec);
}

function downloadLast() {
  const rec = latestRecording();
  if (!rec) return;
  const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `triangle-duel-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      watch(JSON.parse(await file.text()) as Recording);
    } catch (err) {
      alert(`Couldn't load that recording: ${err instanceof Error ? err.message : err}`);
    }
  };
  input.click();
}

// ---- online (C1: lobby + the official input stream; C2 will play the match) ----

const net = new NetClient();
/** Schedule my inputs this many steps ahead of the relay's clock (~50 ms). */
const INPUT_LEAD = 3;
let lastSentInput = "";

function netJoin(code = ui.netRoom.trim().toUpperCase()) {
  if (!ROOM_CODE.test(code)) {
    ui.netStatus = "room codes are 4 letters (no I, L or O)";
    return;
  }
  ui.netRoom = code;
  net.connect(code, ui.netName);
}

function netStart() {
  if (!net.isHost) {
    ui.netStatus = "only the host can start";
    return;
  }
  const match = { ...DEFAULT_MATCH, players: net.roster.length, stocks: ui.stocks };
  net.start({ stage: WINGS_STAGE, match, params: structuredClone(params) });
}

net.onStart = () => (lastSentInput = "");

/** During an online match: send P1's keys (arrows) to the relay when they change. */
function pumpNetInput() {
  if (net.phase !== "match") return;
  const code = encodeInput(readInput(0));
  if (code === lastSentInput) return;
  lastSentInput = code;
  net.sendInput(net.lastStep + 1 + INPUT_LEAD, code);
}

const ARROWS = ["←", "", "→"];
function netStatusLine(): string | undefined {
  if (net.phase === "offline") return net.error ? `ONLINE — ${net.error}` : undefined;
  const ping = net.rttMs === null ? "" : ` · ping ${Math.round(net.rttMs)} ms`;
  if (net.phase === "connecting") return `ONLINE ${net.room} — connecting…`;
  if (net.phase === "lobby") {
    const names = net.roster.map((p) => p.name + (p.host ? "*" : "") + (p.slot === net.slot ? " (you)" : "")).join(", ");
    return `ONLINE ${net.room} — lobby: ${names}${ping}`;
  }
  const inputs = net.inputs
    .map((_, i) => {
      const inp = net.inputOf(i)!;
      const keys = ARROWS[inp.turn + 1] + (inp.charge ? "↓" : "");
      return `P${i + 1}${i === net.you ? "(you)" : ""} ${keys || "·"}`;
    })
    .join("  ");
  return `ONLINE ${net.room} — step ${net.lastStep} — ${inputs}${ping}`;
}

// ---- presentation reacting to the sim ---------------------------------------

/** Map a contact force (N) to shake trauma. Measured in bot matches: median
 *  contact peaks ~39 N, top 10% > 62 N, top 1% > 126 N. Ordinary bumps barely
 *  register (shake goes with trauma²); only big hits really shake. */
const impactShake = (force: number) => Math.min(1, Math.max(0, (force - 30) / 100));

/** React to what happened this tick. Returns true if the final KO just happened. */
function handleEvents(events: SimEvent[]): boolean {
  let final = false;
  for (const e of events) {
    if (e.type === "impact") camera.shake(impactShake(e.force));
    else if (e.type === "ko") {
      camera.shake(0.6);
      if (e.final) final = true;
    }
  }
  return final;
}

function startKoReplay() {
  const sim = session.sim;
  const loser = sim.events.find((e) => e.type === "ko" && e.final);
  if (!sim.result.over || !loser || loser.type !== "ko") return;
  koReplay = new FinalKoReplay(history.snapshot(), loser.fighter);
}

// ---- wiring --------------------------------------------------------------

restart();
buildPanel(params, ui, {
  restart,
  controllersChanged,
  watchLast,
  downloadLast,
  loadFile,
  netCreate: () => netJoin(randomRoomCode()),
  netJoin: () => netJoin(),
  netStart,
  netLobby: () => net.backToLobby(),
  netLeave: () => net.leave(),
});
installKeyboard((code) => {
  if (code === "KeyR") restart();
});

// Fixed timestep: the sim always advances in exact 1/60 s ticks regardless of
// frame rate. Leftover time carries to the next frame; the renderer
// interpolates between the last two ticks using that leftover.
let accumulator = 0;
let last = performance.now();
let lastFrame = performance.now();

function frame(now: number) {
  // Schedule the next frame first, so an error in this one shows up in the
  // console instead of stopping the game loop for good.
  requestAnimationFrame(frame);
  // Cap the catch-up so a backgrounded tab doesn't simulate seconds at once.
  accumulator += Math.min((now - last) / 1000, 0.25);
  last = now;
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  pumpNetInput();
  const netLine = netStatusLine();
  ui.netStatus = net.error ?? net.phase;
  const sim = session.sim;

  if (koReplay) {
    // Final-KO replay: the sim is paused; we play back recorded frames.
    accumulator = 0;
    const playing = koReplay.update(dt);
    if (koReplay.hitNow) camera.shake(1);
    if (!playing) koReplay = null; // done: back to the live view, banner shows
  } else {
    while (accumulator >= DT) {
      if (!session.step()) {
        accumulator = 0; // nothing to do (finished playback): hold the last frame
        break;
      }
      prev = curr;
      curr = sim.view();
      history.push({ views: curr, events: sim.events });
      accumulator -= DT;
      if (handleEvents(sim.events) && ui.finalKoReplay) {
        startKoReplay();
        break;
      }
    }
  }

  // What to show: the KO replay's recorded frames, or the sim.
  const shown = koReplay ? koReplay.current() : { prev, curr, alpha: accumulator / DT };
  const inFrame = koReplay
    ? koReplay.focus.map((i) => shown.curr[i])
    : shown.curr.filter((f) => !f.ko && !f.eliminated);
  const cam = camera.update(inFrame, dt, renderer.aspect(), { follow: ui.cameraFollow, shakeScale: ui.shakeScale });
  const players = Array.from({ length: sim.match.players }, (_, i) => i);
  renderer.draw(sim.stage, cam, shown.prev, shown.curr, shown.alpha, sim.result, {
    replay: koReplay !== null,
    debug: ui.debug,
    labels: players.map((i) => session.describe(i)),
    humans: players.map((i) => session.isHuman(i)),
    totalStocks: sim.match.stocks,
    status: session.status() ?? netLine,
  });
}
requestAnimationFrame(frame);
