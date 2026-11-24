<script lang="ts">
  // The lobby: who's here and the match settings, before (and between)
  // matches. The host fills empty seats with bots, sets each bot's level,
  // removes bots and kicks players, changes the settings, and starts; everyone
  // else waits. Just you and bots: the match runs on this machine; anyone else
  // here: online, through the relay (Game.playRoom).
  import type { NetClient } from "../net/client";
  import { BOT_LEVELS, MAX_PLAYERS, type BotLevel } from "../net/protocol";
  import { playerColor } from "../theme";
  import { isTouchDevice } from "../input";
  import ColorPicker from "./ColorPicker.svelte";
  import Panel from "./Panel.svelte";
  import FighterIcon from "./FighterIcon.svelte";
  import MatchSettings from "./MatchSettings.svelte";

  let { net, onStart, onLeave, onColor }: { net: NetClient; onStart: () => void; onLeave: () => void; onColor: (color: number) => void } = $props();

  const me = $derived($net.roster.find((p) => p.slot === $net.slot));
  /** One row per seat, by slot (fighter order), empty seats included, so adding a bot never moves anything. */
  const seats = $derived(Array.from({ length: MAX_PLAYERS }, (_, slot) => $net.roster.find((p) => p.slot === slot) ?? null));
  // My color, and who has the others (colors are unique in a room).
  const takenColors = $derived(new Map($net.roster.filter((p) => p.slot !== $net.slot).map((p) => [p.color, p.name] as [number, string])));
  const host = $derived($net.isHost);
  const connecting = $derived($net.phase === "connecting");

  const nextLevel = (l: BotLevel | null): BotLevel => BOT_LEVELS[(BOT_LEVELS.indexOf(l ?? "normal") + 1) % BOT_LEVELS.length];

  // An invite link: opening it joins this room (App.svelte reads ?join=).
  // (No "/" before "?" at the site root: same address, looks cleaner when shared.)
  const inviteUrl = $derived(`${location.origin}${location.pathname === "/" ? "" : location.pathname}?join=${$net.room}`);
  // Phones get the share sheet (Messages, WhatsApp, ...); elsewhere, copy.
  const canShare = typeof navigator.share === "function" && isTouchDevice();
  let copied = $state("");

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = ""), 1500);
    } catch {}
  }

  async function invite() {
    if (canShare) {
      try {
        await navigator.share({ title: "Triangle Duel", text: `Join my Triangle Duel room (${$net.room})`, url: inviteUrl });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // closed the share sheet
      }
    }
    await copy(inviteUrl, "link copied!");
  }
</script>

