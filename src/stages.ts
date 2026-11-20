// The playable maps, for menus and match setup. (FLAT_STAGE in geometry.ts is
// reserved for tests, so it isn't listed.)

import { ISLAND_STAGE, OVERPASS_STAGE, STATION_STAGE, STOOP_STAGE, WINGS_STAGE, type Stage } from "./sim/geometry";

export interface StageInfo {
  id: string;
  name: string;
  blurb: string;
  stage: Stage;
}

export const STAGES: StageInfo[] = [
  { id: "wings", name: "Wings", blurb: "Wide floor, two pass-through wings", stage: WINGS_STAGE },
  { id: "island", name: "Island", blurb: "One small platform. No escape.", stage: ISLAND_STAGE },
  { id: "overpass", name: "Overpass", blurb: "Short floor, three stacked pass-throughs", stage: OVERPASS_STAGE },
  { id: "station", name: "Platform ▽", blurb: "A pit in the middle, a bar across it", stage: STATION_STAGE },
  { id: "stoop", name: "The Stoop", blurb: "Wide sidewalk, two solid steps", stage: STOOP_STAGE },
];

export function stageById(id: string): StageInfo {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
