import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRecording, type Recording } from "../src/sim/recording";
import { initPhysics } from "../src/sim/sim";

await initPhysics();

// The cross-engine contract: this recorded match must replay to exactly this
// final state, in Node and in every browser (npm run cross-browser checks the
// browsers). If an intentional sim change moves it, regenerate the fixture
// (scripts/make-fixture.ts) and update the hash; old recordings and online
// clients on the old version will no longer match the new one.
const FIXTURE_FINAL_HASH = "da5a3bb8";

describe("fixture recording", () => {
  it("replays to the locked final state", () => {
    const rec = JSON.parse(readFileSync(join(__dirname, "fixtures/match-4p.json"), "utf8")) as Recording;
    const r = verifyRecording(rec);
    expect(r.desync).toBeNull();
    expect(r.finalHash).toBe(FIXTURE_FINAL_HASH);
  });
});
