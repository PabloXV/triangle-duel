// Fighter shapes and stages as plain data.

import { cos, sin } from "./detmath";

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * A fighter shape. Vertices are in body-local coordinates **relative to the
 * centroid**, so the body's origin is its center of mass and rotation happens
 * around it. `footIndex` names the one vertex allowed to touch the stage.
 */
export interface FighterShape {
  vertices: [Vec2, Vec2, Vec2];
  footIndex: 0 | 1 | 2;
}

/** An upside-down isosceles triangle (▽) balancing on its bottom vertex. */
export function invertedIsosceles(width: number, height: number): FighterShape {
  // Centroid = average of the vertices: one vertex at y=0, two at y=height,
  // so the centroid sits at 2/3 height above the foot.
  const cy = (2 * height) / 3;
  return {
    vertices: [
      { x: 0, y: -cy }, // foot
      { x: width / 2, y: height - cy }, // top right
      { x: -width / 2, y: height - cy }, // top left
    ],
    footIndex: 0,
  };
}

/** An axis-aligned rectangle. Fixed for now; moving platforms can add a path later. */
export interface Platform {
  center: Vec2;
  halfWidth: number;
  halfHeight: number;
  /**
   * One-way (pass-through from below, like floating platforms in Smash). Only
   * solid for a fighter that is entirely above its top surface; see
   * Sim.updateOneWaySolidity. Default: solid from every side.
   */
  oneWay?: boolean;
}

export interface Stage {
  platforms: Platform[];
  /** Fighters spawn evenly spaced along this line (foot positions), see spawnPoints(). */
  spawnLine: { minX: number; maxX: number; y: number };
  /**
   * Fixed spawn points (foot positions) per player count, where one line
   * can't work: a gap or steps would put someone over the pit or inside a
   * block. Overrides spawnLine for those counts.
   */
  spawns?: Partial<Record<number, Vec2[]>>;
  /** Respawns drop in from this height (foot position), above the player's spawn x. */
  respawnY: number;
  /** Anything whose center leaves this box is KO'd (fell off / launched). */
  blastZone: { minX: number; maxX: number; minY: number; maxY: number };
  /** What the (fixed) camera frames, in meters. Rendering only. */
  camera: { center: Vec2; width: number; height: number };
}

/** A single 8 m platform. Used by tests: simple and stable, so mechanics tests
 *  don't change when the real stage (WINGS_STAGE) gets redesigned. */
export const FLAT_STAGE: Stage = {
  platforms: [{ center: { x: 0, y: -0.5 }, halfWidth: 4, halfHeight: 0.5 }],
  spawnLine: { minX: -4, maxX: 4, y: 0.001 },
  respawnY: 3,
  blastZone: { minX: -14, maxX: 14, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2 }, width: 18, height: 10 },
};

/**
 * Wide main platform (16 m) plus two one-way wing platforms up and out at the
 * sides, overhanging the edges a bit. A wing top at 2 m needs roughly a
 * 60% charge to reach (jump heights stayed the same when gravity was halved to 5.25).
 */
