// Helpers for walking the region tree (structures.json).

import type { Structure } from "./types";

export const OUTSIDE = 0; // label value for pixels outside the brain

/** True if `index` is `ancestor` itself or lies anywhere below it. */
export function isWithin(index: number, ancestor: number, structures: Structure[]): boolean {
  let current: number | null = index;
  while (current !== null && current !== OUTSIDE) {
    if (current === ancestor) return true;
    current = structures[current].parentIndex;
  }
  return false;
}

/**
 * mask[i] === 1 when structure i is `target` or one of its descendants.
 * Computing this once lets us test millions of pixels quickly.
 */
export function descendantMask(target: number, structures: Structure[]): Uint8Array {
  const mask = new Uint8Array(structures.length);
  for (const s of structures) {
    if (s.index !== OUTSIDE && isWithin(s.index, target, structures)) mask[s.index] = 1;
  }
  return mask;
}

/**
 * The closest region at or above `index` that belongs to `level` (a set of
 * structure indices, e.g. all hard-mode regions). Null if there is none.
 * Example: a click in "Primary motor area, Layer 6a" at medium level gives
 * "Somatomotor areas".
 */
export function regionAtLevel(index: number, level: ReadonlySet<number>, structures: Structure[]): number | null {
  let current: number | null = index;
  while (current !== null && current !== OUTSIDE) {
    if (level.has(current)) return current;
    current = structures[current].parentIndex;
  }
  return null;
}

/** "fiber tracts" → "Fiber tracts" (some Allen names start lowercase). */
export function displayName(s: Structure): string {
  return s.name.charAt(0).toUpperCase() + s.name.slice(1);
}
