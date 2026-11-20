// Browser test of the menu flow (local play). Builds, serves, and drives the
// real game in Chrome; saves screenshots to e2e-shots/ for a visual check.
// Usage: npm run e2e

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

// The production setup: wrangler serves the built game and the relay together.
const PORT = 8787;
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

const server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { stdio: "ignore" });
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (let i = 0; i < 150; i++) {
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

  await customizeFlow(page);
  await phoneFlow();
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);

  await onlineFlow();
  await inviteFlow();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;

// ---- online: lobby, settings, bots, kick, a match, back to the room, host handoff ----
async function onlineFlow() {
  // The relay is the same server as the game (started above).
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

// ---- customize: drag corners (with push-back), settle into balance, save, use ----
async function customizeFlow(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  if (await page.getByRole("button", { name: "Menu" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Customize fighter" }).click();
  const handle = (name: string) => page.getByRole("slider", { name });
  const center = async (name: string) => {
    const b = (await handle(name).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  /** Handle positions in world units (from the SVG attributes). */
  const corners = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("svg.editor circle")].map((c) => ({ x: +c.getAttribute("cx")!, y: -+c.getAttribute("cy")! })),
    );
  const drag = async (name: string, dx: number, dy: number) => {
    const c = await center(name);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(c.x + (dx * k) / 10, c.y + (dy * k) / 10);
    await page.mouse.up();
  };

  // 1. An absurd drag (way up): pushed back, with a notice; the result is still a legal shape.
  await drag("corner 1", 40, -600);
  check(await page.getByText(/pushed back/).isVisible(), "a too-far drag is pushed back, with a notice");
  await page.waitForTimeout(500);
  check(await page.getByText(/yours: .* m tall/).isVisible(), "the pushed-back shape is still legal (stats shown)");

  // 2. A lopsided drag, then let go: it settles so the center of mass is straight above the foot.
  await drag("corner 2", -60, 40);
  await page.waitForTimeout(600); // settle animation
  const v = await corners();
  const cx = (v[0].x + v[1].x + v[2].x) / 3;
  check(Math.abs(cx - v[0].x) < 0.01, `after letting go: balanced (center of mass x ${cx.toFixed(3)} above foot x ${v[0].x.toFixed(3)})`);
  await shot(page, "12-customize");

  // 3. Save; reload; it's remembered.
  await page.getByRole("button", { name: "Save" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Customize fighter" }).click();
  const after = await corners();
  const same = after.every((p, i) => Math.abs(p.x - v[i].x) < 1e-3 && Math.abs(p.y - v[i].y) < 1e-3);
  check(same, "after reload: the saved shape is remembered");
  await page.getByRole("button", { name: "Back" }).click();

  // 4. In a local match, my fighter has that shape, at the standard fighter's mass (area).
  await page.getByRole("button", { name: "Play locally" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForTimeout(300);
  const { shapes } = await info(page);
  const [mine, bot] = shapes;
  check(Math.abs(mine.height - bot.height) > 0.05 || Math.abs(mine.width - bot.width) > 0.05, `my fighter is my shape (${mine.height.toFixed(2)}×${mine.width.toFixed(2)} vs standard ${bot.height.toFixed(2)}×${bot.width.toFixed(2)})`);
  check(Math.abs(mine.area - bot.area) < 1e-3, `same mass as the standard fighter (area ${mine.area.toFixed(4)} vs ${bot.area.toFixed(4)})`);
  await shot(page, "13-custom-in-game");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave to menu" }).click();
}

// ---- phone: touch controls (portrait pad, landscape zones), camera on a tall screen ----
async function phoneFlow() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  /** Put fingers down / lift them: `points` is every finger touching after this event. */
  const touches = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const pad = p.getByRole("group", { name: "touch controls" });
  /** A spot on the pad: fraction across its width, middle of its height (or near the bottom). */
  const spot = async (fx: number, id: number, fy = 0.5) => {
    const b = (await pad.boundingBox())!;
    return { x: b.x + b.width * fx, y: b.y + b.height * fy, id };
  };
  const me = async () => {
    const i = await info(p);
    return { angle: i.angles[0] as number, charge: i.charge[0] as number, ko: i.ko[0], grounded: i.grounded[0] as boolean, i };
  };
  /** Wait until my fighter is in play (not KO'd / respawning), roughly upright, and nearly stopped. */
  const ready = async () => {
    for (let n = 0; n < 120; n++) {
      const m = await me();
      // In play and upright; nearly stopped too, unless that takes long (a bot keeps pushing).
      if (!m.ko && Math.abs(m.angle) < 0.4 && (n > 40 || Math.abs(m.i.positions[0].vx) < 0.4)) return;
      await p.waitForTimeout(100);
    }
  };

  await p.goto(URL);
  await p.getByLabel("What should we call you?").fill("Thumbs");
  await p.getByRole("button", { name: "Continue" }).click();
  await shot(p, "14-phone-menu");
  await p.getByRole("button", { name: "Play locally" }).click();
  await shot(p, "15-phone-setup");
  // Plenty of lives, so the test's own moves can't end the match early.
  for (let n = 0; n < 4; n++) await p.getByRole("button", { name: "more stocks" }).click().catch(() => {});
  await p.getByRole("button", { name: "Start" }).click();
  await p.waitForTimeout(600);

  // Portrait: a pad below the game; the game area shrinks to make room.
  check(await pad.isVisible(), "phone portrait: touch controls shown");
  const portrait = await info(p);
  const padBox = (await pad.boundingBox())!;
  check(portrait.canvas.height <= padBox.y + 1, `portrait: the game sits above the pad (canvas ${portrait.canvas.height}px tall, pad from y=${padBox.y})`);
  check(!(await p.getByText(/rotate, ↓ charge/).isVisible().catch(() => false)), "no keyboard hints on a touch screen");

  // Camera: zoomed in on a tall screen (not the whole 27 m stage), with me in view.
  const cam = portrait.camera;
  const pos = portrait.positions[0];
  const inView = Math.abs(pos.x - cam.center.x) < cam.width / 2 && Math.abs(pos.y - cam.center.y) < cam.height / 2;
  check(cam.width < 16 && inView, `portrait camera: ${cam.width.toFixed(1)} m wide (desktop shows up to 27.5), and I'm in view`);
  const pxPerM = portrait.canvas.width / cam.width;
  check(pxPerM > 24, `portrait: fighters drawn at ${pxPerM.toFixed(0)} px/m (was ~14 before)`);

  /** One thumb: put it down at `o`, then slide through `path` (offsets in px), then hold. */
  const drag = async (o: { x: number; y: number; id: number }, path: [number, number][]) => {
    await touches("touchStart", [o]);
    for (const [dx, dy] of path) await touches("touchMove", [{ ...o, x: o.x + dx, y: o.y + dy }]);
  };
  /** Hold charge until my fighter has planted and the charge is building. */
  const untilPlanted = async () => {
    let m = await me();
    for (let n = 0; n < 60 && m.charge === 0; n++) {
      await p.waitForTimeout(25);
      m = await me();
    }
    return m;
  };

  /** Sample my fighter for `ms`. */
  const watch = async (ms: number) => {
    const out: Awaited<ReturnType<typeof me>>[] = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      out.push(await me());
      await p.waitForTimeout(40);
    }
    return out;
  };
  const leanMax = (xs: { angle: number }[]) => Math.max(...xs.map((m) => Math.abs(m.angle)));

  // Stick (the default) is analog: sideways sets your speed.
  check(await p.getByText(/slide ◀ ▶ to move/).isVisible(), "stick: idle hint shown");
  // A small nudge right: a small, controlled move right, no flipping over.
  await ready();
  let x0 = (await me()).i.positions[0].x;
  await drag(await spot(0.5, 1), [[8, 0], [16, 0], [22, 0]]);
  let seen = await watch(900);
  await touches("touchEnd", []);
  let x1 = (await me()).i.positions[0].x;
  check(x1 > x0 + 0.2 && leanMax(seen) < 0.3 && !seen.some((m) => m.ko), `stick nudge right: moved right ${(x1 - x0).toFixed(2)} m, leaning at most ${leanMax(seen).toFixed(2)} rad (no flip)`);
  await p.waitForTimeout(600);

  // Full left: runs left, still upright enough to stay in control. (Movement
  // comes from hops: the next landing after leaning launches you sideways.)
  await ready();
  x0 = (await me()).i.positions[0].x;
  await drag(await spot(0.5, 2), [[-20, 0], [-45, 0], [-70, 0]]);
  seen = await watch(1200);
  await touches("touchEnd", []);
  x1 = (await me()).i.positions[0].x;
  const top = Math.max(...seen.map((m) => -m.i.positions[0].vx));
  check(x1 < x0 - 0.5 && leanMax(seen) < 0.6, `stick full left: ran left ${(x0 - x1).toFixed(2)} m (up to ${top.toFixed(1)} m/s), leaning at most ${leanMax(seen).toFixed(2)} rad`);
  await p.waitForTimeout(800);

  // Charge and aim, one thumb: pull down (charge), then slide left (aim left).
  await ready();
  const o = await spot(0.5, 3);
  await drag(o, [[0, 12], [0, 24], [0, 36]]);
  const planted = await untilPlanted();
  await touches("touchMove", [{ ...o, x: o.x - 40, y: o.y + 36 }]);
  await touches("touchMove", [{ ...o, x: o.x - 64, y: o.y + 36 }]);
  const aiming = await watch(350);
  const aimed = aiming[aiming.length - 1];
  await shot(p, "16-phone-portrait");
  await touches("touchEnd", []);
  check(
    planted.charge > 0 && Math.max(...aiming.map((m) => m.charge)) > planted.charge && aimed.angle > 0.2 && leanMax(aiming) < 0.6,
    `stick pulled down, then left: charge ${(planted.charge * 100).toFixed(0)}% → ${(Math.max(...aiming.map((m) => m.charge)) * 100).toFixed(0)}%, aimed left (lean ${aimed.angle.toFixed(2)} rad, never past ${leanMax(aiming).toFixed(2)})`,
  );
  await p.waitForTimeout(1200);

  // Landscape: the game takes the full screen; the stick works anywhere on it.
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(400);
  const land = await info(p);
  check((await pad.getAttribute("class"))!.includes("landscape") && land.canvas.height >= 389, `landscape: full-screen game (${land.canvas.width}×${land.canvas.height})`);
  await ready();
  x0 = (await me()).i.positions[0].x;
  await drag(await spot(0.5, 4, 0.4), [[20, 0], [40, 0]]); // right: back toward the middle
  seen = await watch(1200);
  await touches("touchEnd", []);
  x1 = (await me()).i.positions[0].x;
  check(x1 > x0 + 0.3 && leanMax(seen) < 0.6, `landscape stick right: moved right ${(x1 - x0).toFixed(2)} m, leaning at most ${leanMax(seen).toFixed(2)} rad`);
  await shot(p, "17-phone-landscape");

  // The pause menu switches to buttons (◀ ▶ | Charge), remembered on this device.
  await p.getByRole("button", { name: "pause" }).click();
  await p.getByRole("button", { name: "Touch controls: stick" }).click();
  check(await p.getByRole("button", { name: "Touch controls: buttons" }).isVisible(), "pause menu: switched to buttons");
  check((await p.evaluate(() => localStorage.getItem("triangle-duel.touchScheme"))) === "buttons", "the choice is remembered");
  await p.getByRole("button", { name: "Resume" }).click();
  check(await pad.getByText("Charge").isVisible(), "buttons: ◀ ▶ Charge shown");
  await ready();
  const before = (await me()).angle;
  await touches("touchStart", [await spot(0.1, 5, 0.7)]);
  const held = await watch(350);
  await touches("touchEnd", []);
  const peak = Math.max(...held.map((m) => m.angle));
  check(peak > before + 0.1, `buttons, hold ◀: turned counterclockwise (${before.toFixed(2)} → up to ${peak.toFixed(2)} rad)${peak > before + 0.1 ? "" : ` [inputs ${held.map((m) => `${m.i.lastInputs?.[0]?.turn}${m.ko ? "K" : ""}${m.grounded ? "G" : ""}`).join(" ")}; angles ${held.map((m) => m.angle.toFixed(2)).join(",")}; pad ${await pad.getAttribute("class")}]`}`);

  // The pause menu hides the pad; resuming brings it back.
  await p.getByRole("button", { name: "pause" }).click();
  check(!(await pad.isVisible()), "paused: touch controls hidden");
  await p.getByRole("button", { name: "Resume" }).click();
  check(await pad.isVisible(), "resumed: touch controls back");

  check(errors.length === 0, `phone: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await ctx.close();
}

// ---- invite link: copy it in the room; opening it joins that room ----
async function inviteFlow() {
  const errors: string[] = [];
  const open = async (name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: URL });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return { ctx, p };
  };
  const rosterNames = (p: Page) => p.locator(".roster .name").allTextContents();
  const waitForRoster = async (p: Page, name: string) => {
    for (let n = 0; n < 50 && !(await rosterNames(p)).includes(name); n++) await p.waitForTimeout(100);
    return (await rosterNames(p)).includes(name);
  };

  const host = await open("Hal");
  await host.p.goto(URL);
  await host.p.getByLabel("What should we call you?").fill("Hal");
  await host.p.getByRole("button", { name: "Continue" }).click();
  await host.p.getByRole("button", { name: "Play online" }).click();
  await host.p.getByRole("button", { name: "Create a room" }).click();
  await waitForRoster(host.p, "Hal");
  const code = (await host.p.locator(".code").textContent())!.trim();
  await host.p.getByRole("button", { name: "Copy invite link" }).click();
  const copiedShown = await host.p.getByText("link copied!").waitFor({ timeout: 2000 }).then(() => true, () => false);
  check(copiedShown, "room: Copy invite link → copied");
  const link = await host.p.evaluate(() => navigator.clipboard.readText());
  check(link === `${URL}?join=${code}`, `the invite link is ${link}`);
  await shot(host.p, "18-room-invite");

  // Someone new (no name yet): asked for a name, then straight into the room.
  const ivy = await open("Ivy");
  await ivy.p.goto(link);
  await ivy.p.getByLabel("What should we call you?").fill("Ivy");
  await ivy.p.getByRole("button", { name: "Continue" }).click();
  check(await waitForRoster(ivy.p, "Hal"), "new player via link: name, then in Hal's room");
  check(await waitForRoster(host.p, "Ivy"), "the host sees them join");
  check(!ivy.p.url().includes("join="), "the join parameter is cleared from the address (no rejoin on reload)");

  // Someone who's played before: straight in, no clicks.
  const jo = await open("Jo");
  await jo.p.goto(URL);
  await jo.p.getByLabel("What should we call you?").fill("Jo");
  await jo.p.getByRole("button", { name: "Continue" }).click();
  await jo.p.goto(link);
  check(await waitForRoster(jo.p, "Jo") && (await rosterNames(jo.p)).includes("Hal"), "returning player via link: straight into the room");

  check(errors.length === 0, `invite: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  for (const x of [host, ivy, jo]) await x.ctx.close();
}
