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
/**
 * The parent only counts if, on this slice, it is at most this many times the
 * target's area. Otherwise it is too big to be a "near miss" (for a cortical
 * area the parent is the whole isocortex, 20–37× larger). Chosen from the data:
 * 4× keeps TH→Interbrain (1.9×), CA→Hippocampal region (1.4×), CA1→Ammon's horn.
 */
export const MAX_PARENT_AREA_RATIO = 4;

/**
 * Mouse (decay 0.75 mm): 0 mm → 1000, 0.5 mm → 513, 1 mm → 264, 2 mm → 69.
 * The human brain is ~12× bigger, so it uses decay 5 mm: 2 mm → 670, 5 mm → 368.
 */
export function distancePoints(distanceMm: number, decayMm: number = DECAY_MM): number {
  return Math.round(MAX_POINTS * Math.exp(-Math.max(0, distanceMm) / decayMm));
}

export interface Score {
  points: number;
  distanceMm: number;
  /** Set when the hierarchy floor raised the score: the parent the click was in. */
  creditedParent: number | null;
}

/**
 * @param areaPx area of a region (with its subregions) on this slice, in pixels.
 *               Only called for the target and its parent.
 */
export function scoreClick(
  distanceMm: number,
  clickedIndex: number,
  targetIndex: number,
  structures: Structure[],
  areaPx: (index: number) => number,
  decayMm: number = DECAY_MM,
): Score {
  const points = distancePoints(distanceMm, decayMm);
  const parent = structures[targetIndex].parentIndex;
  if (
    points < PARENT_FLOOR &&
    parent !== null &&
    structures[parent].depth >= MIN_PARENT_DEPTH &&
    isWithin(clickedIndex, parent, structures) &&
    areaPx(parent) <= MAX_PARENT_AREA_RATIO * areaPx(targetIndex)
  ) {
    return { points: PARENT_FLOOR, distanceMm, creditedParent: parent };
  }
  return { points, distanceMm, creditedParent: null };
}
