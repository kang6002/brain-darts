// Choosing the rounds of a game. Pure: pass your own `random` in tests.

import type { Difficulty, SliceMeta } from "./types";

export const ROUNDS_PER_GAME = 10;

export interface Round {
  slice: SliceMeta;
  target: number; // structure index
}

/** Title shown on the final screen, from the share of the maximum score. */
export const RANKS: [minShare: number, title: string][] = [
  [0.95, "Living Atlas"],
  [0.8, "Neuroanatomy Ace"],
  [0.6, "Nucleus Hunter"],
  [0.4, "Anatomy Apprentice"],
  [0.2, "Curious Freshman"],
  [0, "Lost in the Ventricles"],
];

export function rankFor(score: number, maxScore: number): string {
  const share = maxScore > 0 ? score / maxScore : 0;
  return RANKS.find(([min]) => share >= min)![1];
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/**
 * Pick `n` rounds: a random slice that still has a region not asked yet in
 * this game, then a random such region on it. Regions only repeat once every
 * region of the level has been asked, and never twice in a row (unless there
 * is no other choice).
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
  const asked = new Set<number>();
  let previous: number | null = null;
  for (let i = 0; i < n; i++) {
    let withNew = usable.filter((s) => s.targets[difficulty].some((t) => !asked.has(t)));
    if (withNew.length === 0) {
      asked.clear(); // every region has been asked: start a new cycle
      withNew = usable;
    }
    const slice = pick(withNew, random);
    const all = slice.targets[difficulty];
    const fresh = all.filter((t) => !asked.has(t) && t !== previous);
    const notPrevious = all.filter((t) => t !== previous);
    const target = pick(fresh.length > 0 ? fresh : notPrevious.length > 0 ? notPrevious : all, random);
    rounds.push({ slice, target });
    asked.add(target);
    previous = target;
  }
  return rounds;
}
