<script lang="ts">
  // Set up a match on this machine: map, bots, stocks, difficulty, 2nd player.
  import { untrack } from "svelte";
  import type { BotLevel, LocalSetup } from "../game";
  import { STAGES } from "../stages";
  import StagePreview from "./StagePreview.svelte";

  let { initial, onStart, onBack }: { initial: LocalSetup; onStart: (s: LocalSetup) => void; onBack: () => void } = $props();

  // The form starts from `initial` once; later changes to the prop don't reset it.
  const init = untrack(() => initial);
  let stageId = $state(init.stageId);
  let bots = $state(init.bots);
  let stocks = $state(init.stocks);
  let botLevel = $state<BotLevel>(init.botLevel);
  let secondPlayer = $state(init.secondPlayer);

  // 2–4 fighters in total: you (+ a 2nd player) + bots.
  const humans = $derived(secondPlayer ? 2 : 1);
  const minBots = $derived(2 - humans);
  const maxBots = $derived(4 - humans);
  $effect(() => {
    bots = Math.min(maxBots, Math.max(minBots, bots));
  });

  function start() {
    onStart({ stageId, bots, stocks, botLevel, secondPlayer });
  }
</script>

<div class="card wide">
  <h2>Play locally</h2>

  <fieldset>
    <legend>Map</legend>
    <div class="maps">
      {#each STAGES as s (s.id)}
        <button class="map" class:selected={stageId === s.id} onclick={() => (stageId = s.id)} aria-pressed={stageId === s.id}>
          <StagePreview stage={s.stage} />
          <strong>{s.name}</strong>
          <span>{s.blurb}</span>
        </button>
      {/each}
    </div>
  </fieldset>

  <div class="row">
    <fieldset>
      <legend>Bots</legend>
      <div class="stepper">
        <button onclick={() => bots--} disabled={bots <= minBots} aria-label="fewer bots">−</button>
        <output>{bots}</output>
        <button onclick={() => bots++} disabled={bots >= maxBots} aria-label="more bots">+</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>Stocks</legend>
      <div class="stepper">
        <button onclick={() => stocks--} disabled={stocks <= 1} aria-label="fewer stocks">−</button>
        <output>{stocks}</output>
        <button onclick={() => stocks++} disabled={stocks >= 5} aria-label="more stocks">+</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>Bot level</legend>
      <div class="segmented">
        {#each ["easy", "normal", "hard"] as const as level}
          <button class:selected={botLevel === level} onclick={() => (botLevel = level)} aria-pressed={botLevel === level}>{level}</button>
        {/each}
      </div>
    </fieldset>
  </div>

  <label class="check">
    <input type="checkbox" bind:checked={secondPlayer} />
    Second player on this keyboard (A / D / S)
  </label>

  <div class="actions">
    <button onclick={onBack}>Back</button>
    <button class="primary" onclick={start}>Start</button>
  </div>
  <p class="hint">You: ← → rotate, ↓ charge · Esc: pause</p>
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
    padding: 0.6rem;
  }
  .map span {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .stepper button {
    width: 2.25rem;
    padding: 0.35rem 0;
  }
  .stepper output {
    min-width: 1.5rem;
    text-align: center;
    font-size: 1.2rem;
    font-weight: 700;
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border-radius: 0;
    padding: 0.4rem 0.7rem;
  }
  .segmented button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .segmented button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 1rem 0;
  }
</style>
