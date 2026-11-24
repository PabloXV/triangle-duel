// Browser test, customize: drag corners (with push-back), settle into balance, save, use

import type { Page } from "playwright-core";
import { check, enterName, info, NAME_FIELD, shot } from "./lib";

export async function customizeFlow(page: Page) {
  if (await page.getByLabel(NAME_FIELD).isVisible().catch(() => false)) await enterName(page, "Pablo");
  // From wherever the last flow left off (mid-match, in a room): a fresh page, on the menu.
  if (!(await page.getByRole("button", { name: "edit your fighter" }).isVisible().catch(() => false))) await page.goto(page.url());
  await page.getByRole("button", { name: "edit your fighter" }).click();
  const handle = (name: string) => page.getByRole("slider", { name });
  const center = async (name: string) => {
    const b = (await handle(name).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  /** Handle positions in world units (from the SVG attributes). */
  const corners = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("svg.editor circle.handle")].map((c) => ({ x: +c.getAttribute("cx")!, y: -+c.getAttribute("cy")! })),
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
  check(!(await page.getByRole("button", { name: "Save" }).isDisabled()), "the pushed-back shape is still legal (Save enabled)");

  // 2. A lopsided drag, then let go: it settles so the center of mass is straight above the foot.
  await drag("corner 2", -60, 40);
  await page.waitForTimeout(600); // settle animation
  const v = await corners();
  const cx = (v[0].x + v[1].x + v[2].x) / 3;
  check(Math.abs(cx - v[0].x) < 0.01, `after letting go: balanced (center of mass x ${cx.toFixed(3)} above foot x ${v[0].x.toFixed(3)})`);
  await shot(page, "12-customize");

  // Eyes: pick a style from the sheet; the editor's triangle wears it.
  await page.getByRole("radio", { name: "color: Sky" }).click();
  check((await page.getByRole("radio", { name: "color: Sky" }).getAttribute("aria-checked")) === "true", "color picker: Sky selected (the preview wears it)");
  await page.getByRole("button", { name: "eyes: Cat" }).click();
  check((await page.getByRole("button", { name: "eyes: Cat" }).getAttribute("aria-pressed")) === "true", "eye picker: Cat selected");
  check((await page.locator("svg.editor .face").count()) === 1, "the editor's fighter shows the chosen eyes");
  await shot(page, "12b-customize-eyes");

  // 3. Save; reload; it's remembered.
  await page.getByRole("button", { name: "Save" }).click();
  await page.reload();
  await page.getByRole("button", { name: "edit your fighter" }).click();
  const after = await corners();
  const same = after.every((p, i) => Math.abs(p.x - v[i].x) < 1e-3 && Math.abs(p.y - v[i].y) < 1e-3);
  check(same, "after reload: the saved shape is remembered");
  check((await page.getByRole("button", { name: "eyes: Cat" }).getAttribute("aria-pressed")) === "true", "after reload: the eye style is remembered");
  check((await page.getByRole("radio", { name: "color: Sky" }).getAttribute("aria-checked")) === "true", "after reload: the color is remembered");
  await page.getByRole("button", { name: "Back" }).click();

  // 4. In a local match, my fighter has that shape, at the standard fighter's mass (area).
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".roster .name", { hasText: "bot" }).first().waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(300);
  const { shapes } = await info(page);
  const [mine, bot] = shapes;
  check(Math.abs(mine.height - bot.height) > 0.05 || Math.abs(mine.width - bot.width) > 0.05, `my fighter is my shape (${mine.height.toFixed(2)}×${mine.width.toFixed(2)} vs standard ${bot.height.toFixed(2)}×${bot.width.toFixed(2)})`);
  check(Math.abs(mine.area - bot.area) < 1e-3, `same mass as the standard fighter (area ${mine.area.toFixed(4)} vs ${bot.area.toFixed(4)})`);
  await page.waitForTimeout(500);
  const look = await info(page);
  check(look.eyes[0] === 10 && look.facesReady >= 4, `in the match: my fighter wears the Cat eyes (styles ${JSON.stringify(look.eyes)}, ${look.facesReady} face images ready)`);
  check(look.colors[0] === 7 && new Set(look.colors).size === look.colors.length, `in the match: I'm Sky, everyone has a different color (${JSON.stringify(look.colors)})`);
  await shot(page, "13-custom-in-game");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to room" }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
}
