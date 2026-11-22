// Drawing on the canvas. The canvas is SCALE× the slice size; CSS may shrink
// it further on small screens, which is why clicks go through screenToSlice.

import type { LabelMap } from "./labelmap";

export const SCALE = 2;

/**
 * Colour for revealing the answer. Not the Allen colour: several Allen colours
 * are grey (ventricles #AAAAAA, fiber tracts #CCCCCC) and vanish on the grey slice.
 */
export const HIGHLIGHT = "#00D5FF";

export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D not supported");
  return ctx;
}

export function drawSlice(ctx: CanvasRenderingContext2D, image: HTMLImageElement): void {
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Draw every pixel whose structure is in `mask`: a translucent fill, plus a
 * solid outline on pixels at the region's edge so small regions stay visible.
 */
export function drawRegion(ctx: CanvasRenderingContext2D, labels: LabelMap, mask: Uint8Array, color: string): void {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const { width, height, data } = labels;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[data[y * width + x]] === 1;
  const overlay = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      overlay.data.set([r, g, b, edge ? 255 : 110], (y * width + x) * 4);
    }
  }
  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  small.getContext("2d")!.putImageData(overlay, 0, 0);
  ctx.imageSmoothingEnabled = false; // keep region edges crisp when enlarged
  ctx.drawImage(small, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

type Point = { x: number; y: number }; // slice coordinates

function toCanvas(p: Point): Point {
  return { x: p.x * SCALE, y: p.y * SCALE };
}

export function drawClick(ctx: CanvasRenderingContext2D, click: Point): void {
  const c = toCanvas(click);
  ctx.beginPath();
  ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffd400";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

export function drawLine(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
  const a = toCanvas(from);
  const b = toCanvas(to);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "#ffd400";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.setLineDash([]);
}
