import { describe, expect, it } from "vitest";
import { KeyboardSource, touch } from "../src/input";
import { WINGS_STAGE } from "../src/sim/geometry";
import { DEFAULT_PARAMS } from "../src/sim/params";
import { Sim, initPhysics } from "../src/sim/sim";

await initPhysics();

// The touch controls' path into the game: touch state → the input source that
// also reads the arrow keys (binding 0) → the turn/charge the sim gets.
describe("touch input → game input", () => {
  const sim = new Sim(WINGS_STAGE, DEFAULT_PARAMS, { players: 1 });
  for (let t = 0; t < 60; t++) sim.step([{ turn: 0, charge: false }]);
  const view = sim.view(); // standing upright, at rest
  const reset = () => Object.assign(touch, { left: false, right: false, charge: false, stickX: null });

  it("buttons: ◀ / ▶ / Charge map straight to turn and charge", () => {
    const src = new KeyboardSource(0, 0);
    reset();
    touch.left = true;
    expect(src.next(view)).toEqual({ turn: -1, charge: false });
    reset();
    touch.right = true;
    touch.charge = true;
    expect(src.next(view)).toEqual({ turn: 1, charge: true });
    reset();
  });

  it("stick: full left from standing still turns left (to lean into the run); centered at rest, no turn", () => {
    const src = new KeyboardSource(0, 0);
    reset();
    touch.stickX = -1;
    expect(src.next(view).turn).toBe(-1);
    touch.stickX = 0;
    const centered = new KeyboardSource(0, 0);
    expect(centered.next(view).turn).toBe(0);
    reset();
  });

  it("only binding 0 (P1 locally, you online) takes touch input", () => {
    reset();
    touch.left = true;
    expect(new KeyboardSource(1, 0).next(view).turn).toBe(0);
    reset();
  });
});
