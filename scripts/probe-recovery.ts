// Diagnostic: how long can you hold "rotate right" from upright and still
// recover? After the hold, a simple bang-bang balancer steers back upright
// (rotate against lean + spin), like a decent player would. Bigger = more forgiving.
import { FLAT_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

// These probes study standing on the ground, so: no auto-hop, and torque-mode
// rotation unless a probe overrides it.
const BASE: Partial<Params> = { jumpMode: "manual", rotationMode: "torque" };

function recovers(over: Partial<Params>, hold: number): boolean {
  const sim = new Sim(FLAT_STAGE, { ...DEFAULT_PARAMS, ...BASE, ...over });
  for (let t = 0; t < 240; t++) {
    const f = sim.view()[0];
    // angle > 0 = leaning left (CCW) → correct with turn +1 (clockwise).
    const balance = f.angle + 0.25 * f.angularVelocity > 0 ? 1 : -1;
    sim.step([{ turn: t < hold ? 1 : balance, charge: false }, NO_INPUT]);
    if (sim.view()[0].ko) { sim.free(); return false; }
  }
  sim.free();
  return true;
}

function maxHold(over: Partial<Params>): number {
  let h = 0;
  while (h < 240 && recovers(over, h + 1)) h++;
  return h;
}

const rows: [string, Partial<Params>][] = [];
for (const rotationMode of ["torque", "servo"] as const)
  for (const rotateTorque of [5.5, 8])
    for (const gripStrength of [0, 2])
      rows.push([`${rotationMode} torque=${rotateTorque} grip=${gripStrength}`, { rotationMode, rotateTorque, gripStrength }]);
for (const [label, over] of rows) {
  const h = maxHold(over);
  console.log(`${label.padEnd(40)} max recoverable hold: ${String(h).padStart(3)} ticks (${(h / 60).toFixed(2)} s)`);
}
