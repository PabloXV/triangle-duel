<script lang="ts">
  // Create a room, or join one by its code.
  import type { NetClient } from "../net/client";
  import { ROOM_CODE, randomRoomCode } from "../net/protocol";

  let { net, name, onBack }: { net: NetClient; name: string; onBack: () => void } = $props();
  let code = $state("");
  const cleaned = $derived(code.trim().toUpperCase());
  const valid = $derived(ROOM_CODE.test(cleaned));

  function join(e: SubmitEvent) {
    e.preventDefault();
    if (valid) net.connect(cleaned, name);
  }
</script>

<div class="card">
  <h2>Play online</h2>
  {#if $net.error}<p class="error" role="alert">{$net.error}</p>{/if}
  <div class="stack">
    <button class="primary" onclick={() => net.connect(randomRoomCode(), name)} disabled={$net.phase === "connecting"}>Create a room</button>
  </div>
  <form class="join" onsubmit={join}>
    <label for="code">…or join one with its code</label>
    <div class="row">
      <input id="code" type="text" bind:value={code} maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false" />
      <button type="submit" disabled={!valid || $net.phase === "connecting"}>Join</button>
    </div>
    {#if code && !valid}<p class="hint">Room codes are 4 letters.</p>{/if}
  </form>
  {#if $net.phase === "connecting"}<p class="hint">Connecting…</p>{/if}
  <div class="actions"><button onclick={onBack}>Back</button></div>
</div>

<style>
  .join {
    margin-top: 1.25rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .row input {
    margin: 0.4rem 0 !important;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-weight: 700;
  }
  .error {
    color: var(--accent);
    margin: 0 0 1rem;
  }
</style>
