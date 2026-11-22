import { describe, expect, it } from "vitest";
import { makeReviewRounds, makeRounds, pickWeighted, rankFor } from "./game";
import type { SliceMeta, Variant } from "./types";

function slice(id: string, easy: number[], hard: number[] = []): SliceMeta {
  const variant: Variant = { width: 1, height: 1, mmPerPixel: 0.025, image: "", labels: { default: "" } };
  return {
    id, plane: "coronal", index: 0, apMm: 0, variants: { sharp: variant, light: variant },
    regions: "", targets: { easy, medium: [], hard },
  };
}

describe("pickWeighted", () => {
  it("never picks a zero-weight item when others have weight", () => {
    for (let s = 1; s < 100; s++) expect(pickWeighted(["a", "b"], (x) => (x === "a" ? 0 : 1), seeded(s))).toBe("b");
  });
});

describe("makeReviewRounds", () => {
  const slices = [slice("a", [1, 2], [7]), slice("b", [2], [8])];

  it("asks the given regions, at the easiest level that includes them", () => {
    const rounds = makeReviewRounds(slices, [7, 2, 8], 10, seeded(1));
    expect(rounds.map((r) => r.target).sort()).toEqual([2, 7, 8]);
    for (const r of rounds) {
      expect(r.level).toBe(r.target === 2 ? "easy" : "hard");
      expect(r.slice.targets[r.level]).toContain(r.target);
    }
  });

  it("takes only the n most urgent and skips regions not on any slice", () => {
    const rounds = makeReviewRounds(slices, [99, 7, 2, 8], 2, seeded(1));
    expect(rounds.map((r) => r.target).sort()).toEqual([2, 7]);
  });
});

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

  it("picks heavily weighted (weak) regions first more often", () => {
    const four = [slice("a", [1, 2]), slice("b", [3, 4])];
    let firstIsWeak = 0;
    for (let s = 1; s <= 400; s++) {
      const [first] = makeRounds(four, "easy", 1, seeded(s), (r) => (r === 3 ? 6 : 1));
      if (first.target === 3) firstIsWeak++;
    }
    // expected share 6 / (6 + 1 + 1 + 1) = 67 %; uniform would be 25 %
    expect(firstIsWeak / 400).toBeGreaterThan(0.55);
    expect(firstIsWeak / 400).toBeLessThan(0.8);
  });

  it("puts each region on a slice where it can be asked", () => {
    const rounds = makeRounds([slice("a", [1]), slice("b", [2]), slice("c", [1, 2])], "easy", 6, seeded(7));
    for (const r of rounds) expect(r.slice.targets.easy).toContain(r.target);
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
