// Browser test, invite link: copy it in the room; opening it joins that room,
// even while the host is playing the bots (then the next match goes online)

import { check, enterName, info, newUser, rosterNames, shot, URL, waitForRoster } from "./lib";

export async function inviteFlow() {
  const errors: string[] = [];
  const open = async (name: string) => {
    const user = await newUser(name, errors);
    await user.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
    return user;
  };

  const host = await open("Hal");
  await host.p.goto(URL);
  await enterName(host.p, "Hal");
  await host.p.getByRole("button", { name: "Play", exact: true }).click();
  await waitForRoster(host.p, "Hal");
  const code = (await host.p.locator(".code").textContent())!.trim();
  await host.p.getByRole("button", { name: "Copy invite link" }).click();
  const copiedShown = await host.p.getByText("link copied!").waitFor({ timeout: 2000 }).then(() => true, () => false);
  check(copiedShown, "room: Copy invite link → copied");
  const link = await host.p.evaluate(() => navigator.clipboard.readText());
  check(link === `${URL.replace(/\/$/, "")}?join=${code}`, `the invite link is ${link} (no "/" before "?")`);
  await shot(host.p, "18-room-invite");

  // While waiting, the host plays the room's bot: just them and bots, so on this machine.
  await host.p.getByRole("button", { name: "Start", exact: true }).click();
  check((await info(host.p)).mode === "local", "host vs the bot while waiting: runs on the host's machine");

  // Someone new (no name yet): asked for a name, then straight into the room.
  const ivy = await open("Ivy");
  await ivy.p.goto(link);
  await enterName(ivy.p, "Ivy");
  check(await waitForRoster(ivy.p, "Hal"), "new player via link: name, then in Hal's room");
  await host.p.getByText("Ivy joined the room").waitFor({ timeout: 5000 });
  check(true, "mid-match, the host is told Ivy joined");
  await host.p.keyboard.press("Escape");
  await host.p.getByRole("button", { name: "Back to room" }).click();
  check(await waitForRoster(host.p, "Ivy"), "back in the room, Ivy is there");
  check(!ivy.p.url().includes("join="), "the join parameter is cleared from the address (no rejoin on reload)");

  // Someone who's played before: straight in, no clicks.
  const jo = await open("Jo");
  await jo.p.goto(URL);
  await enterName(jo.p, "Jo");
  await jo.p.goto(link);
  check(await waitForRoster(jo.p, "Jo") && (await rosterNames(jo.p)).includes("Hal"), "returning player via link: straight into the room");

  // Now there are other humans: Start goes online, through the relay.
  await host.p.getByRole("button", { name: "Start", exact: true }).click();
  await ivy.p.waitForFunction(() => (window as any).triangleDuel.game.info.mode === "online", null, { timeout: 10_000 });
  const [h, i] = [await info(host.p), await info(ivy.p)];
  check(h.mode === "online" && i.mode === "online" && h.players === 4, `with friends in the room, Start plays online (host ${h.mode}, Ivy ${i.mode}, ${h.players} fighters)`);

  check(errors.length === 0, `invite: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  for (const x of [host, ivy, jo]) await x.ctx.close();
}
