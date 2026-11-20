// Fighter eyes, ported from the eye sheet (concept/eyes.html). Every style
// shares one build: white sticker outline, black block shadow, thick ink line,
// two-dot shine; lids are the body color. Four moods (idle, charge, wobble,
// KO'd) change the same few things on every style: lids, pupils, the KO mark.
//
// Output is SVG markup in "face units": the face is centered at (0, 0), about
// ±1 across, y down. The renderer rasterizes each (style, mood, color) once
// (src/look/faces.ts) and places it at the fighter's incircle.

import { GOLD, HALO, INK, SWEAT as SWEAT_COLOR, WHITE } from "../theme";
import { sparkleSVG } from "./sparkle";

export type EyeMood = "idle" | "charge" | "wobble" | "ko";
export const EYE_MOODS: EyeMood[] = ["idle", "charge", "wobble", "ko"];

const f = (n: number) => Math.round(n * 1000) / 1000;

/** Half the side of the square the face is drawn in (face units). Covers every style's extras. */
export const FACE_EXTENT = 1.3;

// clipPath ids: unique across the page (eyes can also be inlined in the UI's SVGs).
let uidN = 0;
const uid = () => "eye" + ++uidN;

// ---------- shared eye build ----------
// `shapes`: bare elements (no paint), painted in passes so every style matches.
function eyeBuild({ shapes, inner = "", fill = WHITE, transform = "", extra = "" }: { shapes: string; inner?: string; fill?: string; transform?: string; extra?: string }) {
  let s = `<g transform="${transform}">`;
  if (shapes) {
    s += `<g fill="${HALO}" stroke="${HALO}" stroke-width=".26" stroke-linejoin="round">${shapes}</g>`;
    s += `<g transform="translate(.07 .08)" fill="${INK}" stroke="${INK}" stroke-width=".1" stroke-linejoin="round">${shapes}</g>`;
    s += `<g fill="${fill}">${shapes}</g>`;
  }
  s += inner;
  if (shapes) s += `<g fill="none" stroke="${INK}" stroke-width=".1" stroke-linejoin="round">${shapes}</g>`;
  return s + extra + "</g>";
}

const shine = (x: number, y: number, r: number) =>
  `<circle cx="${f(x - r * 0.38)}" cy="${f(y - r * 0.4)}" r="${f(r * 0.32)}" fill="${WHITE}"/><circle cx="${f(x + r * 0.36)}" cy="${f(y + r * 0.32)}" r="${f(r * 0.14)}" fill="${WHITE}"/>`;

function starPath(x: number, y: number, r: number) {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    p.push(f(x + rr * Math.cos(a)) + "," + f(y + rr * Math.sin(a)));
  }
  return p.join(" ");
}

type PupilType = "dot" | "big" | "star" | "cat";
function pupil(type: PupilType, x: number, y: number, r: number) {
  if (type === "star")
    return `<polygon points="${starPath(x, y, r * 1.35)}" fill="${INK}" stroke="${INK}" stroke-width=".03" stroke-linejoin="round"/><circle cx="${f(x - r * 0.25)}" cy="${f(y - r * 0.3)}" r="${f(r * 0.2)}" fill="${WHITE}"/>`;
  if (type === "cat")
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.35)}" fill="${GOLD}" stroke="${INK}" stroke-width=".05"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * 0.32)}" ry="${f(r * 1.1)}" fill="${INK}"/>` + shine(x, y, r);
  return (
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${INK}"/>` +
    shine(x, y, r) +
    (type === "big" ? `<circle cx="${f(x + r * 0.42)}" cy="${f(y - r * 0.45)}" r="${f(r * 0.16)}" fill="${WHITE}"/>` : "")
  );
}

