import { describe, expect, it } from "vitest";
import { descendantMask } from "./tree";
import {
  countPixels,
  decodeLabelMap,
  gunzipIfNeeded,
  labelAt,
  nearestTargetPoint,
  OUTSIDE,
  screenToSlice,
  type LabelMap,
} from "./labelmap";
import { IDX, STRUCTURES } from "./testFixtures";

// 5 × 3 map (width 5, height 3):
//   y=0:  0   TH  TH  0   0
//   y=1:  0   TH  0   0   PVH
//   y=2:  CB  0   0   0   HY
const W = 5;
const H = 3;
const PIXELS = [
  0, IDX.TH, IDX.TH, 0, 0,
  0, IDX.TH, 0, 0, IDX.PVH,
  IDX.CB, 0, 0, 0, IDX.HY,
];

function encode(values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v, true)); // little-endian, like the pipeline
  return buffer;
}

const map: LabelMap = decodeLabelMap(encode(PIXELS), W, H);

describe("decodeLabelMap", () => {
  it("reads little-endian uint16 values row by row", () => {
    expect(Array.from(map.data)).toEqual(PIXELS);
  });

  it("handles indices above 255 (needs both bytes)", () => {
    expect(decodeLabelMap(encode([1303, 256]), 2, 1).data).toEqual(new Uint16Array([1303, 256]));
  });

  it("rejects a file of the wrong size", () => {
    expect(() => decodeLabelMap(encode(PIXELS), 4, 3)).toThrow(/expected/);
  });
});

describe("gunzipIfNeeded", () => {
  async function gzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }

  it("unzips a gzip file back to the exact label map", async () => {
    const zipped = await gzip(encode(PIXELS));
    expect(new Uint8Array(zipped).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]));
    const map2 = decodeLabelMap(await gunzipIfNeeded(zipped), W, H);
    expect(Array.from(map2.data)).toEqual(PIXELS);
  });

  it("passes through data that a server already unzipped", async () => {
    const raw = encode(PIXELS);
    expect(await gunzipIfNeeded(raw)).toBe(raw);
  });
});

describe("labelAt", () => {
  it("finds the structure under a point", () => {
    expect(labelAt(map, 1.5, 0.5)).toBe(IDX.TH);
    expect(labelAt(map, 4.9, 1.0)).toBe(IDX.PVH);
  });

  it("treats a pixel as the square [px, px+1)", () => {
    expect(labelAt(map, 0.999, 2)).toBe(IDX.CB);
    expect(labelAt(map, 1.0, 2)).toBe(OUTSIDE);
  });

  it("returns OUTSIDE for background and for points off the image", () => {
    expect(labelAt(map, 0.5, 0.5)).toBe(OUTSIDE);
    expect(labelAt(map, -0.1, 1)).toBe(OUTSIDE);
    expect(labelAt(map, 5, 1)).toBe(OUTSIDE);
    expect(labelAt(map, 2, 3)).toBe(OUTSIDE);
  });
});

describe("screenToSlice", () => {
  // Canvas shown at 912 × 640 CSS pixels, placed at (100, 50) on the page.
  const rect = { left: 100, top: 50, width: 912, height: 640 };

  it("maps the corners and centre of the canvas to the slice", () => {
    expect(screenToSlice(100, 50, rect, 456, 320)).toEqual({ x: 0, y: 0 });
    expect(screenToSlice(1012, 690, rect, 456, 320)).toEqual({ x: 456, y: 320 });
    expect(screenToSlice(556, 370, rect, 456, 320)).toEqual({ x: 228, y: 160 });
  });

  it("still works when CSS shrinks the canvas", () => {
    const small = { left: 0, top: 0, width: 228, height: 160 };
    expect(screenToSlice(57, 40, small, 456, 320)).toEqual({ x: 114, y: 80 });
  });
});

describe("countPixels", () => {
  it("counts pixels of a region including its subregions", () => {
    expect(countPixels(map, descendantMask(IDX.TH, STRUCTURES))).toBe(3);
    expect(countPixels(map, descendantMask(IDX.HY, STRUCTURES))).toBe(2); // HY + PVH
    expect(countPixels(map, descendantMask(IDX.fiber, STRUCTURES))).toBe(0);
  });
});

describe("nearestTargetPoint", () => {
  it("gives distance 0 for a click inside the target", () => {
    expect(nearestTargetPoint(map, IDX.TH, STRUCTURES, 2.5, 0.5)?.distancePx).toBe(0);
  });

  it("measures to the edge of the nearest target pixel", () => {
    // Click at (3.5, 0.5): the TH pixel (2,0) spans x 2..3, so its edge is 0.5 away.
    const result = nearestTargetPoint(map, IDX.TH, STRUCTURES, 3.5, 0.5);
    expect(result?.distancePx).toBeCloseTo(0.5);
    expect(result?.point).toEqual({ x: 3, y: 0.5 });
  });

  it("measures diagonal distances with Pythagoras", () => {
    // Click at (4, 2): the nearest TH point is the bottom-right corner (3, 1)
    // of pixel (2,0), which is 1 across and 1 up: sqrt(1 + 1).
    const result = nearestTargetPoint(map, IDX.TH, STRUCTURES, 4, 2);
    expect(result?.distancePx).toBeCloseTo(Math.SQRT2);
    expect(result?.point).toEqual({ x: 3, y: 1 });
  });

  it("counts subregions as part of their parent", () => {
    // PVH (4,1) lies inside HY, so clicking it is a hit for HY.
    expect(nearestTargetPoint(map, IDX.HY, STRUCTURES, 4.5, 1.5)?.distancePx).toBe(0);
  });

  it("returns null when the target is not on the slice", () => {
    expect(nearestTargetPoint(map, IDX.fiber, STRUCTURES, 1, 1)).toBeNull();
  });
});
