import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProgress } from "./review";
import {
  getBestScore,
  getQuality,
  loadProgress,
  normalizeQuality,
  recordScore,
  resetProgress,
  saveProgress,
  setQuality,
  useStoreForTests,
} from "./storage";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  useStoreForTests({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  });
});
afterEach(() => useStoreForTests(null));

describe("best scores", () => {
  it("are kept separately per species", () => {
    recordScore("mouse", "easy", 5000);
    recordScore("human", "easy", 3000);
    expect(getBestScore("mouse", "easy")).toBe(5000);
    expect(getBestScore("human", "easy")).toBe(3000);
    expect(getBestScore("human", "hard")).toBeNull();
  });

  it("still finds a mouse best score saved before M5", () => {
    data.set("brain-atlas:best-score:medium", "6442");
    expect(getBestScore("mouse", "medium")).toBe(6442);
    expect(getBestScore("human", "medium")).toBeNull();
    expect(recordScore("mouse", "medium", 6000)).toBe(false); // old best still counts
    expect(recordScore("mouse", "medium", 7000)).toBe(true);
    expect(data.get("brain-atlas:best-score:mouse:medium")).toBe("7000");
  });
});

describe("review progress", () => {
  it("is separate per species and migrates the old mouse key", () => {
    const old = { ...emptyProgress(), gamesPlayed: 4 };
    data.set("brain-atlas:progress", JSON.stringify(old));
    expect(loadProgress("mouse").gamesPlayed).toBe(4);
    expect(loadProgress("human").gamesPlayed).toBe(0);
    saveProgress("mouse", { ...old, gamesPlayed: 5 });
    expect(data.has("brain-atlas:progress")).toBe(false); // moved to the new key
    expect(loadProgress("mouse").gamesPlayed).toBe(5);
  });

  it("reset only affects one species", () => {
    saveProgress("mouse", { ...emptyProgress(), gamesPlayed: 2 });
    saveProgress("human", { ...emptyProgress(), gamesPlayed: 3 });
    resetProgress("human");
    expect(loadProgress("human").gamesPlayed).toBe(0);
    expect(loadProgress("mouse").gamesPlayed).toBe(2);
  });
});

describe("quality", () => {
  it("understands the old 10um/25um names and defaults to sharp", () => {
    expect(normalizeQuality("10um")).toBe("sharp");
    expect(normalizeQuality("25um")).toBe("light");
    expect(normalizeQuality(null)).toBe("sharp");
    expect(normalizeQuality("bogus")).toBe("sharp");
    setQuality("light");
    expect(getQuality()).toBe("light");
  });
});
