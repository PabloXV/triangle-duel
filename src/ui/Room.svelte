<script lang="ts">
  // A room before (and between) matches: who's here and the settings. The host
  // changes settings, adds bots, kicks, and starts; everyone else waits.
  import type { NetClient } from "../net/client";
  import { MAX_PLAYERS, MAX_STOCKS } from "../net/protocol";
  import { playerColor } from "../theme";
  import { isTouchDevice } from "../input";
  import ColorPicker from "./ColorPicker.svelte";
  import Panel from "./Panel.svelte";
  import FighterIcon from "./FighterIcon.svelte";
  import MapPicker from "./MapPicker.svelte";
  import Stepper from "./Stepper.svelte";

  let { net, onStart, onLeave, onColor }: { net: NetClient; onStart: () => void; onLeave: () => void; onColor: (color: number) => void } = $props();

  // My color, and who has the others (colors are unique in a room).
  const me = $derived($net.roster.find((p) => p.slot === $net.slot));
  /** The player list as MAX_PLAYERS rows: seated players in slot order, then empty seats (null). */
  const seats = $derived([...$net.roster, ...Array(Math.max(0, MAX_PLAYERS - $net.roster.length)).fill(null)] as (typeof $net.roster[number] | null)[]);
  const takenColors = $derived(new Map($net.roster.filter((p) => p.slot !== $net.slot).map((p) => [p.color, p.name] as [number, string])));

  const host = $derived($net.isHost);
  const bots = $derived($net.roster.filter((p) => p.bot).length);
  const humans = $derived($net.roster.length - bots);

  function setBots(n: number) {
    if (n > bots) net.addBot();
    else if (n < bots) net.removeBot();
  }

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
      <h2>Room <button class="code" onclick={() => copy($net.room, "code copied!")} title="Copy the room code">{$net.room}</button></h2>
      <span class="invite-wrap">
        <button class="primary invite" onclick={invite}>{canShare ? "Share invite" : "Copy invite link"}</button>
        {#if copied}<span class="toast" role="status">{copied}</span>{/if}
      </span>
    </div>
  {/snippet}

  {#if $net.error}<p class="error" role="alert">{$net.error}</p>{/if}
  {#if $net.slot === null}
    <p class="note">The room is full, so you're watching. You'll get a seat as soon as one frees up.</p>
  {/if}

  <section>
    <div class="section-head">
      <p class="label">Players {$net.roster.length}/{MAX_PLAYERS}</p>
      {#if host}
        <span class="bots"><span class="label">Bots</span><Stepper value={bots} min={0} max={MAX_PLAYERS - humans} label="bots" onChange={setBots} /></span>
      {/if}
    </div>
    <!-- Always MAX_PLAYERS rows (empty seats too), so adding a bot never moves anything. -->
    <ul class="roster">
      {#each seats as p, i (p ? `p${p.slot}` : `empty${i}`)}
        {#if p}
          <li>
            <FighterIcon shape={p.shape} color={playerColor(p.color)} eyes={p.eyes} size={30} />
            <span class="name">{p.name}</span>
            {#if p.host}<span class="tag">host</span>{/if}
            {#if p.bot}<span class="tag">bot</span>{/if}
            {#if p.slot === $net.slot}<span class="tag you">you</span>{/if}
            {#if host && p.slot !== $net.slot}
              <button class="kick" onclick={() => net.kick(p.slot)} aria-label={`kick ${p.name}`}>{p.bot ? "remove" : "kick"}</button>
            {/if}
          </li>
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

  <section>
    <div class="section-head">
      <p class="label">Match{host ? "" : " (the host decides)"}</p>
      <span class="bots"><span class="label">Stocks</span><Stepper value={$net.settings.stocks} min={1} max={MAX_STOCKS} label="stocks" disabled={!host} onChange={(stocks) => net.setSettings({ ...$net.settings, stocks })} /></span>
    </div>
    <MapPicker value={$net.settings.stageId} disabled={!host} onPick={(stageId) => host && net.setSettings({ ...$net.settings, stageId })} />
  </section>

  {#snippet footer()}
    <button onclick={onLeave}>Leave room</button>
    {#if host}
      <button class="primary" onclick={onStart} disabled={$net.roster.length < 2}>
        {$net.roster.length < 2 ? "Add a bot to start" : "Start match"}
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
  .bots {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    min-height: 2.75rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 85%, var(--bg));
  }
  .roster li.empty {
    background: none;
    border: 2px dashed color-mix(in srgb, var(--muted) 45%, transparent);
    color: var(--muted);
    font-size: 0.9rem;
  }
  .name {
    font-weight: 600;
  }
  .tag {
    font-size: 0.75rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 0.45rem;
  }
  .tag.you {
    color: var(--accent);
    border-color: var(--accent);
  }
  .kick {
    margin-left: auto;
    padding: 0.2rem 0.6rem !important;
    font-size: 0.85rem !important;
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
