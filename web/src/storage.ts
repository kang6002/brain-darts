// Best score in localStorage. Wrapped in try/catch because storage can be
// blocked (private windows, strict browser settings); the game still works.

const KEY = "brain-atlas:best-score:easy";

export function getBestScore(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

/** Saves the score if it beats the old best. Returns true if it was a new best. */
export function recordScore(score: number): boolean {
  const best = getBestScore();
  if (best !== null && score <= best) return false;
  try {
    localStorage.setItem(KEY, String(score));
  } catch {
    // ignore: the score just won't be remembered
  }
  return true;
}
