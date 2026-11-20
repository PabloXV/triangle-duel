import { describe, expect, it } from "vitest";
import { STICK, StickController } from "../src/aim";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

// The touch stick's controller against the real physics (one fighter, middle
// of the Wings floor, default auto-hop). Stick x: -1..1; charge = pulled down.
function run(script: (t: number) => { x: number; charge: boolean }, ticks: number) {
  const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 1 });
  for (let t = 0; t < 60; t++) sim.step([{ turn: 0, charge: false }]);
  const ctl = new StickController();
  const trace: { angle: number; vx: number; x: number; charge: number; turn: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    const f = sim.view()[0];
    const s = script(t);
    const turn = ctl.next(f, s.x, s.charge);
    sim.step([{ turn, charge: s.charge }]);
    const g = sim.view()[0];
    trace.push({ angle: g.angle, vx: g.vx, x: g.x, charge: g.charge, turn });
  }
  const ko = sim.view()[0].ko;
  sim.free();
  return { trace, ko };
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const maxLean = (tr: { angle: number }[]) => Math.max(...tr.map((p) => Math.abs(p.angle)));

describe("touch stick: moving sets your speed", () => {
  it.each([0.5, 1, -0.5, -1])("stick %f: runs at about that speed, without toppling", (x) => {
    const { trace, ko } = run(() => ({ x, charge: false }), 90);
    const late = trace.slice(50);
    const vx = avg(late.map((p) => p.vx));
    console.log(`stick ${x}: speed ${vx.toFixed(2)} m/s (target ${x * STICK.maxSpeed}), max lean ${maxLean(trace).toFixed(2)} rad`);
    expect(ko).toBeNull();
    expect(Math.sign(vx)).toBe(Math.sign(x));
    expect(Math.abs(vx)).toBeGreaterThan(Math.abs(x) * STICK.maxSpeed * 0.5);
    expect(maxLean(trace)).toBeLessThan(STICK.dangerLean);
  });

  it("let go to center: brakes to a stop and stays upright", () => {
    const { trace, ko } = run((t) => ({ x: t < 60 ? 1 : 0, charge: false }), 150);
    expect(ko).toBeNull();
    const end = trace.slice(-30);
    console.log(`after braking: speed ${avg(end.map((p) => p.vx)).toFixed(2)} m/s, lean ${avg(end.map((p) => p.angle)).toFixed(2)} rad`);
    expect(Math.abs(avg(end.map((p) => p.vx)))).toBeLessThan(0.5);
    expect(maxLean(end)).toBeLessThan(0.25);
  });

  it("a small nudge is a small move (no flipping over)", () => {
    const { trace, ko } = run(() => ({ x: 0.15, charge: false }), 120);
    expect(ko).toBeNull();
    expect(maxLean(trace)).toBeLessThan(0.2);
  });
});

describe("touch stick: charging sets your aim", () => {
  it.each([0.5, 1, -1])("stick %f while charging: planted, leaning toward the aim, never toppling", (x) => {
    // Pull down, then aim, for the whole charge (it auto-releases when full).
    const { trace, ko } = run((t) => ({ x: t < 10 ? 0 : x, charge: true }), 48);
    expect(ko).toBeNull();
    const charging = trace.filter((p) => p.charge > 0);
    const target = -x * STICK.maxAimLean;
    const toward = Math.max(...charging.map((p) => p.angle * Math.sign(target)));
    console.log(`aim ${x}: leaned ${toward.toFixed(2)} rad toward the aim (target ${Math.abs(target).toFixed(2)}), max lean ${maxLean(charging).toFixed(2)}`);
    expect(charging.length).toBeGreaterThan(10);
    expect(toward).toBeGreaterThan(Math.abs(target) * 0.6);
    expect(maxLean(charging)).toBeLessThan(0.6); // planted, past ~0.6 rad you can't hold it: no overshoot
  });
});
