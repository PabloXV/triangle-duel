// Wires everything together: fixed-timestep loop, input, sim, renderer, panel.

import { DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { CameraRig } from "./camera";
import { BINDINGS, installKeyboard, readInput } from "./input";
import { buildPanel, loadParams, type UiState } from "./panel";
import { Renderer } from "./render";
import { FinalKoReplay, History } from "./replay";
import { WINGS_STAGE } from "./sim/geometry";
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
let replay: FinalKoReplay | null = null; // non-null while showing the final-KO replay

let sim: Sim;
let prev: FighterView[];
let curr: FighterView[];
let bots: (HeuristicBot | null)[] = [];
let matchNumber = 0;

/** P1/P2 follow the panel; anyone beyond the keyboard bindings (P3, P4) is a bot. */
function isBot(i: number): boolean {
  if (i >= BINDINGS.length) return true;
  return (i === 0 ? ui.p1 : ui.p2) === "bot";
}

/** (Re)create bots for bot slots. New seed each match so matches differ. */
function setupControllers() {
  bots = Array.from({ length: sim.match.players }, (_, i) =>
    isBot(i)
      ? new HeuristicBot(i, { ...DEFAULT_BOT, reactionTicks: ui.botReaction, seed: matchNumber * 4 + i + 1 })
      : null,
  );
}

function restart() {
  sim?.free();
  // The only place the panel's player count is read. Everything else uses
  // sim.match.players: the slider changes ui.players while you drag it, before
  // the match restarts, and the running match must not see that.
  sim = new Sim(WINGS_STAGE, params, { players: ui.players, stocks: ui.stocks });
  matchNumber++;
  setupControllers();
  curr = sim.view();
  prev = curr;
  history.clear();
  replay = null;
  camera.reset();
}

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

function startReplay() {
  const r = sim.result;
  const loser = sim.events.find((e) => e.type === "ko" && e.final);
  if (!r.over || !loser || loser.type !== "ko") return;
  replay = new FinalKoReplay(history.snapshot(), loser.fighter);
}
restart();

buildPanel(params, ui, { restart, controllersChanged: setupControllers });
installKeyboard((code) => {
  if (code === "KeyR") restart();
});

function gatherInputs(): Input[] {
  const view = sim.view();
  return Array.from({ length: sim.match.players }, (_, i) => bots[i]?.think(view, sim.stage, params) ?? readInput(i));
}

function labels(): string[] {
  return Array.from({ length: sim.match.players }, (_, i) => {
    const b = bots[i];
    return b ? `P${i + 1} bot (${b.mode})` : `P${i + 1} human`;
  });
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

  if (replay) {
    // Final-KO replay: the sim is paused; we play back recorded frames.
    accumulator = 0;
    const playing = replay.update(dt);
    if (replay.hitNow) camera.shake(1);
    if (!playing) replay = null; // done: back to the live view, banner shows
  } else {
    while (accumulator >= DT) {
      sim.step(gatherInputs());
      prev = curr;
      curr = sim.view();
      history.push({ views: curr, events: sim.events });
      accumulator -= DT;
      if (handleEvents(sim.events) && ui.finalKoReplay) {
        startReplay();
        break;
      }
    }
  }

  // What to show: the replay's recorded frames, or the live sim.
  const shown = replay ? replay.current() : { prev, curr, alpha: accumulator / DT };
  const inFrame = replay
    ? replay.focus.map((i) => shown.curr[i])
    : shown.curr.filter((f) => !f.ko && !f.eliminated);
  const cam = camera.update(inFrame, dt, renderer.aspect(), { follow: ui.cameraFollow, shakeScale: ui.shakeScale });
  renderer.draw(sim.stage, cam, shown.prev, shown.curr, shown.alpha, sim.result, {
    replay: replay !== null,
    debug: ui.debug,
    labels: labels(),
    humans: Array.from({ length: sim.match.players }, (_, i) => !bots[i]),
    totalStocks: sim.match.stocks,
  });
}
requestAnimationFrame(frame);
