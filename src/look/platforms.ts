// Platforms in the "Cut gem" style (docs/visual-language.md §9;
// concept/platforms-world.html): a beveled slab with the fighters' recipe
// (white outline, block shadow, top-lit gradient, gloss, sparkles), white
// paint drips off the outline, and a bright ground line exactly on the
// collision top.
//
// Each platform is baked once (an SVG with the mockups' edge-warp filter,
// rasterized), then drawn as an image. The ground line is drawn crisp on top
// every frame, so the warp never blurs where the floor is.

import type { Platform } from "../sim/geometry";
import { mulberry32 } from "../rng";
import { DRIP_SHADE, HALO, INK, LINES, PLATFORM_COLORS, WHITE, mix, withAlpha } from "../theme";
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
  band: LINES.bandStatic,
  shadow: { x: 0.18, y: 0.2 },
  facet: 0.05,
  drip: { w: [0.1, 0.18], len: [0.24, 1.44], perCluster: 3, spacing: 0.44 },
  ground: 0.12,
  glossy: true,
};
const SMALL = {
  depth: 0.36,
  chamfer: 0.12,
  bevel: 0.08,
  cap: 0.1,
  band: 0.065,
  shadow: { x: 0.12, y: 0.14 },
  facet: 0.03,
  drip: { w: [0.06, 0.108], len: [0.1, 0.58], perCluster: 2, spacing: 0.26 },
  ground: 0.08,
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
  svg: string;
  /** Where the image's top-left corner is, in the world (m), and its size (m). */
  x: number;
  top: number;
  width: number;
  height: number;
}

/** The platform as an SVG image, plus where it goes in the world. */
function bakePlatform(p: Platform, color = PLATFORM_COLOR, seed = 1): Baked {
  const s = sizeOf(p);
  const width = p.halfWidth * 2;
  const haloW = (LINES.line + 2 * s.band) * PX;
  const margin = { x: s.shadow.x * PX + 0.2 * PX, top: 0.2 * PX };
  // The slab is inset by half the white outline, so the outline's outer edge
  // is exactly the collision box's top and sides (§9: nothing visible past
  // them at or above the top). Below the top is decoration.
  const inset = haloW / 2;
  const boxLeft = margin.x;
  const x0 = boxLeft + inset;
  const x1 = boxLeft + width * PX - inset;
  const y0 = margin.top + inset;
  const D = s.depth * PX - inset;
  const c = s.chamfer * PX;
  const bev = s.bevel * PX;
  const cap = s.cap * PX;
  const sx = s.shadow.x * PX;
  const sy = s.shadow.y * PX;
  const lite = (k: number) => mix(color, WHITE, k);
  const dark = (k: number) => mix(color, INK, k);

  const ds = drips(width, s, seed).map((d) => ({ ...d, x: d.x + boxLeft }));
  const dripY = y0 + D + (s.band + 0.03) * PX;
  const dripShapes = [...ds.map((d) => dripPath(d, dripY)), ...ds.filter((d) => d.droplet).map((d) => dropletPath(d, dripY))];
  const lowest = Math.max(y0 + D, ...ds.map((d) => dripY + d.len * 1.3 + d.w * 2 + 12));
  const W = boxLeft + width * PX + margin.x;
  const H = lowest + sy + 0.2 * PX;

  const body = `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y0 + D - c)}L${f(x1 - c)} ${f(y0 + D)}H${f(x0 + c)}L${f(x0)} ${f(y0 + D - c)}Z`;
  const shadowFill = withAlpha(INK, 0.8);
  let g = "";
  // Shadows (drips and body), then the white outline and white drips.
  g += dripShapes.map((d) => `<path d="${d}" fill="${shadowFill}" transform="translate(${f(sx)} ${f(sy)})"/>`).join("");
  g += `<path d="${body}" fill="${shadowFill}" stroke="${shadowFill}" stroke-width="${f(haloW)}" stroke-linejoin="round" transform="translate(${f(sx)} ${f(sy)})"/>`;
  g += `<path d="${body}" fill="${HALO}" stroke="${HALO}" stroke-width="${f(haloW)}" stroke-linejoin="round"/>`;
  g += dripShapes.map((d) => `<path d="${d}" fill="${HALO}"/>`).join("");
  for (const d of ds)
    if (d.len > 12) g += `<path d="M${f(d.x + d.w * 0.18)} ${f(dripY + d.w)}V${f(dripY + d.len)}" stroke="${DRIP_SHADE}" stroke-width="${f(Math.max(1.2, d.w * 0.2))}" stroke-linecap="round" opacity=".55"/>`;
  // The slab: top-lit gradient, top bevel, bottom chamfer, facet lines, ink line.
  g += `<path d="${body}" fill="url(#grad)"/>`;
  g += `<polygon points="${f(x0)},${f(y0)} ${f(x1)},${f(y0)} ${f(x1 - bev)},${f(y0 + cap)} ${f(x0 + bev)},${f(y0 + cap)}" fill="${lite(0.5)}"/>`;
  g += `<polygon points="${f(x0)},${f(y0 + D - c)} ${f(x1)},${f(y0 + D - c)} ${f(x1 - c)},${f(y0 + D)} ${f(x0 + c)},${f(y0 + D)}" fill="${dark(0.45)}"/>`;
  g += `<path d="M${f(x0)} ${f(y0)}L${f(x0 + bev)} ${f(y0 + cap)}H${f(x1 - bev)}L${f(x1)} ${f(y0)}M${f(x0)} ${f(y0 + D - c)}H${f(x1)}M${f(x0 + bev)} ${f(y0 + cap)}L${f(x0)} ${f(y0 + D - c)}M${f(x1 - bev)} ${f(y0 + cap)}L${f(x1)} ${f(y0 + D - c)}" stroke="${INK}" stroke-width="${f(s.facet * PX)}" fill="none" opacity=".55"/>`;
  g += `<path d="${body}" fill="none" stroke="${INK}" stroke-width="${f(LINES.line * PX)}" stroke-linejoin="round"/>`;
  if (s.glossy) {
    const gx = x0 + 0.52 * PX;
    const gy = y0 + cap + 0.24 * PX;
    g += `<path d="M${f(gx)} ${f(gy)}H${f(gx + 0.8 * PX)}" stroke="${WHITE}" stroke-width="${f(0.1 * PX)}" stroke-linecap="round" opacity=".9"/><circle cx="${f(gx + 0.8 * PX + 0.22 * PX)}" cy="${f(gy)}" r="${f(0.05 * PX)}" fill="${WHITE}" opacity=".9"/>`;
    g += `<path d="M${f(gx)} ${f(gy + 0.24 * PX)}H${f(gx + 0.4 * PX)}" stroke="${WHITE}" stroke-width="${f(0.06 * PX)}" stroke-linecap="round" opacity=".6"/>`;
    g += sparkleSVG(x1 - 0.68 * PX, y0 + cap + 0.36 * PX, 0.2 * PX, HALO) + sparkleSVG(x1 - 1.16 * PX, y0 + cap + 0.68 * PX, 0.1 * PX, HALO);
  }

  // The mockups' edge warp (§5): low-frequency displacement, whole object.
  const warpFreq = 0.04 * (50 / PX);
  const warpScale = 4 * (PX / 50);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}">` +
    `<defs><linearGradient id="grad" x1="0" y1="0" x2=".12" y2="1"><stop offset="0" stop-color="${lite(0.32)}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${dark(0.38)}"/></linearGradient>` +
    `<filter id="warp" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="${warpFreq}" numOctaves="2" seed="5" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="${f(warpScale)}" xChannelSelector="R" yChannelSelector="G"/></filter></defs>` +
    `<g filter="url(#warp)">${g}</g></svg>`;
  return { svg, x: p.center.x - p.halfWidth - margin.x / PX, top: p.center.y + p.halfHeight + margin.top / PX, width: Math.ceil(W) / PX, height: Math.ceil(H) / PX };
}

