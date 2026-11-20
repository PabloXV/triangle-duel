<script lang="ts">
  // Choose a map: one preview at a time, ◀ ▶ to flip through, a dot per map to
  // jump. Compact, however many maps there are. Read-only (just shows the
  // choice) when `disabled`.
  import { STAGES } from "../stages";
  import StagePreview from "./StagePreview.svelte";

  let { value, disabled = false, onPick }: { value: string; disabled?: boolean; onPick: (id: string) => void } = $props();
  const index = $derived(Math.max(0, STAGES.findIndex((s) => s.id === value)));
  const current = $derived(STAGES[index]);
  const flip = (d: number) => onPick(STAGES[(index + d + STAGES.length) % STAGES.length].id);
</script>

<div class="picker">
  <button class="nav" aria-label="previous map" disabled={disabled} onclick={() => flip(-1)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5V19L6 12Z" /></svg>
  </button>
  <div class="current">
    <StagePreview stage={current.stage} />
    <strong>{current.name}</strong>
    <span>{current.blurb}</span>
  </div>
  <button class="nav" aria-label="next map" disabled={disabled} onclick={() => flip(1)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5V19L18 12Z" /></svg>
  </button>
</div>
<div class="dots" role="group" aria-label="maps">
  {#each STAGES as s (s.id)}
    <button
      class="map"
      class:selected={value === s.id}
      aria-pressed={value === s.id}
      aria-label={s.name}
      title={s.name}
      disabled={disabled && value !== s.id}
      onclick={() => onPick(s.id)}
    ></button>
  {/each}
</div>

<style>
  .picker {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.8rem;
  }
  .current {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    width: 100%;
    max-width: 300px;
    justify-self: center;
  }
  .current strong {
    font: 400 1.2rem var(--font-label);
    color: var(--halo);
  }
  .current span {
    font-size: 0.85rem;
    color: var(--muted);
  }
  :global(.card) .nav {
    width: 2.6rem;
    height: 2.6rem;
    padding: 0;
    display: grid;
    place-items: center;
  }
  .nav svg {
    width: 1.2rem;
    height: 1.2rem;
  }
  .nav path {
    fill: var(--halo);
    stroke: var(--ink);
    stroke-width: 2.4;
    stroke-linejoin: round;
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 0.7rem;
    margin-top: 0.7rem;
  }
  :global(.card) button.map {
    width: 0.95rem;
    height: 0.95rem;
    padding: 0;
    border-width: 2px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--halo);
  }
  :global(.card) button.map.selected {
    box-shadow: 0 0 0 2px var(--halo), 0 0 0 5px var(--ink);
  }
</style>
