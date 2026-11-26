// Platforms in the "Cut gem" style (docs/visual-language.md §9;
// concept/platforms-world.html): a beveled slab with the fighters' recipe
// (white outline, block shadow, top-lit gradient, gloss, sparkles) and white
// paint drips off the outline.
//
// As for every object, the ink line's outer edge is the collision edge: a
// fighter's foot meets the platform's top ink line. Each platform is baked
// once as two images: the back (shadow, white outline, drips, with the
// mockups' edge warp) is drawn before any fighter, and the front (slab and ink)
// after their backs. The front gets rounded top corners and a much gentler
// warp, both inside the slop budget (theme.ts PAINT), so the floor is where it
// looks.

import type { Platform } from "../sim/geometry";
import { mulberry32 } from "../rng";
import { DRIP_SHADE, HALO, INK, LINES, PAINT, PLATFORM_COLORS, WHITE, cornerRadius, mix, withAlpha } from "../theme";
import { sparkleSVG } from "./sparkle";
import { SvgImages } from "./svgImage";

/** Bake resolution, pixels per meter. */
const PX = 96;
/** The platform color (one for now; never a player color). */
const PLATFORM_COLOR = PLATFORM_COLORS.violet;

/** Cut gem sizes in meters: solid floors are "big", pass-through platforms "small". */
const BIG = {
  depth: 1.32, // the art goes this far below the top (below the box is decoration)
  chamfer: 0.36,
  bevel: 0.24, // top bevel inset
  cap: 0.26, // top bevel height
  band: LINES.bandPlatform,
  shadow: { x: LINES.shadowPlatform, y: LINES.shadowPlatform + 0.02 },
  facet: 0.05,
  drip: { w: [0.1, 0.18], len: [0.24, 1.44], perCluster: 3, spacing: 0.44 },
  ground: 0.08,
  glossy: true,
};
const SMALL = {
  depth: 0.36,
  chamfer: 0.12,
  bevel: 0.08,
  cap: 0.1,
  band: LINES.bandPlatform * 0.65,
  shadow: { x: 0.12, y: 0.14 },
  facet: 0.03,
  drip: { w: [0.06, 0.108], len: [0.1, 0.58], perCluster: 2, spacing: 0.26 },
  ground: 0.05,
  glossy: false,
};
type Size = typeof BIG;
/**
 * A thin solid block sitting on something (a stair step): shallow, as deep as
 * its box, and no drips (they'd run over whatever is below).
 */
function stepSize(p: Platform): Size {
  return { ...BIG, depth: p.halfHeight * 2, chamfer: 0.1, bevel: 0.12, cap: 0.12, drip: { ...BIG.drip, perCluster: 0 }, glossy: false };
}
const sizeOf = (p: Platform): Size => (p.oneWay ? SMALL : p.halfHeight < 0.5 ? stepSize(p) : BIG);

interface Drip {
  x: number; // px
  w: number;
  len: number;
  droplet: boolean;
}

/** Clustered drips (§7): a few clusters, each of a few drips, lengths skewed short. */
function drips(width: number, s: Size, seed: number): Drip[] {
  const r = mulberry32(seed); // seeded: a platform's drips are the same every time
  const clusters = s === SMALL ? 1 : Math.max(1, Math.round(width / 6));
  const centers = clusters === 1 ? [s === SMALL ? 0.6 : 0.5] : Array.from({ length: clusters }, (_, i) => 0.2 + (0.55 * i) / (clusters - 1));
  const out: Drip[] = [];
  for (const c of centers)
    for (let i = 0; i < s.drip.perCluster; i++) {
      const x = c * width + (i - (s.drip.perCluster - 1) / 2) * s.drip.spacing + (r() - 0.5) * 0.12;
      const w = s.drip.w[0] + r() * (s.drip.w[1] - s.drip.w[0]);
      const len = s.drip.len[0] + Math.pow(r(), 1.4) * (s.drip.len[1] - s.drip.len[0]);
      out.push({ x: x * PX, w: w * PX, len: len * PX, droplet: r() < 0.25 });
    }
  return out;
}

