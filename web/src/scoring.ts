// Points for one click. Pure functions, no DOM: see scoring.test.ts.

import type { Structure } from "./types";
import { isWithin } from "./tree";

export const MAX_POINTS = 1000;
/** Points fall to 1/e (≈37 %) of the maximum at this distance. */
export const DECAY_MM = 0.75;
/** Minimum points for clicking inside the target's parent region. */
export const PARENT_FLOOR = 250;
/** Parents shallower than this (root = 0, "Basic cell groups" = 1) give no partial credit. */
export const MIN_PARENT_DEPTH = 2;

/** 0 mm → 1000, 0.5 mm → 513, 1 mm → 264, 2 mm → 69. */
export function distancePoints(distanceMm: number): number {
  return Math.round(MAX_POINTS * Math.exp(-Math.max(0, distanceMm) / DECAY_MM));
}

export interface Score {
  points: number;
  distanceMm: number;
  /** Set when the hierarchy floor raised the score: the parent the click was in. */
  creditedParent: number | null;
}

export function scoreClick(
  distanceMm: number,
  clickedIndex: number,
  targetIndex: number,
  structures: Structure[],
): Score {
  const points = distancePoints(distanceMm);
  const parent = structures[targetIndex].parentIndex;
  if (
    parent !== null &&
    structures[parent].depth >= MIN_PARENT_DEPTH &&
    isWithin(clickedIndex, parent, structures) &&
    points < PARENT_FLOOR
  ) {
    return { points: PARENT_FLOOR, distanceMm, creditedParent: parent };
  }
  return { points, distanceMm, creditedParent: null };
}
