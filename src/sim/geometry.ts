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
 * 60% charge to reach at gravity 10.5 / jumpMaxSpeed 7.5.
 */
export const WINGS_STAGE: Stage = {
  platforms: [
    { center: { x: 0, y: -0.5 }, halfWidth: 8, halfHeight: 0.5 },
    { center: { x: -7, y: 1.85 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
    { center: { x: 7, y: 1.85 }, halfWidth: 1.5, halfHeight: 0.15, oneWay: true },
  ],
  spawnLine: { minX: -8, maxX: 8, y: 0.001 }, // 2 players: ±4; 4 players: -6, -2, 2, 6
  respawnY: 3.5,
  blastZone: { minX: -20, maxX: 20, minY: -8, maxY: 20 },
  camera: { center: { x: 0, y: 2.5 }, width: 22, height: 11 },
};

/** n spawn points, evenly spaced: each player gets the middle of an equal slice of the line. */
export function spawnPoints(stage: Stage, n: number): Vec2[] {
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

