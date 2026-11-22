// The hidden label map: which structure is at each pixel of a slice.
//
// Coordinates: pixel (px, py) covers the square [px, px+1) × [py, py+1) in
// "slice coordinates". x grows to the right, y grows downwards (dorsal → ventral).
// A click is a continuous point in these coordinates, e.g. (120.4, 87.9).

import type { Structure } from "./types";
import { OUTSIDE, descendantMask } from "./tree";

export { OUTSIDE } from "./tree";

export interface LabelMap {
  width: number;
  height: number;
  data: Uint16Array; // structure index of pixel (px, py) is data[py * width + px]
}

/**
 * Unzip a .bin.gz file with the browser's built-in DecompressionStream.
 *
 * Some web servers unzip .gz files on the way (Content-Encoding: gzip), so we
 * only decompress if the data starts with gzip's two "magic" bytes 1f 8b.
 * Raw label data never starts with them: pixel (0, 0) is a corner of the
 * image, outside the brain, so its value is 0 (bytes 00 00).
 */
export async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** Decode a label map: raw little-endian uint16, one value per pixel, row by row. */
export function decodeLabelMap(buffer: ArrayBuffer, width: number, height: number): LabelMap {
  if (buffer.byteLength !== width * height * 2) {
    throw new Error(`label map has ${buffer.byteLength} bytes, expected ${width * height * 2}`);
  }
  // DataView reads little-endian explicitly, whatever the computer's byte order.
  const view = new DataView(buffer);
  const data = new Uint16Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = view.getUint16(i * 2, true);
  return { width, height, data };
}

/** Structure index at a point in slice coordinates (OUTSIDE if off the image). */
export function labelAt(map: LabelMap, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= map.width || py >= map.height) return OUTSIDE;
  return map.data[py * map.width + px];
}

/** Convert a mouse position on the (possibly CSS-scaled) canvas to slice coordinates. */
export function screenToSlice(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  sliceWidth: number,
  sliceHeight: number,
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * sliceWidth,
    y: ((clientY - rect.top) / rect.height) * sliceHeight,
  };
}

export interface Nearest {
  distancePx: number; // 0 when the click is inside the target
  point: { x: number; y: number }; // closest point of the target to the click
}

/**
 * Closest point of `target` (including all its subregions) to the click.
 * Returns null if the target does not appear on this slice.
 *
 * Distance is measured to the edge of each pixel square, not its centre,
 * so a click anywhere inside a target pixel gives exactly 0.
 */
export function nearestTargetPoint(
  map: LabelMap,
  target: number,
  structures: Structure[],
  x: number,
  y: number,
): Nearest | null {
  const inTarget = descendantMask(target, structures);
  let best: Nearest | null = null;
  let bestSq = Infinity;
  for (let py = 0; py < map.height; py++) {
    for (let px = 0; px < map.width; px++) {
      if (!inTarget[map.data[py * map.width + px]]) continue;
      const cx = Math.min(Math.max(x, px), px + 1); // clamp click into the square
      const cy = Math.min(Math.max(y, py), py + 1);
      const sq = (cx - x) ** 2 + (cy - y) ** 2;
      if (sq < bestSq) {
        bestSq = sq;
        best = { distancePx: Math.sqrt(sq), point: { x: cx, y: cy } };
        if (sq === 0) return best;
      }
    }
  }
  return best;
}
