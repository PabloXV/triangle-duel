// The sparkle mark's shape (docs/visual-language.md §6): a 4-point star.
// Geometry and SVG only, no canvas: the relay server imports the eye styles,
// which use it. Canvas drawing is in marks.ts.

import { INK, WHITE } from "../theme";

/** The sparkle's 4-point star: points around (x, y), radius r (inner radius 0.28 r). */
export function sparklePoints(x: number, y: number, r: number): [number, number][] {
  const q = r * 0.28;
  return [
    [x, y - r],
    [x + q, y - q],
    [x + r, y],
    [x + q, y + q],
    [x, y + r],
    [x - q, y + q],
    [x - r, y],
    [x - q, y - q],
  ];
}

/** The sparkle as an SVG path (any units): flat `fill`, ink line `stroke` wide (default 0.18 r). */
export function sparkleSVG(x: number, y: number, r: number, fill = WHITE, stroke = r * 0.18): string {
  const f = (n: number) => Math.round(n * 1000) / 1000;
  const d = sparklePoints(x, y, r).map(([px, py], i) => `${i ? "L" : "M"}${f(px)} ${f(py)}`).join("") + "Z";
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${f(stroke)}" stroke-linejoin="round"/>`;
}
