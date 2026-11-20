// Browser test of the menu flow (local play). Builds, serves, and drives the
// real game in Chrome; saves screenshots to e2e-shots/ for a visual check.
// Usage: npm run e2e

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const PORT = 4176;
const URL = `http://localhost:${PORT}/`;
const SHOTS = "e2e-shots";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}
const info = (p: Page) => p.evaluate(() => (window as any).triangleDuel.game.info);
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const procs: { relay?: ReturnType<typeof spawn> } = {}; // started by onlineFlow()
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL);

  // 1. First visit: name screen.
  await page.getByLabel("What should we call you?").waitFor();
  await shot(page, "1-name");
  await page.getByLabel("What should we call you?").fill("Pablo");
  await page.getByRole("button", { name: "Continue" }).click();
  check(await page.getByText("Playing as").isVisible(), "name accepted → main menu");
  check((await page.locator("strong", { hasText: "Pablo" }).count()) > 0, "menu shows the name");
  check((await info(page)).mode === "attract", "a bot match plays behind the menu");
  await shot(page, "2-menu");

  // 2. Local setup.
  await page.getByRole("button", { name: "Play locally" }).click();
  await page.getByRole("button", { name: /Island/ }).click();
  await page.getByRole("button", { name: "more bots" }).click(); // 1 → 2
  await page.getByRole("button", { name: "fewer stocks" }).click();
  await page.getByRole("button", { name: "fewer stocks" }).click(); // 3 → 1
  await page.getByRole("button", { name: "hard" }).click();
  await shot(page, "3-local-setup");
  await page.getByRole("button", { name: "Start" }).click();
  const m = await info(page);
  check(m.mode === "local" && m.players === 3 && m.stocks === 1 && m.platforms === 1, `local match: 3 fighters, 1 stock, Island (${JSON.stringify(m)})`);
  await page.waitForTimeout(800);
  await shot(page, "4-in-game");

  // 3. Pause freezes the clock; resume runs it.
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Paused" }).waitFor();
  const t0 = (await info(page)).tick;
  await page.waitForTimeout(500);
  check((await info(page)).tick === t0, "Esc pauses: the clock is frozen");
  await shot(page, "5-paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(500);
  check((await info(page)).tick > t0 + 10, "Resume: the clock runs again");

  // 4. Leave to menu.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave to menu" }).click();
  check(await page.getByRole("button", { name: "Play locally" }).isVisible(), "leave → back to the menu");
  check((await info(page)).mode === "attract", "...with the bot match behind it again");

  // 5. Reload: name and setup are remembered.
  await page.reload();
  await page.getByText("Playing as").waitFor();
  check((await page.locator("strong", { hasText: "Pablo" }).count()) > 0, "after reload: name remembered");
  await page.getByRole("button", { name: "Play locally" }).click();
  check((await page.getByRole("button", { name: /Island/ }).getAttribute("aria-pressed")) === "true", "after reload: map choice remembered");
  check((await page.locator("output").first().textContent()) === "2", "after reload: bot count remembered");

  // 6. Play to the end (idle human vs 2 hard bots, 1 stock), then play again.
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Play again" }).waitFor({ timeout: 90_000 });
  await shot(page, "6-match-over");
  check(true, "the match ended → end-of-match options");
  await page.getByRole("button", { name: "Play again" }).click();
  await page.waitForTimeout(300);
  const again = await info(page);
  check(again.mode === "local" && again.tick < 60, "play again starts a fresh match");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);

  await onlineFlow();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.kill();
  procs.relay?.kill();
}
console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;

