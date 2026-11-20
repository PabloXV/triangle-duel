<script lang="ts">
  import { untrack } from "svelte";
  // The menus around the game. The game itself (canvas, sim, netcode) is plain
  // TypeScript in src/game.ts; screens only call its small API.
  import { DEFAULT_LOCAL_SETUP, type Game, type LocalSetup } from "../game";
  import type { FighterShape } from "../sim/geometry";
  import { shapeIssue } from "../sim/shapes";
  import { ROOM_CODE } from "../net/protocol";
  import InGame from "./InGame.svelte";
  import LocalSetupScreen from "./LocalSetup.svelte";
  import MainMenu from "./MainMenu.svelte";
  import CustomizeScreen from "./CustomizeScreen.svelte";
  import NameScreen from "./NameScreen.svelte";
  import OnlineMenu from "./OnlineMenu.svelte";
  import Room from "./Room.svelte";

  let { game }: { game: Game } = $props();

  const NAME_KEY = "triangle-duel.name";
  const SETUP_KEY = "triangle-duel.localSetup";
  const SHAPE_KEY = "triangle-duel.shape";
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
  type Screen = "name" | "menu" | "local" | "online" | "room" | "game" | "customize";
  const net = untrack(() => game.net); // `game` never changes
  let screen = $state<Screen>(savedName ? "menu" : "name");

  // An invite link (?join=ABCD): join that room, once we have a name. The
  // parameter is removed from the address right away, so a reload or leaving
  // the room doesn't rejoin.
  let pendingJoin: string | null = (() => {
    const url = new URL(location.href);
    const code = url.searchParams.get("join")?.trim().toUpperCase() ?? "";
    if (url.searchParams.has("join")) {
      url.searchParams.delete("join");
      history.replaceState(null, "", url);
    }
    return ROOM_CODE.test(code) ? code : null;
  })();
  function joinPending() {
    if (!pendingJoin) return false;
    net.connect(pendingJoin, name);
    pendingJoin = null;
    screen = "online"; // → the room once joined (or the reason it failed)
    return true;
  }
  untrack(() => {
    if (savedName) joinPending();
  });
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

  // My fighter shape: re-checked on load, so a stale or corrupted save falls back to standard.
  const savedShape = ((): FighterShape | null => {
    try {
      const s = JSON.parse(load(SHAPE_KEY) ?? "null") as FighterShape | null;
      return s && !shapeIssue(s) ? s : null;
    } catch {
      return null;
    }
  })();
  let shape = $state<FighterShape | null>(savedShape);
  untrack(() => game.setPlayerShape(savedShape));

  function saveShape(s: FighterShape | null) {
    shape = s;
    game.setPlayerShape(s);
    save(SHAPE_KEY, JSON.stringify(s));
    screen = "menu";
  }

  function setName(n: string) {
    name = n;
    save(NAME_KEY, n);
    screen = "menu";
    joinPending(); // came from an invite link: straight to that room
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
    const wasOnline = $game.mode === "online";
    game.leaveToMenu(); // (online: also leaves the room)
    screen = wasOnline ? "online" : "menu";
  }

  // Online, the screen follows the connection: joined → room; host started →
  // game; match over (host sent everyone back) → room; kicked or
  // disconnected → the online menu, which shows why.
  $effect(() => {
    const phase = $net.phase;
    const mode = $game.mode;
    if (mode === "online") screen = "game";
    else if (screen === "online" && phase === "lobby") screen = "room";
    else if (screen === "room" && phase === "offline") screen = "online";
    else if (screen === "game" && mode === "attract" && phase === "lobby") screen = "room";
  });

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
    <MainMenu
      {name}
      onLocal={() => (screen = "local")}
      onOnline={() => (screen = "online")}
      onRename={() => (screen = "name")}
      onCustomize={() => (screen = "customize")}
    />
  {:else if screen === "customize"}
    <CustomizeScreen
      initial={shape}
      standardArea={(game.params.triWidth * game.params.triHeight) / 2}
      onSave={saveShape}
      onBack={() => (screen = "menu")}
    />
  {:else if screen === "local"}
    <LocalSetupScreen initial={setup} onStart={startLocal} onBack={() => (screen = "menu")} />
  {:else if screen === "online"}
    <OnlineMenu {net} {name} onBack={() => (screen = "menu")} />
  {:else if screen === "room"}
    <Room {net} onStart={() => game.startOnline()} onLeave={() => net.leave()} />
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