// ---- drawing ----
const baked = new SvgImages();

function art(p: Platform, index: number) {
  const key = `${p.center.x},${p.center.y},${p.halfWidth},${p.halfHeight},${p.oneWay ?? false}`;
  let at = placement.get(key);
  if (!at) placement.set(key, (at = bakePlatform(p, PLATFORM_COLOR, index + 1)));
  const img = baked.get(key, () => at.svg);
  return img ? { img, at } : null;
}
const placement = new Map<string, Baked>();

/** Draw a platform (world units, y up). */
export function drawPlatform(ctx: CanvasRenderingContext2D, p: Platform, index: number) {
  const s = sizeOf(p);
  const left = p.center.x - p.halfWidth;
  const right = p.center.x + p.halfWidth;
  const top = p.center.y + p.halfHeight;
  const a = art(p, index);
  if (a) {
    ctx.save();
    ctx.translate(a.at.x, a.at.top);
    ctx.scale(a.at.width / a.img.width, -a.at.height / a.img.height);
    ctx.drawImage(a.img, 0, 0);
    ctx.restore();
  } else {
    // Still baking: a plain slab, so the floor is never invisible.
    ctx.fillStyle = PLATFORM_COLOR;
    ctx.fillRect(left, top - s.depth, right - left, s.depth);
  }
  // Ground line: a bright stroke, its top flush with the collision top.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left + 0.1, top - s.ground / 2);
  ctx.lineTo(right - 0.1, top - s.ground / 2);
  ctx.strokeStyle = mix(PLATFORM_COLOR, WHITE, 0.75);
  ctx.lineWidth = s.ground;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}
