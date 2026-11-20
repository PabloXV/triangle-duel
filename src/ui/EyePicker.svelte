<script lang="ts">
  // Pick an eye style (the eye sheet's 14), shown on the standard fighter in your color.
  import { EYE_STYLES } from "../look/eyes";
  import { stickerSVG } from "../look/stickerSVG";
  import { STANDARD_SHAPE } from "../sim/shapes";

  let { value, color, onPick }: { value: number; color: string; onPick: (eyes: number) => void } = $props();
  // Thumbnails use the standard fighter: on a skinny custom shape the faces get
  // too small to tell apart (the shape editor shows them on yours).
</script>

<div class="eye-grid">
  {#each EYE_STYLES as style, i}
    <button class="eye" class:selected={value === i} aria-pressed={value === i} aria-label="eyes: {style.name}" title={style.vibe} onclick={() => onPick(i)}>
      <span class="thumb">{@html stickerSVG(STANDARD_SHAPE, color, i)}</span>
      <span class="nm">{style.name}</span>
    </button>
  {/each}
</div>

<style>
  /* Padding leaves room for the buttons' outlines and shadows. */
  .eye-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 0.7rem;
    padding: 0.6rem 0.9rem 0.9rem 0.6rem;
    border: 3px solid var(--ink);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 60%, var(--ink));
  }
  :global(.card) button.eye {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    padding: 0.35rem 0.2rem 0.3rem;
    font-size: 0.75rem;
    text-shadow: none; /* small labels: the ink outline would swamp them */
  }
  .thumb {
    width: 54px;
    height: 54px;
    display: block;
  }
  .thumb :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .nm {
    color: var(--halo);
    white-space: nowrap;
  }
  .eye.selected .nm {
    color: var(--ink);
  }
</style>