const f = (n: number) => Math.round(n * 10) / 10;
const BULB = 1.3;

/** A drip leaving the edge through a smooth curve, narrowing a little, then a round bead. */
function dripPath(d: Drip, y: number) {
  const hw = d.w / 2;
  const fr = d.w * 0.65;
  const br = hw * BULB;
  const yb = y + d.len;
  const t = hw * 0.82;
  const x = d.x;
  return (
    `M${f(x - hw - fr)} ${f(y - 2)}Q${f(x - hw)} ${f(y - 2)} ${f(x - hw)} ${f(y + fr)}L${f(x - t)} ${f(yb)}` +
    `C${f(x - t)} ${f(yb + br * 0.4)} ${f(x - br)} ${f(yb + br * 0.3)} ${f(x - br)} ${f(yb + br)}` +
    `A${f(br)} ${f(br)} 0 0 0 ${f(x + br)} ${f(yb + br)}` +
    `C${f(x + br)} ${f(yb + br * 0.3)} ${f(x + t)} ${f(yb + br * 0.4)} ${f(x + t)} ${f(yb)}` +
    `L${f(x + hw)} ${f(y + fr)}Q${f(x + hw)} ${f(y - 2)} ${f(x + hw + fr)} ${f(y - 2)}Z`
  );
}

function dropletPath(d: Drip, y: number) {
  const br = (d.w / 2) * BULB;
  const r = br * 0.6;
  const cx = d.x;
  const cy = y + d.len + br * 2 + r + 8 + d.len * 0.15;
  return `M${f(cx)} ${f(cy - r * 2)}C${f(cx + r * 0.3)} ${f(cy - r)} ${f(cx + r)} ${f(cy - r * 0.6)} ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 1 ${f(cx - r)} ${f(cy)}C${f(cx - r)} ${f(cy - r * 0.6)} ${f(cx - r * 0.3)} ${f(cy - r)} ${f(cx)} ${f(cy - r * 2)}Z`;
}

interface Baked {
  back: string;
  front: string;
  /** Where the images' top-left corner is, in the world (m), and their size (m). */
  x: number;
  top: number;
  width: number;
  height: number;
}

