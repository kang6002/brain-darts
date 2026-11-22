import { describe, expect, it } from "vitest";
import { makeRounds, rankFor } from "./game";
import type { SliceMeta, Variant } from "./types";

function slice(id: string, easy: number[], hard: number[] = []): SliceMeta {
  const variant: Variant = { width: 1, height: 1, mmPerPixel: 0.025, image: "", labels: "" };
  return {
    id, plane: "coronal", index: 0, apMm: 0, variants: { "25um": variant, "10um": variant },
    regions: "", targets: { easy, medium: [], hard },
  };
}

describe("rankFor", () => {
  it("picks the title for the share of the maximum score", () => {
    expect(rankFor(10000, 10000)).toBe("Living Atlas");
    expect(rankFor(9500, 10000)).toBe("Living Atlas");
    expect(rankFor(9499, 10000)).toBe("Neuroanatomy Ace");
    expect(rankFor(0, 10000)).toBe("Lost in the Ventricles");
  });
});

// Simple repeatable "random" numbers so the test always does the same thing.
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("makeRounds", () => {
  const slices = [slice("a", [4, 5]), slice("b", [5, 7]), slice("empty", [])];

  it("makes 10 rounds using only targets listed for that slice", () => {
    const rounds = makeRounds(slices, "easy", 10, seeded(1));
    expect(rounds).toHaveLength(10);
    for (const r of rounds) {
      expect(r.slice.id).not.toBe("empty");
      expect(r.slice.targets.easy).toContain(r.target);
    }
  });

  it("never asks the same target twice in a row", () => {
    for (let s = 1; s < 50; s++) {
      const rounds = makeRounds(slices, "easy", 10, seeded(s));
      for (let i = 1; i < rounds.length; i++) expect(rounds[i].target).not.toBe(rounds[i - 1].target);
    }
  });

  it("asks every region once before repeating any", () => {
    // 4 distinct regions spread over slices: the first 4 rounds must all differ,
    // and each later block of 4 too (a new cycle starts when all were asked).
    const many = [slice("a", [1, 2]), slice("b", [2, 3]), slice("c", [3, 4]), slice("d", [1])];
    for (let s = 1; s < 50; s++) {
      const targets = makeRounds(many, "easy", 8, seeded(s)).map((r) => r.target);
      expect(new Set(targets.slice(0, 4)).size).toBe(4);
    }
  });

  it("fails clearly if no slice has targets", () => {
    expect(() => makeRounds([slice("empty", [])], "easy")).toThrow(/no slices/);
  });

  it("uses the target list of the chosen difficulty", () => {
    const mixed = [slice("a", [4], [40, 41]), slice("b", [5], [])];
    const rounds = makeRounds(mixed, "hard", 10, seeded(3));
    for (const r of rounds) {
      expect(r.slice.id).toBe("a"); // "b" has no hard targets
      expect([40, 41]).toContain(r.target);
    }
  });
});
