<script lang="ts">
  // Pick a fighter color. `taken` marks colors someone else has (in a room,
  // colors are unique): shown but not pickable, with who has it.
  import { PLAYER_COLORS, PLAYER_COLOR_NAMES } from "../theme";

  let { value, taken = new Map(), onPick }: { value: number; taken?: Map<number, string>; onPick: (color: number) => void } = $props();
</script>

<div class="swatches" role="radiogroup" aria-label="fighter color">
  {#each PLAYER_COLORS as c, i}
    {@const by = taken.get(i)}
    <button
      class="swatch"
      class:mine={value === i}
      role="radio"
      aria-checked={value === i}
      aria-label="color: {PLAYER_COLOR_NAMES[i]}{by ? ` (taken by ${by})` : ''}"
      title={by ? `${PLAYER_COLOR_NAMES[i]}: taken by ${by}` : PLAYER_COLOR_NAMES[i]}
      disabled={!!by}
      style:--c={c}
      onclick={() => onPick(i)}
    >
      {#if by}<span class="who" aria-hidden="true">{by.slice(0, 1).toUpperCase()}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.3rem 0.2rem;
  }
  /* A small sticker: the color with an ink line and a white band (no label, no gloss). */
  :global(.card) .swatch {
    --btn-base: var(--c);
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--ink);
    text-shadow: none;
  }
  :global(.card) .swatch:disabled {
    --btn: color-mix(in srgb, var(--c) 45%, var(--slate));
    opacity: 0.75;
  }
  :global(.card) .swatch.mine {
    box-shadow:
      0 0 0 3px var(--halo),
      0 0 0 7px var(--pop),
      0 0 0 10px var(--ink),
      3px 4px 0 10px var(--shadow-ink);
  }
  .who {
    font: 400 0.95rem var(--font-label);
  }
</style>
