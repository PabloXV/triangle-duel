// Keyboard → Input. The sim never sees keys, only Input structs, so bots and
// network peers can later produce the same thing.

import type { InputSource } from "./session";
import { StickController } from "./aim";
import type { FighterView, Input } from "./sim/sim";

interface Binding {
  left: string;
  right: string;
  charge: string;
}

// Only P1 and P2 can be human. P3 and P4 are always bots.
const BINDINGS: Binding[] = [
  { left: "ArrowLeft", right: "ArrowRight", charge: "ArrowDown" }, // P1
  { left: "KeyA", right: "KeyD", charge: "KeyS" }, // P2
];

const held = new Set<string>();

/**
 * On-screen touch controls (TouchControls.svelte) set this. They drive keyboard
 * binding 0: P1 locally, and you online, same as the arrow keys.
 */
export const touch = {
  left: false,
  right: false,
  charge: false,
  /** The touch stick's sideways position, -1..1, while a thumb is on it (null otherwise). See src/aim.ts. */
  stickX: null as number | null,
};

/** Show touch controls? A touch-first device, or forced with ?touch=1 / ?touch=0. */
export function isTouchDevice(): boolean {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced === "1" || forced === "0") return forced === "1";
  return navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches;
}
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
  window.addEventListener("blur", () => {
    held.clear();
    touch.left = touch.right = touch.charge = false;
    touch.stickX = null;
  });
}

function readInput(player: number): Input {
  const b = BINDINGS[player];
  const t = player === 0 ? touch : { left: false, right: false, charge: false };
  const turn = (held.has(b.right) || t.right ? 1 : 0) - (held.has(b.left) || t.left ? 1 : 0);
  return { turn: turn as Input["turn"], charge: held.has(b.charge) || t.charge };
}

/**
 * A player driven by keyboard binding `binding` (0 = arrows, 1 = A/D/S),
 * controlling fighter `fighter`. Binding 0 also takes the touch controls; with
 * the touch stick, the turn comes from StickController (speed / aim), unless
 * an arrow key is held.
 */
export class KeyboardSource implements InputSource {
  readonly isHuman = true;
  private stick = new StickController();
  constructor(
    private binding: number,
    private fighter: number,
  ) {}
  describe() {
    return "human";
  }
  next(view: FighterView[]): Input {
    const input = readInput(this.binding);
    const me = view[this.fighter];
    if (this.binding === 0 && touch.stickX !== null && input.turn === 0 && me && !me.ko) {
      input.turn = this.stick.next(me, touch.stickX, input.charge);
    } else this.stick.reset();
    return input;
  }
}