type KoType = "x" | "spiral";
function koMark(type: KoType, x: number, y: number, m: number) {
  if (type === "spiral") {
    const pts: string[] = [];
    const turns = 3.2 * Math.PI;
    const R = m * 0.72;
    for (let a = 0; a <= turns; a += 0.28) {
      const rr = (R * a) / turns;
      pts.push(f(x + rr * Math.cos(a)) + "," + f(y + rr * Math.sin(a)));
    }
    return `<polyline points="${pts.join(" ")}" fill="none" stroke="${INK}" stroke-width=".07" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const k = m * 0.5;
  return `<path d="M${f(x - k)} ${f(y - k)}L${f(x + k)} ${f(y + k)}M${f(x + k)} ${f(y - k)}L${f(x - k)} ${f(y + k)}" stroke="${INK}" stroke-width=".11" stroke-linecap="round"/>`;
}

type ScleraType = "oval" | "round" | "almond";
function sclera(type: ScleraType, cx: number, cy: number, rx: number, ry: number) {
  if (type === "almond")
    return `<path d="M${f(cx - rx)} ${f(cy)}Q${f(cx)} ${f(cy - ry * 1.9)} ${f(cx + rx)} ${f(cy)}Q${f(cx)} ${f(cy + ry * 1.9)} ${f(cx - rx)} ${f(cy)}Z"/>`;
  return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
}

const SWEAT = `<path d="M.78 -.62Q.9 -.4 .78 -.34Q.66 -.4 .78 -.62Z" fill="${SWEAT_COLOR}" stroke="${INK}" stroke-width=".06"/>`;

interface Lid {
  y: number;
  a: number;
}
interface EyeParams {
  sclera: ScleraType;
  ex: number;
  ey: number;
  rx: number;
  ry: number;
  pupil: PupilType;
  pr: number;
  pdx: number;
  pdy: number;
  lid: Lid | null;
  ko: boolean;
  koType: KoType;
  koLid?: Lid | null;
}
type EyeBase = Partial<EyeParams> & { single?: boolean; per?: Record<string, Partial<EyeParams>> };

// Mood rules, the same for every standard eye: lids and pupils move, nothing else.
function moodize(p: EyeParams, mood: EyeMood): EyeParams {
  p = { ...p };
  const lidY = p.lid ? p.lid.y : -1.4;
  const lidA = p.lid ? p.lid.a : 0;
  if (mood === "charge") {
    p.lid = { y: Math.max(lidY, -0.25) + 0.05, a: Math.max(lidA, 0) + 24 };
    p.pr *= 0.85;
    p.pdy = Math.max(p.pdy, 0.25);
    p.ry *= 0.94;
  }
  if (mood === "wobble") {
    p.lid = { y: lidY > -0.5 ? lidY - 0.2 : -0.72, a: -18 };
    p.pdx = -0.42;
    p.pdy = 0.15;
    p.pr *= 0.9;
  }
  if (mood === "ko") {
    p.ko = true;
    p.lid = p.koLid || null;
  }
  return p;
}

const DEF: EyeParams = { sclera: "oval", ex: 0.36, ey: -0.1, rx: 0.28, ry: 0.36, pupil: "dot", pr: 0.14, pdx: 0.1, pdy: 0.12, lid: null, ko: false, koType: "x" };

function standardEyes(base: EyeBase, mood: EyeMood, col: string) {
  const sides = base.single ? [0] : [-1, 1];
  let shapes = "";
  let inner = "<defs>";
  const bodies: string[] = [];
  for (const sd of sides) {
    let p: EyeParams = { ...DEF, ...base, ...((base.per && base.per[String(sd)]) || {}) };
    p = moodize(p, mood);
    const cx = sd * p.ex;
    const cy = p.ey;
    const shp = sclera(p.sclera, cx, cy, p.rx, p.ry);
    shapes += shp;
    const id = uid();
    inner += `<clipPath id="${id}">${shp}</clipPath>`;
    let g = p.ko ? koMark(p.koType, cx, cy, Math.min(p.rx, p.ry) * 1.6) : pupil(p.pupil, cx + p.pdx * p.rx, cy + p.pdy * p.ry, p.pr);
    if (p.lid) {
      const flat = cy + p.lid.y * p.ry;
      const rot = f(-sd * p.lid.a);
      g += `<g transform="rotate(${rot} ${f(cx)} ${f(cy)})"><rect x="${f(cx - 1)}" y="${f(cy - 2)}" width="2" height="${f(flat - cy + 2)}" fill="${col}"/><rect x="${f(cx - 1)}" y="${f(cy - 2)}" width="2" height="${f(flat - cy + 2)}" fill="${INK}" opacity=".14"/><path d="M${f(cx - 1)} ${f(flat)}H${f(cx + 1)}" stroke="${INK}" stroke-width=".1"/></g>`;
    }
    bodies.push(`<g clip-path="url(#${id})">${g}</g>`);
  }
  inner += "</defs>" + bodies.join("");
  return eyeBuild({ shapes, inner, extra: mood === "wobble" ? SWEAT : "" });
}

function shadesEyes(mood: EyeMood) {
  const slant = { idle: 0, charge: 0.12, wobble: -0.09, ko: 0 }[mood];
  const lens = (sd: number) => {
    const cx = sd * 0.34;
    const cy = -0.1;
    const top = cy - 0.2;
    const yl = top + (sd === 1 ? slant : 0);
    const yr = top + (sd === -1 ? slant : 0);
    return `<path d="M${f(cx - 0.31)} ${f(yl)}L${f(cx + 0.31)} ${f(yr)}Q${f(cx + 0.33)} ${f(cy + 0.04)} ${f(cx + 0.24)} ${f(cy + 0.18)}Q${f(cx)} ${f(cy + 0.3)} ${f(cx - 0.24)} ${f(cy + 0.18)}Q${f(cx - 0.33)} ${f(cy + 0.04)} ${f(cx - 0.31)} ${f(yl)}Z"/>`;
  };
  const shapes = lens(-1) + lens(1);
  const id = uid();
  let inner = `<defs><clipPath id="${id}">${shapes}</clipPath></defs><g clip-path="url(#${id})"><path d="M-.9 .12L-.2 -.6L0 -.6L-.7 .12ZM.1 .12L.8 -.6L.9 -.6L.2 .12Z" fill="#8f7fd0" opacity=".55"/>`;
  if (mood === "ko")
    inner += `<path d="M-.5 -.22L-.36 -.08L-.28 -.18L-.14 .04M-.36 -.08L-.4 .08M.2 -.2L.32 -.04L.42 -.14L.5 .06" stroke="${WHITE}" stroke-width=".04" fill="none" stroke-linejoin="round"/>`;
  inner += `</g><path d="M-.04 -.2Q0 -.26 .04 -.2" stroke="${INK}" stroke-width=".09" fill="none" stroke-linecap="round"/>`;
  const transform = { idle: "", charge: "translate(0 .05)", wobble: "translate(.04 .08) rotate(-10)", ko: "translate(.03 .06) rotate(12)" }[mood];
  let extra = mood === "charge" ? sparkleSVG(0.52, -0.42, 0.13) : "";
  if (mood === "wobble") extra += SWEAT;
  return eyeBuild({ shapes, inner, fill: INK, transform, extra });
}

function dotEyes(mood: EyeMood) {
  if (mood === "ko") {
    const x = (cx: number, k = 0.13) => `M${f(cx - k)} ${f(-0.1 - k)}L${f(cx + k)} ${f(-0.1 + k)}M${f(cx + k)} ${f(-0.1 - k)}L${f(cx - k)} ${f(-0.1 + k)}`;
    const d = x(-0.34) + x(0.34);
    return `<path d="${d}" stroke="${HALO}" stroke-width=".34" stroke-linecap="round"/><path d="${d}" transform="translate(.07 .08)" stroke="${INK}" stroke-width=".16" stroke-linecap="round"/><path d="${d}" stroke="${INK}" stroke-width=".16" stroke-linecap="round"/>`;
  }
  const P = { idle: [0.12, 0.17, 0, 0, 0], charge: [0.13, 0.09, 0, 0.04, 22], wobble: [0.1, 0.14, -0.08, 0.03, 0] }[mood];
  let shapes = "";
  let inner = "";
  for (const sd of [-1, 1]) {
    const cx = sd * 0.34 + P[2];
    const cy = -0.1 + P[3];
    shapes += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${P[0]}" ry="${P[1]}" transform="rotate(${f(-sd * P[4])} ${f(cx)} ${f(cy)})"/>`;
    inner += `<circle cx="${f(cx - P[0] * 0.35)}" cy="${f(cy - P[1] * 0.4)}" r="${f(P[0] * 0.32)}" fill="${WHITE}"/>`;
  }
  return eyeBuild({ shapes, inner, fill: INK, extra: mood === "wobble" ? SWEAT : "" });
}

