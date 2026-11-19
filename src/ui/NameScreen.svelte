<script lang="ts">
  // Pick a display name (anything; stored in this browser).
  import { untrack } from "svelte";
  let { initial = "", onDone }: { initial?: string; onDone: (name: string) => void } = $props();
  let name = $state(untrack(() => initial)); // starts from `initial` once
  const clean = $derived(name.trim().slice(0, 16));

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (clean) onDone(clean);
  }
</script>

<form class="card" onsubmit={submit}>
  <h1 class="title"><span class="logo">▽</span> Triangle Duel</h1>
  <label for="name">What should we call you?</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input id="name" bind:value={name} maxlength="16" placeholder="your name" autofocus autocomplete="off" />
  <button class="primary" type="submit" disabled={!clean}>Continue</button>
</form>
