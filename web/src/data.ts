// Loading the static files in public/data/ (made by pipeline/build_atlas.py).

import type { SliceMeta, Structure } from "./types";
import { decodeLabelMap, type LabelMap } from "./labelmap";

// BASE_URL is "./" (see vite.config.ts), so this also works on GitHub Pages.
const DATA = `${import.meta.env.BASE_URL}data/`;

export interface LoadedSlice {
  meta: SliceMeta;
  image: HTMLImageElement;
  labels: LabelMap;
}

export interface Atlas {
  structures: Structure[];
  slices: Map<string, LoadedSlice>;
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

/** Loads everything up front. Fine for 10 slices (~3.5 MB); lazy-load in M2. */
export async function loadAtlas(): Promise<Atlas> {
  const [structures, index] = await Promise.all([
    fetchOk(`${DATA}structures.json`).then((r) => r.json() as Promise<Structure[]>),
    fetchOk(`${DATA}slices.json`).then((r) => r.json() as Promise<{ slices: SliceMeta[] }>),
  ]);
  const loaded = await Promise.all(
    index.slices.map(async (meta): Promise<LoadedSlice> => {
      const [image, buffer] = await Promise.all([
        loadImage(`${DATA}${meta.image}`),
        fetchOk(`${DATA}${meta.labels}`).then((r) => r.arrayBuffer()),
      ]);
      return { meta, image, labels: decodeLabelMap(buffer, meta.width, meta.height) };
    }),
  );
  return { structures, slices: new Map(loaded.map((s) => [s.meta.id, s])) };
}
