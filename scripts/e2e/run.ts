// Browser test: builds, serves (the production setup), and drives the real
// game in Chrome; saves screenshots to e2e-shots/ for a visual check.
//
// Usage: npm run e2e                 everything (about a minute)
//        npm run e2e -- phone online  just those sections
// Sections: local, customize, phone, online, invite (one file each, here).

import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { customizeFlow } from "./customize";
import { inviteFlow } from "./invite";
import { DESKTOP, PORT, URL, check, env, fail, failureCount } from "./lib";
import { localFlow } from "./local";
import { onlineFlow } from "./online";
import { phoneFlow } from "./phone";

const SECTIONS = ["local", "customize", "phone", "online", "invite"];
const asked = process.argv.slice(2);
for (const a of asked)
  if (!SECTIONS.includes(a)) {
    console.error(`unknown section "${a}" (sections: ${SECTIONS.join(", ")})`);
    process.exit(2);
  }
const run = (name: string) => asked.length === 0 || asked.includes(name);
async function section(name: string, fn: () => Promise<void>) {
  if (!run(name)) return;
  const t0 = Date.now();
  console.log(`— ${name}`);
  await fn();
  console.log(`  (${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: "ignore" });
const browser = await chromium.launch({ channel: "chrome" });
env.browser = browser;
try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  // Local play and customizing share one browser user (customize checks the shape is used in a local match).
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);

  await section("local", () => localFlow(page));
  await section("customize", () => customizeFlow(page));
  if (run("local") || run("customize")) check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await section("phone", phoneFlow);
  await section("online", onlineFlow);
  await section("invite", inviteFlow);
} catch (err) {
  fail(err);
} finally {
  await browser.close();
  server.kill();
}
console.log(failureCount() ? `${failureCount()} failed` : "all passed");
process.exitCode = failureCount() ? 1 : 0;
