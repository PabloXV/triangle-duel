// Does any fighter shape dominate? Bots with a custom shape vs bots with the
// standard shape, sides alternating. Caveat: the bot was tuned on the
// standard shape. Usage: npm run shape-arena
import { DEFAULT_BOT, HeuristicBot } from "../src/bots/heuristic";
import { WINGS_STAGE, type FighterShape } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { SHAPE_LIMITS, STANDARD_SHAPE, balanceShape, shapeIssue } from "../src/sim/shapes";
import { Sim, initPhysics } from "../src/sim/sim";

await initPhysics();
const N = 40;

/** Scale a family of triangles until it just fits the limits (the most extreme legal version). */
function extreme(make: (s: number) => { x: number; y: number }[]): FighterShape {
  let best = STANDARD_SHAPE;
  for (let s = 1; s < 20; s += 0.05) {
    const b = balanceShape(make(s), 0);
    if (!b || shapeIssue(b)) break;
    best = b;
  }
  return best;
}

const shapes: [string, FighterShape][] = [
  ["standard (control)", STANDARD_SHAPE],
  ["tallest (needle)", extreme((s) => [{ x: 0, y: 0 }, { x: 0.5, y: s }, { x: -0.5, y: s }])],
  ["widest (wedge)", extreme((s) => [{ x: 0, y: 0 }, { x: s, y: 1 }, { x: -s, y: 1 }])],
  ["lopsided", balanceShape([{ x: 0, y: 0 }, { x: 1.4, y: 1.3 }, { x: -0.3, y: 1.0 }], 0)!],
];

for (const [name, shape] of shapes) {
  let won = 0, lost = 0;
  for (let s = 1; s <= N; s++) {
    const side = s % 2;
    const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 2, stocks: 3, shapes: side === 0 ? [shape, null] : [null, shape] });
    const bots = [0, 1].map((i) => new HeuristicBot(i, { ...DEFAULT_BOT, seed: s * 13 + i }));
    while (!sim.result.over && sim.tick < 60 * 180) sim.step(bots.map((b) => b.think(sim.view(), sim.stage, DEFAULT_PARAMS)));
    const r = sim.result;
    if (r.over && r.winner === side) won++;
    else if (r.over && r.winner === 1 - side) lost++;
    sim.free();
  }
  const ys = shape.vertices.map((v) => v.y), xs = shape.vertices.map((v) => v.x);
  const h = (Math.max(...ys) - shape.vertices[0].y) / (SHAPE_LIMITS.maxHeight / 2), w = (Math.max(...xs) - Math.min(...xs)) / (SHAPE_LIMITS.maxWidth / 2);
  console.log(`${name.padEnd(20)} ${(h * 100).toFixed(0).padStart(3)}% height ${(w * 100).toFixed(0).padStart(3)}% width | vs standard: ${String(won).padStart(2)}W ${String(lost).padStart(2)}L`);
}
