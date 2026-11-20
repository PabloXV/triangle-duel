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
    gap: 0.75rem;
  }
  .map {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    text-align: left;
    padding: 0.6rem !important;
  }
  .map span {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
