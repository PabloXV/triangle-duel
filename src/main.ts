// Wires everything together: fixed-timestep loop, input, sim, renderer, panel.
//
// Two modes:
//   live      a match being played (keyboard + bots), recorded as it goes
//   playback  a recorded match played back exactly (from "watch last match" or a file)
// Both feed the same camera, shake, and final-KO replay.

import { DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { CameraRig } from "./camera";
import { BINDINGS, installKeyboard, readInput } from "./input";
import { FinalKoReplay, History } from "./koReplay";
import { buildPanel, loadParams, type UiState } from "./panel";
import { Renderer } from "./render";
import { WINGS_STAGE } from "./sim/geometry";
import { Playback, Recorder, type Recording } from "./sim/recording";
import { DEFAULT_MATCH, DT, Sim, initPhysics, type FighterView, type Input, type SimEvent } from "./sim/sim";

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
};
const renderer = new Renderer(document.getElementById("game") as HTMLCanvasElement);
const camera = new CameraRig(WINGS_STAGE);
const history = new History();

let sim: Sim;
let prev: FighterView[];
let curr: FighterView[];
let bots: (HeuristicBot | null)[] = [];
let matchNumber = 0;
let koReplay: FinalKoReplay | null = null; // non-null while showing the final-KO replay
let recorder: Recorder | null = null; // live mode: records the current match
let playback: Playback | null = null; // playback mode: the recording being played
let lastRecording: Recording | null = null;

// ---- match setup ----------------------------------------------------------

/** P1/P2 follow the panel; anyone beyond the keyboard bindings (P3, P4) is a bot. */
function isBot(i: number): boolean {
  if (i >= BINDINGS.length) return true;
  return (i === 0 ? ui.p1 : ui.p2) === "bot";
}

/** (Re)create bots for bot slots. New seed each match so matches differ. */
function setupControllers() {
  if (playback) return; // playback inputs come from the recording
  bots = Array.from({ length: sim.match.players }, (_, i) =>
    isBot(i)
      ? new HeuristicBot(i, { ...DEFAULT_BOT, reactionTicks: ui.botReaction, seed: matchNumber * 4 + i + 1 })
      : null,
  );
}

/** Keep what's been recorded so far, so "watch last match" works mid-match too. */
function saveRecording() {
  if (recorder) lastRecording = recorder.finish(sim);
}

/** Swap in a sim (live or playback) and reset everything that follows it. */
function show(newSim: Sim) {
  sim = newSim;
  curr = sim.view();
  prev = curr;
  history.clear();
  koReplay = null;
  camera.reset();
}

/** Start a new live match (R). */
function restart() {
  saveRecording();
  sim?.free();
  playback = null;
  // The only place the panel's player count is read. Everything else uses
  // sim.match.players: the slider changes ui.players while you drag it, before
  // the match restarts, and the running match must not see that.
  const live = new Sim(WINGS_STAGE, params, { players: ui.players, stocks: ui.stocks });
  recorder = new Recorder(WINGS_STAGE, live.match, params);
  matchNumber++;
  show(live);
  setupControllers();
}

function watch(recording: Recording) {
  saveRecording();
  recorder = null;
  sim?.free();
  bots = [];
  playback = new Playback(recording);
  show(playback.sim);
}

function watchLast() {
  saveRecording();
  if (lastRecording) watch(lastRecording);
}

function downloadLast() {
  saveRecording();
  if (!lastRecording) return;
  const blob = new Blob([JSON.stringify(lastRecording)], { type: "application/json" });
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

// ---- per tick ----------------------------------------------------------------

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
  const loser = sim.events.find((e) => e.type === "ko" && e.final);
  if (!sim.result.over || !loser || loser.type !== "ko") return;
  koReplay = new FinalKoReplay(history.snapshot(), loser.fighter);
}

function gatherInputs(): Input[] {
  const view = sim.view();
  return Array.from({ length: sim.match.players }, (_, i) => bots[i]?.think(view, sim.stage, params) ?? readInput(i));
}

/** Advance one tick in whichever mode we're in. False if there was nothing to do (playback finished). */
function stepOnce(): boolean {
  if (playback) {
    if (playback.done) return false;
    playback.step();
    return true;
  }
  const inputs = gatherInputs();
  recorder?.beforeStep(sim, inputs, params);
  sim.step(inputs);
  recorder?.afterStep(sim);
  if (sim.result.over && recorder) {
    lastRecording = recorder.finish(sim); // the match is decided; stop recording
    recorder = null;
  }
  return true;
}

// ---- wiring --------------------------------------------------------------

restart();
buildPanel(params, ui, { restart, controllersChanged: setupControllers, watchLast, downloadLast, loadFile });
installKeyboard((code) => {
  if (code === "KeyR") restart();
});

function labels(): string[] {
  return Array.from({ length: sim.match.players }, (_, i) => {
    if (playback) return `P${i + 1}`;
    const b = bots[i];
    return b ? `P${i + 1} bot (${b.mode})` : `P${i + 1} human`;
  });
}

function status(): string | undefined {
  if (!playback) return undefined;
  if (playback.desync) return `REPLAY — DESYNC at tick ${playback.desync.tick}`;
  return playback.done ? "REPLAY — end (R for a new match)" : "REPLAY";
}

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

  if (koReplay) {
    // Final-KO replay: the sim is paused; we play back recorded frames.
    accumulator = 0;
    const playing = koReplay.update(dt);
    if (koReplay.hitNow) camera.shake(1);
    if (!playing) koReplay = null; // done: back to the live view, banner shows
  } else {
    while (accumulator >= DT) {
      if (!stepOnce()) {
        accumulator = 0; // finished playback: hold the last frame
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
  renderer.draw(sim.stage, cam, shown.prev, shown.curr, shown.alpha, sim.result, {
    replay: koReplay !== null,
    debug: ui.debug,
    labels: labels(),
    humans: Array.from({ length: sim.match.players }, (_, i) => !playback && !bots[i]),
    totalStocks: sim.match.stocks,
    status: status(),
  });
}
requestAnimationFrame(frame);
