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
export const BLUSH = "#ff8fb8";
export const TONGUE = "#ff7aa8";
/** The thin volume line on white drips. */
export const DRIP_SHADE = "#a99fcf";

/** Fighters only, by player (P1..P4). */
export const PLAYER_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a78bfa"];
/** Player `i`'s color (wraps around past four players). */
export function playerColor(i: number): string {
  return PLAYER_COLORS[i % PLAYER_COLORS.length];
}
/** Platforms: never a player color. */
export const PLATFORM_COLORS = { violet: "#7b5cd6", slate: "#8a86a3", teal: "#2f9c95", plum: "#a1509f" };
/** The default backdrop (a dark, desaturated wall). */
export const WALL = { top: "#2a2140", bottom: "#40305f" };

// ---- line weights, in meters (visual-language.md §2) ----
export const LINES = {
  /** The ink line on every object. */
  line: 0.07,
  /** Visible white past the ink line: thin on things that move and collide, fat on static ones. */
  bandMoving: 0.025,
  bandStatic: 0.1,
  /** Block shadow offset, down and right. */
  shadowMoving: 0.04,
  shadowStatic: 0.18,
  /** Ink line on small effects (marks). */
  markLine: 0.035,
};

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

// ---- the scene as drawn today (to be replaced by the visual-language pass) ----
export const SCENE = {
  skyTop: "#1e1b2e",
  skyBottom: "#2b2340",
  platform: "#5c5470",
  platformPassable: "#7a6f96",
  groundLine: "#b9b4c7",
};

/** Debug overlay colors (the foot marker). */
export const DEBUG_COLORS = { grounded: "#6bff8f", coyote: "#ffd93d", airborne: "#888888" };

// ---- menus (CSS custom properties; see src/ui/themeCss.ts) ----
export const UI = {
  bg: "#14121c",
  card: "#221d33f2",
  surface: "#2e2742", // buttons, chips
  field: "#16121f", // inputs, the editor canvas
  line: "#3d3556",
  text: "#ece8f6",
  muted: "#a59fba",
  accent: PLAYER_COLORS[0],
  accentText: "#1a0f12",
  radius: "10px",
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
