// Replays the fixture recording in this browser and publishes the result.
// See verify.html and scripts/cross-browser.ts.
import fixture from "../tests/fixtures/match-4p.json";
import { verifyRecording, type Recording } from "./sim/recording";
import { initPhysics } from "./sim/sim";

const out = document.getElementById("result")!;
try {
  await initPhysics();
  const t0 = performance.now();
  const r = verifyRecording(fixture as Recording);
  out.textContent = JSON.stringify({ ...r, ms: Math.round(performance.now() - t0), userAgent: navigator.userAgent });
} catch (err) {
  out.textContent = JSON.stringify({ error: String(err) });
}
out.dataset.done = "1";
