<script lang="ts">
  // On-screen controls for touch screens: ◀ ▶ under the left thumb, Charge
  // under the right, usable together (steer while charging), like ←/→ + ↓.
  //
  //   portrait:  a pad below the game (the canvas shrinks to make room), so
  //              thumbs never cover the action;
  //   landscape: invisible zones over the bottom of the game, with faint labels.
  //
  // Zones are bigger than the labels: the whole left side turns (left/right
  // half of it), the whole right side charges. A thumb that starts on the turn
  // side stays a turn thumb (it can slide between ◀ and ▶), and one that starts
  // on Charge stays Charge, so a drifting thumb can't start or drop a charge.
  import { onDestroy } from "svelte";
  import { touch } from "../input";

  let { layout }: { layout: "portrait" | "landscape" } = $props();

  type Zone = "left" | "right" | "charge";
  const pointers = new Map<number, Zone>();
  let pressed = $state({ left: false, right: false, charge: false });
  let el: HTMLDivElement;

  /** Where along the pad (0..1 of its width) a pointer is. */
  const fx = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  // Landscape leaves a dead strip in the middle; portrait splits the pad in half.
  const turnEnd = $derived(layout === "portrait" ? 0.5 : 0.42);
  const chargeStart = $derived(layout === "portrait" ? 0.5 : 0.58);

  function sync() {
    const zones = [...pointers.values()];
    for (const k of ["left", "right", "charge"] as const) touch[k] = pressed[k] = zones.includes(k);
  }

  function down(e: PointerEvent) {
    const x = fx(e);
    const zone: Zone | null = x < turnEnd ? (x < turnEnd / 2 ? "left" : "right") : x >= chargeStart ? "charge" : null;
    if (!zone) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, zone);
    sync();
  }

  function move(e: PointerEvent) {
    const zone = pointers.get(e.pointerId);
    if (zone === undefined || zone === "charge") return;
    const next = fx(e) < turnEnd / 2 ? "left" : "right";
    if (next !== zone) {
      pointers.set(e.pointerId, next);
      sync();
    }
  }

  function up(e: PointerEvent) {
    if (pointers.delete(e.pointerId)) sync();
  }

  onDestroy(() => {
    pointers.clear();
    touch.left = touch.right = touch.charge = false;
  });
</script>

<div
  bind:this={el}
  class="pad {layout}"
  role="group"
  aria-label="touch controls"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="turns" style:width="{turnEnd * 100}%">
    <div class="btn" class:on={pressed.left} data-zone="left">◀</div>
    <div class="btn" class:on={pressed.right} data-zone="right">▶</div>
  </div>
  <div class="charge-side" style:width="{(1 - chargeStart) * 100}%">
    <div class="btn charge" class:on={pressed.charge} data-zone="charge">Charge</div>
  </div>
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
    background: #17141f;
    border-top: 1px solid #ffffff14;
  }
  .pad.landscape {
    height: 60%;
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .turns,
  .charge-side {
    display: flex;
    align-items: center;
    justify-content: space-evenly;
    pointer-events: none; /* labels only: the pad itself takes the touches */
  }
  .landscape .turns,
  .landscape .charge-side {
    align-items: flex-end;
    padding-bottom: 1.2rem;
  }
  .btn {
    display: grid;
    place-items: center;
    width: 4.6rem;
    height: 4.6rem;
    border-radius: 1.2rem;
    background: #2a2438;
    border: 1px solid #ffffff22;
    color: #fffc;
    font: 700 1.6rem system-ui, sans-serif;
    transition: background 60ms, transform 60ms;
  }
  .btn.charge {
    width: 7rem;
    height: 7rem;
    border-radius: 50%;
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .landscape .btn {
    background: #ffffff10;
    border-color: #ffffff22;
    color: #fff8;
    width: 3.8rem;
    height: 3.8rem;
    font-size: 1.3rem;
  }
  .landscape .btn.charge {
    width: 5.6rem;
    height: 5.6rem;
    font-size: 0.9rem;
  }
  .btn.on {
    background: var(--accent);
    color: #1a1424;
    transform: scale(0.94);
  }
  .landscape .btn.on {
    background: #ff6b6b88;
    color: #fff;
  }
</style>
