// Loading the static files in public/data/ (made by pipeline/build_atlas.py).

import type { Difficulty, SliceMeta, Structure } from "./types";
import { decodeLabelMap, gunzipIfNeeded, type LabelMap } from "./labelmap";

// BASE_URL is "./" (see vite.config.ts), so this also works on GitHub Pages.
const DATA = `${import.meta.env.BASE_URL}data/`;

export interface LoadedSlice {
  meta: SliceMeta;
  image: HTMLImageElement;
  labels: LabelMap;
}

export interface AtlasIndex {
  structures: Structure[];
  slices: SliceMeta[];
  /** All regions of each difficulty, before the per-slice size filter. */
  levels: Record<Difficulty, ReadonlySet<number>>;
}

interface SlicesFile {
  slices: SliceMeta[];
  levels: Record<Difficulty, number[]>;
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

/** The small files needed before a game can start (~200 KB). */
export async function loadIndex(): Promise<AtlasIndex> {
  const [structures, index] = await Promise.all([
    fetchOk(`${DATA}structures.json`).then((r) => r.json() as Promise<Structure[]>),
    fetchOk(`${DATA}slices.json`).then((r) => r.json() as Promise<SlicesFile>),
  ]);
  return {
    structures,
    slices: index.slices,
    levels: {
      easy: new Set(index.levels.easy),
      medium: new Set(index.levels.medium),
      hard: new Set(index.levels.hard),
    },
  };
}

// Each slice is downloaded at most once; asking again returns the same promise.
const cache = new Map<string, Promise<LoadedSlice>>();

/** Image + label map of one slice, downloaded the first time it is needed. */
export function loadSlice(meta: SliceMeta): Promise<LoadedSlice> {
  let pending = cache.get(meta.id);
  if (!pending) {
    pending = Promise.all([
      loadImage(`${DATA}${meta.image}`),
      fetchOk(`${DATA}${meta.labels}`)
        .then((r) => r.arrayBuffer())
        .then(gunzipIfNeeded),
    ]).then(([image, buffer]) => ({ meta, image, labels: decodeLabelMap(buffer, meta.width, meta.height) }));
    pending.catch(() => cache.delete(meta.id)); // allow a retry after a network error
    cache.set(meta.id, pending);
  }
  return pending;
}
