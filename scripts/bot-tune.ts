// Compare bot steering variants against the current default bot:
// head-to-head win rate (sides alternate, to cancel any P1/P2 bias), input
// changes per second (fewer = fewer mispredictions online), and whether the
// variant ever loses to an idle opponent (i.e. kills itself).
// Usage: npm run bot-tune
import { DEFAULT_BOT, HeuristicBot, type BotConfig } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics, type Input } from "../src/sim/sim";
import { encodeInput } from "../src/sim/inputCodec";

await initPhysics();
const N = 40;
const MAX = 60 * 180;

/** Play one match. `variantSide` = which fighter is the variant; the other is `opponent` (a bot config, or null = idle). */
function play(variant: Partial<BotConfig>, opponent: Partial<BotConfig> | null, variantSide: 0 | 1, seed: number) {
  const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, stocks: 3 });
  const v = new HeuristicBot(variantSide, { ...DEFAULT_BOT, ...variant, seed });
  const o = opponent && new HeuristicBot(1 - variantSide, { ...DEFAULT_BOT, ...opponent, seed: seed * 7919 });
  let changes = 0;
  let last = "";
  while (!sim.result.over && sim.tick < MAX) {
    const view = sim.view();
    const vi = v.think(view, sim.stage, DEFAULT_PARAMS);
    const oi = o ? o.think(view, sim.stage, DEFAULT_PARAMS) : NO_INPUT;
    const code = encodeInput(vi);
    if (code !== last) changes++;
    last = code;
    const inputs: Input[] = variantSide === 0 ? [vi, oi] : [oi, vi];
    sim.step(inputs);
  }
  const r = sim.result;
  const secs = sim.tick / 60;
  sim.free();
  return { won: r.over && r.winner === variantSide, lost: r.over && r.winner === 1 - variantSide, changesPerSec: changes / secs, secs };
}

function evaluate(name: string, variant: Partial<BotConfig>) {
  let won = 0, lost = 0, changes = 0, secs = 0;
  for (let s = 1; s <= N; s++) {
    const r = play(variant, {}, (s % 2) as 0 | 1, s);
    won += +r.won;
    lost += +r.lost;
    changes += r.changesPerSec;
    secs += r.secs;
  }
  let selfKills = 0;
  for (let s = 1; s <= 10; s++) if (!play(variant, null, (s % 2) as 0 | 1, 100 + s).won) selfKills++;
  console.log(
    `${name.padEnd(30)} vs default: ${String(won).padStart(2)}W ${String(lost).padStart(2)}L ${String(N - won - lost).padStart(2)}D/T` +
      ` | ${(changes / N).toFixed(1).padStart(4)} input changes/s | avg match ${(secs / N).toFixed(0)} s | vs idle: ${selfKills ? `${selfKills} self-KO losses!` : "10/10"}`,
  );
}

const variants: [string, Partial<BotConfig>][] = [
  ["default (control)", {}],
  ["old bang-bang .03/.03", { deadband: 0.03, releaseBand: 0.03 }],
  ["bands .10/.03", { deadband: 0.1, releaseBand: 0.03 }],
  ["bands .15/.04", { deadband: 0.15, releaseBand: 0.04 }],
];
for (const [name, v] of variants) evaluate(name, v);

// Robustness: do the winners hold up on fresh seeds, another map, and in FFA?
if (process.argv.includes("--robust")) {
  const { ISLAND_STAGE } = await import("../src/sim/geometry");
  const ffa = (variant: Partial<BotConfig>, seed: number, stage = WINGS_STAGE) => {
    const sim = new Sim(stage, DEFAULT_PARAMS, { players: 3, stocks: 2 });
    const side = seed % 3;
    const bots = [0, 1, 2].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, ...(i === side ? variant : {}), seed: seed * 31 + i }));
    while (!sim.result.over && sim.tick < MAX) sim.step(bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS)));
    const r = sim.result;
    sim.free();
    return r.over && r.winner === side;
  };
  const duel = (variant: Partial<BotConfig>, seed: number, stage: typeof WINGS_STAGE) => {
    const side = (seed % 2) as 0 | 1;
    const sim = new Sim(stage, DEFAULT_PARAMS, { players: 2, stocks: 3 });
    const v = new HeuristicBot(side, { ...DEFAULT_BOT, ...variant, seed });
    const o = new HeuristicBot(1 - side, { ...DEFAULT_BOT, seed: seed * 7919 });
    while (!sim.result.over && sim.tick < MAX) {
      const view = sim.view();
      const [a, b] = [v.think(view, sim.stage, DEFAULT_PARAMS), o.think(view, sim.stage, DEFAULT_PARAMS)];
      sim.step(side === 0 ? [a, b] : [b, a]);
    }
    const r = sim.result;
    sim.free();
    return r.over && r.winner === side;
  };
  console.log("\nrobustness (variant win counts):");
  for (const [name, v] of [["default (control)", {}], ["old bang-bang .03/.03", { deadband: 0.03, releaseBand: 0.03 }]] as [string, Partial<BotConfig>][]) {
    let fresh = 0, island = 0, ffaW = 0, ffaI = 0;
    for (let s = 1001; s <= 1040; s++) fresh += +duel(v, s, WINGS_STAGE);
    for (let s = 1; s <= 40; s++) island += +duel(v, s, ISLAND_STAGE);
    for (let s = 1; s <= 30; s++) ffaW += +ffa(v, s);
    for (let s = 1; s <= 30; s++) ffaI += +ffa(v, s, ISLAND_STAGE);
    console.log(`${name.padEnd(20)} fresh seeds ${String(fresh).padStart(2)}/40 | Island ${String(island).padStart(2)}/40 | 3-FFA Wings ${String(ffaW).padStart(2)}/30 | 3-FFA Island ${String(ffaI).padStart(2)}/30  (par: 20, 20, 10, 10)`);
  }
}
