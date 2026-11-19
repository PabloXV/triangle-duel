import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics, type Input } from "../src/sim/sim";

beforeAll(() => initPhysics());

function play(controllers: (HeuristicBot | null)[], maxTicks = 60 * 60 * 3) { // 3 min: 3-stock matches
  const sim = new Sim(WINGS_STAGE, { ...DEFAULT_PARAMS });
  while (!sim.result.over && sim.tick < maxTicks) {
    const view = sim.view();
    sim.step(controllers.map((b): Input => b?.think(view, sim.stage, DEFAULT_PARAMS) ?? NO_INPUT));
  }
  const result = sim.result;
  sim.free();
  return result;
}

describe("heuristic bot", () => {
  // These are the regressions the arena (npm run bots) caught while tuning:
  // with a bad config the bot kills itself against a target that never moves.
  it.each([1, 2, 3, 4, 5])("beats an idle opponent without killing itself (seed %i, as P1)", (seed) => {
    expect(play([new HeuristicBot(0, { ...DEFAULT_BOT, seed }), null])).toMatchObject({ over: true, winner: 0 });
  });

  it.each([1, 2, 3])("same from the other side (seed %i, as P2)", (seed) => {
    expect(play([null, new HeuristicBot(1, { ...DEFAULT_BOT, seed })])).toMatchObject({ over: true, winner: 1 });
  });

  it("bot vs bot finishes with a winner, not a timeout or mutual KO", () => {
    for (const seed of [1, 2, 3]) {
      const r = play([new HeuristicBot(0, { ...DEFAULT_BOT, seed }), new HeuristicBot(1, { ...DEFAULT_BOT, seed: seed * 7919 })]);
      expect(r.over).toBe(true);
      expect(r.over && r.winner).not.toBeNull();
    }
  });

  it("is deterministic: same seed, same match", () => {
    const run = () => play([new HeuristicBot(0, { ...DEFAULT_BOT, seed: 9 }), new HeuristicBot(1, { ...DEFAULT_BOT, seed: 10 })]);
    expect(run()).toEqual(run());
  });
});

describe("heuristic bot, platforms", () => {
  const wing = WINGS_STAGE.platforms[2];
  const onWing = { x: wing.center.x, y: wing.center.y + wing.halfHeight + 0.001 };
  const onFloor = { x: 0, y: 0.001 };

  function duel(botSpawn: { x: number; y: number }, idleSpawn: { x: number; y: number }, seed: number) {
    const params = DEFAULT_PARAMS; // global: manual mode would stop the bot walking too
    const sim = new Sim(WINGS_STAGE, params, { stocks: 1, spawns: [botSpawn, idleSpawn] });
    const bot = new HeuristicBot(0, { ...DEFAULT_BOT, seed });
    let botMaxFootY = -Infinity;
    while (!sim.result.over && sim.tick < 60 * 60) {
      sim.step([bot.think(sim.view(), sim.stage, params), NO_INPUT]);
      const f = sim.view()[0];
      botMaxFootY = Math.max(botMaxFootY, f.vertices[f.footIndex].y);
    }
    const result = sim.result;
    sim.free();
    return { result, botMaxFootY };
  }

  // The idle opponent just auto-hops in place.
  it.each([1, 2, 3])("climbs up to an opponent hiding on a wing and wins (seed %i)", (seed) => {
    const { result, botMaxFootY } = duel(onFloor, onWing, seed);
    expect(botMaxFootY).toBeGreaterThan(onWing.y); // it got up there
    expect(result).toMatchObject({ over: true, winner: 0 });
  });

  it.each([1, 2, 3])("drops down from a wing to an opponent below and wins (seed %i)", (seed) => {
    expect(duel(onWing, onFloor, seed).result).toMatchObject({ over: true, winner: 0 });
  });
});
