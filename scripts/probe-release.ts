// Diagnostic: lean for N ticks, then let go of everything. Still standing 4 s later?
import { FLAT_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

// These probes study standing on the ground, so: no auto-hop, and torque-mode
// rotation unless a probe overrides it.
const BASE: Partial<Params> = { jumpMode: "manual", rotationMode: "torque" };

function survivesRelease(over: Partial<Params>, hold: number) {
  const sim = new Sim(FLAT_STAGE, { ...DEFAULT_PARAMS, ...BASE, ...over });
  for (let t = 0; t < hold + 240; t++) sim.step([{ turn: t < hold ? 1 : 0, charge: false }, NO_INPUT]);
  const f = sim.view()[0];
  sim.free();
  return { ok: !f.ko, angle: (f.angle * 180) / Math.PI };
}

for (const [rotationMode, servoStiffness] of [["torque", 0], ["servo", 10], ["servo", 30], ["servo", 100]] as const)
  for (const rotateTorque of [5.5, 8])
    for (const hold of [3, 10, 20]) {
      const r = survivesRelease({ rotationMode, rotateTorque, servoStiffness, gripStrength: 2 }, hold);
      console.log(`${rotationMode.padEnd(6)} stiff=${String(servoStiffness).padStart(3)} torque=${rotateTorque} lean ${String(hold).padStart(2)}t then release → ${r.ok ? `standing at ${r.angle.toFixed(0)}°` : "KO"}`);
    }
