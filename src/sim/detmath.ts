// Determinism chokepoint for math in the sim.
//
// Rapier (deterministic build) gives bit-identical physics across browsers and
// machines. Our own JS on top must match that for rollback netcode to work.
// + - * / and Math.sqrt are exact IEEE-754 operations, so they're the same
// everywhere. Math.sin/cos/atan2/hypot are NOT guaranteed to match across JS
// engines (Chrome vs Safari can differ in the last bit).
//
// For now, sin/cos below just call Math. That's fine for local play. Before
// netcode, replace them with a pure-arithmetic implementation. Everything in
// src/sim must use these instead of Math.sin/Math.cos, so the swap is one file.

export const sin = Math.sin;
export const cos = Math.cos;
