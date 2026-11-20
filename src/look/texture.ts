// Spray-paint texture (docs/visual-language.md §5): small noise tiles made
// once (SVG turbulence, rasterized) and repeated as canvas patterns, locked to
// the world so they read as the wall's surface, not a pane of glass. Recipes
// from the mockups (concept/platforms-world.html): frequencies are per mockup
// pixel, at 50 px per meter.

import { SvgImages } from "./svgImage";

const TILE = 256; // px
/** Tile pixels per meter (the mockups' scale). */
const TEXTURE_PX_PER_M = 50;

type Tile = "speckLight" | "speckDark" | "grain";
const RECIPES: Record<Tile, { freq: number; seed: number; matrix: string }> = {
  // White specks: alpha = 1.6·n − 0.95.
  speckLight: { freq: 0.9, seed: 11, matrix: "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -.95" },
  // Dark specks: alpha = 0.95 − 1.8·n.
  speckDark: { freq: 0.7, seed: 12, matrix: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.8 .95" },
  // Paint grain: a light gray, multiplied over the picture.
  grain: { freq: 0.9, seed: 2, matrix: ".33 .33 .33 0 .5  .33 .33 .33 0 .5  .33 .33 .33 0 .5  0 0 0 0 1" },
};

const tiles = new SvgImages<HTMLCanvasElement>((img) => {
  const c = document.createElement("canvas");
  c.width = c.height = TILE;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
});

function tile(name: Tile): HTMLCanvasElement | null {
  const r = RECIPES[name];
  return tiles.get(
    name,
    () =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}">` +
      `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${r.freq}" numOctaves="3" seed="${r.seed}" stitchTiles="stitch"/><feColorMatrix values="${r.matrix}"/></filter>` +
      `<rect width="100%" height="100%" filter="url(#n)"/></svg>`,
  );
}

/**
 * Fill the whole canvas with a texture tile, locked to the world: `world` is
 * the current world → device-pixel transform (the camera, shake included).
 */
export function fillTexture(ctx: CanvasRenderingContext2D, name: Tile, world: DOMMatrix, alpha = 1, op: GlobalCompositeOperation = "source-over") {
  const t = tile(name);
  if (!t) return; // still being made: skip a frame or two
  const pattern = ctx.createPattern(t, "repeat");
  if (!pattern) return;
  // One tile pixel = 1/50 m, y down in the tile → y up in the world.
  pattern.setTransform(world.scale(1 / TEXTURE_PX_PER_M, -1 / TEXTURE_PX_PER_M));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Start making the tiles (so the first frames aren't bare). */
export function preloadTextures() {
  for (const name of Object.keys(RECIPES) as Tile[]) tile(name);
}
