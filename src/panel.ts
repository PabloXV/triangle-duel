// The debug panel (lil-gui), a dev tool: press ` (backtick) to show it. Edits
// the shared params object in place (the sim re-reads it every tick; values
// persist in localStorage), presentation settings, and match recordings.

import GUI, { type Controller } from "lil-gui";
import type { Game } from "./game";
import type { Recording } from "./sim/recording";
import { DEFAULT_PARAMS, PARAM_GROUPS, PARAM_META, type Params } from "./sim/params";

const STORAGE_KEY = "triangle-duel.params.v1";

export function loadParams(): Params {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    // Only keep known keys, so renamed/removed params don't linger.
    const merged: Params = { ...DEFAULT_PARAMS };
    for (const k of Object.keys(DEFAULT_PARAMS) as (keyof Params)[]) {
      if (typeof saved[k] === typeof DEFAULT_PARAMS[k]) (merged as any)[k] = saved[k];
    }
    return merged;
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

function saveParams(params: Params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // storage unavailable; tuning just won't persist
  }
}

export function buildPanel(game: Game, container: HTMLElement) {
  const params = game.params;
  const gui = new GUI({ title: "Debug panel  (` to hide)", container });

  const juice = gui.addFolder("Juice");
  juice.add(game.settings, "cameraFollow").name("camera follow");
  juice.add(game.settings, "shakeScale", 0, 3, 0.1).name("screen shake");
  juice.add(game.settings, "finalKoReplay").name("final KO replay");

  const folders = new Map(PARAM_GROUPS.map((g) => [g, gui.addFolder(g)]));
  folders.get("Advanced")!.close();

  // Controllers whose visibility depends on other params (e.g. hopSpeed only in auto mode).
  const conditional: [Controller, (p: Params) => boolean][] = [];
  const refreshVisibility = () => conditional.forEach(([c, showIf]) => c.show(showIf(params)));

  for (const key of Object.keys(PARAM_META) as (keyof Params)[]) {
    const meta = PARAM_META[key];
    const f = folders.get(meta.group)!;
    const ctrl = meta.range
      ? f.add(params, key, meta.range[0], meta.range[1], meta.range[2])
      : meta.options
        ? f.add(params, key, meta.options)
        : f.add(params, key);
    if (!meta.live) ctrl.name(`${key} (restart)`);
    if (meta.showIf) conditional.push([ctrl, meta.showIf]);
    ctrl.onChange(() => {
      saveParams(params);
      refreshVisibility();
    });
  }
  refreshVisibility();

  const misc = gui.addFolder("Misc");
  misc.add(game.settings, "debug").name("debug overlay");
  misc.add({ watch: () => watchLast(game) }, "watch").name("watch last match");
  misc.add({ download: () => downloadLast(game) }, "download").name("download last match");
  misc.add({ load: () => loadFile(game) }, "load").name("load match file…");
  misc
    .add(
      {
        reset() {
          Object.assign(params, DEFAULT_PARAMS);
          saveParams(params);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          refreshVisibility();
        },
      },
      "reset",
    )
    .name("reset params to defaults");
  misc.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(params, null, 2)) }, "copy").name("copy params JSON");

  return gui;
}

function watchLast(game: Game) {
  const rec = game.latestRecording();
  if (rec) game.watch(rec);
}

function downloadLast(game: Game) {
  const rec = game.latestRecording();
  if (!rec) return;
  const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `triangle-duel-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadFile(game: Game) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      game.watch(JSON.parse(await file.text()) as Recording);
    } catch (err) {
      alert(`Couldn't load that recording: ${err instanceof Error ? err.message : err}`);
    }
  };
  input.click();
}
