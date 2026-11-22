// Choosing the rounds of a game. Pure: pass your own `random` in tests.

import { DIFFICULTIES, type Difficulty, type SliceMeta } from "./types";

export const ROUNDS_PER_GAME = 10;

export interface Round {
  slice: SliceMeta;
  target: number; // structure index
  /** Level the question belongs to (for review rounds: the easiest level that asks it). */
  level: Difficulty;
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

/** Pick one item; an item with twice the weight is twice as likely. */
export function pickWeighted<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const weights = items.map((item) => Math.max(weight(item), 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(items, random);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** region index → slices where it can be asked at this level */
function slicesByRegion(slices: SliceMeta[], level: Difficulty): Map<number, SliceMeta[]> {
  const map = new Map<number, SliceMeta[]>();
  for (const slice of slices) {
    for (const t of slice.targets[level]) {
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(slice);
    }
  }
  return map;
}

/**
 * Pick `n` rounds: a region of this level (weighted by `weight`, e.g. how
 * badly you know it), then a random slice where it can be asked. Regions only
 * repeat once every region of the level has been asked, and never twice in a
 * row (unless there is no other choice).
 */
export function makeRounds(
  slices: SliceMeta[],
  difficulty: Difficulty,
  n: number = ROUNDS_PER_GAME,
  random: () => number = Math.random,
  weight: (region: number) => number = () => 1,
): Round[] {
  const where = slicesByRegion(slices, difficulty);
  if (where.size === 0) throw new Error(`no slices have ${difficulty} targets`);
  const pool = [...where.keys()];
  const rounds: Round[] = [];
  const asked = new Set<number>();
  let previous: number | null = null;
  for (let i = 0; i < n; i++) {
    let choices = pool.filter((t) => !asked.has(t) && t !== previous);
    if (choices.length === 0) {
      asked.clear(); // every region has been asked: start a new cycle
      choices = pool.filter((t) => t !== previous);
      if (choices.length === 0) choices = pool;
    }
    const target = pickWeighted(choices, weight, random);
    rounds.push({ slice: pick(where.get(target)!, random), target, level: difficulty });
    asked.add(target);
    previous = target;
  }
  return rounds;
}

/**
 * A review game: up to `n` of the given regions (most urgent first), each on a
 * random slice where it can be asked at the easiest level that includes it.
 * Rounds are shuffled so the order does not give away how weak each one is.
 */
export function makeReviewRounds(
  slices: SliceMeta[],
  regions: number[],
  n: number = ROUNDS_PER_GAME,
  random: () => number = Math.random,
): Round[] {
  const where = DIFFICULTIES.map((level) => [level, slicesByRegion(slices, level)] as const);
  const rounds: Round[] = [];
  for (const target of regions) {
    if (rounds.length === n) break;
    const found = where.find(([, map]) => map.has(target));
    if (!found) continue; // not askable on any slice
    const [level, map] = found;
    rounds.push({ slice: pick(map.get(target)!, random), target, level });
  }
  for (let i = rounds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rounds[i], rounds[j]] = [rounds[j], rounds[i]];
  }
  return rounds;
}
