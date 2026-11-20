import { describe, expect, it } from "vitest";
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { spawnPoints, type Stage, type Vec2 } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Sim, initPhysics } from "../src/sim/sim";
import { STAGES } from "../src/stages";

await initPhysics();

/** Where a spawn point stands: on a platform top (with room), inside a block, or over nothing. */
function standing(stage: Stage, p: Vec2): "ok" | "inside a block" | "over a gap" {
  const inside = stage.platforms.some((pl) => Math.abs(p.x - pl.center.x) < pl.halfWidth && p.y + 0.1 > pl.center.y - pl.halfHeight && p.y + 0.1 < pl.center.y + pl.halfHeight);
  if (inside) return "inside a block";
  const on = stage.platforms.some((pl) => Math.abs(p.y - (pl.center.y + pl.halfHeight)) < 0.05 && Math.abs(p.x - pl.center.x) <= pl.halfWidth - 0.3);
  return on ? "ok" : "over a gap";
}

describe("stages", () => {
  for (const { id, stage } of STAGES)
    for (const n of [2, 3, 4])
      it(`${id}, ${n} players: everyone spawns standing on a platform`, () => {
        for (const p of spawnPoints(stage, n)) expect(standing(stage, p), `spawn ${JSON.stringify(p)}`).toBe("ok");
      });

  it.each(STAGES.map((s) => s.id))("%s: a 4-bot match runs, and nobody is KO'd in the first second", (id) => {
    const stage = STAGES.find((s) => s.id === id)!.stage;
    const sim = new Sim(stage, DEFAULT_PARAMS, { players: 4, stocks: 2 });
    const bots = [0, 1, 2, 3].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: i + 1 }));
    for (let t = 0; t < 60; t++) sim.step(bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS)));
    expect(sim.view().every((f) => f.ko === null)).toBe(true);
    for (let t = 0; t < 600 && !sim.result.over; t++) sim.step(bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS)));
    sim.free();
  });
});
