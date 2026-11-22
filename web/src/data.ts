// Loading the static files in public/data/<species>/ (made by the pipeline).

import type { Difficulty, Quality, SliceMeta, SpeciesId, SpeciesInfo, Structure, Variant } from "./types";
import { decodeLabelMap, gunzipIfNeeded, type LabelMap } from "./labelmap";

// BASE_URL is "./" (see vite.config.ts), so this also works on GitHub Pages.
const dataDir = (species: SpeciesId) => `${import.meta.env.BASE_URL}data/${species}/`;

export interface LoadedSlice {
  meta: SliceMeta;
  variant: Variant;
  image: HTMLImageElement;
  /** One label map per map name (mouse: "default"; human: "gyral", "brodmann"). */
  labels: Record<string, LabelMap>;
}

export interface AtlasIndex {
  species: SpeciesInfo;
  structures: Structure[];
  slices: SliceMeta[];
  /** All regions of each difficulty, before the per-slice size filter. */
  levels: Record<Difficulty, ReadonlySet<number>>;
  /** Region index → id of the slice where it is largest (for study-mode search). */
  bestSlice: ReadonlyMap<number, string>;
}

interface SlicesFile {
  species: SpeciesInfo;
  slices: SliceMeta[];
  levels: Record<Difficulty, number[]>;
  bestSlice: Record<string, string>;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url} (HTTP ${response.status})`);
  return response;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Text under the slice, e.g. "Coronal plate 60 of 106 · 80.3 mm from the first plate · …". */
export function sliceCaption(atlas: AtlasIndex, meta: SliceMeta): string {
  const { species, slices } = atlas;
  if (species.id === "human") {
    return `${species.planeLabel} ${meta.index} of ${slices.length} · ${meta.apMm.toFixed(1)} mm behind the first plate · ` +
      `${species.hemisphere ?? "one hemisphere"}`;
  }
  return `${species.planeLabel} · ${meta.apMm.toFixed(2)} mm from the front of the atlas · dorsal is up`;
}

const indexCache = new Map<SpeciesId, Promise<AtlasIndex>>();

/** The small files needed before a species can be played (loaded once per species). */
export function loadIndex(species: SpeciesId): Promise<AtlasIndex> {
  let pending = indexCache.get(species);
  if (!pending) {
    const dir = dataDir(species);
    pending = Promise.all([
      fetchOk(`${dir}structures.json`).then((r) => r.json() as Promise<Structure[]>),
      fetchOk(`${dir}slices.json`).then((r) => r.json() as Promise<SlicesFile>),
    ]).then(([structures, index]) => ({
      species: index.species,
      structures,
      slices: index.slices,
      levels: {
        easy: new Set(index.levels.easy),
        medium: new Set(index.levels.medium),
        hard: new Set(index.levels.hard),
      },
      bestSlice: new Map(Object.entries(index.bestSlice).map(([k, v]) => [Number(k), v])),
    }));
    pending.catch(() => indexCache.delete(species)); // allow a retry after a network error
    indexCache.set(species, pending);
  }
  return pending;
}

// Each slice is downloaded at most once per quality; asking again returns the same promise.
const sliceCache = new Map<string, Promise<LoadedSlice>>();

/** Image + all label maps of one slice, downloaded the first time they are needed. */
export function loadSlice(atlas: AtlasIndex, meta: SliceMeta, quality: Quality): Promise<LoadedSlice> {
  const key = `${atlas.species.id}/${meta.id}@${quality}`;
  let pending = sliceCache.get(key);
  if (!pending) {
    const dir = dataDir(atlas.species.id);
    const variant = meta.variants[quality];
    const maps = Object.entries(variant.labels);
    pending = Promise.all([
      loadImage(`${dir}${variant.image}`),
      ...maps.map(([, file]) =>
        fetchOk(`${dir}${file}`)
          .then((r) => r.arrayBuffer())
          .then(gunzipIfNeeded)
          .then((buffer) => decodeLabelMap(buffer, variant.width, variant.height)),
      ),
    ]).then(([image, ...decoded]) => ({
      meta,
      variant,
      image: image as HTMLImageElement,
      labels: Object.fromEntries(maps.map(([name], i) => [name, decoded[i] as LabelMap])),
    }));
    pending.catch(() => sliceCache.delete(key));
    sliceCache.set(key, pending);
  }
  return pending;
}
