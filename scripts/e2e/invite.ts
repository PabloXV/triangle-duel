// Browser test, invite link: copy it in the room; opening it joins that room

import { check, enterName, newUser, rosterNames, shot, URL, waitForRoster } from "./lib";

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
  await host.p.getByRole("button", { name: "Play online" }).click();
  await host.p.getByRole("button", { name: "Create a room" }).click();
  await waitForRoster(host.p, "Hal");
  const code = (await host.p.locator(".code").textContent())!.trim();
  await host.p.getByRole("button", { name: "Copy invite link" }).click();
  const copiedShown = await host.p.getByText("link copied!").waitFor({ timeout: 2000 }).then(() => true, () => false);
  check(copiedShown, "room: Copy invite link → copied");
  const link = await host.p.evaluate(() => navigator.clipboard.readText());
  check(link === `${URL.replace(/\/$/, "")}?join=${code}`, `the invite link is ${link} (no "/" before "?")`);
  await shot(host.p, "18-room-invite");

  // Someone new (no name yet): asked for a name, then straight into the room.
  const ivy = await open("Ivy");
  await ivy.p.goto(link);
  await enterName(ivy.p, "Ivy");
  check(await waitForRoster(ivy.p, "Hal"), "new player via link: name, then in Hal's room");
  check(await waitForRoster(host.p, "Ivy"), "the host sees them join");
  check(!ivy.p.url().includes("join="), "the join parameter is cleared from the address (no rejoin on reload)");

  // Someone who's played before: straight in, no clicks.
  const jo = await open("Jo");
  await jo.p.goto(URL);
  await enterName(jo.p, "Jo");
  await jo.p.goto(link);
  check(await waitForRoster(jo.p, "Jo") && (await rosterNames(jo.p)).includes("Hal"), "returning player via link: straight into the room");

  check(errors.length === 0, `invite: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  for (const x of [host, ivy, jo]) await x.ctx.close();
}
