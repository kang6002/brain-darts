// Loading the static files in public/data/ (made by pipeline/build_atlas.py).

import type { Difficulty, Quality, SliceMeta, Structure, Variant } from "./types";
import { decodeLabelMap, gunzipIfNeeded, type LabelMap } from "./labelmap";

// BASE_URL is "./" (see vite.config.ts), so this also works on GitHub Pages.
const DATA = `${import.meta.env.BASE_URL}data/`;

export interface LoadedSlice {
  meta: SliceMeta;
  variant: Variant;
  image: HTMLImageElement;
  labels: LabelMap;
}

export interface AtlasIndex {
  structures: Structure[];
  slices: SliceMeta[];
  /** All regions of each difficulty, before the per-slice size filter. */
  levels: Record<Difficulty, ReadonlySet<number>>;
  /** Region index → id of the slice where it is largest (for study-mode search). */
  bestSlice: ReadonlyMap<number, string>;
}

interface SlicesFile {
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

/** The small files needed before anything can start (~230 KB). */
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
    bestSlice: new Map(Object.entries(index.bestSlice).map(([k, v]) => [Number(k), v])),
  };
}

// Each slice is downloaded at most once per quality; asking again returns the same promise.
const cache = new Map<string, Promise<LoadedSlice>>();

/** Image + label map of one slice, downloaded the first time it is needed. */
export function loadSlice(meta: SliceMeta, quality: Quality): Promise<LoadedSlice> {
  const key = `${meta.id}@${quality}`;
  let pending = cache.get(key);
  if (!pending) {
    const variant = meta.variants[quality];
    pending = Promise.all([
      loadImage(`${DATA}${variant.image}`),
      fetchOk(`${DATA}${variant.labels}`)
        .then((r) => r.arrayBuffer())
        .then(gunzipIfNeeded),
    ]).then(([image, buffer]) => ({
      meta,
      variant,
      image,
      labels: decodeLabelMap(buffer, variant.width, variant.height),
    }));
    pending.catch(() => cache.delete(key)); // allow a retry after a network error
    cache.set(key, pending);
  }
  return pending;
}
