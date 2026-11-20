// Entry point: load physics, start the game, mount the menus, attach the
// (hidden) debug panel. The game lives in game.ts; the menus in ui/.

import { mount } from "svelte";
import { Game } from "./game";
import { touch } from "./input";
import { buildPanel } from "./panel";
import { initPhysics } from "./sim/sim";
import App from "./ui/App.svelte";

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
