<script lang="ts">
  // A small drawing of a stage's platforms, from the same data the sim uses,
  // framed around the platforms (with margin) so it reads at thumbnail size.
  import type { Stage } from "../sim/geometry";

  let { stage }: { stage: Stage } = $props();
  const PAD_X = 2;
  const PAD_Y = 2.5;
  const viewBox = $derived.by(() => {
    const ps = stage.platforms;
    const minX = Math.min(...ps.map((p) => p.center.x - p.halfWidth)) - PAD_X;
    const maxX = Math.max(...ps.map((p) => p.center.x + p.halfWidth)) + PAD_X;
    const minY = Math.min(...ps.map((p) => p.center.y - p.halfHeight)) - PAD_Y;
    const maxY = Math.max(...ps.map((p) => p.center.y + p.halfHeight)) + PAD_Y;
    // SVG y points down; the sim's y points up.
    return `${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`;
  });
</script>

<svg {viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  {#each stage.platforms as p}
    <rect
      x={p.center.x - p.halfWidth}
      y={-(p.center.y + p.halfHeight)}
      width={p.halfWidth * 2}
      height={p.halfHeight * 2}
      class:oneway={p.oneWay}
    />
  {/each}
</svg>

<style>
  svg {
    width: 100%;
    aspect-ratio: 16 / 7;
    display: block;
  }
  rect {
    fill: var(--platform);
  }
  rect.oneway {
    fill: var(--platform-light);
  }
</style>
