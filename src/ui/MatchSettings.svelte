<script lang="ts">
  // The match rules, shared by local setup and the online room: map, stocks,
  // hops. Read-only (shows the host's choice) when `disabled`.
  import { MAX_STOCKS } from "../net/protocol";
  import MapPicker from "./MapPicker.svelte";
  import Stepper from "./Stepper.svelte";

  export interface MatchRules {
    stageId: string;
    stocks: number;
    hops: boolean;
  }

  let { value, disabled = false, label = "Match", onChange }: { value: MatchRules; disabled?: boolean; label?: string; onChange: (r: MatchRules) => void } = $props();
  const set = (patch: Partial<MatchRules>) => onChange({ ...value, ...patch });
</script>

<section class="rules">
  <p class="label">{label}</p>
  <div class="row">
    <span class="field"><span class="label">Stocks</span><Stepper value={value.stocks} min={1} max={MAX_STOCKS} label="stocks" {disabled} onChange={(stocks) => set({ stocks })} /></span>
    <span class="field" title="On: fighters hop whenever they land. Off: they stand still; only a charged jump leaves the ground.">
      <span class="label">Hops</span>
      <span class="segmented" role="group" aria-label="hops">
        <button class:selected={value.hops} aria-pressed={value.hops} {disabled} onclick={() => set({ hops: true })}>on</button>
        <button class:selected={!value.hops} aria-pressed={!value.hops} {disabled} onclick={() => set({ hops: false })}>off</button>
      </span>
    </span>
  </div>
  <MapPicker value={value.stageId} {disabled} onPick={(stageId) => set({ stageId })} />
</section>

<style>
  .rules {
    margin-top: 1.1rem;
  }
  .rules:first-child {
    margin-top: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.6rem;
    margin: 0.4rem 0 0.9rem;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
