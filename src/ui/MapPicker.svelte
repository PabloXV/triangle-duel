<script lang="ts">
  // Choose a map. Read-only (just shows the choice) when `disabled`.
  import { STAGES } from "../stages";
  import StagePreview from "./StagePreview.svelte";

  let { value, disabled = false, onPick }: { value: string; disabled?: boolean; onPick: (id: string) => void } = $props();
</script>

<div class="maps">
  {#each STAGES as s (s.id)}
    <button
      class="map"
      class:selected={value === s.id}
      onclick={() => onPick(s.id)}
      aria-pressed={value === s.id}
      disabled={disabled && value !== s.id}
    >
      <StagePreview stage={s.stage} />
      <strong>{s.name}</strong>
      <span>{s.blurb}</span>
    </button>
  {/each}
</div>

<style>
  .maps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1.1rem;
  }
  /* A picture card, not a toggle: it stays dark so the preview and text read;
     the chosen map gets a POP ring around its outline instead of a yellow body. */
  :global(.card) button.map {
    --btn-base: var(--panel);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    text-align: left;
    padding: 0.5rem 0.5rem 0.65rem;
    color: var(--halo);
    text-shadow: none;
  }
  :global(.card) button.map.selected {
    --btn-base: var(--panel);
    color: var(--halo);
    box-shadow:
      0 0 0 3px var(--halo),
      0 0 0 8px var(--pop),
      0 0 0 11px var(--ink),
      4px 5px 0 11px var(--shadow-ink);
  }
  .map strong {
    font: 400 1.15rem var(--font-label);
    padding: 0 0.2rem;
  }
  .map span {
    font: 400 0.82rem/1.3 var(--font-body);
    color: var(--muted);
    padding: 0 0.2rem;
  }
</style>
