import { describe, expect, it } from "vitest";
import { BotSource, DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { CameraRig } from "../src/camera";
import { LiveSession } from "../src/session";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { DT, initPhysics, type FighterView } from "../src/sim/sim";

await initPhysics();

// Runs a bot match through the real camera at 120 fps, as the game does, and
// measures how the *stage* moves on screen. Fighters auto-hop ~4.5×/s; a
// camera that frames their exact bounding box bobs with every hop, which reads
// as stutter (measured before the dead zones: ~28 px of stage movement per
// quarter second, p90 65 px).
const FPS = 120;
const CANVAS_W = 1150;
const ASPECT = 1150 / 800;

function measure(players: number) {
  const sources = Array.from({ length: players }, (_, i) => new BotSource(new HeuristicBot(i, { ...DEFAULT_BOT, seed: 7 + i }), DEFAULT_PARAMS));
  const session = new LiveSession(WINGS_STAGE, DEFAULT_PARAMS, { stocks: 99, players }, sources);
  const camera = new CameraRig(WINGS_STAGE);
  let curr: FighterView[] = session.sim.view();
  let acc = 0;
  const floorY: number[] = []; // the floor's screen position, px
  let offscreen = 0;
  for (let frame = 0; frame < FPS * 20; frame++) {
    acc += 1 / FPS;
    while (acc >= DT) {
      session.step();
      curr = session.sim.view();
      acc -= DT;
    }
    const v = camera.update(curr.filter((f) => !f.ko), 1 / FPS, ASPECT, { follow: true, shakeScale: 0 });
    floorY.push((0 - v.center.y) * (CANVAS_W / v.width));
    // Anyone on or above the floor must be fully in view (fallers below it are
    // deliberately not followed: they're dropping to a KO).
    const halfW = v.width / 2;
    const halfH = v.width / ASPECT / 2;
    const out = curr.some(
      (f) => !f.ko && f.y > -0.5 && f.vertices.some((p) => Math.abs(p.x - v.center.x) > halfW || Math.abs(p.y - v.center.y) > halfH),
    );
    if (out) offscreen++;
  }
  session.free();
  // Peak-to-peak floor movement within each quarter second (about one hop).
  const windows: number[] = [];
  for (let i = FPS * 2; i + FPS / 4 < floorY.length; i += FPS / 4) {
    const w = floorY.slice(i, i + FPS / 4);
    windows.push(Math.max(...w) - Math.min(...w));
  }
  const avg = windows.reduce((a, b) => a + b, 0) / windows.length;
  return { avgBobPx: avg, offscreenFrames: offscreen };
}

describe("follow camera", () => {
  it.each([2, 4])("doesn't bob with hops, and keeps on-stage fighters in frame (%i players)", (players) => {
    const r = measure(players);
    expect(r.avgBobPx).toBeLessThan(10); // measured ~5 px with dead zones (was ~28 without)
    expect(r.offscreenFrames).toBe(0);
  });
});
