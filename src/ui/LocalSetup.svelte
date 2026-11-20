<script lang="ts">
  // Set up a match on this machine: map, bots, stocks, difficulty, 2nd player.
  import { untrack } from "svelte";
  import type { BotLevel, LocalSetup } from "../game";
  import { isTouchDevice } from "../input";
  import MapPicker from "./MapPicker.svelte";
  import Stepper from "./Stepper.svelte";

  let { initial, onStart, onBack }: { initial: LocalSetup; onStart: (s: LocalSetup) => void; onBack: () => void } = $props();

  // The form starts from `initial` once; later changes to the prop don't reset it.
  const init = untrack(() => initial);
  let stageId = $state(init.stageId);
  let bots = $state(init.bots);
  let stocks = $state(init.stocks);
  let botLevel = $state<BotLevel>(init.botLevel);
  // A second player needs a keyboard: not offered on touch screens.
  const touchScreen = isTouchDevice();
  let secondPlayer = $state(init.secondPlayer && !touchScreen);

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
    <MapPicker value={stageId} onPick={(id) => (stageId = id)} />
  </fieldset>

  <div class="row">
    <fieldset>
      <legend>Bots</legend>
      <Stepper bind:value={bots} min={minBots} max={maxBots} label="bots" />
    </fieldset>
    <fieldset>
      <legend>Stocks</legend>
      <Stepper bind:value={stocks} min={1} max={5} label="stocks" />
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

  {#if !touchScreen}
    <label class="check">
      <input type="checkbox" bind:checked={secondPlayer} />
      Second player on this keyboard (A / D / S)
    </label>
  {/if}

  <div class="actions">
    <button onclick={onBack}>Back</button>
    <button class="primary" onclick={start}>Start</button>
  </div>
  <p class="hint">{touchScreen ? "Left thumb: ◀ ▶ turn · right thumb: hold Charge" : "You: ← → rotate, ↓ charge · Esc: pause"}</p>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
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
