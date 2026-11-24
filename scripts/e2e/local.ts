// Browser test, playing with bots: name, menu, a room with bots (runs on this machine), pause, back to the room, remembered setup, a match to the end

import type { Page } from "playwright-core";
import { check, enterName, info, NAME_FIELD, rosterNames, shot, waitForRoster } from "./lib";

export async function localFlow(page: Page) {
  // 1. First visit: name screen.
  await page.getByLabel(NAME_FIELD).waitFor();
  await shot(page, "1-name");
  await enterName(page, "Pablo");
  check(await page.getByRole("button", { name: "edit your fighter" }).isVisible(), "name accepted → main menu");
  check((await page.locator("button.me .name").textContent()) === "Pablo", "menu shows the name (on your fighter card)");
  check((await info(page)).mode === "attract", "a bot match plays behind the menu");
  await shot(page, "2-menu");

  // 2. Play opens a room (a new player's starts with one bot). Fill a seat
  //    with another bot and make it hard; Island, 1 stock.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  check(await waitForRoster(page, "bot 1"), "Play → a room, with one bot to start");
  check((await page.getByRole("button", { name: "+ Add bot" }).count()) === 2, "the empty seats offer + Add bot (2 of them)");
  await page.getByRole("button", { name: "+ Add bot" }).first().click();
  check(await waitForRoster(page, "bot 2"), "+ Add bot → bot 2 joins, in that seat");
  await page.getByRole("button", { name: "bot 2: normal (change level)" }).click(); // normal → hard
  await page.getByRole("button", { name: "bot 2: hard (change level)" }).waitFor({ timeout: 3000 });
  check(true, "clicking a bot's level changes it (normal → hard)");
  check((await page.locator(".stepper").count()) === 1, "stocks is the only +/- control");
  await page.getByRole("button", { name: /Island/ }).click();
  await page.getByRole("button", { name: "fewer stocks" }).click();
  await page.waitForTimeout(150); // (each change goes through the room)
  await page.getByRole("button", { name: "fewer stocks" }).click(); // 3 → 1
  await page.waitForTimeout(300);
  await shot(page, "3-room-bots");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const m = await info(page);
  check(m.mode === "local" && m.players === 3 && m.stocks === 1 && m.platforms === 1, `just me and bots: the match runs on this machine (mode ${m.mode}), 3 fighters (${m.players}), 1 stock (${m.stocks}), Island`);
  {
    // I'm standard here; the bots get random shapes near it, at the same mass.
    const [me, ...bots] = m.shapes as { height: number; width: number; area: number }[];
    const differs = bots.some((b) => Math.abs(b.height - me.height) + Math.abs(b.width - me.width) > 0.02);
    check(differs && bots.every((b) => Math.abs(b.area - me.area) < 1e-3), `bots have their own shapes (${bots.map((b) => `${b.height.toFixed(2)}×${b.width.toFixed(2)}`).join(", ")} vs standard ${me.height.toFixed(2)}×${me.width.toFixed(2)}), same mass`);
  }
  await page.waitForTimeout(800);
  await shot(page, "4-in-game");
  {
    // The stock icons are made once per fighter, then reused (a cache keyed by
    // the fighters' wobbling corners used to remake them every few frames, so
    // the row blinked).
    const before = (await info(page)).hudIconLoads;
    await page.waitForTimeout(3000);
    const made = (await info(page)).hudIconLoads - before;
    check(made === 0, `stock icons stay put during play (${made} remade in 3 s)`);
  }

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

  // 4. Back to the room (still there, same bots), then leave it.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to room" }).click();
  check(await page.getByRole("button", { name: "Start", exact: true }).isVisible(), "pause → Back to room");
  const names = await rosterNames(page);
  check(JSON.stringify(names) === JSON.stringify(["Pablo", "bot 1", "bot 2"]), `...with the same players (${names})`);
  check((await info(page)).mode === "attract", "...and the bot match behind it again");
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  check(await page.getByRole("button", { name: "Play", exact: true }).isVisible(), "Leave → back to the menu");

  // 5. Reload: name and setup are remembered.
  await page.reload();
  await page.getByRole("button", { name: "edit your fighter" }).waitFor();
  check((await page.locator("button.me .name").textContent()) === "Pablo", "after reload: name remembered");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  check(await waitForRoster(page, "bot 2"), "after reload: Play → a new room set up like the last match: both bots");
  check(await page.getByRole("button", { name: "bot 2: hard (change level)" }).isVisible(), "...at their levels");
  await page.waitForTimeout(300);
  check((await page.getByRole("button", { name: /Island/ }).getAttribute("aria-pressed")) === "true", "...on the same map");
  check((await page.getByLabel("stocks", { exact: true }).textContent()) === "1", "...with the same stocks");

  // 6. Play to the end (idle human vs 2 bots, 1 stock), then play again.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Play again" }).waitFor({ timeout: 90_000 });
  await shot(page, "6-match-over");
  check(true, "the match ended → end-of-match options");
  await page.getByRole("button", { name: "Play again" }).click();
  await page.waitForTimeout(300);
  const again = await info(page);
  check(again.mode === "local" && again.tick < 60, "play again starts a fresh match");
}
