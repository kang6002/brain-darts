// Spaced repetition with Leitner boxes. Pure functions: see review.test.ts.
//
// Every region you are asked gets a record with a "box" from 1 to 5:
//   hit  (≥ HIT_POINTS)  → one box up (max 5)
//   miss (< MISS_POINTS) → back to box 1
//   in between           → stays (a first "close" answer starts in box 2)
// A region is "due" for review once enough games have passed since you last
// saw it: 0 games for box 1 (right away), then 1, 2, 4, 8. We count games, not
// days, because a game is played in bursts. Box ≥ MASTERED_BOX = "mastered".
//
// Records are keyed by the Allen structure id (stable across data rebuilds),
// not by our index (which could shift if the ontology changes).

export const HIT_POINTS = 750; // within ~0.2 mm, or inside the region
export const MISS_POINTS = 400; // more than ~0.5 mm away
export const MAX_BOX = 5;
export const MASTERED_BOX = 4;
/** Games to wait before a region in box b is due again: INTERVAL_GAMES[b]. */
export const INTERVAL_GAMES = [0, 0, 1, 2, 4, 8];
/** How much more often a region is picked in normal games, by box (index 0 = never asked). */
export const BOX_WEIGHT = [3, 6, 4, 2, 1, 0.5];

export interface RegionRecord {
  box: number; // 1..5
  tries: number;
  hits: number;
  lastGame: number; // game number when last asked
  lastPoints: number;
}

export interface Progress {
  version: 1;
  gamesPlayed: number;
  regions: Record<string, RegionRecord>; // key: Allen structure id
}

export function emptyProgress(): Progress {
  return { version: 1, gamesPlayed: 0, regions: {} };
}

/** New record after answering a region with `points` during game number `game`. */
export function updateRecord(old: RegionRecord | undefined, points: number, game: number): RegionRecord {
  const hit = points >= HIT_POINTS;
  const miss = points < MISS_POINTS;
  let box: number;
  if (miss) box = 1;
  else if (hit) box = Math.min(MAX_BOX, (old?.box ?? 1) + 1);
  else box = old?.box ?? 2;
  return {
    box,
    tries: (old?.tries ?? 0) + 1,
    hits: (old?.hits ?? 0) + (hit ? 1 : 0),
    lastGame: game,
    lastPoints: points,
  };
}

export function isDue(record: RegionRecord, gamesPlayed: number): boolean {
  return gamesPlayed - record.lastGame >= INTERVAL_GAMES[record.box];
}

/** Weight for picking a region in a normal game (higher = more often). */
export function weightFor(record: RegionRecord | undefined): number {
  return BOX_WEIGHT[record?.box ?? 0];
}

/**
 * Regions (by Allen id) that are due, most urgent first: lowest box first,
 * then the ones not seen for longest, then the worst last answer.
 */
export function dueRegions(progress: Progress, ids: Iterable<number>): number[] {
  const due: [number, RegionRecord][] = [];
  for (const id of ids) {
    const r = progress.regions[id];
    if (r && isDue(r, progress.gamesPlayed)) due.push([id, r]);
  }
  due.sort(([, a], [, b]) => a.box - b.box || a.lastGame - b.lastGame || a.lastPoints - b.lastPoints);
  return due.map(([id]) => id);
}

export function masteredCount(progress: Progress, ids: Iterable<number>): number {
  let n = 0;
  for (const id of ids) if ((progress.regions[id]?.box ?? 0) >= MASTERED_BOX) n++;
  return n;
}

/** Read saved progress, falling back to empty progress for missing or damaged data. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return emptyProgress();
  try {
    const data = JSON.parse(raw) as Partial<Progress>;
    if (data.version !== 1 || typeof data.gamesPlayed !== "number" || typeof data.regions !== "object" || !data.regions) {
      return emptyProgress();
    }
    const regions: Record<string, RegionRecord> = {};
    for (const [id, r] of Object.entries(data.regions)) {
      if (r && Number.isInteger(r.box) && r.box >= 1 && r.box <= MAX_BOX && typeof r.lastGame === "number") {
        regions[id] = { box: r.box, tries: r.tries ?? 1, hits: r.hits ?? 0, lastGame: r.lastGame, lastPoints: r.lastPoints ?? 0 };
      }
    }
    return { version: 1, gamesPlayed: data.gamesPlayed, regions };
  } catch {
    return emptyProgress();
  }
}
