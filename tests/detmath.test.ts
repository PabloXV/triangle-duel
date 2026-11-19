import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cos, sin } from "../src/sim/detmath";

const bits = (x: number) => {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x);
  return b.getBigUint64(0).toString(16).padStart(16, "0");
};

describe("deterministic sin/cos", () => {
  it("agrees with Math.sin/cos to within ~1 ulp on [-20, 20]", () => {
    for (let i = -20000; i <= 20000; i++) {
      const x = i / 1000;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThanOrEqual(2.3e-16);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThanOrEqual(2.3e-16);
    }
  });

  it("handles special values", () => {
    expect(sin(0)).toBe(0);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Number.NaN)).toBeNaN();
    expect(sin(Infinity)).toBeNaN();
    expect(cos(-Infinity)).toBeNaN();
  });

  // Exact output bits, locked in. If these change, every saved replay and
  // every online match between old and new clients desyncs. The cross-browser
  // check (step 4) verifies every engine produces these same bits.
  it.each([
    [0.5, "3fdeaee8744b05f0", "3fec1528065b7d50"],
    [1, "3feaed548f090cee", "3fe14a280fb5068c"],
    [-2.5, "bfe326af0dcfcab0", "bfe9a2f7ef858b7d"],
    [3.14159, "3ec6428a6aa44cd1", "bfefffffffff8420"],
    [10, "bfe1689ef5f34f53", "bfead9ac890c6b1f"],
    [-100.25, "3fd1bf00980dc35d", "3feebec72ba6b0ec"],
  ])("golden bits for x = %d", (x, sinBits, cosBits) => {
    expect(bits(sin(x))).toBe(sinBits);
    expect(bits(cos(x))).toBe(cosBits);
  });
});

describe("sim determinism rules", () => {
  // The sim must produce bit-identical results in every JS engine. These are
  // the operations that aren't guaranteed to (or aren't deterministic at all).
  const FORBIDDEN: [RegExp, string][] = [
    [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/, "engine-dependent rounding; use src/sim/detmath.ts"],
    [/Math\.random\b/, "not deterministic"],
    [/Date\.now|performance\.now|new Date\b/, "wall-clock time"],
    [/[\w)\]]\s*\*\*\s*[\w(]/, "** calls pow (engine-dependent)"],
  ];
  const dir = join(__dirname, "../src/sim");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "detmath.ts");

  it.each(files)("%s uses no engine-dependent or nondeterministic operations", (file) => {
    // Strip comments, so docs can mention these names.
    const code = readFileSync(join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const [pattern, why] of FORBIDDEN) {
      const match = code.match(pattern);
      expect(match, `${file}: "${match?.[0]}" (${why})`).toBeNull();
    }
  });
});
