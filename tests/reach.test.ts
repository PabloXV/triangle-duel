import { describe, expect, it } from "vitest";
import { StickController } from "../src/aim";
import type { Stage } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Sim, initPhysics } from "../src/sim/sim";
import { stageById } from "../src/stages";

await initPhysics();

/**
 * Can you get there? From standing at x on platform `from`, try a grid of
 * jumps (aim lean × charge time, via the touch stick's aim controller) in the
 * real physics; count how many land, upright, on platform `to`. More = easier.
 * (Wings' wings, the reference "takes a decent charge" jump, score ~10.)
 */
function ease(stage: Stage, from: number, x: number, to: number): number {
  const top = (i: number) => stage.platforms[i].center.y + stage.platforms[i].halfHeight;
  const target = stage.platforms[to];
  let count = 0;
  for (let aim = -1; aim <= 1.001; aim += 0.2)
    for (let charge = 0; charge <= 42; charge += 6) {
      const sim = new Sim({ ...stage, spawns: { 1: [{ x, y: top(from) + 0.001 }] } }, DEFAULT_PARAMS, { players: 1, stocks: 1 });
      const ctl = new StickController();
      for (let t = 0; t < 40; t++) sim.step([{ turn: 0, charge: false }]);
      let left = false;
      for (let t = 0; t < 150; t++) {
        const f = sim.view()[0];
        if (f.ko) break;
        const holding = t < 12 + charge; // pull down (plants on the next landing), hold, release
        sim.step([{ turn: holding ? ctl.next(f, aim, true) : 0, charge: holding && charge > 0 }]);
        const g = sim.view()[0];
        const foot = g.vertices[g.footIndex];
        if (foot.y > top(from) + 0.5 || Math.abs(foot.x - x) > 0.8) left = true;
        if (left && !holding && foot.y - top(to) > -0.02 && foot.y - top(to) < 0.06 && Math.abs(foot.x - target.center.x) <= target.halfWidth && Math.abs(g.angle) < 0.6) {
          count++;
          break;
        }
      }
      sim.free();
    }
  return count;
}

describe("stages: every platform is reachable", () => {
  it("Wings: floor -> wing (the reference)", () => {
    expect(ease(stageById("wings").stage, 0, -4.5, 1)).toBeGreaterThanOrEqual(3);
  });
  it("Overpass: floor -> side platform, side -> top", () => {
    const s = stageById("overpass").stage;
    expect(ease(s, 0, -2.5, 1)).toBeGreaterThanOrEqual(3);
    expect(ease(s, 1, -2.5, 3)).toBeGreaterThanOrEqual(6);
  });
  it("Platform ▽: floor -> the bar over the pit is easy, and the pit can be jumped", () => {
    const s = stageById("station").stage;
    expect(ease(s, 0, -2.2, 2)).toBeGreaterThanOrEqual(15);
    expect(ease(s, 0, -1.6, 1)).toBeGreaterThanOrEqual(2);
  });
  it("The Stoop: floor -> step -> top step", () => {
    const s = stageById("stoop").stage;
    expect(ease(s, 0, -3.3, 1)).toBeGreaterThanOrEqual(3);
    expect(ease(s, 1, -2.2, 2)).toBeGreaterThanOrEqual(3);
  });
});
