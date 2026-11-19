// Compact input encoding, shared by recordings and the network protocol.
// Kept dependency-free so the relay can use it without pulling in the sim
// (and Rapier's WASM).

import type { Input } from "./types";

// One input = one character '0'..'5': (turn + 1) + (charge ? 3 : 0).
export function encodeInput(i: Input): string {
  return String(i.turn + 1 + (i.charge ? 3 : 0));
}

export function decodeInput(c: string): Input {
  const n = Number(c);
  if (!(n >= 0 && n <= 5)) throw new Error(`bad input char ${JSON.stringify(c)}`);
  return { turn: ((n % 3) - 1) as Input["turn"], charge: n >= 3 };
}
