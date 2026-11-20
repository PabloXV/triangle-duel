// A tiny seeded random number generator (mulberry32): the same seed gives the
// same sequence everywhere, for bots' choices, platform drips and tests.
// (Not used by the sim, which has no randomness.)

/** Uniform numbers in [0, 1) from `seed`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
