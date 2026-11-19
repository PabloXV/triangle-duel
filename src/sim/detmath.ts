// Deterministic math for the sim.
//
// Rapier (deterministic build) gives bit-identical physics on every machine.
// Our own JS on top must match that, or online clients slowly drift apart.
// + - * / and Math.sqrt / round / floor / abs / min / max are exact (IEEE-754
// or defined exactly by the JS spec), so they're identical in every engine.
// JS also forbids engines from fusing a*b+c into one rounding step.
// Math.sin/cos/atan2/hypot/exp are NOT guaranteed to match across engines
// (Chrome vs Safari can differ in the last bit), so the sim must not use them.
//
// sin/cos below are a port of fdlibm's (the classic reference libm): reduce
// the angle into [-π/4, π/4] by subtracting a multiple of π/2, then evaluate
// fixed minimax polynomials. Only exact operations, so bit-identical
// everywhere, and within ~1 ulp of the true value. Everything in src/sim must
// use these instead of Math.sin / Math.cos.

// π/2 split into three parts with few enough bits that n * part is exact for
// any reasonable n (Cody–Waite reduction). Constants from fdlibm.
const PIO2_1 = 1.57079632673412561417e0; // first 33 bits of π/2
const PIO2_2 = 6.07710050630396597660e-11; // next 33 bits
const PIO2_3 = 2.02226624871116645580e-21; // the rest
const INV_PIO2 = 6.36619772367581382433e-1; // 2/π

// Polynomial coefficients for sin and cos on [-π/4, π/4] (fdlibm __kernel_sin/cos).
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-π/4, π/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [-π/4, π/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** Largest |angle| we reduce accurately. The sim's angles are within a few π. */
const MAX_ANGLE = 1e6;

/** x = n·(π/2) + r with |r| ≤ π/4. Returns [r, n mod 4]. */
function reduce(x: number): [number, number] {
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_3;
  return [r, ((n % 4) + 4) % 4];
}

export function sin(x: number): number {
  if (!(Math.abs(x) <= MAX_ANGLE)) return NaN; // also catches NaN and ±Infinity
  if (x === 0) return x; // keep the sign of -0 (the reduction below would lose it)
  const [r, q] = reduce(x);
  switch (q) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

export function cos(x: number): number {
  if (!(Math.abs(x) <= MAX_ANGLE)) return NaN;
  const [r, q] = reduce(x);
  switch (q) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}
