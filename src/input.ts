// Keyboard → Input. The sim never sees keys, only Input structs, so bots and
// network peers can later produce the same thing.

import type { InputSource } from "./session";
import { StickController } from "./aim";
import type { FighterView, Input } from "./sim/sim";

interface Binding {
  left: string;
  right: string;
  charge: string;
  /** A short hop: the same as tapping charge (a minimum-charge jump). Held: hop again on every landing. */
  hop: string;
}

// Only P1 and P2 can be human. P3 and P4 are always bots.
const BINDINGS: Binding[] = [
  { left: "ArrowLeft", right: "ArrowRight", charge: "ArrowDown", hop: "ArrowUp" }, // P1
  { left: "KeyA", right: "KeyD", charge: "KeyS", hop: "KeyW" }, // P2
];

const held = new Set<string>();
/** Key presses not yet turned into a hop (cleared by the source that uses them). */
const pressed = new Set<string>();

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
const GAME_KEYS = new Set(BINDINGS.flatMap((b) => [b.left, b.right, b.charge, b.hop]));

export function installKeyboard(onKey: (code: string) => void) {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return; // typing in the param panel
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    held.add(e.code);
    if (!e.repeat) {
      pressed.add(e.code);
      onKey(e.code);
    }
  });
  window.addEventListener("keyup", (e) => held.delete(e.code));
  // Losing focus while holding a key would otherwise leave it stuck down.
  window.addEventListener("blur", () => {
    held.clear();
    pressed.clear();
    touch.left = touch.right = touch.charge = false;
    touch.stickX = null;
  });
}

/** Input from any of `bindings` (keys held on either count); binding 0 also takes the touch controls. */
function readInput(bindings: number[]): Input {
  const t = bindings.includes(0) ? touch : { left: false, right: false, charge: false };
  const any = (key: "left" | "right" | "charge") => t[key] || bindings.some((i) => held.has(BINDINGS[i][key]));
  const turn = (any("right") ? 1 : 0) - (any("left") ? 1 : 0);
  return { turn: turn as Input["turn"], charge: any("charge") };
}

/**
 * The hop key, as a tap of charge. The sim starts a charge only on a tick
 * the fighter is grounded and jumps when charge is let go, so: hold charge
 * until we see the fighter grounded (a press in the air waits for the
 * landing), let go, then wait until it has left the ground before another hop
 * (held key: hop on every landing). Online inputs land a few ticks late, and
 * waiting to leave the ground covers that.
 */
export class HopTapper {
  private phase: "idle" | "pending" | "launched" = "idle";
  private wait = 0;
  next(press: boolean, held: boolean, grounded: boolean): boolean {
    if (this.phase === "launched") {
      // Left the ground (or it never happened, e.g. a KO): ready again.
      if (!grounded || ++this.wait > 30) this.phase = "idle";
      else return false;
    }
    if (this.phase === "idle" && (press || held)) this.phase = "pending";
    if (this.phase !== "pending") return false;
    if (grounded) {
      this.phase = "launched";
      this.wait = 0;
    }
    return true;
  }
  reset() {
    this.phase = "idle";
  }
}

/**
 * A player driven by keyboard binding `binding` (0 = arrows, 1 = A/D/S, or a
 * list: online, you get both), controlling fighter `fighter`. Binding 0 also
 * takes the touch controls; with the touch stick, the turn comes from
 * StickController (speed / aim), unless a turn key is held.
 */
export class KeyboardSource implements InputSource {
  readonly isHuman = true;
  private stick = new StickController();
  private hop = new HopTapper();
  private bindings: number[];
  constructor(
    binding: number | number[],
    private fighter: number,
  ) {
    this.bindings = typeof binding === "number" ? [binding] : binding;
    for (const i of this.bindings) pressed.delete(BINDINGS[i].hop); // a press from before the match isn't a hop
  }
  describe() {
    return "human";
  }
  next(view: FighterView[]): Input {
    const input = readInput(this.bindings);
    const me = view[this.fighter];
    const hopKeys = this.bindings.map((i) => BINDINGS[i].hop);
    const press = hopKeys.some((k) => pressed.delete(k));
    const hopHeld = hopKeys.some((k) => held.has(k));
    if (me && !me.ko && !me.eliminated) input.charge = this.hop.next(press, hopHeld, me.grounded) || input.charge;
    else this.hop.reset();
    if (this.bindings.includes(0) && touch.stickX !== null && input.turn === 0 && me && !me.ko) {
      input.turn = this.stick.next(me, touch.stickX, input.charge);
    } else this.stick.reset();
    return input;
  }
}