export const WINGS_STAGE: Stage = {
  platforms: [
    { center: { x: 0, y: -0.5 }, halfWidth: 8, halfHeight: 0.5 },
    { center: { x: -7, y: 1.85 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
    { center: { x: 7, y: 1.85 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
  ],
  spawnLine: { minX: -8, maxX: 8, y: 0.001 },
  // Everyone drops in from above: the outer spawns stay clear of the wings
  // (evenly spaced, they landed on a wing's edge and slid off).
  spawns: {
    2: [{ x: -4, y: 0.001 }, { x: 4, y: 0.001 }],
    3: [{ x: -4.5, y: 0.001 }, { x: 0, y: 0.001 }, { x: 4.5, y: 0.001 }],
    4: [{ x: -4.5, y: 0.001 }, { x: -1.5, y: 0.001 }, { x: 1.5, y: 0.001 }, { x: 4.5, y: 0.001 }],
  },
  respawnY: 3.5,
  blastZone: { minX: -20, maxX: 20, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.5 }, width: 22, height: 11 },
};

/**
 * A short floor with three pass-through platforms, stacked like the classic
 * three-platform layout: the side ones a bit higher than Wings' wings, the top
 * one 3.6 m up (reach it from a side platform; tests/reach.test.ts). Good for
 * 3 to 4 players.
 */
export const OVERPASS_STAGE: Stage = {
  platforms: [
    { center: { x: 0, y: -0.5 }, halfWidth: 4.5, halfHeight: 0.5 },
    { center: { x: -3.6, y: 1.95 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
    { center: { x: 3.6, y: 1.95 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
    { center: { x: 0, y: 3.45 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
  ],
  spawnLine: { minX: -4.5, maxX: 4.5, y: 0.001 },
  // Dropping in from above, the floor is mostly covered by the three
  // platforms: spawn on them, centered (evenly spaced, the 2- and 4-player
  // spawns landed half off a platform edge; respawns use the 4-player set).
  spawns: {
    2: [{ x: -3.6, y: 2.101 }, { x: 3.6, y: 2.101 }],
    3: [{ x: -3.6, y: 2.101 }, { x: 0, y: 3.601 }, { x: 3.6, y: 2.101 }],
    4: [{ x: -3.6, y: 2.101 }, { x: -0.75, y: 3.601 }, { x: 0.75, y: 3.601 }, { x: 3.6, y: 2.101 }],
  },
  respawnY: 5,
  blastZone: { minX: -16, maxX: 16, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.7 }, width: 20, height: 11 },
};

/**
 * Two floors with a 2.8 m pit between them (a KO pit mid-stage) and a long,
 * low pass-through bar over it that overlaps both floor edges: hop up, walk
 * across, drop down (or jump the pit outright, harder). With 3 players, the
 * middle one starts on the bar. (A 3 m pit with a short, high bar was nearly
 * uncrossable: tests/reach.test.ts. A 2 m pit was too narrow: two fighters
 * falling in side by side wedged between the walls, held each other up, and
 * neither could jump; tilted, a fighter is ~1.4 m wide.)
 */
export const STATION_STAGE: Stage = {
  platforms: [
    { center: { x: -5.65, y: -0.5 }, halfWidth: 4.25, halfHeight: 0.5 },
    { center: { x: 5.65, y: -0.5 }, halfWidth: 4.25, halfHeight: 0.5 },
    { center: { x: 0, y: 1.45 }, halfWidth: 2, halfHeight: 0.15, oneWay: true },
  ],
  spawnLine: { minX: -8, maxX: 8, y: 0.001 },
  spawns: {
    2: [{ x: -5.65, y: 0.001 }, { x: 5.65, y: 0.001 }],
    3: [{ x: -5.65, y: 0.001 }, { x: 0, y: 1.601 }, { x: 5.65, y: 0.001 }],
    4: [{ x: -7, y: 0.001 }, { x: -3.5, y: 0.001 }, { x: 3.5, y: 0.001 }, { x: 7, y: 0.001 }],
  },
  respawnY: 3.5,
  blastZone: { minX: -20, maxX: 20, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.4 }, width: 22, height: 11 },
};

/**
 * A wide sidewalk with a two-step stoop in the middle. The steps are solid:
 * the first stage where the ground isn't flat, so a corner can catch on an edge.
 */
export const STOOP_STAGE: Stage = {
  platforms: [
    { center: { x: 0, y: -0.5 }, halfWidth: 7, halfHeight: 0.5 },
    { center: { x: 0, y: 0.25 }, halfWidth: 2.6, halfHeight: 0.25 },
    { center: { x: 0, y: 0.75 }, halfWidth: 1.7, halfHeight: 0.25 },
  ],
  spawnLine: { minX: -7, maxX: 7, y: 0.001 },
  spawns: {
    2: [{ x: -4.5, y: 0.001 }, { x: 4.5, y: 0.001 }],
    3: [{ x: -4.8, y: 0.001 }, { x: 0, y: 1.001 }, { x: 4.8, y: 0.001 }],
    4: [{ x: -5.6, y: 0.001 }, { x: -3.5, y: 0.001 }, { x: 3.5, y: 0.001 }, { x: 5.6, y: 0.001 }],
  },
  respawnY: 3.5,
  blastZone: { minX: -18, maxX: 18, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.3 }, width: 20, height: 10 },
};

/** n spawn points, evenly spaced: each player gets the middle of an equal slice of the line. */
export function spawnPoints(stage: Stage, n: number): Vec2[] {
  const fixed = stage.spawns?.[n];
  if (fixed && fixed.length === n) return fixed.map((p) => ({ ...p }));
  const { minX, maxX, y } = stage.spawnLine;
  const slice = (maxX - minX) / n;
  return Array.from({ length: n }, (_, i) => ({ x: minX + (i + 0.5) * slice, y }));
}

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = cos(angle);
  const s = sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Height of a platform's walkable top surface. */
export function platformTop(p: Platform): number {
  return p.center.y + p.halfHeight;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Distance from point p to the platform rectangle (0 if inside). Used by both
 * the grounded check and the KO check, so the two rules measure the same way.
 */
export function distanceToPlatform(p: Vec2, plat: Platform): number {
  const dx = Math.max(Math.abs(p.x - plat.center.x) - plat.halfWidth, 0);
  const dy = Math.max(Math.abs(p.y - plat.center.y) - plat.halfHeight, 0);
  return Math.sqrt(dx * dx + dy * dy); // not Math.hypot: see detmath.ts
}


/** A single 10 m platform, no wings: tighter and more aggressive than Wings. */
export const ISLAND_STAGE: Stage = {
  platforms: [{ center: { x: 0, y: -0.5 }, halfWidth: 5, halfHeight: 0.5 }],
  spawnLine: { minX: -5, maxX: 5, y: 0.001 },
  respawnY: 3.5,
  blastZone: { minX: -16, maxX: 16, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.5 }, width: 18, height: 10 },
};
