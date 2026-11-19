import { describe, expect, it } from "vitest";
import type { OnlineSession } from "../src/net/onlineSession";
import { CorrectionSmoother } from "../src/smoothing";
import { initPhysics, type FighterView } from "../src/sim/sim";
import { playOnline } from "./onlineHarness";

await initPhysics();

const fighterAt = (x: number, y = 1): FighterView =>
  ({ x, y, vertices: [{ x, y: y - 0.8 }, { x: x + 0.6, y: y + 0.4 }, { x: x - 0.6, y: y + 0.4 }] }) as FighterView;

describe("rollback correction smoothing", () => {
  it("starts where the fighter was drawn, then fades to the corrected position", () => {
    const s = new CorrectionSmoother();
    s.add([fighterAt(1)], [fighterAt(0)]); // corrected 1 m to the left
    expect(s.apply([fighterAt(0)])[0].vertices[0].x).toBeCloseTo(1, 6); // drawn where it was
    s.update(0.08);
    expect(s.largest).toBeCloseTo(Math.exp(-1), 2); // ~37% left after one time constant
    s.update(0.5);
    expect(s.largest).toBeLessThan(0.01); // essentially gone in about half a second
  });

  it("doesn't smooth teleports (e.g. a respawn)", () => {
    const s = new CorrectionSmoother();
    s.add([fighterAt(8)], [fighterAt(0)]);
    expect(s.largest).toBe(0);
  });

  it("over a ~100 ms connection, the worst visible snap is much smaller with smoothing", () => {
    // Emulate the game loop: after each step, take the correction, smooth, draw.
    const worst = { raw: 0, smoothed: 0 };
    const state = new Map<OnlineSession, { smoother: CorrectionSmoother; lastRaw?: FighterView[]; lastDrawn?: FighterView[] }>();
    const maxMove = (a: FighterView[], b: FighterView[]) =>
      Math.max(0, ...b.map((f, i) => (a[i] && !f.ko && !a[i].ko ? Math.hypot(f.vertices[0].x - a[i].vertices[0].x, f.vertices[0].y - a[i].vertices[0].y) : 0)));
    playOnline({
      latency: [6, 6],
      jitter: 3,
      ticks: 2400,
      sample: (s) => {
        let st = state.get(s);
        if (!st) state.set(s, (st = { smoother: new CorrectionSmoother() }));
        const c = s.takeCorrection();
        if (c) st.smoother.add(c.before, c.after);
        st.smoother.update(1 / 60);
        const raw = s.sim.view();
        const drawn = st.smoother.apply(raw);
        if (st.lastRaw && st.lastDrawn) {
          worst.raw = Math.max(worst.raw, maxMove(st.lastRaw, raw));
          worst.smoothed = Math.max(worst.smoothed, maxMove(st.lastDrawn, drawn));
        }
        st.lastRaw = raw;
        st.lastDrawn = drawn;
      },
    });
    expect(worst.raw).toBeGreaterThan(0.5); // sanity: there were visible snaps to smooth
    expect(worst.smoothed).toBeLessThan(worst.raw / 2);
    console.log(`worst per-frame jump: raw ${worst.raw.toFixed(2)} m, smoothed ${worst.smoothed.toFixed(2)} m`);
  });
});
