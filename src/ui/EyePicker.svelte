<script lang="ts">
  // Pick an eye style (the eye sheet's 14), shown on the standard fighter in
  // your color, plus which mood to preview them in.
  import { EYE_MOODS, EYE_STYLES, type EyeMood } from "../look/eyes";
  import { stickerSVG } from "../look/stickerSVG";
  import { STANDARD_SHAPE } from "../sim/shapes";

  let { value, color, mood = $bindable("idle"), onPick }: { value: number; color: string; mood?: EyeMood; onPick: (eyes: number) => void } = $props();

  const MOOD_NAMES: Record<EyeMood, string> = { idle: "Idle", charge: "Charge", wobble: "Wobble", ko: "KO'd" };
  // Thumbnails use the standard fighter: on a skinny custom shape the faces get
  // too small to tell apart (the shape editor shows them on yours).
</script>

<div class="eye-grid">
  {#each EYE_STYLES as style, i}
    <button class="eye" class:selected={value === i} aria-pressed={value === i} aria-label="eyes: {style.name}" title={style.vibe} onclick={() => onPick(i)}>
      <span class="thumb">{@html stickerSVG(STANDARD_SHAPE, color, i, mood)}</span>
      <span class="nm">{style.name}</span>
    </button>
  {/each}
</div>
<div class="moods" role="group" aria-label="preview mood">
  {#each EYE_MOODS as m}
    <button class:selected={mood === m} aria-pressed={mood === m} onclick={() => (mood = m)}>{MOOD_NAMES[m]}</button>
  {/each}
</div>

<style>
  /* Its own scroll box (about three rows), so the page stays short and
     Save is in reach. Padding leaves room for the buttons' outlines and shadows. */
  .eye-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 0.7rem;
    max-height: 17rem;
    overflow-y: auto;
    padding: 0.6rem 0.9rem 0.9rem 0.6rem;
    border: 3px solid var(--ink);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 60%, var(--ink));
    overscroll-behavior: contain;
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
  .moods {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  :global(.card) .moods button {
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
  }
</style>
