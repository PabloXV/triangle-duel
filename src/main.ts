// Wires everything together: fixed-timestep loop, input, sim, renderer, panel.

import { DEFAULT_BOT, HeuristicBot } from "./bots/heuristic";
import { BINDINGS, installKeyboard, readInput } from "./input";
import { buildPanel, loadParams, type UiState } from "./panel";
import { Renderer } from "./render";
import { WINGS_STAGE } from "./sim/geometry";
import { DEFAULT_MATCH, DT, Sim, initPhysics, type FighterView, type Input } from "./sim/sim";

await initPhysics();

const params = loadParams();
const ui: UiState = {
  debug: true,
  players: 2,
  stocks: DEFAULT_MATCH.stocks,
  p1: "human",
  p2: "bot",
  botReaction: DEFAULT_BOT.reactionTicks,
};
const renderer = new Renderer(document.getElementById("game") as HTMLCanvasElement);

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

function frame(now: number) {
  // Schedule the next frame first, so an error in this one shows up in the
  // console instead of stopping the game loop for good.
  requestAnimationFrame(frame);
  // Cap the catch-up so a backgrounded tab doesn't simulate seconds at once.
  accumulator += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (accumulator >= DT) {
    sim.step(gatherInputs());
    prev = curr;
    curr = sim.view();
    accumulator -= DT;
  }
  renderer.draw(sim.stage, prev, curr, accumulator / DT, sim.result, {
    debug: ui.debug,
    labels: labels(),
    humans: Array.from({ length: sim.match.players }, (_, i) => !bots[i]),
    totalStocks: sim.match.stocks,
  });
}
requestAnimationFrame(frame);
