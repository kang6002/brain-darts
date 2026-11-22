import { describe, expect, it } from "vitest";
import { distancePoints, MAX_POINTS, PARENT_FLOOR, scoreClick } from "./scoring";
import { IDX, STRUCTURES } from "./testFixtures";
import { OUTSIDE } from "./tree";

describe("distancePoints", () => {
  it("matches the documented curve", () => {
    expect(distancePoints(0)).toBe(MAX_POINTS);
    expect(distancePoints(0.5)).toBe(513);
    expect(distancePoints(1)).toBe(264);
    expect(distancePoints(2)).toBe(69);
  });

  it("never increases with distance and never goes negative", () => {
    let previous = Infinity;
    for (let d = 0; d <= 12; d += 0.25) {
      const p = distancePoints(d);
      expect(p).toBeLessThanOrEqual(previous);
      expect(p).toBeGreaterThanOrEqual(0);
      previous = p;
    }
  });
});

describe("scoreClick", () => {
  it("gives full points for a click inside the target", () => {
    expect(scoreClick(0, IDX.TH, IDX.TH, STRUCTURES)).toEqual({
      points: MAX_POINTS,
      distanceMm: 0,
      creditedParent: null,
    });
  });

  it("gives the parent floor for a far click inside the target's parent", () => {
    // Target HY, click in TH: both are in Interbrain (depth 2), 3 mm away.
    const score = scoreClick(3, IDX.TH, IDX.HY, STRUCTURES);
    expect(score.points).toBe(PARENT_FLOOR);
    expect(score.creditedParent).toBe(IDX.IB);
  });

  it("keeps distance points when they beat the floor", () => {
    const score = scoreClick(0.2, IDX.TH, IDX.HY, STRUCTURES);
    expect(score.points).toBe(distancePoints(0.2));
    expect(score.creditedParent).toBeNull();
  });

  it("gives no partial credit through root or grey", () => {
    // CB's parent is grey (depth 1); fiber tracts' parent is root (depth 0).
    expect(scoreClick(4, IDX.TH, IDX.CB, STRUCTURES).points).toBe(distancePoints(4));
    expect(scoreClick(4, IDX.TH, IDX.fiber, STRUCTURES).points).toBe(distancePoints(4));
  });

  it("gives no partial credit for a click in an unrelated region or outside the brain", () => {
    expect(scoreClick(4, IDX.CB, IDX.HY, STRUCTURES).creditedParent).toBeNull();
    expect(scoreClick(4, OUTSIDE, IDX.HY, STRUCTURES).points).toBe(distancePoints(4));
  });
});
