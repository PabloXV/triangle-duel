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
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;
