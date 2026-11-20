<script lang="ts">
  import { untrack } from "svelte";
  // The menus around the game. The game itself (canvas, sim, netcode) is plain
  // TypeScript in src/game.ts; screens only call its small API.
  import { DEFAULT_LOCAL_SETUP, type Game, type LocalSetup } from "../game";
  import type { FighterShape } from "../sim/geometry";
  import { shapeIssue } from "../sim/shapes";
  import { eyeStyle } from "../look/eyes";
  import { colorIndex } from "../theme";
  import { KEYS, load, loadJSON, save, saveJSON } from "../storage";
  import { ROOM_CODE } from "../net/protocol";
  import InGame from "./InGame.svelte";
  import LocalSetupScreen from "./LocalSetup.svelte";
  import MainMenu from "./MainMenu.svelte";
  import CustomizeScreen from "./CustomizeScreen.svelte";
  import NameScreen from "./NameScreen.svelte";
  import OnlineMenu from "./OnlineMenu.svelte";
  import Room from "./Room.svelte";

  let { game }: { game: Game } = $props();

  const savedName = load(KEYS.name) ?? "";
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

  let setup = $state<LocalSetup>({ ...DEFAULT_LOCAL_SETUP, ...loadJSON<Partial<LocalSetup>>(KEYS.localSetup, {}) });

  // My fighter shape: re-checked on load, so a stale or corrupted save falls back to standard.
  const savedShape = ((): FighterShape | null => {
    const s = loadJSON<FighterShape | null>(KEYS.shape, null);
    return s && !shapeIssue(s) ? s : null;
  })();
  let shape = $state<FighterShape | null>(savedShape);
  untrack(() => game.setPlayerShape(savedShape));
  // My eye style and color (re-checked on load: anything unknown → the default).
  let eyes = $state(eyeStyle(Number(load(KEYS.eyes) ?? 0)));
  untrack(() => game.setPlayerEyes(eyes));
  let color = $state(colorIndex(Number(load(KEYS.color) ?? 0)));
  untrack(() => game.setPlayerColor(color));

  /** My color: from Customize, or picked in a room (asks the room; remembered either way). */
  function setColor(c: number) {
    color = c;
    game.setPlayerColor(c);
    save(KEYS.color, String(c));
  }

  function saveFighter(s: FighterShape | null, e: number, c: number) {
    shape = s;
    eyes = e;
    game.setPlayerShape(s);
    game.setPlayerEyes(e);
    setColor(c);
    saveJSON(KEYS.shape, s);
    save(KEYS.eyes, String(e));
    screen = "menu";
  }

  function setName(n: string) {
    name = n;
    save(KEYS.name, n);
    screen = "menu";
    joinPending(); // came from an invite link: straight to that room
  }

  function startLocal(s: LocalSetup) {
    setup = s;
    saveJSON(KEYS.localSetup, s);
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
      initialEyes={eyes}
      initialColor={color}
      standardArea={(game.params.triWidth * game.params.triHeight) / 2}
      onSave={saveFighter}
      onBack={() => (screen = "menu")}
    />
  {:else if screen === "local"}
    <LocalSetupScreen initial={setup} onStart={startLocal} onBack={() => (screen = "menu")} />
  {:else if screen === "online"}
    <OnlineMenu {net} {name} onBack={() => (screen = "menu")} />
  {:else if screen === "room"}
    <Room {net} onStart={() => game.startOnline()} onLeave={() => net.leave()} onColor={setColor} />
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
    background: linear-gradient(color-mix(in srgb, var(--bg) 75%, transparent), color-mix(in srgb, var(--bg) 88%, transparent)); /* the attract match shows through */
    pointer-events: auto;
    overflow-y: auto;
    padding: 24px 16px 110px; /* room below for the panels' drips */
    box-sizing: border-box;
  }

  /* Shared menu styles (panels, sticker buttons, titles): src/ui/theme.css. */
</style>
