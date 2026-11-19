// Headless bot matches, to tune the bot with numbers instead of vibes.
// Usage: npm run bots
//
// Scenarios:
//   vs idle:  bot vs a non-moving opponent. Should always win, fast. A loss
//             means the bot killed itself.
//   bot/bot:  two bots with different seeds. Match length + outcome spread.

import { DEFAULT_BOT, HeuristicBot, type BotConfig } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, TICK_RATE, initPhysics, type Input } from "../src/sim/sim";

await initPhysics();

const MAX_TICKS = 180 * TICK_RATE; // 3 min per match (3 stocks)

type Controller = ((sim: Sim) => Input) | null;

function play(c0: Controller, c1: Controller) {
  const sim = new Sim(WINGS_STAGE, { ...DEFAULT_PARAMS });
  while (!sim.result.over && sim.tick < MAX_TICKS) {
    sim.step([c0 ? c0(sim) : NO_INPUT, c1 ? c1(sim) : NO_INPUT]);
  }
  const r = sim.result;
  const ko = sim.view().map((f) => f.ko);
  sim.free();
  return { winner: r.over ? r.winner : "timeout", seconds: sim.tick / TICK_RATE, ko };
}

const bot = (me: number, cfg: Partial<BotConfig> = {}): Controller => {
  const b = new HeuristicBot(me, { ...DEFAULT_BOT, ...cfg });
  return (sim) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS);
};

function summarize(label: string, results: ReturnType<typeof play>[]) {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(String(r.winner), (counts.get(String(r.winner)) ?? 0) + 1);
  const secs = results.map((r) => r.seconds).sort((a, b) => a - b);
  const median = secs[Math.floor(secs.length / 2)];
  const reasons = new Map<string, number>();
  for (const r of results) for (const k of r.ko) if (k) reasons.set(k, (reasons.get(k) ?? 0) + 1);
  console.log(
    `${label.padEnd(26)} winners: ${[...counts].map(([k, v]) => `${k}=${v}`).join(" ").padEnd(28)} median ${median.toFixed(1)}s   KOs: ${[...reasons].map(([k, v]) => `${k}=${v}`).join(" ")}`,
  );
}

const N = 40;
const seeds = Array.from({ length: N }, (_, i) => i + 1);
summarize("bot(P0) vs idle", seeds.map((s) => play(bot(0, { seed: s }), null)));
summarize("idle vs bot(P1)", seeds.map((s) => play(null, bot(1, { seed: s }))));
summarize("bot vs bot", seeds.map((s) => play(bot(0, { seed: s }), bot(1, { seed: s * 7919 }))));
summarize("bot vs bot, fast reactions", seeds.map((s) => play(bot(0, { seed: s, reactionTicks: 2 }), bot(1, { seed: s * 7919 }))));

if (process.argv.includes("--experiments")) {
  console.log("\nexperiments (P0 varies, P1 = default bot):");
  for (const [label, cfg] of [
    ["P0 reaction 2", { reactionTicks: 2 }],
    ["P0 reaction 6", { reactionTicks: 6 }],
    ["P0 reaction 20", { reactionTicks: 20 }],
    ["P0 reaction 2, range 1.0", { reactionTicks: 2, attackRange: 1.0 }],
    ["P0 reaction 12, range 1.0", { attackRange: 1.0 }],
    ["P0 reaction 12, range 2.2", { attackRange: 2.2 }],
  ] as [string, Partial<BotConfig>][]) {
    summarize(label, seeds.map((s) => play(bot(0, { seed: s, ...cfg }), bot(1, { seed: s * 7919 }))));
  }
}

if (process.argv.includes("--side-bias")) {
  // Same bots, seeds swapped between sides. If P0 still wins, the bias is the side, not the seed.
  summarize("bot vs bot (normal)", seeds.map((s) => play(bot(0, { seed: s }), bot(1, { seed: s * 7919 }))));
  summarize("bot vs bot (seeds swapped)", seeds.map((s) => play(bot(0, { seed: s * 7919 }), bot(1, { seed: s }))));
}
