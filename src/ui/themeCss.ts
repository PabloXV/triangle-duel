// The theme (src/theme.ts) as CSS custom properties, for the menus' styles.
// Browser only (theme.ts itself stays DOM-free: the relay server imports it).

import { DEBUG_COLORS, FONTS, GOLD, HALO, INK, PLATFORM_COLORS, PLAYER_COLORS, POP, UI, WHITE, mix } from "../theme";

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
    "font-title": FONTS.title,
    "font-label": FONTS.label,
    "font-body": FONTS.body,
  };
  PLAYER_COLORS.forEach((c, i) => (vars[`p${i + 1}`] = c));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
}
