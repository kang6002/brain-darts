import { describe, expect, it } from "vitest";
import { distancePoints, MAX_PARENT_AREA_RATIO, MAX_POINTS, PARENT_FLOOR, scoreClick } from "./scoring";
import { IDX, STRUCTURES } from "./testFixtures";
import { OUTSIDE } from "./tree";

describe("distancePoints", () => {
  it("matches the documented curve", () => {
    expect(distancePoints(0)).toBe(MAX_POINTS);
    expect(distancePoints(0.5)).toBe(513);
    expect(distancePoints(1)).toBe(264);
    expect(distancePoints(2)).toBe(69);
  });

  it("uses the species' distance scale (human: 5 mm)", () => {
    expect(distancePoints(2, 5)).toBe(670);
    expect(distancePoints(5, 5)).toBe(368);
    expect(scoreClick(5, OUTSIDE, IDX.HY, STRUCTURES, () => 1, 5).points).toBe(368);
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
  // Areas on the slice, in pixels. Interbrain (IB) = TH + HY = 3 × HY.
  const areas: Record<number, number> = { [IDX.TH]: 100, [IDX.HY]: 50, [IDX.IB]: 150, [IDX.grey]: 2000 };
  const areaPx = (i: number) => areas[i] ?? 0;

  it("gives full points for a click inside the target", () => {
    expect(scoreClick(0, IDX.TH, IDX.TH, STRUCTURES, areaPx)).toEqual({
      points: MAX_POINTS,
      distanceMm: 0,
      creditedParent: null,
    });
  });

  it("gives the parent floor for a far click inside a small enough parent", () => {
    // Target HY, click in TH: both in Interbrain, which is 3× HY's area.
    const score = scoreClick(3, IDX.TH, IDX.HY, STRUCTURES, areaPx);
    expect(score.points).toBe(PARENT_FLOOR);
    expect(score.creditedParent).toBe(IDX.IB);
  });

  it("gives no partial credit when the parent is too big compared with the target", () => {
    const tinyHY = (i: number) => (i === IDX.HY ? 150 / (MAX_PARENT_AREA_RATIO + 1) : areaPx(i));
    const score = scoreClick(3, IDX.TH, IDX.HY, STRUCTURES, tinyHY);
    expect(score.points).toBe(distancePoints(3));
    expect(score.creditedParent).toBeNull();
  });

  it("allows a parent of exactly the maximum ratio", () => {
    const edge = (i: number) => (i === IDX.HY ? 150 / MAX_PARENT_AREA_RATIO : areaPx(i));
    expect(scoreClick(3, IDX.TH, IDX.HY, STRUCTURES, edge).creditedParent).toBe(IDX.IB);
  });

  it("keeps distance points when they beat the floor", () => {
    const score = scoreClick(0.2, IDX.TH, IDX.HY, STRUCTURES, areaPx);
    expect(score.points).toBe(distancePoints(0.2));
    expect(score.creditedParent).toBeNull();
  });

  it("gives no partial credit through root or grey", () => {
    // CB's parent is grey (depth 1); fiber tracts' parent is root (depth 0).
    expect(scoreClick(4, IDX.TH, IDX.CB, STRUCTURES, areaPx).points).toBe(distancePoints(4));
    expect(scoreClick(4, IDX.TH, IDX.fiber, STRUCTURES, areaPx).points).toBe(distancePoints(4));
  });

  it("gives no partial credit for a click in an unrelated region or outside the brain", () => {
    expect(scoreClick(4, IDX.CB, IDX.HY, STRUCTURES, areaPx).creditedParent).toBeNull();
    expect(scoreClick(4, OUTSIDE, IDX.HY, STRUCTURES, areaPx).points).toBe(distancePoints(4));
  });
});
