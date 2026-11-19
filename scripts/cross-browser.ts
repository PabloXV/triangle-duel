// Cross-engine determinism check: replays the fixture recording in Node and in
// Chrome (V8), Firefox (SpiderMonkey) and WebKit (JavaScriptCore, Safari's
// engine), and checks every one reaches the exact same final state.
//
// Usage: npm run cross-browser   (builds first)
// One-time setup: npx playwright-core install firefox webkit

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit, type BrowserType } from "playwright-core";
import { verifyRecording, type Recording } from "../src/sim/recording";
import { initPhysics } from "../src/sim/sim";

const PORT = 4175;

await initPhysics();
const fixture = JSON.parse(readFileSync("tests/fixtures/match-4p.json", "utf8")) as Recording;
const node = verifyRecording(fixture);
const rows: { engine: string; finalHash: string; desync: string; ms: string }[] = [
  { engine: `Node ${process.version}`, finalHash: node.finalHash, desync: node.desync ? `tick ${node.desync.tick}` : "none", ms: "-" },
];

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  await waitForServer(`http://localhost:${PORT}/verify.html`);
  const engines: [string, BrowserType, object][] = [
    ["Chrome (V8)", chromium, { channel: "chrome" }], // the installed Google Chrome
    ["Firefox (SpiderMonkey)", firefox, {}],
    ["WebKit (JavaScriptCore)", webkit, {}],
  ];
  for (const [name, type, launch] of engines) {
    const browser = await type.launch(launch);
    try {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${PORT}/verify.html`);
      await page.waitForSelector("#result[data-done]", { timeout: 60_000 });
      const r = JSON.parse((await page.textContent("#result")) ?? "{}");
      if (r.error) throw new Error(r.error);
      const version = browser.version();
      rows.push({
        engine: `${name} ${version}`,
        finalHash: r.finalHash,
        desync: r.desync ? `tick ${r.desync.tick}` : "none",
        ms: String(r.ms),
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}

console.table(rows);
const allMatch = rows.every((r) => r.finalHash === node.finalHash && r.desync === "none");
console.log(allMatch ? `OK: all ${rows.length} engines reproduce the match exactly (${node.finalHash})` : "MISMATCH: engines disagree");
process.exitCode = allMatch ? 0 : 1;

async function waitForServer(url: string) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server didn't start at ${url}`);
}
