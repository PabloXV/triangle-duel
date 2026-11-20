// The theme (src/theme.ts) as CSS custom properties, for the menus' styles.
// Browser only (theme.ts itself stays DOM-free: the relay server imports it).

import { DEBUG_COLORS, FONTS, GOLD, HALO, INK, PLATFORM_COLORS, PLAYER_COLORS, POP, UI, WHITE, mix, withAlpha } from "../theme";

const svgUrl = (svg: string) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

/** Paint grain for UI backgrounds (multiplied in): the mockups' "paint" filter. */
const GRAIN = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="2" stitchTiles="stitch"/><feColorMatrix values=".33 .33 .33 0 .52  .33 .33 .33 0 .52  .33 .33 .33 0 .52  0 0 0 0 1"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`,
);
/** A sticker button's gloss: a short white dash and a dot. */
const GLOSS = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="8"><g opacity=".9" fill="${WHITE}"><path d="M2 4H38" stroke="${WHITE}" stroke-width="3.5" stroke-linecap="round"/><circle cx="45" cy="4" r="1.8"/></g></svg>`);
/** The 4-point sparkle (a mark: flat fill, ink line). */
const SPARKLE = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M7 2L8.4 5.6L12 7L8.4 8.4L7 12L5.6 8.4L2 7L5.6 5.6Z" fill="${HALO}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg>`);

/** One white paint drip (with its block shadow) hanging off a panel's outline, `len` px long. */
function drip(len: number): string {
  const x = 9;
  const w = 6;
  const d = `M${x - w / 2 - 4} 0Q${x - w / 2} 0 ${x - w / 2} 5V${len}a${w / 2 + 1.5} ${w / 2 + 1.5} 0 0 0 ${w + 3} 0V5Q${x + w / 2} 0 ${x + w / 2 + 4} 0Z`;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="${len + 22}"><path d="${d}" fill="${withAlpha(INK, 0.8)}" transform="translate(8 10)"/><path d="${d}" fill="${HALO}"/></svg>`);
}
/** Panel drips (§11, as approved in the menu mockup): five in two groups. */
const DRIPS = [
  [22, 46],
  [26, 22],
  [30, 70],
  [72, 30],
  [76, 54],
]
  .map(([at, len]) => `${drip(len)} ${at}% 0 no-repeat`)
  .join(", ");

/** Publish the tokens as CSS custom properties, for the menus' styles. */
export function applyTheme(root: HTMLElement = document.documentElement) {
  const vars: Record<string, string> = {
    ink: INK,
    halo: HALO,
    gold: GOLD,
    pop: POP,
    bg: UI.bg,
    card: UI.card,
    surface: UI.surface,
    field: UI.field,
    line: UI.line,
    text: UI.text,
    muted: UI.muted,
    accent: UI.accent,
    "accent-text": UI.accentText,
    radius: UI.radius,
    platform: PLATFORM_COLORS.violet,
    "platform-light": mix(PLATFORM_COLORS.violet, WHITE, 0.75), // the ground line
    "debug-grounded": DEBUG_COLORS.grounded,
    violet: PLATFORM_COLORS.violet,
    panel: UI.panel,
    slate: UI.slate,
    grain: GRAIN,
    gloss: GLOSS,
    sparkle: SPARKLE,
    drips: DRIPS,
    "font-title": FONTS.title,
    "font-label": FONTS.label,
    "font-body": FONTS.body,
  };
  PLAYER_COLORS.forEach((c, i) => (vars[`p${i + 1}`] = c));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
}
