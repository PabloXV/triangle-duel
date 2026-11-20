// Browser test, local play: name, menu, setup, pause, leave, remembered settings, a match to the end

import type { Page } from "playwright-core";
import { check, enterName, info, NAME_FIELD, shot } from "./lib";

export async function localFlow(page: Page) {
  // 1. First visit: name screen.
  await page.getByLabel(NAME_FIELD).waitFor();
  await shot(page, "1-name");
  await enterName(page, "Pablo");
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
  check(m.mode === "local" && m.players === 3 && m.stocks === 1 && m.platforms === 1, `local match: 3 fighters, 1 stock, Island`);
  {
    // I'm standard here; the bots get random shapes near it, at the same mass.
    const [me, ...bots] = m.shapes as { height: number; width: number; area: number }[];
    const differs = bots.some((b) => Math.abs(b.height - me.height) + Math.abs(b.width - me.width) > 0.02);
    check(differs && bots.every((b) => Math.abs(b.area - me.area) < 1e-3), `bots have their own shapes (${bots.map((b) => `${b.height.toFixed(2)}×${b.width.toFixed(2)}`).join(", ")} vs standard ${me.height.toFixed(2)}×${me.width.toFixed(2)}), same mass`);
  }
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
}
