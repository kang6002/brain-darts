// Everything the game remembers, in the browser's localStorage:
//   brain-atlas:best-score:<species>:<level>   best score per species and level
//   brain-atlas:progress:<species>             review progress (Allen ids differ per species)
//   brain-atlas:quality                        "sharp" | "light"
//   brain-atlas:species                        last species played
// Every access is wrapped in try/catch: storage can be blocked (private
// windows, strict settings) and the game must still work without it.
//
// Migration: before the human mode existed (M1–M4) the keys had no species
// part and quality was "10um"/"25um". Old mouse data is still read.

import { emptyProgress, parseProgress, type Progress } from "./review";
import { QUALITIES, SPECIES, type Difficulty, type Quality, type SpeciesId } from "./types";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
let override: Store | null = null;

/** Tests pass a fake store here (Node has no localStorage). */
export function useStoreForTests(store: Store | null): void {
  override = store;
}

function store(): Store | null {
  if (override) return override;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    const s = store();
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    // ignore: it just won't be remembered
  }
}

// ---------------------------------------------------------------- best scores

/** Keys to read, newest first; mouse also reads the pre-M5 key. */
export function bestScoreKeys(species: SpeciesId, level: Difficulty): string[] {
  const keys = [`brain-atlas:best-score:${species}:${level}`];
  if (species === "mouse") keys.push(`brain-atlas:best-score:${level}`);
  return keys;
}

export function getBestScore(species: SpeciesId, level: Difficulty): number | null {
  for (const key of bestScoreKeys(species, level)) {
    const raw = read(key);
    if (raw !== null && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

/** Saves the score if it beats the old best. Returns true if it was a new best. */
export function recordScore(species: SpeciesId, level: Difficulty, score: number): boolean {
  const best = getBestScore(species, level);
  if (best !== null && score <= best) return false;
  write(bestScoreKeys(species, level)[0], String(score));
  return true;
}

// ---------------------------------------------------------------- review progress

export function progressKeys(species: SpeciesId): string[] {
  const keys = [`brain-atlas:progress:${species}`];
  if (species === "mouse") keys.push("brain-atlas:progress");
  return keys;
}

/** Review progress (Leitner boxes per region); empty if none saved or storage is blocked. */
export function loadProgress(species: SpeciesId): Progress {
  for (const key of progressKeys(species)) {
    const raw = read(key);
    if (raw !== null) return parseProgress(raw);
  }
  return emptyProgress();
}

export function saveProgress(species: SpeciesId, progress: Progress): void {
  const [key, ...legacy] = progressKeys(species);
  write(key, JSON.stringify(progress));
  for (const old of legacy) write(old, null); // migrated: the new key now holds it
}

/** Forget review progress for one species (best scores are kept). */
export function resetProgress(species: SpeciesId): void {
  for (const key of progressKeys(species)) write(key, null);
}

// ---------------------------------------------------------------- settings

/** "10um"/"25um" were the quality names before M5. */
export function normalizeQuality(raw: string | null): Quality {
  if (raw === "10um") return "sharp";
  if (raw === "25um") return "light";
  return (QUALITIES as readonly string[]).includes(raw ?? "") ? (raw as Quality) : "sharp";
}

export function getQuality(): Quality {
  return normalizeQuality(read("brain-atlas:quality"));
}

export function setQuality(quality: Quality): void {
  write("brain-atlas:quality", quality);
}

export function getLastSpecies(): SpeciesId | null {
  const raw = read("brain-atlas:species");
  return (SPECIES as readonly string[]).includes(raw ?? "") ? (raw as SpeciesId) : null;
}

export function setLastSpecies(species: SpeciesId): void {
  write("brain-atlas:species", species);
}
