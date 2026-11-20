// How does rollback behave on realistic connections? Plays bot matches over the
// in-process fake network (tests/onlineHarness.ts) and reports rollback
// frequency, depth, and how far fighters visibly jump when corrected.
// Usage: npm run netsim
import { initPhysics } from "../src/sim/sim";
import { playOnline } from "../tests/onlineHarness";

await initPhysics();
const PX_PER_M = 57; // ~a 1150 px wide view of 20 m
const TICKS = 2400;
const conditions: [string, number, number][] = [
  // name, one-way latency (ticks of 16.7 ms), jitter (ticks)
  ["same city (~17 ms, steady)", 1, 1],
  ["across the country (~50 ms)", 3, 2],
  ["across an ocean (~100 ms)", 6, 3],
  ["bad wifi (~50 ms, very jittery)", 3, 8],
];
console.log("per client, 40 s matches, 2 players + 2 room bots (A hosts; bots stand in for the players too):");
for (const [name, latency, jitter] of conditions) {
  const { a, b, desyncs } = playOnline({ latency: [latency, latency], jitter, ticks: TICKS, bots: 2 }); // A hosts 2 room bots
  const secs = TICKS / 60;
  const row = [a, b].map((s) => {
    const st = s.stats;
    const avgDepth = st.rollbacks ? st.resimulated / st.rollbacks : 0;
    const avgJump = st.rollbacks ? (st.totalCorrection / st.rollbacks) * PX_PER_M : 0;
    return `${(st.rollbacks / secs).toFixed(1)}/s, depth avg ${avgDepth.toFixed(1)} max ${st.maxDepth}, jump avg ${avgJump.toFixed(1)} px max ${(st.maxCorrection * PX_PER_M).toFixed(0)} px; own input late ${st.ownLate}, stalls ${st.stalls}, bursts ${st.bursts}`;
  });
  const agree = a.confirmedHash() === b.confirmedHash() && desyncs.length === 0;
  console.log(`${name.padEnd(32)} ${agree ? "in sync" : "DESYNC!"}\n  A: ${row[0]}\n  B: ${row[1]}`);
}
