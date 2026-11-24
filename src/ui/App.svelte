<script lang="ts">
  import { untrack } from "svelte";
  // The menus around the game. The game itself (canvas, sim, netcode) is plain
  // TypeScript in src/game.ts; screens only call its small API.
  import type { Game } from "../game";
  import type { FighterShape } from "../sim/geometry";
  import { shapeIssue } from "../sim/shapes";
  import { eyeStyle } from "../look/eyes";
  import { colorIndex } from "../theme";
  import { KEYS, load, loadJSON, save, saveJSON } from "../storage";
  import { BOT_LEVELS, DEFAULT_ROOM_SETTINGS, MAX_STOCKS, ROOM_CODE, randomRoomCode, type BotLevel } from "../net/protocol";
  import type { RoomSetup } from "../net/client";
  import { stageById } from "../stages";
  import InGame from "./InGame.svelte";
  import MainMenu from "./MainMenu.svelte";
  import CustomizeScreen from "./CustomizeScreen.svelte";
  import NameScreen from "./NameScreen.svelte";
  import JoinRoom from "./JoinRoom.svelte";
  import Room from "./Room.svelte";

  let { game }: { game: Game } = $props();

  const savedName = load(KEYS.name) ?? "";
  let name = $state(savedName);
  type Screen = "name" | "menu" | "join" | "room" | "game" | "customize";
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
    screen = "join"; // → the room once joined (or the reason it failed)
    return true;
  }
  untrack(() => {
    if (savedName) joinPending();
  });
  let menuOpen = $state(false);
  $effect(() => {
    game.profile.name = name || "player";
  });

  /** Why we're back on the main menu, if something went wrong (kicked, disconnected). */
  let notice = $state<string | null>(null);

  // Play opens a new room set up like your last match (re-checked on load:
  // anything unknown falls back to the defaults). New players start with one bot.
  function savedSetup(): RoomSetup {
    const s = loadJSON<Partial<RoomSetup>>(KEYS.roomSetup, {});
    const st = { ...DEFAULT_ROOM_SETTINGS, ...(s.settings ?? {}) };
    const settings = {
      stageId: stageById(st.stageId).id,
      stocks: Number.isInteger(st.stocks) && st.stocks >= 1 && st.stocks <= MAX_STOCKS ? st.stocks : DEFAULT_ROOM_SETTINGS.stocks,
      hops: typeof st.hops === "boolean" ? st.hops : DEFAULT_ROOM_SETTINGS.hops,
    };
    const bots = Array.isArray(s.bots) ? s.bots.filter((l): l is BotLevel => BOT_LEVELS.includes(l)).slice(0, 3) : ["normal" as BotLevel];
    return { settings, bots };
  }

  function play() {
    notice = null;
    net.connect(randomRoomCode(), name, savedSetup());
    screen = "room";
  }

  /** The room as it is now (settings, bots), to remember or to carry over. */
  const currentSetup = (): RoomSetup => ({ settings: $net.settings, bots: $net.roster.filter((p) => p.bot).map((p) => p.level ?? "normal") });

  /** Offline room: try the server again, keeping the bots and settings. */
  function retry() {
    net.connect(randomRoomCode(), name, currentSetup());
  }

  /** Host: start (and remember this setup for the next room). */
  function start() {
    saveJSON(KEYS.roomSetup, currentSetup());
    game.playRoom();
    if (game.current.mode === "local") screen = "game"; // (online, the screen follows the relay: the match starts when it says so)
  }

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

  function saveFighter(n: string, s: FighterShape | null, e: number, c: number) {
    name = n;
    save(KEYS.name, n);
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

  // Leaving a match: online, that's leaving the room too (back to the menu);
  // a match on this machine goes back to the room.
  function leave() {
    menuOpen = false;
    game.leaveToMenu(); // (online: also leaves the room)
    screen = $net.phase === "lobby" ? "room" : "menu";
  }

  function leaveRoom() {
    net.leave();
    notice = null;
    screen = "menu";
  }

  // The screen follows the connection: joined → room; an online match started
  // → game; match over (host sent everyone back) → room; kicked or
  // disconnected → the main menu, which says why.
  $effect(() => {
    const phase = $net.phase;
    const mode = $game.mode;
    if (mode === "online") screen = "game";
    else if (screen === "join" && phase === "lobby") screen = "room";
    else if (screen === "room" && phase === "offline") {
      notice = $net.error;
      screen = "menu";
    } else if (screen === "game" && mode === "attract" && phase === "lobby") screen = "room";
  });

  // Playing bots on this machine while someone joins the room: say so.
  let humansSeen = new Set<string>();
  $effect(() => {
    const humans = $net.roster.filter((p) => !p.bot && p.slot !== $net.slot).map((p) => `${p.slot}:${p.name}`);
    if (screen === "game" && $game.mode === "local") {
      const joined = humans.filter((h) => !humansSeen.has(h));
      if (joined.length) game.announce(`${joined.map((h) => h.slice(h.indexOf(":") + 1)).join(" and ")} joined the room`);
    }
    humansSeen = new Set(humans);
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
      {shape}
      {eyes}
      {color}
      {notice}
      onPlay={play}
      onJoin={() => {
        notice = null;
        screen = "join";
      }}
      onCustomize={() => (screen = "customize")}
    />
  {:else if screen === "customize"}
    <CustomizeScreen
      initial={shape}
      initialName={name}
      initialEyes={eyes}
      initialColor={color}
      standardArea={(game.params.triWidth * game.params.triHeight) / 2}
      onSave={saveFighter}
      onBack={() => (screen = "menu")}
    />
  {:else if screen === "join"}
    <JoinRoom {net} {name} onBack={leaveRoom} />
  {:else if screen === "room"}
    <Room {net} onStart={start} onLeave={leaveRoom} onColor={setColor} onRetry={retry} />
  {:else if screen === "game"}
    <InGame {game} gs={$game} bind:menuOpen onLeave={leave} />
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
