<script lang="ts">
  // A small drawing of a fighter: its shape (custom or standard), color and eyes.
  import type { FighterShape } from "../sim/geometry";
  import { stickerSVG } from "../look/stickerSVG";

  let { shape, color, eyes = 0, size = 18 }: { shape: FighterShape | null; color: string; eyes?: number; size?: number } = $props();
  const svg = $derived(stickerSVG(shape, color, eyes));
</script>

<span class="icon" style:width="{size}px" style:height="{size}px" aria-hidden="true">{@html svg}</span>

<style>
  .icon {
    display: inline-block;
    flex: none;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
