<script lang="ts">
  let {
    name,
    onLocal,
    onOnline,
    onRename,
    onCustomize,
  }: { name: string; onLocal: () => void; onOnline: () => void; onRename: () => void; onCustomize: () => void } = $props();
</script>

<div class="card">
  <h1 class="title"><span class="logo">▽</span> Triangle Duel</h1>
  <p class="hello">
    Playing as <strong>{name}</strong>
    <button class="link" onclick={onRename}>change</button>
  </p>
  <div class="stack">
    <button class="primary" onclick={onLocal}>Play locally</button>
    <button onclick={onOnline}>Play online</button>
    <button onclick={onCustomize}>Customize fighter</button>
  </div>
</div>

<style>
  .hello {
    margin: 0 0 1.25rem;
    color: var(--muted);
  }
</style>
