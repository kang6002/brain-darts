// Best score per difficulty in localStorage. Wrapped in try/catch because
// storage can be blocked (private windows, strict settings); the game still works.

import type { Difficulty } from "./types";

const key = (difficulty: Difficulty) => `brain-atlas:best-score:${difficulty}`;

export function getBestScore(difficulty: Difficulty): number | null {
  try {
    const raw = localStorage.getItem(key(difficulty));
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

/** Saves the score if it beats the old best. Returns true if it was a new best. */
export function recordScore(difficulty: Difficulty, score: number): boolean {
  const best = getBestScore(difficulty);
  if (best !== null && score <= best) return false;
  try {
    localStorage.setItem(key(difficulty), String(score));
  } catch {
    // ignore: the score just won't be remembered
  }
  return true;
}
