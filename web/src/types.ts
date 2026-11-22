// Shapes of the JSON files written by the pipeline (build_atlas.py for mouse,
// build_human.py for human). Both species use the same format.

/** One entry of structures.json. `index` is its position in that array. */
export interface Structure {
  index: number;
  id: number; // Allen structure id (mouse: graph 1, human: graph 16)
  acronym: string;
  name: string;
  parentIndex: number | null;
  depth: number; // 0 = root; -1 for the "outside brain" entry at index 0
  color: string; // "#RRGGBB"
}

export const SPECIES = ["mouse", "human"] as const;
export type SpeciesId = (typeof SPECIES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Image quality chosen in the menu. Mouse: sharp = 10 µm, light = 25 µm. Human: 1/64 and 1/128 of full size. */
export const QUALITIES = ["sharp", "light"] as const;
export type Quality = (typeof QUALITIES)[number];

/** slices.json → "species": what differs between mouse and human. */
export interface SpeciesInfo {
  id: SpeciesId;
  name: string;
  plates: number;
  planeLabel: string; // "Coronal slice" / "Coronal plate"
  hemisphere?: string;
  /** Names of the label maps each slice has: mouse ["default"], human ["gyral", "brodmann"]. */
  maps: string[];
  /** Which label map each difficulty uses (human: gyri for easy/medium, Brodmann for hard). */
  mapForLevel: Record<Difficulty, string>;
  /** Scoring distance scale in mm (points fall to 37 % here): mouse 0.75, human 5. */
  decayMm: number;
}

/** The files of one slice at one quality. */
export interface Variant {
  width: number;
  height: number;
  mmPerPixel: number;
  image: string; // PNG (mouse) or JPEG (human) file name
  labels: Record<string, string>; // label map name → .bin.gz file name
}

/** One entry of slices.json → "slices". */
export interface SliceMeta {
  id: string;
  plane: "coronal";
  index: number;
  apMm: number;
  section?: number; // human: section number in the Allen series
  variants: Record<Quality, Variant>;
  regions: string; // .regions.json file name (areas + centroids; not used by the game yet)
  targets: Record<Difficulty, number[]>; // structure indices that can be asked on this slice
}
