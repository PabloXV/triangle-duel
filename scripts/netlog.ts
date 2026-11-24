// A real 4-player online match on this machine, by the numbers: builds the
// game, serves it with the relay (wrangler dev, like production), opens one
// browser tab per player (?netlog=1&autopilot=1: a bot plays each), runs the
// match, and prints each player's net log (src/net/netLog.ts). The full
// per-second logs go to netlogs/<time>/.
//
// Usage: npm run netlog                          4 players, no added lag, 60 s
//        npm run netlog -- --lag 50 --jitter 20  every player: +50 ms each way, +0-20 ms jitter
//        npm run netlog -- --lag 15,15,15,100    per player (the last one far away)
//        npm run netlog -- --secs 30 --players 3 --headed --no-build

import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import type { NetLogRow } from "../src/net/netLog";

const PORT = 8788; // not the browser test's, so both can run
const URL = `http://localhost:${PORT}/`;
const NAMES = ["Ana", "Bo", "Cy", "Di"];

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);
const players = Math.min(4, Math.max(2, Number(opt("players", "4"))));
const secs = Number(opt("secs", "60"));
const perPlayer = (v: string) => {
  const xs = v.split(",").map(Number);
  return Array.from({ length: players }, (_, i) => xs[Math.min(i, xs.length - 1)] || 0);
};
const lag = perPlayer(opt("lag", "0"));
const jitter = perPlayer(opt("jitter", "0"));

if (!flag("no-build")) execSync("npm run build", { stdio: "inherit" });
const server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: "ignore" });
const browser = await chromium.launch({ channel: "chrome", headless: !flag("headed") });

const pageUrl = (i: number, extra = "") => `${URL}?netlog=1&autopilot=1&lag=${lag[i]}&jitter=${jitter[i]}${extra}`;
async function enterName(p: Page, name: string) {
  await p.getByLabel("What should we call you?").fill(name);
  await p.getByRole("button", { name: "Continue" }).click();
}
const mode = (p: Page) => p.evaluate(() => (window as any).triangleDuel.game.info.mode as string);
const rows = (p: Page) => p.evaluate(() => (window as any).triangleDuel.game.netLog.rows as NetLogRow[]);

let logs: NetLogRow[][] = [];
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  // One browser user per player (separate storage), like 4 people.
  const pages: Page[] = [];
  for (let i = 0; i < players; i++) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => console.error(`${NAMES[i]}: page error: ${e.stack ?? e.message}`));
    pages.push(p);
  }
  const host = pages[0];
  await host.goto(pageUrl(0));
  await enterName(host, NAMES[0]);
  await host.getByRole("button", { name: "Play", exact: true }).click();
  const code = (await host.locator("button.code").textContent({ timeout: 15_000 }))!.trim();
  // A new room starts with one bot: remove it (this measures players only).
  await host.getByRole("button", { name: "remove bot 1" }).click({ timeout: 10_000 });
  const more = host.getByRole("button", { name: "more stocks" });
  while (await more.isEnabled()) await more.click(); // the most stocks: a longer match
  for (let i = 1; i < players; i++) {
    await pages[i].goto(pageUrl(i, `&join=${code}`)); // an invite link
    await enterName(pages[i], NAMES[i]);
  }
  for (let n = 0; n < 100 && (await host.locator(".roster .name").count()) < players; n++) await host.waitForTimeout(100);
  console.log(`room ${code}: ${players} players; lag ${lag.join("/")} ms, jitter ${jitter.join("/")} ms (one way); input delay comes from the game`);
  await host.waitForTimeout(3000); // like real players in the lobby: pings settle (the input delay is picked from the ping)
  await host.getByRole("button", { name: "Start", exact: true }).click();
  for (const p of pages) await p.waitForFunction(() => (window as any).triangleDuel.game.info.mode === "online", undefined, { timeout: 15_000 });

  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    await host.waitForTimeout(1000);
    if ((await mode(host)) !== "online") break; // match over, back to the room
    process.stdout.write(`\r  ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  process.stdout.write("\n");
  logs = await Promise.all(pages.map(rows));
} finally {
  await browser.close();
  server.kill();
}

// ---- report -------------------------------------------------------------------
const dir = `netlogs/${new Date().toISOString().slice(0, 19).replace(/:/g, "")}`;
mkdirSync(dir, { recursive: true });
logs.forEach((r, i) => writeFileSync(`${dir}/${NAMES[i]}.json`, JSON.stringify(r, null, 1)));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const f1 = (x: number) => x.toFixed(1);
const table: Record<string, string>[] = [];
logs.forEach((r, i) => {
  const live = r.slice(1); // the first second includes the countdown start-up
  const col = (k: keyof NetLogRow) => live.map((x) => (x[k] as number | null) ?? 0);
  table.push({
    player: `${NAMES[i]}${i === 0 ? " (host)" : ""}`,
    "lag ms": `${lag[i]}±${jitter[i]}`,
    secs: String(live.length),
    "ping ms": f1(avg(col("rttMs"))),
    "input delay": String(live[0]?.inputDelay ?? "?"),
    "frame adv avg [min-max]": `${f1(avg(col("frameAdvantage")))} [${min(col("frameAdvantage"))}-${max(col("frameAdvantage"))}]`,
    "predicting avg": f1(avg(col("predicting"))),
    "rollbacks/s": f1(sum(col("rollbacks")) / Math.max(1, live.length)),
    "depth avg/max": `${f1(sum(live.map((x) => x.avgDepth * x.rollbacks)) / Math.max(1, sum(col("rollbacks"))))}/${max(col("maxDepth"))}`,
    "resim ms/s avg (max 1)": `${avg(col("resimMs")).toFixed(2)} (${max(col("maxResimMs")).toFixed(2)})`,
    "jump px avg/max": `${f1(sum(live.map((x) => x.corrAvgPx * x.rollbacks)) / Math.max(1, sum(col("rollbacks"))))}/${max(col("corrMaxPx"))}`,
    "own late": String(sum(col("ownLate"))),
    frozen: String(sum(col("frozen"))),
    "time-sync": String(sum(col("slews"))),
    bursts: String(sum(col("bursts"))),
    "steps in/s min": String(min(col("ticksIn"))),
    "max gap ms": String(max(col("maxGapMs"))),
    fps: f1(avg(col("fps"))),
    "max frame ms": String(max(col("maxFrameMs"))),
    "work ms/frame": avg(col("workMs")).toFixed(2),
  });
});
// Players as columns: easier to compare side by side.
const keys = Object.keys(table[0] ?? {});
const w0 = Math.max(...keys.map((k) => k.length));
const widths = table.map((t) => Math.max(...keys.map((k) => t[k].length)));
for (const k of keys) console.log(`${k.padEnd(w0)}  ${table.map((t, i) => t[k].padStart(widths[i])).join("  ")}`);
console.log(`\nper-second logs: ${dir}/`);
