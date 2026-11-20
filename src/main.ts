// Entry point: load physics, start the game, mount the menus, attach the
// (hidden) debug panel. The game lives in game.ts; the menus in ui/.

import { mount } from "svelte";
import { Game } from "./game";
import { touch } from "./input";
import { buildPanel } from "./panel";
import { initPhysics } from "./sim/sim";
import App from "./ui/App.svelte";
import { applyTheme } from "./ui/themeCss";
// The theme's fonts, self-hosted (bundled): titles, labels, body text.
import "@fontsource/sedgwick-ave-display";
import "@fontsource/permanent-marker";
import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "./ui/theme.css";

applyTheme(); // colors and fonts as CSS variables, before any menu renders
await initPhysics();

const game = new Game(document.getElementById("game") as HTMLCanvasElement);
mount(App, { target: document.getElementById("ui")!, props: { game } });

// Debug panel: a dev tool, hidden until you press ` (backtick).
const panel = document.getElementById("panel")!;
buildPanel(game, panel);
window.addEventListener("keydown", (e) => {
  if (e.key === "`" && !(e.target instanceof HTMLInputElement)) panel.hidden = !panel.hidden;
});

// Debug handle (browser console, and browser tests): what's running now.
Object.assign(window, { triangleDuel: { game, touch } });
