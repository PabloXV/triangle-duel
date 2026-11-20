import { describe, expect, it } from "vitest";
import { EYE_MOODS, EYE_STYLES, eyeStyle, eyesSVG } from "../src/look/eyes";
import { stickerSVG } from "../src/look/stickerSVG";
import { STANDARD_SHAPE, balanceShape } from "../src/sim/shapes";

describe("eyes (from the eye sheet)", () => {
  it("every style draws every mood", () => {
    expect(EYE_STYLES).toHaveLength(14);
    for (let s = 0; s < EYE_STYLES.length; s++)
      for (const m of EYE_MOODS) {
        const svg = eyesSVG(s, m, "#ff6b6b");
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).not.toMatch(/NaN|undefined/);
        // Every opened <g> is closed.
        expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
      }
  });

  it("KO'd looks different from idle, on every style", () => {
    for (let s = 0; s < EYE_STYLES.length; s++) expect(eyesSVG(s, "ko", "#4ecdc4")).not.toBe(eyesSVG(s, "idle", "#4ecdc4"));
  });

  it("unknown styles fall back to Classic", () => {
    expect([eyeStyle(-1), eyeStyle(99), eyeStyle(2.5), eyeStyle("3"), eyeStyle(5)]).toEqual([0, 0, 0, 0, 5]);
  });

  it("the sticker fighter draws for the standard and custom shapes", () => {
    const lopsided = balanceShape([{ x: 0, y: 0 }, { x: 1.4, y: 1.3 }, { x: -0.3, y: 1.0 }], 0)!;
    for (const shape of [null, STANDARD_SHAPE, lopsided]) expect(stickerSVG(shape, "#ffd93d", 10, "charge")).not.toMatch(/NaN|undefined/);
  });
});
