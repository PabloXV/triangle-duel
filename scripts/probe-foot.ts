// Diagnostic: when does the foot leave the ground while rotating?
// Usage: npm run probe:foot
import { FLAT_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS, type Params } from "../src/sim/params";
import { NO_INPUT, Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

// These probes study standing on the ground, so: no auto-hop, and torque-mode
// rotation unless a probe overrides it.
const BASE: Partial<Params> = { jumpMode: "manual", rotationMode: "torque" };

function probe(label: string, over: Partial<Params>, holdTicks: number) {
  const sim = new Sim(FLAT_STAGE, { ...DEFAULT_PARAMS, ...BASE, ...over });
  const airborneTicks: number[] = [];
  let koTick: number | null = null;
  for (let t = 0; t < 120; t++) {
    sim.step([{ turn: t < holdTicks ? 1 : -1, charge: false }, NO_INPUT]);
    const f = sim.view()[0];
    if (!f.grounded && !f.ko) airborneTicks.push(t);
    if (f.ko && koTick === null) koTick = t;
  }
  const f = sim.view()[0];
  console.log(
    `${label.padEnd(44)} airborne ticks: ${String(airborneTicks.length).padStart(3)}  first: ${airborneTicks[0] ?? "-"}  ko: ${koTick ?? "-"}  final angle ${((f.angle * 180) / Math.PI).toFixed(0)}°`,
  );
}

for (const torque of [5.5, 15, 30]) {
  for (const grip of [0, 2]) {
    probe(`torque ${torque}, grip ${grip}: lean R 15t then L`, { rotateTorque: torque, gripStrength: grip }, 15);
  }
}
