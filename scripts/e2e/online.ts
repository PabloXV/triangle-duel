// Browser test, online: lobby, settings, bots, kick, a match, back to the room, host handoff

import { check, enterName, info, newUser, rosterNames, shot, URL } from "./lib";

export async function onlineFlow() {
  // The relay is the same server as the game (started above).
  const errors: string[] = [];
  async function player(name: string) {
    const { p } = await newUser(name, errors);
    await p.goto(URL);
    await enterName(p, name);
    await p.getByRole("button", { name: "Play online" }).click();
    return p;
  }
  const ana = await player("Ana");
  const bo = await player("Bo");
  const cy = await player("Cy");

  // Ana creates a room and sets it up.
  await ana.getByRole("button", { name: "Create a room" }).click();
  const code = (await ana.locator("button.code").textContent({ timeout: 10_000 }))!.trim();
  check(/^[A-Z]{4}$/.test(code), `room created: ${code}`);
  check((await ana.locator("button.map").count()) === 5, "all five maps are offered");
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
  // Colors are unique in a room: Ana picks Lime; Bo sees it taken.
  await ana.getByRole("radio", { name: "color: Lime" }).click();
  await bo.waitForTimeout(300);
  check((await ana.getByRole("radio", { name: "color: Lime" }).getAttribute("aria-checked")) === "true", "room: Ana picks Lime");
  check(await bo.getByRole("radio", { name: "color: Lime (taken by Ana)" }).isDisabled(), "Bo sees Lime as taken by Ana");
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
  // Cy (kicked earlier) joins mid-match: he spectates, caught up to now.
  await cy.getByLabel("…or join one with its code").fill(code);
  await cy.getByRole("button", { name: "Join" }).click();
  await cy.waitForFunction(() => (window as any).triangleDuel.game.info.mode === "online", null, { timeout: 10_000 });
  const [ic, ia2] = [await info(cy), await info(ana)];
  check(ic.players === 3 && Math.abs(ic.tick - ia2.tick) < 60, `Cy joined mid-match and caught up (Cy at step ${ic.tick}, Ana at ${ia2.tick})`);
  check(String(ic.status).startsWith("SPECTATING"), `Cy is spectating ("${ic.status}")`);
  await shot(cy, "9b-spectating");
  await ana.keyboard.down("ArrowRight");
  await bo.keyboard.down("ArrowRight");
  await ana.locator("button.code").waitFor({ timeout: 60_000 });
  await bo.locator("button.code").waitFor({ timeout: 10_000 });
  await cy.locator("button.code").waitFor({ timeout: 10_000 });
  check(true, "match over → everyone back in the room automatically");
  await ana.waitForTimeout(300);
  check(JSON.stringify(await rosterNames(ana)) === JSON.stringify(["Ana", "bot 1", "Bo", "Cy"]), `the spectator got a seat: ${await rosterNames(ana)}`);
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
  check(after.mode === "online" && after.players === 4 && after.eliminated[0] === true && !after.eliminated[2], "Bo's match goes on; Ana's fighter is gone");
  await shot(bo, "10-host-left");
  // Bo and Cy walk off; the bot wins. Bo's browser is host now, so it sends everyone back.
  await bo.keyboard.down("ArrowRight");
  await cy.keyboard.down("ArrowRight");
  await bo.locator("button.code").waitFor({ timeout: 60_000 });
  await cy.locator("button.code").waitFor({ timeout: 10_000 });
  await bo.keyboard.up("ArrowRight");
  await cy.keyboard.up("ArrowRight");
  check(await bo.getByRole("button", { name: "Start match" }).isVisible(), "the new host (Bo) ended the match: back in the room as host");
  check(JSON.stringify(await rosterNames(bo)) === JSON.stringify(["bot 1", "Bo", "Cy"]), `the bot and Cy stay in the room: ${await rosterNames(bo)}`);
  await shot(bo, "11-new-host-room");
  check(errors.length === 0, `online: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
}
