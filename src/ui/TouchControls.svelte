<script lang="ts">
  // On-screen controls for touch screens. Two schemes (pause menu to switch):
  //
  //   buttons (default): ◀ on the left flank, ▶ on the right, Charge in the
  //     middle; each thumb tilts its own side and either can reach Charge, so
  //     you can charge with one thumb and aim with the other. A finger keeps
  //     the zone it landed on (no sliding into another), so drifting can't
  //     start or drop a charge.
  //   stick: put a thumb down anywhere on the control area and a stick
  //     appears there. It's analog (src/aim.ts): sideways sets your speed
  //     (centered = stop and balance); pulled down, you charge, and sideways
  //     then sets your aim. A second finger anywhere also charges.
  //
  //   portrait:  a pad below the game (the canvas shrinks to make room), so
  //              thumbs never cover the action;
  //   landscape: over the game (stick: anywhere; buttons: faint zones).
  //
  // Both drive the same input as the arrow keys (src/input.ts `touch`).
  import { onDestroy } from "svelte";
  import { touch } from "../input";

  export type TouchScheme = "stick" | "buttons";
  let { layout, scheme }: { layout: "portrait" | "landscape"; scheme: TouchScheme } = $props();

  let pressed = $state({ left: false, right: false, charge: false });
  let el: HTMLDivElement;

  function set(next: { left: boolean; right: boolean; charge: boolean }) {
    for (const k of ["left", "right", "charge"] as const) touch[k] = pressed[k] = next[k];
  }

  // ---- stick ----
  // Analog: the sideways position (-1..1) goes to src/aim.ts, which turns it
  // into a target speed (moving) or aim (charging). Pulling down charges.
  const R = 64; // px of knob travel each way; past that the base follows the thumb
  const CENTER = 0.12; // fraction of R: a dead zone at the center (= stop)
  const CHARGE_ON = 22; // px down to start charging...
  const CHARGE_OFF = 14; // ...and back above this to stop (hysteresis: no flicker)
  let stickId = $state<number | null>(null);
  let base = $state({ x: 0, y: 0 }); // where the stick is (px, in the pad)
  let knob = $state({ x: 0, y: 0 }); // offset from the base
  const extra = new Set<number>(); // other fingers: they charge

  function local(e: PointerEvent) {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function stickInput() {
    if (stickId === null) {
      touch.stickX = null;
      set({ left: false, right: false, charge: extra.size > 0 });
      return;
    }
    const raw = knob.x / R;
    touch.stickX = Math.abs(raw) < CENTER ? 0 : (Math.sign(raw) * (Math.abs(raw) - CENTER)) / (1 - CENTER);
    const charge = pressed.charge ? knob.y > CHARGE_OFF : knob.y > CHARGE_ON;
    set({ left: false, right: false, charge: charge || extra.size > 0 });
  }

  function stickDown(e: PointerEvent) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    if (stickId === null) {
      stickId = e.pointerId;
      base = local(e);
      knob = { x: 0, y: 0 };
    } else extra.add(e.pointerId);
    stickInput();
  }

  function stickMove(e: PointerEvent) {
    if (e.pointerId !== stickId) return;
    const p = local(e);
    // Each axis on its own (a square, not a circle), so pulling down to charge
    // doesn't shrink how far you can aim sideways. Past the edge, the base follows.
    let dx = p.x - base.x;
    let dy = p.y - base.y;
    if (Math.abs(dx) > R) {
      base = { ...base, x: p.x - Math.sign(dx) * R };
      dx = Math.sign(dx) * R;
    }
    if (Math.abs(dy) > R) {
      base = { ...base, y: p.y - Math.sign(dy) * R };
      dy = Math.sign(dy) * R;
    }
    knob = { x: dx, y: dy };
    stickInput();
  }

  function stickUp(e: PointerEvent) {
    if (e.pointerId === stickId) {
      stickId = null;
      knob = { x: 0, y: 0 };
    } else extra.delete(e.pointerId);
    stickInput();
  }

  // ---- buttons ----
  type Zone = "left" | "right" | "charge";
  const zones = new Map<number, Zone>();
  /** Flanks: ◀ on the outer left, ▶ on the outer right, Charge in between. */
  const FLANK = 0.3;
  function zoneAt(e: PointerEvent): Zone {
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    return fx < FLANK ? "left" : fx > 1 - FLANK ? "right" : "charge";
  }

  function syncZones() {
    const z = [...zones.values()];
    set({ left: z.includes("left"), right: z.includes("right"), charge: z.includes("charge") });
  }

  function buttonsDown(e: PointerEvent) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    zones.set(e.pointerId, zoneAt(e));
    syncZones();
  }

  function buttonsMove(_e: PointerEvent) {
    // A finger keeps the zone it landed on.
  }

  function buttonsUp(e: PointerEvent) {
    if (zones.delete(e.pointerId)) syncZones();
  }

  const down = (e: PointerEvent) => (scheme === "stick" ? stickDown(e) : buttonsDown(e));
  const move = (e: PointerEvent) => (scheme === "stick" ? stickMove(e) : buttonsMove(e));
  const up = (e: PointerEvent) => (scheme === "stick" ? stickUp(e) : buttonsUp(e));

  function reset() {
    zones.clear();
    extra.clear();
    stickId = null;
    knob = { x: 0, y: 0 };
    touch.stickX = null;
    set({ left: false, right: false, charge: false });
  }
  // Switching schemes mid-match: start clean.
  $effect(() => {
    void scheme;
    reset();
  });
  onDestroy(reset);
