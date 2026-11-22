// A tiny made-up region tree shaped like the real Allen one, for tests.
//
//   root (depth 0)
//   ├─ grey "Basic cell groups and regions" (1)
//   │   ├─ IB "Interbrain" (2)
//   │   │   ├─ TH "Thalamus" (3)
//   │   │   └─ HY "Hypothalamus" (3)
//   │   │       └─ PVH "Paraventricular hypothalamic nucleus" (4)
//   │   └─ CB "Cerebellum" (2)
//   └─ fiber tracts (1)

import type { Structure } from "./types";

const rows: [string, string, number | null, number][] = [
  ["", "outside brain", null, -1],
  ["root", "root", null, 0],
  ["grey", "Basic cell groups and regions", 1, 1],
  ["IB", "Interbrain", 2, 2],
  ["TH", "Thalamus", 3, 3],
  ["HY", "Hypothalamus", 3, 3],
  ["PVH", "Paraventricular hypothalamic nucleus", 5, 4],
  ["CB", "Cerebellum", 2, 2],
  ["fiber tracts", "fiber tracts", 1, 1],
];

export const STRUCTURES: Structure[] = rows.map(([acronym, name, parentIndex, depth], index) => ({
  index,
  id: index * 1000,
  acronym,
  name,
  parentIndex,
  depth,
  color: "#FF0000",
}));

export const IDX = { root: 1, grey: 2, IB: 3, TH: 4, HY: 5, PVH: 6, CB: 7, fiber: 8 } as const;
