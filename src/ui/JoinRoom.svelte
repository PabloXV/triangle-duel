<script lang="ts">
  // Join a friend's room by its code. (Invite links skip this: App.svelte.)
  import type { NetClient } from "../net/client";
  import { ROOM_CODE } from "../net/protocol";
  import Panel from "./Panel.svelte";

  let { net, name, onBack }: { net: NetClient; name: string; onBack: () => void } = $props();
  let code = $state("");
  const cleaned = $derived(code.trim().toUpperCase());
  const valid = $derived(ROOM_CODE.test(cleaned));
  // Only errors from joining here (not, say, why you left the last room).
  let tried = $state(false);

  function join(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    tried = true;
    net.connect(cleaned, name);
  }
</script>

<Panel title="Join a room">
  {#if tried && $net.error}<p class="error" role="alert">{$net.error}</p>{/if}
  <form class="join" onsubmit={join}>
    <label class="label" for="code">Got a code from a friend?</label>
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input id="code" type="text" bind:value={code} maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false" autofocus />
      <button type="submit" class="primary" disabled={!valid || $net.phase === "connecting"}>Join</button>
    </div>
    {#if code && !valid}<p class="hint">Room codes are 4 letters.</p>{/if}
  </form>

  {#snippet footer()}
    <button onclick={onBack}>Back</button>
    {#if $net.phase === "connecting"}<span class="hint">Connecting…</span>{/if}
  {/snippet}
</Panel>

<style>
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
