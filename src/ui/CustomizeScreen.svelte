<script lang="ts">
  // Shape your fighter. Drag the two top corners anywhere, and the foot left or
  // right along the ground. On release, the shape settles into balance (center
  // of mass straight above the foot) at the standard fighter's mass (area).
  // Shapes breaking the limits get pushed back toward where you started.
  import { untrack } from "svelte";
  import type { FighterShape, Vec2 } from "../sim/geometry";
  import { STANDARD_SHAPE, balanceShape, shapeIssue, shapeSize, triangleArea } from "../sim/shapes";
  import { playerColor } from "../theme";
  import { EYE_MOODS, EYE_STYLES, type EyeMood } from "../look/eyes";
  import { stickerInWorld, stickerSVG } from "../look/stickerSVG";

  const MOOD_NAMES: Record<EyeMood, string> = { idle: "Idle", charge: "Charge", wobble: "Wobble", ko: "KO'd" };

  let {
    initial,
    initialEyes = 0,
    standardArea,
    onSave,
    onBack,
  }: {
    initial: FighterShape | null;
    initialEyes?: number;
    standardArea: number;
    onSave: (shape: FighterShape | null, eyes: number) => void;
    onBack: () => void;
  } = $props();

  // Eyes: one of the eye sheet's styles (src/look/eyes.ts).
  let eyes = $state(untrack(() => initialEyes));
  let previewMood = $state<EyeMood>("idle");

  const k = untrack(() => Math.sqrt(standardArea)); // unit shape → meters
  const FOOT = 0;

  /** A unit shape placed in the editor: true size, foot on the ground at x = footX. */
  function place(shape: FighterShape, footX = 0): Vec2[] {
    const foot = shape.vertices[shape.footIndex];
    return shape.vertices.map((v) => ({ x: footX + (v.x - foot.x) * k, y: (v.y - foot.y) * k }));
  }

  let pts = $state<Vec2[]>(place(untrack(() => initial) ?? STANDARD_SHAPE)); // what you see and drag
  let dragging = $state<number | null>(null);
  let animating = $state(false);
  let notice = $state("");
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let svg: SVGSVGElement;

  const balanced = $derived(balanceShape(pts, FOOT));
  const size = $derived(balanced ? shapeSize(balanced, standardArea) : null);
  const standardSize = shapeSize(STANDARD_SHAPE, untrack(() => standardArea));
  const outline = $derived(place(STANDARD_SHAPE, pts[FOOT].x)); // the standard fighter, on the same foot spot

  const issueOf = (p: Vec2[]) => {
    const b = balanceShape(p, FOOT);
    return b ? shapeIssue(b) : "too flat";
  };

  function toWorld(e: PointerEvent): Vec2 {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: -p.y };
  }

  function say(message: string) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 1500);
  }

  function onDown(i: number, e: PointerEvent) {
    if (animating) return;
    dragging = i;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (dragging === null) return;
    const p = toWorld(e);
    const target = dragging === FOOT ? { x: p.x, y: 0 } : p; // the foot slides along the ground
    const at = (t: number) => pts.map((v, i) => (i === dragging ? { x: v.x + (target.x - v.x) * t, y: v.y + (target.y - v.y) * t } : v));
    const issue = issueOf(at(1));
    if (!issue) {
      pts = at(1);
      return;
    }
    // Push back along the move toward where the corner was, to the furthest point that still fits.
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 14; n++) {
      const mid = (lo + hi) / 2;
      if (issueOf(at(mid))) hi = mid;
      else lo = mid;
    }
    pts = at(lo);
    say(`${issue[0].toUpperCase()}${issue.slice(1)}: pushed back`);
  }

  function onUp() {
    if (dragging === null) return;
    dragging = null;
    settle();
  }

  /** Animate to the balanced, equal-mass shape: rotate and scale about the foot. */
  function settle() {
    if (!balanced) return;
    const from = pts.map((p) => ({ ...p }));
    const to = place(balanced, from[FOOT].x);
    const foot = from[FOOT];
    // The similarity transform (rotation θ, scale s) about the foot taking `from` to `to`.
    const a = { x: from[1].x - foot.x, y: from[1].y - foot.y };
    const b = { x: to[1].x - foot.x, y: to[1].y - foot.y };
    const theta = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
    const scale = Math.hypot(b.x, b.y) / Math.hypot(a.x, a.y);
    const start = performance.now();
    const DURATION = 350;
    animating = true;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const e = 1 - (1 - t) ** 3; // ease out
      const [c, s] = [Math.cos(theta * e), Math.sin(theta * e)];
      const sc = 1 + (scale - 1) * e;
      pts = t < 1 ? from.map((p) => {
        const d = { x: p.x - foot.x, y: p.y - foot.y };
        return { x: foot.x + sc * (c * d.x - s * d.y), y: foot.y + sc * (s * d.x + c * d.y) };
      }) : to;
      if (t < 1) requestAnimationFrame(tick);
      else animating = false;
    };
    requestAnimationFrame(tick);
  }

  function reset() {
    pts = place(STANDARD_SHAPE, 0);
  }

  function save() {
    const b = balanceShape(pts, FOOT);
    if (!b || shapeIssue(b)) return;
    // The standard shape counts as "no custom shape".
    const isStandard = b.vertices.every((v, i) => Math.abs(v.x - STANDARD_SHAPE.vertices[i].x) + Math.abs(v.y - STANDARD_SHAPE.vertices[i].y) < 1e-6);
    onSave(isStandard ? null : b, eyes);
  }

  const poly = (p: Vec2[]) => p.map((v) => `${v.x},${-v.y}`).join(" ");

  /** Your fighter exactly as it looks in a match (same drawing as the game: look/stickerSVG.ts), at true size. */
  const fighterSvg = $derived(triangleArea(pts) > 1e-6 ? stickerInWorld(pts, FOOT, playerColor(0), eyes, previewMood) : "");
  // Eye thumbnails use the standard fighter: on a skinny custom shape the faces
  // get too small to tell apart. (The editor above shows them on your shape.)
  const thumbShape = STANDARD_SHAPE;
  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} />

