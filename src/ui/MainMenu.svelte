<script lang="ts">
  // The title screen: your fighter (tap it to edit), then where to play.
  import type { FighterShape } from "../sim/geometry";
  import { playerColor } from "../theme";
  import FighterIcon from "./FighterIcon.svelte";

  let {
    name,
    shape,
    eyes,
    color,
    onLocal,
    onOnline,
    onCustomize,
  }: {
    name: string;
    shape: FighterShape | null;
    eyes: number;
    color: number;
    onLocal: () => void;
    onOnline: () => void;
    onCustomize: () => void;
  } = $props();
</script>

<section class="card">
  <h1 class="title"><span class="logo">▽</span> Triangle Duel</h1>
  <button class="me" onclick={onCustomize} aria-label="edit your fighter">
    <FighterIcon {shape} color={playerColor(color)} {eyes} size={64} />
    <span class="who">
      <span class="name">{name}</span>
      <span class="edit">Edit fighter</span>
    </span>
  </button>
  <div class="stack">
    <button class="primary" onclick={onLocal}>Play locally</button>
    <button onclick={onOnline}>Play online</button>
  </div>
</section>

<style>
  :global(.card) button.me {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    width: 100%;
    margin: 0 0 1.25rem;
    padding: 0.6rem 0.9rem;
    text-align: left;
    background: color-mix(in srgb, var(--panel) 60%, var(--ink));
  }
  .who {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }
  .name {
    font: 400 1.5rem var(--font-label);
    color: var(--halo);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edit {
    font-size: 0.85rem;
    color: var(--muted);
    text-shadow: none;
  }
</style>