</script>

<div
  bind:this={el}
  class="pad {layout} {scheme}"
  role="group"
  aria-label="touch controls"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#if scheme === "stick"}
    {#if stickId !== null}
      <div class="base" style:left="{base.x}px" style:top="{base.y}px" style:width="{2 * R}px" style:height="{2 * R}px" style:border-radius="22%">
        <div class="knob" class:charging={pressed.charge} style:transform="translate({knob.x}px, {knob.y}px)"></div>
      </div>
    {:else}
      <p class="stick-hint">Thumb anywhere here · slide ◀ ▶ to move · pull ▼ to charge, then slide to aim</p>
    {/if}
  {:else}
    <!-- Sticker buttons (visual-language.md §11): arrows secondary, Charge primary. Icons are drawn marks. -->
    <div class="zone" style:width="{FLANK * 100}%">
      <div class="btn" class:on={pressed.left} data-zone="left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 4V20L5 12Z" /></svg></div>
    </div>
    <div class="zone" style:width="{(1 - 2 * FLANK) * 100}%"><div class="btn charge" class:on={pressed.charge} data-zone="charge">Charge</div></div>
    <div class="zone" style:width="{FLANK * 100}%">
      <div class="btn" class:on={pressed.right} data-zone="right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4V20L19 12Z" /></svg></div>
    </div>
  {/if}
</div>

<style>
  .pad {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    pointer-events: auto;
  }
  .pad.portrait {
    height: var(--pad-h);
    padding-bottom: env(safe-area-inset-bottom);
    box-sizing: border-box;
    background: var(--grain), linear-gradient(color-mix(in srgb, var(--panel) 80%, var(--ink)), color-mix(in srgb, var(--panel) 55%, var(--ink)));
    background-blend-mode: multiply, normal;
    border-top: 5px solid var(--ink);
    box-shadow: 0 -4px 0 var(--halo);
  }
  .pad.landscape {
    height: 60%;
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .pad.landscape.stick {
    height: 100%; /* anywhere on screen (the pause button sits on top) */
  }

  /* stick */
  .base {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--halo) 19%, transparent);
    background: color-mix(in srgb, var(--halo) 4%, transparent);
    pointer-events: none;
  }
  .knob {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 52px;
    height: 52px;
    margin: -26px 0 0 -26px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--halo) 33%, transparent);
    transition: background 60ms;
  }
  .knob.charging {
    background: var(--accent);
  }
  .stick-hint {
    margin: auto;
    padding: 0 1.5rem;
    text-align: center;
    color: color-mix(in srgb, var(--halo) 40%, transparent);
    font: 600 0.95rem system-ui, sans-serif;
    pointer-events: none;
  }
  .landscape .stick-hint {
    margin: auto auto 1.2rem;
    color: color-mix(in srgb, var(--halo) 33%, transparent);
  }

  /* buttons */
  .zone {
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none; /* labels only: the pad itself takes the touches */
  }
  .landscape .zone {
    align-items: flex-end;
    padding-bottom: 1.2rem;
  }
  .btn {
    --btn: var(--violet);
    position: relative;
    display: grid;
    place-items: center;
    width: 5rem;
    height: 5rem;
    border: 3px solid var(--ink);
    border-radius: 12px;
    background: var(--grain), linear-gradient(171deg, color-mix(in srgb, var(--btn) 68%, white), var(--btn) 50%, color-mix(in srgb, var(--btn) 70%, var(--ink)));
    background-blend-mode: multiply, normal;
    box-shadow: 0 0 0 3px var(--halo), 4px 5px 0 3px var(--shadow-ink);
    transition: transform 50ms, box-shadow 50ms;
  }
  .btn::before {
    content: "";
    position: absolute;
    left: 8px;
    top: 5px;
    width: 40%;
    height: 7px;
    background: var(--gloss) left center / auto 100% no-repeat;
  }
  .btn svg {
    width: 2.2rem;
    height: 2.2rem;
  }
  .btn path {
    fill: var(--halo);
    stroke: var(--ink);
    stroke-width: 2.4;
    stroke-linejoin: round;
  }
  .btn.charge {
    --btn: var(--pop);
    width: 8.5rem;
    font: 400 1.5rem var(--font-label);
    color: var(--ink);
  }
  .btn.charge::after {
    content: "";
    position: absolute;
    right: 6px;
    top: 5px;
    width: 14px;
    height: 14px;
    background: var(--sparkle);
  }
  /* Pressed: sinks onto its shadow. */
  .btn.on {
    transform: translate(4px, 5px);
    box-shadow: 0 0 0 3px var(--halo);
    --btn: color-mix(in srgb, var(--violet) 88%, white);
  }
  .btn.charge.on {
    --btn: color-mix(in srgb, var(--pop) 88%, white);
  }
  /* Landscape: over the game, so smaller and see-through until pressed. */
  .landscape .btn {
    width: 4rem;
    height: 4rem;
    opacity: 0.6;
  }
  .landscape .btn.charge {
    width: 6.5rem;
    font-size: 1.15rem;
  }
  .landscape .btn.on {
    opacity: 1;
  }
</style>
