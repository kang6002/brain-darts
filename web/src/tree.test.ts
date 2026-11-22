import { describe, expect, it } from "vitest";
import { IDX, STRUCTURES } from "./testFixtures";
import { descendantMask, displayName, isWithin, OUTSIDE, regionAtLevel } from "./tree";

describe("isWithin", () => {
  it("is true for the region itself and everything below it", () => {
    expect(isWithin(IDX.HY, IDX.HY, STRUCTURES)).toBe(true);
    expect(isWithin(IDX.PVH, IDX.HY, STRUCTURES)).toBe(true);
    expect(isWithin(IDX.PVH, IDX.IB, STRUCTURES)).toBe(true);
  });

  it("is false for siblings, parents and outside the brain", () => {
    expect(isWithin(IDX.TH, IDX.HY, STRUCTURES)).toBe(false);
    expect(isWithin(IDX.IB, IDX.HY, STRUCTURES)).toBe(false);
    expect(isWithin(OUTSIDE, IDX.root, STRUCTURES)).toBe(false);
  });
});

describe("descendantMask", () => {
  it("marks the region and its subregions only", () => {
    const mask = descendantMask(IDX.HY, STRUCTURES);
    expect([...mask.keys()].filter((i) => mask[i])).toEqual([IDX.HY, IDX.PVH]);
  });
});

describe("regionAtLevel", () => {
  const level = new Set<number>([IDX.TH, IDX.HY, IDX.CB]);

  it("finds the region of that level that contains the click", () => {
    expect(regionAtLevel(IDX.PVH, level, STRUCTURES)).toBe(IDX.HY);
    expect(regionAtLevel(IDX.TH, level, STRUCTURES)).toBe(IDX.TH);
  });

  it("returns null when no region of that level contains it", () => {
    expect(regionAtLevel(IDX.fiber, level, STRUCTURES)).toBeNull();
    expect(regionAtLevel(IDX.IB, level, STRUCTURES)).toBeNull(); // a parent, not inside
    expect(regionAtLevel(OUTSIDE, level, STRUCTURES)).toBeNull();
  });
});

describe("displayName", () => {
  it("capitalises lowercase Allen names", () => {
    expect(displayName(STRUCTURES[IDX.fiber])).toBe("Fiber tracts");
  });
});
