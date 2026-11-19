<script lang="ts">
  // The menus around the game. The game itself (canvas, sim, netcode) is plain
  // TypeScript in src/game.ts; screens only call its small API.
  import { DEFAULT_LOCAL_SETUP, type Game, type LocalSetup } from "../game";
  import InGame from "./InGame.svelte";
  import LocalSetupScreen from "./LocalSetup.svelte";
  import MainMenu from "./MainMenu.svelte";
  import NameScreen from "./NameScreen.svelte";

  let { game }: { game: Game } = $props();

  const NAME_KEY = "triangle-duel.name";
  const SETUP_KEY = "triangle-duel.localSetup";
  const load = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // storage blocked: just don't remember
    }
  };
  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };

  const savedName = load(NAME_KEY) ?? "";
  let name = $state(savedName);
  type Screen = "name" | "menu" | "local" | "online" | "game";
  let screen = $state<Screen>(savedName ? "menu" : "name");
  let menuOpen = $state(false);
  $effect(() => {
    game.playerName = name || "player";
  });

  const savedSetup = (() => {
    try {
      return JSON.parse(load(SETUP_KEY) ?? "{}");
    } catch {
      return {}; // corrupted: use defaults
    }
  })();
  let setup = $state<LocalSetup>({ ...DEFAULT_LOCAL_SETUP, ...savedSetup });

  function setName(n: string) {
    name = n;
    save(NAME_KEY, n);
    screen = "menu";
  }

  function startLocal(s: LocalSetup) {
    setup = s;
    save(SETUP_KEY, JSON.stringify(s));
    menuOpen = false;
    game.playLocal(s);
    screen = "game";
  }

  function leave() {
    menuOpen = false;
    game.leaveToMenu();
    screen = "menu";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || screen !== "game" || $game.ended) return;
    menuOpen = !menuOpen;
    game.setPaused(menuOpen);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="ui" class:menus={screen !== "game"}>
  {#if screen === "name"}
    <NameScreen initial={name} onDone={setName} />
  {:else if screen === "menu"}
    <MainMenu {name} onLocal={() => (screen = "local")} onOnline={() => (screen = "online")} onRename={() => (screen = "name")} />
  {:else if screen === "local"}
    <LocalSetupScreen initial={setup} onStart={startLocal} onBack={() => (screen = "menu")} />
  {:else if screen === "online"}
    <div class="card">
      <h2>Play online</h2>
      <p class="muted">The online lobby is the next step. For now, online play is in the debug panel (press `).</p>
      <div class="actions"><button onclick={() => (screen = "menu")}>Back</button></div>
    </div>
  {:else if screen === "game"}
    <InGame {game} gs={$game} bind:menuOpen onLeave={leave} onChangeSetup={() => { game.leaveToMenu(); screen = "local"; }} />
  {/if}
</div>

<style>
  .ui {
    position: absolute;
    inset: 0;
    pointer-events: none; /* clicks pass through to nothing; children opt back in */
  }
  .ui.menus {
    display: grid;
    place-items: center;
    background: linear-gradient(#14121cc0, #14121ce0); /* the attract match shows through */
    pointer-events: auto;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
  }

  :global(:root) {
    --bg: #14121c;
    --card: #221d33f2;
    --line: #3d3556;
    --text: #ece8f6;
    --muted: #a59fba;
    --accent: #ff6b6b; /* P1's color */
    --accent-text: #1a0f12;
    --platform: #5c5470;
    --platform-light: #7a6f96;
    --radius: 10px;
    color-scheme: dark;
  }
  :global(.card) {
    pointer-events: auto;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 1.5rem 1.75rem;
    width: min(380px, 100%);
    box-sizing: border-box;
    color: var(--text);
    font-family: system-ui, sans-serif;
    box-shadow: 0 20px 60px #0008;
  }
  :global(.card.wide) {
    width: min(640px, 100%);
  }
  :global(.card.narrow) {
    width: min(300px, 100%);
  }
  :global(.title) {
    margin: 0 0 1rem;
    font-size: 2rem;
    letter-spacing: 0.02em;
  }
  :global(.logo) {
    color: var(--accent);
  }
  :global(.card h2) {
    margin: 0 0 1rem;
  }
  :global(.card button) {
    font: inherit;
    color: var(--text);
    background: #2e2742;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.65rem 1rem;
    cursor: pointer;
  }
  :global(.card button:hover:not(:disabled)) {
    border-color: var(--muted);
  }
  :global(.card button:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  :global(.card button.primary),
  :global(.end button.primary) {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
    font-weight: 700;
  }
  :global(.card button.selected) {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  :global(.card button.link) {
    background: none;
    border: none;
    padding: 0 0.25rem;
    color: var(--muted);
    text-decoration: underline;
  }
  :global(.card input:not([type])),
  :global(.card input[type="text"]) {
    font: inherit;
    width: 100%;
    box-sizing: border-box;
    padding: 0.65rem 0.8rem;
    margin: 0.4rem 0 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: #16121f;
    color: var(--text);
  }
  :global(.card fieldset) {
    border: none;
    padding: 0;
    margin: 0 0 1rem;
  }
  :global(.card legend) {
    color: var(--muted);
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
  }
  :global(.stack) {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  :global(.actions) {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  :global(.hint),
  :global(.muted) {
    color: var(--muted);
    font-size: 0.85rem;
  }
  :global(.end button),
  :global(.corner) {
    font: 600 1rem system-ui, sans-serif;
    color: var(--text);
    background: #2e2742e8;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.65rem 1.1rem;
    cursor: pointer;
  }
</style>