<div class="card wide">
  <h2>Customize fighter</h2>
  <p class="hint">Drag the top corners, or slide the foot. Let go and it settles into balance at the same mass as everyone else.</p>

  <svg bind:this={svg} viewBox="-2.6 -3.3 5.2 3.7" class="editor" role="application" aria-label="fighter shape editor">
    <!-- The floor, like a platform top: slab, ink line, ground line on the top edge. -->
    <rect x="-2.7" y="0" width="5.4" height="0.6" class="slab" />
    <line x1="-2.7" y1="0.06" x2="2.7" y2="0.06" class="ground" />
    <polygon points={poly(outline)} class="standard" />
    <g class="face">{@html fighterSvg}</g>
    {#each pts as p, i}
      <circle
        cx={p.x}
        cy={-p.y}
        r="0.13"
        class="handle"
        class:foot={i === FOOT}
        class:active={dragging === i}
        role="slider"
        tabindex="-1"
        aria-label={i === FOOT ? "foot" : `corner ${i}`}
        aria-valuenow={Math.round(p.x * 100)}
        onpointerdown={(e) => onDown(i, e)}
      />
    {/each}
    {#if notice}<text x="0" y="-3.05" class="notice">{notice}</text>{/if}
  </svg>

  {#if size}
    <div class="stats">
      <span><span class="key mine-key"></span> yours: {size.height.toFixed(2)} m tall, {size.width.toFixed(2)} m wide</span>
      <span><span class="key std-key"></span> standard: {standardSize.height.toFixed(2)} × {standardSize.width.toFixed(2)} m</span>
      <span class="hint">({pct(size.height, standardSize.height)} height, {pct(size.width, standardSize.width)} width, same mass)</span>
    </div>
  {/if}

  <fieldset class="eyes">
    <legend>Eyes</legend>
    <div class="eye-grid">
      {#each EYE_STYLES as style, i}
        <button class="eye" class:selected={eyes === i} aria-pressed={eyes === i} aria-label="eyes: {style.name}" title={style.vibe} onclick={() => (eyes = i)}>
          <span class="thumb">{@html stickerSVG(thumbShape, playerColor(0), i, previewMood)}</span>
          <span class="nm">{style.name}</span>
        </button>
      {/each}
    </div>
    <div class="moods" role="group" aria-label="preview mood">
      {#each EYE_MOODS as m}
        <button class:selected={previewMood === m} aria-pressed={previewMood === m} onclick={() => (previewMood = m)}>{MOOD_NAMES[m]}</button>
      {/each}
    </div>
  </fieldset>

  <div class="actions">
    <button onclick={onBack}>Back</button>
    <span class="row">
      <button onclick={reset}>Reset to standard</button>
      <button class="primary" onclick={save} disabled={animating || dragging !== null}>Save</button>
    </span>
  </div>
</div>

<style>
  .editor {
    width: 100%;
    display: block;
    background: var(--grain), linear-gradient(var(--wall-top), var(--wall-bottom));
    background-blend-mode: multiply, normal;
    border: 3px solid var(--ink);
    box-shadow: 0 0 0 3px var(--halo);
    border-radius: var(--radius);
    box-sizing: border-box;
    touch-action: none;
    user-select: none;
  }
  .slab {
    fill: var(--violet);
    stroke: var(--ink);
    stroke-width: 0.07;
  }
  .ground {
    stroke: var(--platform-light);
    stroke-width: 0.12;
  }
  .standard {
    fill: none;
    stroke: color-mix(in srgb, var(--halo) 40%, transparent);
    stroke-width: 0.025;
    stroke-dasharray: 0.08 0.06;
  }
  .handle {
    fill: var(--halo);
    stroke: color-mix(in srgb, var(--ink) 55%, transparent);
    stroke-width: 0.03;
    cursor: grab;
  }
  .handle.foot {
    fill: var(--debug-grounded);
    cursor: ew-resize;
  }
  .handle.active {
    cursor: grabbing;
    stroke: var(--accent);
    stroke-width: 0.05;
  }
  /* The browser focus ring is drawn in SVG units, so the editor's zoom would
     blow it up into a huge circle; .active highlights the dragged handle instead. */
  .handle:focus {
    outline: none;
  }
  .notice {
    fill: var(--accent);
    font: 600 0.16px system-ui, sans-serif;
    text-anchor: middle;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    margin: 0.75rem 0;
    font-size: 0.9rem;
  }
  .key {
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    vertical-align: -0.1rem;
    margin-right: 0.2rem;
  }
  .mine-key {
    background: var(--accent);
  }
  .std-key {
    border: 1px dashed color-mix(in srgb, var(--halo) 55%, transparent);
  }
  .row {
    display: flex;
    gap: 0.6rem;
  }
  .face {
    pointer-events: none;
  }
  .eyes {
    margin-top: 0.25rem;
  }
  .eye-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 0.4rem;
  }
  .card button.eye {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    padding: 0.35rem 0.2rem 0.3rem;
    font-size: 0.75rem;
  }
  .thumb {
    width: 54px;
    height: 54px;
    display: block;
  }
  .thumb :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .card button.eye {
    text-shadow: none; /* small labels: the ink outline would swamp them */
  }
  .nm {
    color: var(--halo);
    white-space: nowrap;
  }
  .eye.selected .nm {
    color: var(--ink);
  }
  .moods {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  .card .moods button {
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
  }
</style>
