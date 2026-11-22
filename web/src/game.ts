// Choosing the rounds of a game. Pure: pass your own `random` in tests.

import type { Difficulty, SliceMeta } from "./types";

export const ROUNDS_PER_GAME = 10;

export interface Round {
  slice: SliceMeta;
  target: number; // structure index
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/**
 * Pick `n` rounds: a random slice that has targets at this difficulty, then a
 * random target on it. The same target is never asked twice in a row (unless
 * there is no other choice).
 */
export function makeRounds(
  slices: SliceMeta[],
  difficulty: Difficulty,
  n: number = ROUNDS_PER_GAME,
  random: () => number = Math.random,
): Round[] {
  const usable = slices.filter((s) => s.targets[difficulty].length > 0);
  if (usable.length === 0) throw new Error(`no slices have ${difficulty} targets`);
  const rounds: Round[] = [];
  let previous: number | null = null;
  for (let i = 0; i < n; i++) {
    const slice = pick(usable, random);
    const all = slice.targets[difficulty];
    const fresh = all.filter((t) => t !== previous);
    const target = pick(fresh.length > 0 ? fresh : all, random);
    rounds.push({ slice, target });
    previous = target;
  }
  return rounds;
}
