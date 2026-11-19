<script lang="ts">
  // On top of a match: a pause/leave button, the pause menu, and end-of-match options.
  import type { Game, GameState } from "../game";

  let {
    game,
    gs,
    menuOpen = $bindable(false),
    onLeave,
    onChangeSetup,
  }: { game: Game; gs: GameState; menuOpen?: boolean; onLeave: () => void; onChangeSetup: () => void } = $props();

  const canPause = $derived(gs.mode === "local" || gs.mode === "replay");

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

{#if !gs.ended && !menuOpen}
  <button class="corner" onclick={openMenu} aria-label={canPause ? "pause" : "menu"}>{canPause ? "❚❚" : "☰"}</button>
{/if}

{#if menuOpen && !gs.ended}
  <div class="scrim">
    <div class="card narrow">
      <h2>{canPause ? "Paused" : "Menu"}</h2>
      <div class="stack">
        <button class="primary" onclick={resume}>{canPause ? "Resume" : "Back to the match"}</button>
        {#if gs.mode === "local"}<button onclick={restart}>Restart</button>{/if}
        <button onclick={onLeave}>{gs.mode === "online" ? "Leave match" : "Leave to menu"}</button>
      </div>
    </div>
  </div>
{/if}

{#if gs.ended}
  <div class="end">
    <div class="stack row">
      {#if gs.mode === "local"}
        <button class="primary" onclick={() => game.playAgain()}>Play again</button>
        <button onclick={onChangeSetup}>Change setup</button>
      {/if}
      <button onclick={onLeave}>Menu</button>
    </div>
  </div>
{/if}

<style>
  .corner {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 2.6rem;
    height: 2.6rem;
    padding: 0;
    pointer-events: auto;
  }
  .scrim {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0008;
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
  }
</style>
