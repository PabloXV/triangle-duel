// The playable maps, for menus and match setup. (FLAT_STAGE in geometry.ts is
// reserved for tests, so it isn't listed.)

import { ISLAND_STAGE, WINGS_STAGE, type Stage } from "./sim/geometry";

export interface StageInfo {
  id: string;
  name: string;
  blurb: string;
  stage: Stage;
}

export const STAGES: StageInfo[] = [
  { id: "wings", name: "Wings", blurb: "Wide floor, two pass-through wings", stage: WINGS_STAGE },
  { id: "island", name: "Island", blurb: "One small platform. No escape.", stage: ISLAND_STAGE },
];

export function stageById(id: string): StageInfo {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
