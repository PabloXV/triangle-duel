// Param panel (lil-gui). Edits the shared params object in place; the sim
// re-reads it every tick. Values persist in localStorage between reloads.

import GUI, { type Controller } from "lil-gui";
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

export interface UiState {
  debug: boolean;
  players: number; // 2–4. P3 and P4 are always bots.
  stocks: number;
  p1: "human" | "bot";
  p2: "human" | "bot";
  botReaction: number; // ticks; see BotConfig.reactionTicks
  cameraFollow: boolean;
  shakeScale: number;
  finalKoReplay: boolean;
  netName: string;
  netRoom: string;
  netStatus: string; // shown read-only in the panel
}

export interface PanelActions {
  restart(): void;
  controllersChanged(): void;
  watchLast(): void;
  downloadLast(): void;
  loadFile(): void;
  netCreate(): void;
  netJoin(): void;
  netStart(): void;
  netLobby(): void;
  netLeave(): void;
}

export function buildPanel(params: Params, ui: UiState, actions: PanelActions) {
  const gui = new GUI({ title: "Params", container: document.getElementById("panel") ?? undefined });

  const players = gui.addFolder("Match");
  // Player count and stocks define the match, so changing them restarts it.
  players.add(ui, "players", 2, 4, 1).name("players (restarts)").onFinishChange(actions.restart);
  players.add(ui, "stocks", 1, 9, 1).name("stocks (restarts)").onFinishChange(actions.restart);
  players.add(ui, "p1", ["human", "bot"]).name("P1 (arrows)").onChange(actions.controllersChanged);
  players.add(ui, "p2", ["human", "bot"]).name("P2 (A/D/S)").onChange(actions.controllersChanged);
  players.add(ui, "botReaction", 0, 40, 1).name("bot reaction (ticks)").onFinishChange(actions.controllersChanged);

  const online = gui.addFolder("Online");
  online.add(ui, "netName").name("your name");
  online.add(ui, "netRoom").name("room code").listen(); // shows the code after "create room"
  online.add(actions, "netCreate").name("create room");
  online.add(actions, "netJoin").name("join room");
  online.add(actions, "netStart").name("start match (host)");
  online.add(actions, "netLobby").name("end match (host)");
  online.add(actions, "netLeave").name("leave room");
  online.add(ui, "netStatus").name("status").disable().listen();

  const juice = gui.addFolder("Juice");
  juice.add(ui, "cameraFollow").name("camera follow");
  juice.add(ui, "shakeScale", 0, 3, 0.1).name("screen shake");
  juice.add(ui, "finalKoReplay").name("final KO replay");

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
  misc.add(ui, "debug").name("debug overlay");
  misc.add(actions, "restart").name("restart match (R)");
  misc.add(actions, "watchLast").name("watch last match");
  misc.add(actions, "downloadLast").name("download last match");
  misc.add(actions, "loadFile").name("load match file…");
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
    .name("reset to defaults");
  misc
    .add(
      {
        copy() {
          navigator.clipboard?.writeText(JSON.stringify(params, null, 2));
        },
      },
      "copy",
    )
    .name("copy params JSON");

  return gui;
}
