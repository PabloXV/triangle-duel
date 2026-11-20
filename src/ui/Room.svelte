<script lang="ts">
  // A room before (and between) matches: who's here and the settings. The host
  // changes settings, adds bots, kicks, and starts; everyone else waits.
  import type { NetClient } from "../net/client";
  import { MAX_PLAYERS, MAX_STOCKS } from "../net/protocol";
  import { playerColor } from "../theme";
  import { isTouchDevice } from "../input";
  import ColorPicker from "./ColorPicker.svelte";
  import FighterIcon from "./FighterIcon.svelte";
  import MapPicker from "./MapPicker.svelte";
  import Stepper from "./Stepper.svelte";

  let { net, onStart, onLeave, onColor }: { net: NetClient; onStart: () => void; onLeave: () => void; onColor: (color: number) => void } = $props();

  // My color, and who has the others (colors are unique in a room).
  const me = $derived($net.roster.find((p) => p.slot === $net.slot));
  const takenColors = $derived(new Map($net.roster.filter((p) => p.slot !== $net.slot).map((p) => [p.color, p.name] as [number, string])));

  const host = $derived($net.isHost);
  const bots = $derived($net.roster.filter((p) => p.bot).length);
  const humans = $derived($net.roster.length - bots);

  function setBots(n: number) {
    if (n > bots) net.addBot();
    else if (n < bots) net.removeBot();
  }

  // An invite link: opening it joins this room (App.svelte reads ?join=).
  const inviteUrl = $derived(`${location.origin}${location.pathname}?join=${$net.room}`);
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

<div class="card wide">
  <div class="top">
    <div>
      <p class="label">Room code</p>
      <div class="code-row">
        <button class="code" onclick={() => copy($net.room, "code copied!")} title="Copy the code">{$net.room}</button>
        <button class="primary invite" onclick={invite}>{canShare ? "Share invite" : "Copy invite link"}</button>
      </div>
      <span class="hint">{copied || "anyone with the link joins this room"}</span>
    </div>
    {#if $net.rttMs !== null}<span class="hint">ping {Math.round($net.rttMs)} ms</span>{/if}
  </div>

  {#if $net.error}<p class="error" role="alert">{$net.error}</p>{/if}
  {#if $net.slot === null}
    <p class="note">The room is full, so you're watching. You'll get a seat as soon as one frees up.</p>
  {/if}

  <fieldset>
    <legend>Players ({$net.roster.length}/{MAX_PLAYERS})</legend>
    <ul class="roster">
      {#each $net.roster as p (p.slot)}
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
      {/each}
    </ul>
  </fieldset>
  {#if $net.spectators.length}<p class="hint">Watching: {$net.spectators.join(", ")}</p>{/if}

  {#if me}
    <fieldset>
      <legend>Your color</legend>
      <ColorPicker value={me.color} taken={takenColors} onPick={onColor} />
    </fieldset>
  {/if}

  {#if host}
    <fieldset>
      <legend>Bots</legend>
      <Stepper value={bots} min={0} max={MAX_PLAYERS - humans} label="bots" onChange={setBots} />
    </fieldset>
  {/if}

  <fieldset>
    <legend>Map{host ? "" : " (the host picks)"}</legend>
    <MapPicker value={$net.settings.stageId} disabled={!host} onPick={(stageId) => host && net.setSettings({ ...$net.settings, stageId })} />
  </fieldset>

  <fieldset>
    <legend>Stocks</legend>
    <Stepper
      value={$net.settings.stocks}
      min={1}
      max={MAX_STOCKS}
      label="stocks"
      disabled={!host}
      onChange={(stocks) => net.setSettings({ ...$net.settings, stocks })}
    />
  </fieldset>

  <div class="actions">
    <button onclick={onLeave}>Leave room</button>
    {#if host}
      <button class="primary" onclick={onStart} disabled={$net.roster.length < 2}>
        {$net.roster.length < 2 ? "Need 2+ players (add a bot?)" : "Start match"}
      </button>
    {:else}
      <span class="hint waiting">Waiting for the host to start…</span>
    {/if}
  </div>
</div>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }
  .label {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .code-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.3rem;
  }
  .code {
    font-size: 2rem !important;
    font-weight: 800;
    letter-spacing: 0.25em;
    padding: 0.2rem 0.6rem !important;
    margin-right: 0.5rem;
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
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--surface) 85%, var(--bg));
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