<Panel size="wide">
  {#snippet header()}
    <div class="room-head">
      {#if connecting}
        <h2>Opening a room…</h2>
      {:else if $net.local}
        <h2>Room</h2>
        <span class="hint offline">Offline: couldn't reach the server, so it's just you and bots.</span>
      {:else}
        <h2>Room <button class="code" onclick={() => copy($net.room, "code copied!")} title="Copy the room code">{$net.room}</button></h2>
        <span class="invite-wrap">
          <button class="primary invite" onclick={invite}>{canShare ? "Share invite" : "Copy invite link"}</button>
          {#if copied}<span class="toast" role="status">{copied}</span>{/if}
        </span>
      {/if}
    </div>
  {/snippet}

  {#if $net.error}<p class="error" role="alert">{$net.error}</p>{/if}
  {#if !connecting && $net.slot === null}
    <p class="note">The room is full, so you're watching. You'll get a seat as soon as one frees up.</p>
  {/if}

  <section>
    <p class="label">Players {$net.roster.length}/{MAX_PLAYERS}</p>
    <ul class="roster">
      {#each seats as p, slot (slot)}
        {#if p}
          <li>
            <FighterIcon shape={p.shape} color={playerColor(p.color)} eyes={p.eyes} size={30} />
            <span class="name">{p.name}</span>
            {#if p.host}<span class="tag">host</span>{/if}
            {#if p.slot === $net.slot}<span class="tag you">you</span>{/if}
            <span class="end">
              {#if p.bot}
                {#if host}
                  <button class="level" onclick={() => net.setBotLevel(p.slot, nextLevel(p.level))} aria-label={`${p.name}: ${p.level ?? "normal"} (change level)`} title="Change level">{p.level ?? "normal"}</button>
                {:else}
                  <span class="tag">{p.level ?? "normal"}</span>
                {/if}
              {/if}
              {#if host && p.slot !== $net.slot}
                <button class="kick" onclick={() => net.kick(p.slot)} aria-label={`${p.bot ? "remove" : "kick"} ${p.name}`} title={p.bot ? "Remove" : "Kick"}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
                </button>
              {/if}
            </span>
          </li>
        {:else if host}
          <li class="empty"><button class="add" onclick={() => net.addBot(slot)}>+ Add bot</button></li>
        {:else}
          <li class="empty">Open seat</li>
        {/if}
      {/each}
    </ul>
    {#if $net.spectators.length}<p class="hint">Watching: {$net.spectators.join(", ")}</p>{/if}
  </section>

  {#if me}
    <section>
      <p class="label">Your color</p>
      <ColorPicker value={me.color} taken={takenColors} onPick={onColor} />
    </section>
  {/if}

  <MatchSettings value={$net.settings} disabled={!host} label={host ? "Match" : "Match (the host decides)"} onChange={(s) => host && net.setSettings(s)} />

  {#snippet footer()}
    <button onclick={onLeave}>Leave</button>
    {#if connecting}
      <span class="hint waiting">Connecting…</span>
    {:else if host}
      <button class="primary" onclick={onStart} disabled={$net.roster.length < 2}>
        {$net.roster.length < 2 ? "Add a bot to start" : "Start"}
      </button>
    {:else}
      <span class="hint waiting">Waiting for the host to start…</span>
    {/if}
  {/snippet}
</Panel>

<style>
  .room-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .room-head h2 {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
  }
  .offline {
    flex-basis: 100%;
  }
  :global(.card) .code {
    font: 400 1.6rem var(--font-label);
    letter-spacing: 0.18em;
    padding: 0.1rem 0.6rem;
  }
  .invite-wrap {
    position: relative;
  }
  .toast {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    white-space: nowrap;
    font: 400 0.9rem var(--font-label);
    color: var(--halo);
  }
  section + section {
    margin-top: 1.1rem;
  }
  .label {
    margin-bottom: 0.4rem;
  }
  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .roster li {
    height: 2.9rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.6rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 85%, var(--bg));
  }
  .roster li.empty {
    background: none;
    border: 2px dashed color-mix(in srgb, var(--muted) 45%, transparent);
    color: var(--muted);
    font-size: 0.9rem;
  }
  .roster li.empty:has(.add) {
    padding: 0;
  }
  /* An empty seat, for the host: the whole row is the button. */
  .roster .add {
    width: 100%;
    height: 100%;
    padding: 0 0.6rem;
    text-align: left;
    font: 400 1rem var(--font-label);
    color: var(--muted);
    text-shadow: none;
    background: none;
    border: none;
    box-shadow: none;
    transform: none;
  }
  .roster .add:hover {
    color: var(--halo);
    background: color-mix(in srgb, var(--surface) 50%, transparent);
  }
  .roster .add::before {
    display: none;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tag {
    font-size: 0.75rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.45rem;
    white-space: nowrap;
  }
  .tag.you {
    color: var(--accent);
    border-color: var(--accent);
  }
  .end {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .roster .level {
    min-width: 5.2rem;
    padding: 0.15rem 0.6rem;
    font-size: 0.9rem;
  }
  .roster .kick {
    width: 2rem;
    height: 2rem;
    padding: 0;
    display: grid;
    place-items: center;
  }
  .kick svg {
    width: 0.9rem;
    height: 0.9rem;
    stroke: currentColor;
    stroke-width: 4;
    stroke-linecap: round;
  }
  .waiting {
    align-self: center;
  }
  .note {
    margin: 0 0 1rem;
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 85%, var(--bg));
  }
  .error {
    color: var(--accent);
    margin: 0 0 1rem;
  }
</style>
