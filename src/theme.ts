// The game's look in one place: colors, line weights, fonts. The names follow
// docs/visual-language.md (the design source of truth); change a value here
// and it changes everywhere: canvas drawing reads these constants, and the
// menus read them as CSS custom properties (src/ui/themeCss.ts, at startup).
// Plain data and math only: the relay server imports it too.

// ---- core tokens (visual-language.md §3) ----
/** All ink lines and shadows. Never pure black. */
export const INK = "#15101f";
/** White outlines, white drips, white marks. */
export const HALO = "#f3eefc";
/** Eye whites and shines (pure white, unlike HALO). */
export const WHITE = "#ffffff";
/** KO stars, rewards, winner accents. */
export const GOLD = "#ffd23d";
/** Focus rings, primary buttons. */
export const POP = "#ffd93d";
export const SWEAT = "#9fe3ff";
/** The thin volume line on white drips. */
export const DRIP_SHADE = "#a99fcf";

/**
 * Fighter colors (fighters only; never platforms). Players pick one; by
 * default player i gets color i, so the first four are the classic P1..P4.
 */
export const PLAYER_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a78bfa", "#9be15d", "#ff7ac6", "#ff9f43", "#5ab8ff"];
export const PLAYER_COLOR_NAMES = ["Coral", "Teal", "Yellow", "Lavender", "Lime", "Hot pink", "Orange", "Sky"];
/** Color number `i` (wraps around). */
export function playerColor(i: number): string {
  return PLAYER_COLORS[((i % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}
/** A valid color number (anything else → 0). */
export function colorIndex(n: unknown): number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < PLAYER_COLORS.length ? (n as number) : 0;
}
/**
 * Colors for a match: fighter i gets `wanted[i]` if given and still free,
 * else the first free color, in order.
 */
export function assignColors(n: number, wanted: (number | null)[] = []): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const w = wanted[i];
    const free = (c: number) => !out.includes(c) && !wanted.slice(i + 1).includes(c);
    if (w !== null && w !== undefined && !out.includes(w)) out.push(w);
    else out.push([...PLAYER_COLORS.keys()].find(free) ?? [...PLAYER_COLORS.keys()].find((c) => !out.includes(c)) ?? i);
  }
  return out;
}
/** Platforms: never a player color. */
export const PLATFORM_COLORS = { violet: "#7b5cd6", slate: "#8a86a3", teal: "#2f9c95", plum: "#a1509f" };
/** The default backdrop (a dark, desaturated wall). */
export const WALL = { top: "#2a2140", bottom: "#40305f" };

// ---- line weights, in meters (visual-language.md §2) ----
export const LINES = {
  /** The ink line on every object. */
  line: 0.07,
  /**
   * White sticker outline past the ink line. The ink line's outer edge is the
   * collision edge; the white is backing paper drawn behind every object, so
   * where two things touch it's hidden and ink meets ink.
   */
  bandFighter: 0.03,
  bandPlatform: 0.08,
  /** Block shadow offset, down and right. */
  shadowFighter: 0.04,
  shadowPlatform: 0.18,
  /** Ink line on small effects (marks). */
  markLine: 0.035,
};

/**
 * The hand-painted finish, kept inside a small "slop budget" so the art never
 * visibly misses a contact the physics makes (hitboxes stay sharp; §2).
 */
export const PAINT = {
  /** Edge wiggle: how far an edge strays from its true line (m), at most. */
  wiggle: 0.012,
  /** Rounded corners: how far a corner's tip may move in (m). Blunt corners get round, needle-sharp ones stay pointy. */
  cornerGap: 0.02,
  /** The same for a fighter's foot, which stands on the floor all the time. */
  footGap: 0.006,
  /** The roundest any corner gets (m). */
  cornerMax: 0.06,
};

/** Corner radius for a corner of interior angle `angle` (rad) whose tip may move in at most `gap`: r(1/sin(a/2) − 1) = gap. */
export function cornerRadius(angle: number, gap = PAINT.cornerGap): number {
  const s = Math.sin(angle / 2);
  return s >= 1 ? PAINT.cornerMax : Math.min(PAINT.cornerMax, gap / (1 / s - 1));
}

// ---- fonts (visual-language.md §11) ----
export const FONTS = {
  /** Big titles only (logo, winner banner). */
  title: '"Sedgwick Ave Display", "Permanent Marker", cursive',
  /** Button labels, headings, names. */
  label: '"Permanent Marker", "Marker Felt", cursive',
  /** Body text, numbers, settings. */
  body: '"Rubik", system-ui, sans-serif',
  mono: "ui-monospace, monospace",
};

/** Debug overlay colors (the foot marker). */
export const DEBUG_COLORS = { grounded: "#6bff8f", coyote: "#ffd93d", airborne: "#888888" };

// ---- menus (CSS custom properties; see src/ui/themeCss.ts) ----
export const UI = {
  bg: "#14121c",
  surface: "#2e2742", // buttons, chips
  field: "#16121f", // inputs, the editor canvas
  line: "#3d3556",
  text: "#ece8f6",
  muted: "#a59fba",
  accent: PLAYER_COLORS[0],
  radius: "10px",
  /** Panels (menu cards): a dark violet slab (visual-language.md §11). */
  panel: "#3b2d63",
  /** Disabled buttons fade toward this. */
  slate: "#6b6680",
};

// ---- helpers ----
function rgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** A shade of `color` toward `other` (derived shades are always mixes toward white or INK, never new hues). */
export function mix(color: string, other: string, t: number): string {
  const a = rgb(color);
  const b = rgb(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** `color` at opacity `a` (0..1), as #rrggbbaa. */
export function withAlpha(color: string, a: number): string {
  return mix(color, color, 0) + Math.round(a * 255).toString(16).padStart(2, "0");
}
