// The theme (src/theme.ts) as CSS custom properties, for the menus' styles.
// Browser only (theme.ts itself stays DOM-free: the relay server imports it).

import { DEBUG_COLORS, FONTS, HALO, INK, PLATFORM_COLORS, POP, UI, WALL, WHITE, mix, withAlpha } from "../theme";

import { sparkleSVG } from "../look/sparkle";
import { svgDataUrl } from "../look/svgImage";

const svgUrl = (svg: string) => `url("${svgDataUrl(svg)}")`;

/** Paint grain for UI backgrounds (multiplied in): the mockups' "paint" filter. */
const GRAIN = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="2" stitchTiles="stitch"/><feColorMatrix values=".33 .33 .33 0 .52  .33 .33 .33 0 .52  .33 .33 .33 0 .52  0 0 0 0 1"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
);
/** A sticker button's gloss: a short white dash and a dot. */
const GLOSS = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="8"><g opacity=".9" fill="${WHITE}"><path d="M2 4H38" stroke="${WHITE}" stroke-width="3.5" stroke-linecap="round"/><circle cx="45" cy="4" r="1.8"/></g></svg>`);
/** The 4-point sparkle (a mark: flat fill, ink line). */
const SPARKLE = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">${sparkleSVG(7, 7, 5, HALO, 1.6)}</svg>`);

/** One paint drip hanging off a panel's outline, `len` px long, in `fill` (white paint, or its ink shadow). */
function drip(len: number, fill: string): string {
  const x = 9;
  const w = 6;
  const d = `M${x - w / 2 - 4} 0Q${x - w / 2} 0 ${x - w / 2} 5V${len}a${w / 2 + 1.5} ${w / 2 + 1.5} 0 0 0 ${w + 3} 0V5Q${x + w / 2} 0 ${x + w / 2 + 4} 0Z`;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="${len + 12}"><path d="${d}" fill="${fill}"/></svg>`);
}
/**
 * Panel drips (§11: five in two groups). The white drips and their shadows
 * are separate layers (theme.css puts all shadows behind all drips), so one
 * drip's shadow never lands on its neighbor.
 */
const DRIP_SPOTS = [
  [19, 46],
  [26, 22],
  [33, 70],
  [70, 30],
  [78, 54],
];
const DRIPS = DRIP_SPOTS.map(([at, len]) => `${drip(len, HALO)} ${at}% 0 no-repeat`).join(", ");
const DRIP_SHADOWS = DRIP_SPOTS.map(([at, len]) => `${drip(len, withAlpha(INK, 0.8))} ${at}% 0 no-repeat`).join(", ");

/** Publish the tokens as CSS custom properties, for the menus' styles. */
export function applyTheme(root: HTMLElement = document.documentElement) {
  const vars: Record<string, string> = {
    ink: INK,
    halo: HALO,
    pop: POP,
    bg: UI.bg,
    surface: UI.surface,
    field: UI.field,
    line: UI.line,
    text: UI.text,
    muted: UI.muted,
    accent: UI.accent,
    radius: UI.radius,
    "platform-light": mix(PLATFORM_COLORS.violet, WHITE, 0.75), // the ground line
    "debug-grounded": DEBUG_COLORS.grounded,
    violet: PLATFORM_COLORS.violet,
    "wall-top": WALL.top,
    "wall-bottom": WALL.bottom,
    panel: UI.panel,
    slate: UI.slate,
    grain: GRAIN,
    gloss: GLOSS,
    sparkle: SPARKLE,
    drips: DRIPS,
    "drip-shadows": DRIP_SHADOWS,
    "font-title": FONTS.title,
    "font-label": FONTS.label,
    "font-body": FONTS.body,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
}
