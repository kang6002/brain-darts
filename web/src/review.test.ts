import { describe, expect, it } from "vitest";
import {
  dueRegions,
  emptyProgress,
  HIT_POINTS,
  isDue,
  masteredCount,
  MISS_POINTS,
  parseProgress,
  updateRecord,
  weightFor,
  type Progress,
  type RegionRecord,
} from "./review";

const rec = (box: number, lastGame: number, lastPoints = 500): RegionRecord => ({ box, tries: 1, hits: 0, lastGame, lastPoints });

describe("updateRecord", () => {
  it("moves up one box on a hit, back to box 1 on a miss", () => {
    expect(updateRecord(rec(2, 0), HIT_POINTS, 3).box).toBe(3);
    expect(updateRecord(rec(4, 0), MISS_POINTS - 1, 3).box).toBe(1);
  });

  it("never goes above box 5", () => {
    expect(updateRecord(rec(5, 0), 1000, 3).box).toBe(5);
  });

  it("keeps the box for an answer between miss and hit", () => {
    expect(updateRecord(rec(3, 0), MISS_POINTS, 3).box).toBe(3);
    expect(updateRecord(rec(3, 0), HIT_POINTS - 1, 3).box).toBe(3);
  });

  it("starts new regions in box 1 (miss), 2 (close) or 2 (hit)", () => {
    expect(updateRecord(undefined, 0, 1).box).toBe(1);
    expect(updateRecord(undefined, 500, 1).box).toBe(2);
    expect(updateRecord(undefined, 1000, 1).box).toBe(2);
  });

  it("counts tries and hits and remembers the game", () => {
    const r = updateRecord(updateRecord(undefined, 1000, 1), 100, 2);
    expect(r).toEqual({ box: 1, tries: 2, hits: 1, lastGame: 2, lastPoints: 100 });
  });
});

describe("isDue", () => {
  it("uses intervals of 0, 1, 2, 4, 8 games for boxes 1–5", () => {
    expect(isDue(rec(1, 5), 5)).toBe(true);
    expect(isDue(rec(2, 5), 5)).toBe(false);
    expect(isDue(rec(2, 5), 6)).toBe(true);
    expect(isDue(rec(4, 5), 8)).toBe(false);
    expect(isDue(rec(4, 5), 9)).toBe(true);
    expect(isDue(rec(5, 5), 13)).toBe(true);
  });
});

describe("weightFor", () => {
  it("picks missed regions most, mastered ones least", () => {
    expect(weightFor(rec(1, 0))).toBeGreaterThan(weightFor(undefined));
    expect(weightFor(undefined)).toBeGreaterThan(weightFor(rec(4, 0)));
    expect(weightFor(rec(4, 0))).toBeGreaterThan(weightFor(rec(5, 0)));
  });
});

describe("dueRegions", () => {
  it("lists due regions, lowest box first, then oldest, then worst answer", () => {
    const p: Progress = {
      version: 1,
      gamesPlayed: 10,
      regions: {
        "1": rec(1, 9, 300),
        "2": rec(1, 9, 100),
        "3": rec(1, 4, 350),
        "4": rec(3, 7), // due (3 games ≥ 2)
        "5": rec(4, 9), // not due
      },
    };
    expect(dueRegions(p, [1, 2, 3, 4, 5, 6])).toEqual([3, 2, 1, 4]);
  });
});

describe("masteredCount", () => {
  it("counts regions in box 4 or 5 among the given ids", () => {
    const p: Progress = { version: 1, gamesPlayed: 0, regions: { "1": rec(4, 0), "2": rec(5, 0), "3": rec(3, 0) } };
    expect(masteredCount(p, [1, 2, 3, 9])).toBe(2);
    expect(masteredCount(p, [3])).toBe(0);
  });
});

describe("parseProgress", () => {
  it("reads back what was saved", () => {
    const p: Progress = { version: 1, gamesPlayed: 3, regions: { "382": rec(2, 3) } };
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
  });

  it("falls back to empty progress for missing, broken or foreign data", () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress("{not json")).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ version: 2, gamesPlayed: 1, regions: {} }))).toEqual(emptyProgress());
  });

  it("drops damaged records but keeps good ones", () => {
    const raw = JSON.stringify({ version: 1, gamesPlayed: 2, regions: { "1": rec(9, 0), "2": rec(2, 1) } });
    expect(Object.keys(parseProgress(raw).regions)).toEqual(["2"]);
  });
});