/** The platform as two SVG images (back and front, same size), plus where they go in the world. */
function bakePlatform(p: Platform, color = PLATFORM_COLOR, seed = 1): Baked {
  const s = sizeOf(p);
  const width = p.halfWidth * 2;
  const haloW = 2 * s.band * PX;
  const line = LINES.line * PX;
  const margin = { x: s.shadow.x * PX + 0.2 * PX, top: 0.2 * PX };
  // The slab's outline is the collision box's top and sides (below the box
  // bottom is decoration). The ink line is inside it, the white outside.
  const x0 = margin.x;
  const x1 = margin.x + width * PX;
  const y0 = margin.top;
  const D = s.depth * PX;
  const c = s.chamfer * PX;
  // Bevel and facets sit inside the ink line.
  const ix0 = x0 + line;
  const ix1 = x1 - line;
  const iy0 = y0 + line;
  const bev = s.bevel * PX;
  const cap = s.cap * PX;
  const sx = s.shadow.x * PX;
  const sy = s.shadow.y * PX;
  const lite = (k: number) => mix(color, WHITE, k);
  const dark = (k: number) => mix(color, INK, k);

  const ds = drips(width, s, seed).map((d) => ({ ...d, x: d.x + x0 }));
  const dripY = y0 + D + s.band * PX * 0.7; // out of the white outline's bottom edge
  const dripShapes = [...ds.map((d) => dripPath(d, dripY)), ...ds.filter((d) => d.droplet).map((d) => dropletPath(d, dripY))];
  const lowest = Math.max(y0 + D, ...ds.map((d) => dripY + d.len * 1.3 + d.w * 2 + 12));
  const W = x1 + margin.x;
  const H = lowest + sy + 0.2 * PX;

  // Top corners rounded as far as the slop budget allows (a right angle: ~5 cm).
  const rc = cornerRadius(Math.PI / 2) * PX;
  const body = `M${f(x0 + rc)} ${f(y0)}H${f(x1 - rc)}A${f(rc)} ${f(rc)} 0 0 1 ${f(x1)} ${f(y0 + rc)}V${f(y0 + D - c)}L${f(x1 - c)} ${f(y0 + D)}H${f(x0 + c)}L${f(x0)} ${f(y0 + D - c)}V${f(y0 + rc)}A${f(rc)} ${f(rc)} 0 0 1 ${f(x0 + rc)} ${f(y0)}Z`;
  const shadowFill = withAlpha(INK, 0.8);

  // Back: shadows (drips and body), then the white outline and white drips.
  let back = "";
  back += dripShapes.map((d) => `<path d="${d}" fill="${shadowFill}" transform="translate(${f(sx)} ${f(sy)})"/>`).join("");
  back += `<path d="${body}" fill="${shadowFill}" stroke="${shadowFill}" stroke-width="${f(haloW)}" stroke-linejoin="round" transform="translate(${f(sx)} ${f(sy)})"/>`;
  back += `<path d="${body}" fill="${HALO}" stroke="${HALO}" stroke-width="${f(haloW)}" stroke-linejoin="round"/>`;
  back += dripShapes.map((d) => `<path d="${d}" fill="${HALO}"/>`).join("");
  for (const d of ds)
    if (d.len > 12) back += `<path d="M${f(d.x + d.w * 0.18)} ${f(dripY + d.w)}V${f(dripY + d.len)}" stroke="${DRIP_SHADE}" stroke-width="${f(Math.max(1.2, d.w * 0.2))}" stroke-linecap="round" opacity=".55"/>`;

  // Front: the slab (top-lit gradient, top bevel, bottom chamfer, facet lines,
  // ground highlight), then the ink line: the outline stroked twice its width
  // and clipped to the slab, so its outer edge is the slab's edge and its
  // corners stay sharp.
  let g = "";
  g += `<path d="${body}" fill="url(#grad)"/>`;
  g += `<polygon points="${f(ix0)},${f(iy0)} ${f(ix1)},${f(iy0)} ${f(ix1 - bev)},${f(iy0 + cap)} ${f(ix0 + bev)},${f(iy0 + cap)}" fill="${lite(0.5)}"/>`;
  g += `<polygon points="${f(x0)},${f(y0 + D - c)} ${f(x1)},${f(y0 + D - c)} ${f(x1 - c)},${f(y0 + D)} ${f(x0 + c)},${f(y0 + D)}" fill="${dark(0.45)}"/>`;
  g += `<path d="M${f(ix0)} ${f(iy0)}L${f(ix0 + bev)} ${f(iy0 + cap)}H${f(ix1 - bev)}L${f(ix1)} ${f(iy0)}M${f(x0)} ${f(y0 + D - c)}H${f(x1)}M${f(ix0 + bev)} ${f(iy0 + cap)}L${f(ix0)} ${f(y0 + D - c)}M${f(ix1 - bev)} ${f(iy0 + cap)}L${f(ix1)} ${f(y0 + D - c)}" stroke="${INK}" stroke-width="${f(s.facet * PX)}" fill="none" opacity=".55"/>`;
  // Ground highlight: a bright line right under the top ink line (the floor).
  g += `<path d="M${f(ix0)} ${f(iy0 + (s.ground * PX) / 2)}H${f(ix1)}" stroke="${lite(0.75)}" stroke-width="${f(s.ground * PX)}"/>`;
  g += `<path d="${body}" fill="none" stroke="${INK}" stroke-width="${f(2 * line)}" clip-path="url(#slab)"/>`;
  if (s.glossy) {
    const gx = ix0 + 0.52 * PX;
    const gy = iy0 + cap + 0.24 * PX;
    g += `<path d="M${f(gx)} ${f(gy)}H${f(gx + 0.8 * PX)}" stroke="${WHITE}" stroke-width="${f(0.1 * PX)}" stroke-linecap="round" opacity=".9"/><circle cx="${f(gx + 0.8 * PX + 0.22 * PX)}" cy="${f(gy)}" r="${f(0.05 * PX)}" fill="${WHITE}" opacity=".9"/>`;
    g += `<path d="M${f(gx)} ${f(gy + 0.24 * PX)}H${f(gx + 0.4 * PX)}" stroke="${WHITE}" stroke-width="${f(0.06 * PX)}" stroke-linecap="round" opacity=".6"/>`;
    g += sparkleSVG(ix1 - 0.68 * PX, iy0 + cap + 0.36 * PX, 0.2 * PX, HALO) + sparkleSVG(ix1 - 1.16 * PX, iy0 + cap + 0.68 * PX, 0.1 * PX, HALO);
  }

  // The mockups' edge warp (§5): full strength on the back (white paint and
  // drips), and only PAINT.wiggle on the front, so the floor's ink line stays
  // within a centimeter or so of the collision top. Same noise, so they move together.
  const warpFreq = 0.04 * (50 / PX);
  const warp = (scale: number) =>
    `<filter id="warp" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${warpFreq}" numOctaves="2" seed="5" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="${f(scale)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}">`;
  const backSvg = open + `<defs>${warp(4 * (PX / 50))}</defs><g filter="url(#warp)">${back}</g></svg>`;
  // Displacement is scale × (noise − 0.5): a scale of 2 × wiggle strays up to the wiggle.
  const frontSvg =
    open +
    `<defs>${warp(2 * PAINT.wiggle * PX)}<linearGradient id="grad" x1="0" y1="0" x2=".12" y2="1"><stop offset="0" stop-color="${lite(0.32)}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${dark(0.38)}"/></linearGradient>` +
    `<clipPath id="slab"><path d="${body}"/></clipPath></defs><g filter="url(#warp)">${g}</g></svg>`;
  return { back: backSvg, front: frontSvg, x: p.center.x - p.halfWidth - margin.x / PX, top: p.center.y + p.halfHeight + margin.top / PX, width: Math.ceil(W) / PX, height: Math.ceil(H) / PX };
}

