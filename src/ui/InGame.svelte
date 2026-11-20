<script lang="ts">
  // On top of a match: a pause/leave button, the pause menu, and end-of-match options.
  import type { Game, GameState } from "../game";
  import { isTouchDevice } from "../input";
  import { KEYS, load, save } from "../storage";
  import TouchControls, { type TouchScheme } from "./TouchControls.svelte";

  let {
    game,
    gs,
    menuOpen = $bindable(false),
    onLeave,
    onChangeSetup,
  }: { game: Game; gs: GameState; menuOpen?: boolean; onLeave: () => void; onChangeSetup: () => void } = $props();

  const canPause = $derived(gs.mode === "local" || gs.mode === "replay");

  // Touch controls, when this screen is playing (not watching) a running match.
  const touchScreen = isTouchDevice();
  // Which touch scheme (stick or buttons), remembered on this device.
  let scheme = $state<TouchScheme>(load(KEYS.touchScheme) === "stick" ? "stick" : "buttons");
  function toggleScheme() {
    scheme = scheme === "stick" ? "buttons" : "stick";
    save(KEYS.touchScheme, scheme);
  }
  let vw = $state(0);
  let vh = $state(0);
  const layout = $derived(vh > vw ? "portrait" : "landscape");
  const showPad = $derived(touchScreen && gs.me !== null && !gs.ended && !menuOpen);
  // In portrait the pad sits below the game: shrink the canvas to make room.
  $effect(() => {
    document.body.classList.toggle("pad-portrait", showPad && layout === "portrait");
    return () => document.body.classList.remove("pad-portrait");
  });

  function openMenu() {
    menuOpen = true;
    game.setPaused(true);
  }
  function resume() {
    menuOpen = false;
    game.setPaused(false);
  }
  function restart() {
    menuOpen = false;
    game.playAgain();
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#if showPad}<TouchControls {layout} {scheme} />{/if}

{#if gs.notice}<div class="notice" role="status">{gs.notice}</div>{/if}

{#if !gs.ended && !menuOpen}
  <button class="corner sticker" onclick={openMenu} aria-label={canPause ? "pause" : "menu"}>
    <!-- Icons are marks: drawn shapes, white with an ink line (no glyphs). -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#if canPause}
        <rect x="5" y="4" width="5" height="16" rx="1.5" />
        <rect x="14" y="4" width="5" height="16" rx="1.5" />
      {:else}
        <rect x="3" y="5" width="18" height="3.4" rx="1.5" />
        <rect x="3" y="10.3" width="18" height="3.4" rx="1.5" />
        <rect x="3" y="15.6" width="18" height="3.4" rx="1.5" />
      {/if}
    </svg>
  </button>
{/if}

{#if menuOpen && !gs.ended}
  <div class="scrim">
    <div class="card narrow">
      <h2>{canPause ? "Paused" : "Menu"}</h2>
      <div class="stack">
        <button class="primary" onclick={resume}>{canPause ? "Resume" : "Back to the match"}</button>
        {#if gs.mode === "local"}<button onclick={restart}>Restart</button>{/if}
        {#if touchScreen}
          <button onclick={toggleScheme}>Touch controls: {scheme === "stick" ? "stick" : "buttons"}</button>
        {/if}
        <button onclick={onLeave}>{gs.mode === "online" ? "Leave match" : "Leave to menu"}</button>
      </div>
    </div>
  </div>
{/if}

{#if gs.ended}
  <div class="end">
    {#if gs.mode === "online"}
      <p class="note">Back to the room in a moment…</p>
    {:else}
    <div class="stack row">
      {#if gs.mode === "local"}
        <button class="sticker primary" onclick={() => game.playAgain()}>Play again</button>
        <button class="sticker" onclick={onChangeSetup}>Change setup</button>
      {/if}
      <button class="sticker" onclick={onLeave}>Menu</button>
    </div>
    {/if}
  </div>
{/if}

<style>
  .corner {
    position: absolute;
    top: 14px;
    right: 18px;
    width: 3rem;
    height: 3rem;
    padding: 0;
    display: grid;
    place-items: center;
    pointer-events: auto;
  }
  .corner::before {
    display: none; /* too small for the gloss */
  }
  .corner svg {
    width: 1.4rem;
    height: 1.4rem;
  }
  .corner rect {
    fill: var(--halo);
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .scrim {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--ink) 55%, transparent);
    pointer-events: auto;
  }
  .end {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(20% + 70px);
    display: flex;
    justify-content: center;
    pointer-events: auto;
  }
  .row {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.2rem;
  }
  .notice {
    position: absolute;
    top: 44px; /* below the online status line */
    left: 50%;
    transform: translateX(-50%);
    padding: 0.45rem 1rem;
    border-radius: 999px;
    background: var(--panel);
    border: 3px solid var(--ink);
    box-shadow: 0 0 0 3px var(--halo), 4px 5px 0 3px var(--shadow-ink);
    color: var(--halo);
    font: 400 1rem var(--font-label);
  }
  .note {
    color: var(--halo);
    text-shadow: var(--text-ink);
    font: 400 1.2rem var(--font-label);
    margin: 0;
  }
</style>
