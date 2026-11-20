<script lang="ts">
  // A small drawing of a fighter's shape (a custom one, or the standard one).
  import type { FighterShape } from "../sim/geometry";
  import { STANDARD_SHAPE } from "../sim/shapes";

  let { shape, color, size = 18 }: { shape: FighterShape | null; color: string; size?: number } = $props();
  const s = $derived(shape ?? STANDARD_SHAPE);
  const xs = $derived(s.vertices.map((v) => v.x));
  const ys = $derived(s.vertices.map((v) => -v.y)); // SVG y points down
  const pad = 0.1;
  const viewBox = $derived(`${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + 2 * pad}`);
  const points = $derived(s.vertices.map((v) => `${v.x},${-v.y}`).join(" "));
</script>

<svg {viewBox} width={size} height={size} aria-hidden="true">
  <polygon {points} fill={color} />
</svg>
