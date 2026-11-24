// Browser test, phone: touch controls (portrait pad, landscape zones), camera on a tall screen

import { check, enterName, info, newUser, shot, URL } from "./lib";

export async function phoneFlow() {
  const errors: string[] = [];
  const { ctx, p } = await newUser("phone", errors, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
  /** The input the game took from me on its latest tick, plus the raw touch state. */
  const sense = () =>
    p.evaluate(() => {
      const t = (window as any).triangleDuel;
      return { input: t.game.info.lastInputs?.[0] as { turn: number; charge: boolean } | undefined, touch: { ...t.touch } as { stickX: number | null } };
    });
  /** Sample that for `ms` (e.g. while a finger is down). */
  const inputsFor = async (ms: number) => {
    const out: Awaited<ReturnType<typeof sense>>[] = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      out.push(await sense());
      await p.waitForTimeout(30);
    }
    return out;
  };

  // A still opponent (?bots=still): it just hops in place, so nothing but the
  // test's own touches moves our fighter.
  await p.goto(`${URL}?bots=still`);
  await enterName(p, "Thumbs");
  await shot(p, "14-phone-menu");
  await p.getByRole("button", { name: "Play", exact: true }).click();
  await p.locator(".roster .name", { hasText: "bot 1" }).waitFor({ timeout: 10_000 });
  await shot(p, "15-phone-room");
  await p.getByRole("button", { name: "Start", exact: true }).click();
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

  // Controls: these check the wiring only, that a touch gives the game the
  // right input (instant, and independent of where the fighter is). What the
  // inputs then do is tested against the physics, deterministically, in
  // tests/aim.test.ts (the stick) and the sim's own tests.
  /** One thumb: put it down at `o`, then slide through `path` (offsets in px), then hold. */
  const drag = async (o: { x: number; y: number; id: number }, path: [number, number][]) => {
    await touches("touchStart", [o]);
    for (const [dx, dy] of path) await touches("touchMove", [{ ...o, x: o.x + dx, y: o.y + dy }]);
  };
  const hold = async (fx: number, id: number, fy = 0.5) => {
    await touches("touchStart", [await spot(fx, id, fy)]);
    const seen = await inputsFor(150);
    await touches("touchEnd", []);
    return seen;
  };
  const turns = (xs: Awaited<ReturnType<typeof sense>>[], t: number) => xs.some((x) => x.input?.turn === t);

  // Buttons (the default): ◀ on the left flank, ▶ on the right, Charge in the middle.
  check(await pad.getByText("Charge").isVisible() && !(await p.getByText(/slide ◀ ▶ to move/).isVisible()), "default touch controls: buttons (◀ | Charge | ▶)");
  const l = await hold(0.12, 11);
  check(turns(l, -1) && !l.some((x) => x.input?.charge), "buttons, hold ◀ (left flank): the game gets turn left");
  const r = await hold(0.88, 12);
  check(turns(r, 1), "buttons, hold ▶ (right flank): the game gets turn right");
  const c = await hold(0.5, 13);
  check(c.some((x) => x.input?.charge && x.input.turn === 0), "buttons, hold Charge (middle): the game gets charge");
  const cs = await spot(0.5, 14);
  await touches("touchStart", [cs]);
  await touches("touchStart", [cs, await spot(0.88, 15)]);
  const both = await inputsFor(150);
  await shot(p, "16a-phone-buttons");
  await touches("touchEnd", []);
  check(both.some((x) => x.input?.charge && x.input.turn === 1), "buttons, Charge + ▶ with two thumbs: charging and turning right at once");

  // Switch to the stick (pause menu).
  await p.getByRole("button", { name: "pause" }).click();
  await p.getByRole("button", { name: "Touch controls: buttons" }).click();
  check(await p.getByRole("button", { name: "Touch controls: stick" }).isVisible(), "pause menu: switched to the stick");
  await p.getByRole("button", { name: "Resume" }).click();
  check(await p.getByText(/slide ◀ ▶ to move/).isVisible(), "stick: idle hint shown");
  // A small nudge right: a small stick value.
  await drag(await spot(0.5, 1), [[8, 0], [16, 0], [22, 0]]);
  const nudge = (await inputsFor(60)).at(-1)!.touch.stickX ?? 0;
  await touches("touchEnd", []);
  check(nudge > 0 && nudge < 0.4, `stick nudge right: a small stick value (${nudge.toFixed(2)})`);
  // Full left: full stick, and the speed controller turns us left.
  await drag(await spot(0.5, 2), [[-20, 0], [-45, 0], [-70, 0]]);
  const full = await inputsFor(300);
  await touches("touchEnd", []);
  // (Stick value → turn input is tested deterministically in tests/input.test.ts.)
  check(full.at(-1)!.touch.stickX === -1, "stick full left: full stick reaches the game");
  check((await sense()).touch.stickX === null, "stick released: no stick input");
  // One thumb: pull down to charge, then slide left (still down) to aim.
  const o = await spot(0.5, 3);
  await drag(o, [[0, 12], [0, 24], [0, 36]]);
  const down = (await inputsFor(90)).at(-1)!;
  await touches("touchMove", [{ ...o, x: o.x - 64, y: o.y + 36 }]);
  const aim = (await inputsFor(120)).at(-1)!;
  await shot(p, "16-phone-portrait");
  await touches("touchEnd", []);
  check(down.input?.charge === true && aim.input?.charge === true && (aim.touch.stickX ?? 0) < -0.9, "stick pulled down: charging; slid left while down: still charging, aiming left");

  // Landscape: the game takes the full screen; the stick works anywhere on it.
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(300);
  const land = await info(p);
  check((await pad.getAttribute("class"))!.includes("landscape") && land.canvas.height >= 389, `landscape: full-screen game (${land.canvas.width}×${land.canvas.height})`);
  await drag(await spot(0.3, 4, 0.3), [[20, 0], [40, 0]]);
  const landStick = (await inputsFor(60)).at(-1)!.touch.stickX ?? 0;
  await touches("touchEnd", []);
  check(landStick > 0.4, `landscape: the stick works up in the game area (${landStick.toFixed(2)})`);
  await shot(p, "17-phone-landscape");

  // The pause menu switches back to buttons, remembered on this device.
  await p.getByRole("button", { name: "pause" }).click();
  await p.getByRole("button", { name: "Touch controls: stick" }).click();
  check(await p.getByRole("button", { name: "Touch controls: buttons" }).isVisible(), "pause menu: switched to buttons");
  check((await p.evaluate(() => localStorage.getItem("triangle-duel.touchScheme"))) === "buttons", "the choice is remembered");
  await p.getByRole("button", { name: "Resume" }).click();
  check(turns(await hold(0.1, 5, 0.7), -1), "landscape buttons, hold ◀: the game gets turn left");

  // The pause menu hides the pad; resuming brings it back.
  await p.getByRole("button", { name: "pause" }).click();
  check(!(await pad.isVisible()), "paused: touch controls hidden");
  await p.getByRole("button", { name: "Resume" }).click();
  check(await pad.isVisible(), "resumed: touch controls back");

  check(errors.length === 0, `phone: no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await ctx.close();
}
