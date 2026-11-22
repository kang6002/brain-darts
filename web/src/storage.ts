// Best score per difficulty in localStorage. Wrapped in try/catch because
// storage can be blocked (private windows, strict settings); the game still works.

import { QUALITIES, type Difficulty, type Quality } from "./types";

const QUALITY_KEY = "brain-atlas:quality";

/** Image quality chosen in the menu; "10um" (Sharp) unless the player picked Light. */
export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if ((QUALITIES as readonly string[]).includes(saved ?? "")) return saved as Quality;
  } catch {
    // storage blocked: fall through to the default
  }
  return "10um";
}

export function setQuality(quality: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    // ignore: the choice just won't be remembered
  }
}

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