function maskEyes(mood: EyeMood) {
  const shapes = `<path d="M-.82 -.38Q0 -.48 .82 -.38L.78 .14Q0 .05 -.78 .14Z"/>`;
  let inner = `<path d="M.78 -.3L1.02 -.42L.98 -.2ZM.78 -.1L1 .02L.82 .1Z" fill="${INK}" stroke="${INK}" stroke-width=".04"/>`;
  for (const sd of [-1, 1]) {
    const cx = sd * 0.34;
    const cy = -0.13;
    const ry = { idle: 0.12, charge: 0.1, wobble: 0.15, ko: 0.13 }[mood];
    const rot = { idle: 0, charge: -sd * 18, wobble: sd * 10, ko: 0 }[mood];
    const eye = `<path d="M${f(cx - 0.21)} ${f(cy)}Q${f(cx)} ${f(cy - ry * 1.9)} ${f(cx + 0.21)} ${f(cy)}Q${f(cx)} ${f(cy + ry * 1.9)} ${f(cx - 0.21)} ${f(cy)}Z" transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"/>`;
    const id = uid();
    inner += `<defs><clipPath id="${id}">${eye}</clipPath></defs><g fill="${WHITE}">${eye}</g><g clip-path="url(#${id})">`;
    if (mood === "ko") inner += koMark("x", cx, cy, 0.17);
    else {
      const px = mood === "wobble" ? cx - 0.09 : cx + 0.02;
      const pr = mood === "charge" ? 0.06 : 0.075;
      inner += pupil("dot", px, cy + 0.02, pr);
    }
    inner += `</g><g fill="none" stroke="${INK}" stroke-width=".07">${eye}</g>`;
  }
  return eyeBuild({ shapes, inner, fill: INK, extra: mood === "wobble" ? SWEAT : "" });
}

