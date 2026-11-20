// Shared by the browser test's sections: checks, screenshots, the game's
// debug info, and making browser users. The browser is set by run.ts.

import { mkdirSync } from "node:fs";
import type { Browser, BrowserContextOptions, Page } from "playwright-core";

// The production setup: wrangler serves the built game and the relay together.
export const PORT = 8787;
export const URL = `http://localhost:${PORT}/`;
const SHOTS = "e2e-shots";
mkdirSync(SHOTS, { recursive: true });
export const DESKTOP = { width: 1280, height: 760 };
export const NAME_FIELD = "What should we call you?";

let failures = 0;
export const failureCount = () => failures;
export function check(ok: boolean, what: string) {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
}
/** Count an unexpected error as a failure. */
export function fail(err: unknown) {
  console.error(err);
  failures++;
}

/** The game's debug info (Game.info) on a page. */
export const info = (p: Page) => p.evaluate(() => (window as any).triangleDuel.game.info);
export const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

export const env: { browser: Browser | null } = { browser: null };

/** A new browser user (its own storage); page errors go to `errors`, labeled. */
export async function newUser(label: string, errors: string[], options: BrowserContextOptions = { viewport: DESKTOP }) {
  const ctx = await env.browser!.newContext(options);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  return { ctx, p };
}
/** Fill in the name screen. */
export async function enterName(p: Page, name: string) {
  await p.getByLabel(NAME_FIELD).fill(name);
  await p.getByRole("button", { name: "Continue" }).click();
}
export const rosterNames = (p: Page) => p.locator(".roster .name").allTextContents();
/** Wait (up to 5 s) for `name` to show in the room's player list. */
export async function waitForRoster(p: Page, name: string) {
  for (let n = 0; n < 50 && !(await rosterNames(p)).includes(name); n++) await p.waitForTimeout(100);
  return (await rosterNames(p)).includes(name);
}
