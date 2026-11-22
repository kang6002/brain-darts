// Shapes of the JSON files written by pipeline/build_atlas.py.

/** One entry of structures.json. `index` is its position in that array. */
export interface Structure {
  index: number;
  id: number; // Allen structure id
  acronym: string;
  name: string;
  parentIndex: number | null;
  depth: number; // 0 = root; -1 for the "outside brain" entry at index 0
  color: string; // "#RRGGBB"
}

export interface RegionStat {
  areaPx: number;
  centroid: [number, number]; // [x, y] in slice pixels
}

/** One entry of slices.json → "slices". */
export interface SliceMeta {
  id: string;
  plane: "coronal";
  index: number;
  apMm: number;
  width: number;
  height: number;
  mmPerPixel: number;
  image: string; // PNG file name
  labels: string; // .bin.gz file name
  regions: string; // .regions.json file name: Record<index, RegionStat> (not used by the game yet)
  targets: Record<Difficulty, number[]>; // structure indices that can be asked on this slice
}

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
