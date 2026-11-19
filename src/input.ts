// Keyboard → Input. The sim never sees keys, only Input structs, so bots and
// network peers can later produce the same thing.

import type { InputSource } from "./session";
import type { Input } from "./sim/sim";

interface Binding {
  left: string;
  right: string;
  charge: string;
}

// Only P1 and P2 can be human. P3 and P4 are always bots.
export const BINDINGS: Binding[] = [
  { left: "ArrowLeft", right: "ArrowRight", charge: "ArrowDown" }, // P1
  { left: "KeyA", right: "KeyD", charge: "KeyS" }, // P2
];

const held = new Set<string>();
const GAME_KEYS = new Set(BINDINGS.flatMap((b) => [b.left, b.right, b.charge]));

export function installKeyboard(onKey: (code: string) => void) {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return; // typing in the param panel
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (!e.repeat) onKey(e.code);
  });
  window.addEventListener("keyup", (e) => held.delete(e.code));
  // Losing focus while holding a key would otherwise leave it stuck down.
  window.addEventListener("blur", () => held.clear());
}

export function readInput(player: number): Input {
  const b = BINDINGS[player];
  const turn = (held.has(b.right) ? 1 : 0) - (held.has(b.left) ? 1 : 0);
  return { turn: turn as Input["turn"], charge: held.has(b.charge) };
}

/** A player driven by keyboard binding `binding` (0 = arrows, 1 = A/D/S). */
export class KeyboardSource implements InputSource {
  readonly isHuman = true;
  constructor(private binding: number) {}
  describe() {
    return "human";
  }
  next(): Input {
    return readInput(this.binding);
  }
}