// ---- online: lobby, settings, bots, kick, a match, back to the room, host handoff ----
async function onlineFlow() {
  // The game's default relay address is ws://localhost:8787.
  procs.relay = spawn("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"], { stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch("http://localhost:8787/")).ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const errors: string[] = [];
  async function player(name: string) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await p.goto(URL);
    await p.getByLabel("What should we call you?").fill(name);
    await p.getByRole("button", { name: "Continue" }).click();
    await p.getByRole("button", { name: "Play online" }).click();
    return p;
  }
  const rosterNames = (p: Page) => p.locator(".roster .name").allTextContents();
  const ana = await player("Ana");
  const bo = await player("Bo");
  const cy = await player("Cy");

  // Ana creates a room and sets it up.
  await ana.getByRole("button", { name: "Create a room" }).click();
  const code = (await ana.locator("button.code").textContent({ timeout: 10_000 }))!.trim();
  check(/^[A-Z]{4}$/.test(code), `room created: ${code}`);
  await ana.getByRole("button", { name: /Island/ }).click();
  await ana.getByRole("button", { name: "fewer stocks" }).click();
  await ana.getByRole("button", { name: "fewer stocks" }).click();
  await ana.getByRole("button", { name: "more bots" }).click();

  // Bo joins and sees the same room.
  await bo.getByLabel("…or join one with its code").fill(code.toLowerCase()); // lowercase is fine
  await bo.getByRole("button", { name: "Join" }).click();
  await bo.locator("button.code").waitFor();
  await bo.waitForTimeout(400);
  check(JSON.stringify(await rosterNames(bo)) === JSON.stringify(["Ana", "bot 1", "Bo"]), `Bo sees the roster: ${await rosterNames(bo)}`);
  check((await bo.getByRole("button", { name: /Island/ }).getAttribute("aria-pressed")) === "true", "Bo sees the host's map (Island)");
  check((await bo.getByLabel("stocks", { exact: true }).textContent()) === "1", "Bo sees the host's stocks (1)");
  check(await bo.getByText("Waiting for the host to start").isVisible(), "Bo (not host) waits");
  check((await bo.getByRole("button", { name: "Start match" }).count()) === 0, "Bo has no start button");
  await shot(ana, "7-room-host");
  await shot(bo, "8-room-guest");

  // Cy joins; Ana kicks him.
  await cy.getByLabel("…or join one with its code").fill(code);
  await cy.getByRole("button", { name: "Join" }).click();
  await cy.locator("button.code").waitFor();
  await ana.getByRole("button", { name: "kick Cy" }).click();
  await cy.getByText("the host removed you from the room").waitFor({ timeout: 5000 });
  check(true, "Cy was kicked: back on the online menu, told why");
  await ana.waitForTimeout(300);
  check(!(await rosterNames(ana)).includes("Cy"), "Cy is gone from Ana's roster");

  // Ana starts. Both walk right off the island, so the bot wins quickly.
  await ana.getByRole("button", { name: "Start match" }).click();
  await ana.waitForTimeout(800);
  const ia = await info(ana);
  const ib = await info(bo);
  check(ia.mode === "online" && ib.mode === "online" && ia.players === 3 && ia.platforms === 1, `both in the online match (3 fighters, Island)`);
  await shot(bo, "9-online-match");
  await ana.keyboard.down("ArrowRight");
  await bo.keyboard.down("ArrowRight");
  await ana.locator("button.code").waitFor({ timeout: 60_000 });
  await bo.locator("button.code").waitFor({ timeout: 10_000 });
  check(true, "match over → both back in the room automatically");
  await ana.keyboard.up("ArrowRight");
  await bo.keyboard.up("ArrowRight");

  // Second match: Ana (host) leaves mid-match. Bo inherits host and the bot.
  await ana.getByRole("button", { name: "Start match" }).click();
  await bo.waitForTimeout(1500);
  await ana.keyboard.press("Escape");
  await ana.getByRole("button", { name: "Leave match" }).click();
  check(await ana.getByRole("button", { name: "Create a room" }).isVisible(), "Ana left the match → back on the online menu");
  await bo.getByText("Ana left the match").waitFor({ timeout: 5000 });
  check(true, "Bo is told Ana left");
  const after = await info(bo);
  check(after.mode === "online" && after.eliminated[0] === true && !after.eliminated[1], "Bo's match goes on; Ana's fighter is gone");
  await shot(bo, "10-host-left");
  // Bo walks off; the bot wins. Bo's browser is host now, so it sends everyone back.
  await bo.keyboard.down("ArrowRight");
  await bo.locator("button.code").waitFor({ timeout: 60_000 });
  await bo.keyboard.up("ArrowRight");
  check(await bo.getByRole("button", { name: "Start match" }).isVisible(), "the new host (Bo) ended the match: back in the room as host");
  check(JSON.stringify(await rosterNames(bo)) === JSON.stringify(["bot 1", "Bo"]), "the bot stays in the room");
  await shot(bo, "11-new-host-room");
  check(errors.length === 0, `online: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
}
