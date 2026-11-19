// Regenerates tests/fixtures/match-4p.json: a 4-bot match with a mid-match
// param change, used to check every JS engine replays it identically.
// Only regenerate on purpose (e.g. after an intentional sim change): the
// fixture's final hash is a cross-engine contract (see tests/fixture.test.ts).
import { writeFileSync } from "node:fs";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Recorder } from "../src/sim/recording";
import { DEFAULT_MATCH, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();
const match = { ...DEFAULT_MATCH, players: 4, stocks: 2 };
const params = { ...DEFAULT_PARAMS };
const sim = new Sim(WINGS_STAGE, params, match);
const rec = new Recorder(WINGS_STAGE, match, params);
const bots = [0, 1, 2, 3].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: 100 + i }));
while (!sim.result.over && sim.tick < 60 * 120) {
  if (sim.tick === 600) params.hopSpeed = 2.8; // exercise paramChanges
  const inputs = bots.map((b) => b.think(sim.view(), sim.stage, params));
  rec.beforeStep(sim, inputs, params);
  sim.step(inputs);
  rec.afterStep(sim);
}
const recording = rec.finish(sim);
writeFileSync("tests/fixtures/match-4p.json", JSON.stringify(recording));
console.log(`wrote ${recording.ticks} ticks, final hash ${sim.hash()}, result ${JSON.stringify(sim.result)}`);
