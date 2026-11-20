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

<!-- A tiny version of the match scene: the wall, then platforms as violet slabs
     with an ink line and the ground line on top (as in the game). -->
<svg {viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  {#each stage.platforms as p}
    <rect
      x={p.center.x - p.halfWidth}
      y={-(p.center.y + p.halfHeight)}
      width={p.halfWidth * 2}
      height={p.oneWay ? 0.36 : p.halfHeight < 0.5 ? p.halfHeight * 2 : 1.32}
      rx="0.15"
      class="slab"
    />
    <line
      x1={p.center.x - p.halfWidth + 0.25}
      x2={p.center.x + p.halfWidth - 0.25}
      y1={-(p.center.y + p.halfHeight) + 0.18}
      y2={-(p.center.y + p.halfHeight) + 0.18}
      class="ground"
    />
  {/each}
</svg>

<style>
  svg {
    width: 100%;
    aspect-ratio: 16 / 7;
    display: block;
    border-radius: 6px;
    border: 2px solid var(--ink);
    box-sizing: border-box;
    background: var(--grain), linear-gradient(var(--wall-top), var(--wall-bottom));
    background-blend-mode: multiply, normal;
  }
  .slab {
    fill: var(--violet);
    stroke: var(--ink);
    stroke-width: 0.3;
    stroke-linejoin: round;
  }
  .ground {
    stroke: var(--platform-light);
    stroke-width: 0.3;
    stroke-linecap: round;
  }
</style>