interface EyeStyle {
  name: string;
  vibe: string;
  base?: EyeBase;
  custom?: (mood: EyeMood, col: string) => string;
}

export const EYE_STYLES: EyeStyle[] = [
  { name: "Classic", vibe: "Tall ovals, big pupils. The b-boy default.", base: { koType: "spiral" } },
  { name: "Chill", vibe: "Heavy flat lids, looking down. Unbothered.", base: { ry: 0.34, pdy: 0.3, lid: { y: -0.08, a: -4 } } },
  { name: "Mean mug", vibe: "Slanted lids all the time.", base: { ry: 0.32, pr: 0.12, pdy: 0.2, lid: { y: -0.22, a: 26 } } },
  { name: "Bug-eyed", vibe: "Huge round whites, tiny pupils.", base: { sclera: "round", ex: 0.37, rx: 0.35, ry: 0.37, pr: 0.07, pdx: 0, pdy: 0, koType: "spiral" } },
  { name: "Side-eye", vibe: "Both pupils parked to one side, one lid lower.", base: { ry: 0.34, pdx: 0.5, pdy: 0.1, pr: 0.13, per: { "-1": { lid: { y: -0.35, a: 0 } }, "1": { lid: { y: -0.05, a: 0 } } } } },
  { name: "Shiny", vibe: "Giant pupils, double shine. Cute.", base: { sclera: "round", rx: 0.3, ry: 0.34, pupil: "big", pr: 0.2, pdx: 0.05, pdy: 0.08, koType: "spiral" } },
  { name: "Droopy", vibe: "Lids sagging at the outer corners.", base: { ry: 0.31, pr: 0.12, pdy: 0.3, lid: { y: 0.12, a: -12 }, koLid: { y: 0.1, a: -12 } } },
  { name: "Wonky", vibe: "One small eye, one big one.", base: { per: { "-1": { rx: 0.21, ry: 0.26, ex: 0.34, pr: 0.1, koType: "x" }, "1": { rx: 0.33, ry: 0.42, ex: 0.4, pr: 0.15, koType: "spiral" } } } },
  { name: "Cyclops", vibe: "One big eye in the middle.", base: { single: true, rx: 0.44, ry: 0.48, pr: 0.2, pdx: 0.05, koType: "spiral" } },
  { name: "Star struck", vibe: "Star pupils. Hype.", base: { pupil: "star", pr: 0.14 } },
  { name: "Cat", vibe: "Almond eyes, gold irises, slit pupils.", base: { sclera: "almond", rx: 0.3, ry: 0.2, pupil: "cat", pr: 0.11, pdx: 0, pdy: 0 } },
  { name: "Shades", vibe: "Lenses cover the same area as the eyes.", custom: shadesEyes },
  { name: "Dots", vibe: "No whites. Same outline and shadow.", custom: dotEyes },
  { name: "Mask", vibe: "Bandana band with eye holes.", custom: maskEyes },
];

/** A valid eye style index (anything else → Classic). */
export function eyeStyle(n: unknown): number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < EYE_STYLES.length ? (n as number) : 0;
}

/** The eyes as SVG elements (face units), for embedding in a larger SVG. */
export function eyesMarkup(style: number, mood: EyeMood, color: string): string {
  const st = EYE_STYLES[eyeStyle(style)];
  return st.custom ? st.custom(mood, color) : standardEyes(st.base!, mood, color);
}

/** A standalone SVG document of the eyes, FACE_EXTENT each way, `px` pixels square. */
export function eyesSVG(style: number, mood: EyeMood, color: string, px = 256): string {
  const e = FACE_EXTENT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-e} ${-e} ${2 * e} ${2 * e}">${eyesMarkup(style, mood, color)}</svg>`;
}
