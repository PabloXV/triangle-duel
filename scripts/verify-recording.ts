// Verify a recording file (e.g. one downloaded from the game) replays exactly.
// Usage: npm run verify -- path/to/recording.json
import { readFileSync } from "node:fs";
import { verifyRecording, type Recording } from "../src/sim/recording";
import { initPhysics } from "../src/sim/sim";

await initPhysics();
const path = process.argv[2];
if (!path) throw new Error("usage: npm run verify -- <recording.json>");
const rec = JSON.parse(readFileSync(path, "utf8")) as Recording;
const r = verifyRecording(rec);
console.log(
  `${rec.ticks} ticks, ${rec.match.players} players, ${rec.checksums.length} fingerprints, ${rec.paramChanges.length} param changes`,
);
console.log(r.ok ? `OK: replays exactly (final ${r.finalHash})` : `DESYNC at tick ${r.desync!.tick}: expected ${r.desync!.expected}, got ${r.desync!.actual}`);
process.exitCode = r.ok ? 0 : 1;