// ---- drawing ----
const baked = new SvgImages();
const placement = new Map<string, Baked>();

function art(p: Platform, index: number, layer: "back" | "front") {
  const key = `${p.center.x},${p.center.y},${p.halfWidth},${p.halfHeight},${p.oneWay ?? false}`;
  let at = placement.get(key);
  if (!at) placement.set(key, (at = bakePlatform(p, PLATFORM_COLOR, index + 1)));
  const img = baked.get(`${key}|${layer}`, () => at[layer]);
  return img ? { img, at } : null;
}

function drawLayer(ctx: CanvasRenderingContext2D, p: Platform, index: number, layer: "back" | "front") {
  const a = art(p, index, layer);
  if (!a) return false;
  ctx.save();
  ctx.translate(a.at.x, a.at.top);
  ctx.scale(a.at.width / a.img.width, -a.at.height / a.img.height);
  ctx.drawImage(a.img, 0, 0);
  ctx.restore();
  return true;
}

/** The back pass (world units, y up): shadow, white outline and drips. Draw every object's back before any front. */
export function drawPlatformBack(ctx: CanvasRenderingContext2D, p: Platform, index: number) {
  drawLayer(ctx, p, index, "back");
}

/** The front pass: the slab and its ink line, whose top edge is the collision top. */
export function drawPlatformFront(ctx: CanvasRenderingContext2D, p: Platform, index: number) {
  if (drawLayer(ctx, p, index, "front")) return;
  // Still baking: a plain slab, so the floor is never invisible.
  const top = p.center.y + p.halfHeight;
  const depth = sizeOf(p).depth;
  ctx.fillStyle = INK;
  ctx.fillRect(p.center.x - p.halfWidth, top - depth, p.halfWidth * 2, depth);
  ctx.fillStyle = PLATFORM_COLOR;
  ctx.fillRect(p.center.x - p.halfWidth + LINES.line, top - depth + LINES.line, p.halfWidth * 2 - 2 * LINES.line, depth - 2 * LINES.line);
}
