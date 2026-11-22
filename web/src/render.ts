// Drawing on a canvas ("stage"). The canvas is always DISPLAY_WIDTH pixels
// wide whatever the slice resolution, and CSS shrinks it to fit the screen;
// that is why clicks go through labelmap.ts:screenToSlice.
//
// Overlays (highlighted region, outlines, atlas colours) are painted at the
// label map's own resolution into a small "layer" canvas, then stretched onto
// the stage without smoothing so region edges stay crisp.

import type { LabelMap } from "./labelmap";

export const DISPLAY_WIDTH = 1824; // canvas pixels (2× a 912 px wide display, for sharp screens)

/**
 * Colour for the answer / selected region. Not the Allen colour: several Allen
 * colours are grey (ventricles #AAAAAA, fiber tracts #CCCCCC) and vanish on the slice.
 */
export const HIGHLIGHT = "#00D5FF";
export const PIN = "#FFD23F";

export interface Stage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number; // slice pixels
  height: number;
  scale: number; // canvas pixels per slice pixel
}

export function makeStage(canvas: HTMLCanvasElement, width: number, height: number): Stage {
  const scale = DISPLAY_WIDTH / width;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D not supported");
  return { canvas, ctx, width, height, scale };
}

export function drawBase(stage: Stage, image: HTMLImageElement): void {
  const { ctx, canvas } = stage;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

export function drawLayer(stage: Stage, layer: HTMLCanvasElement, alpha = 1): void {
  const { ctx, canvas } = stage;
  ctx.imageSmoothingEnabled = false; // keep region edges crisp when enlarged
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- colours

/** "#RRGGBB" + alpha (0–255) → one 32-bit number in the byte order ImageData uses. */
export function packColor(hex: string, alpha: number): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // ImageData bytes are R, G, B, A; read as a little-endian 32-bit number that is A<<24 | B<<16 | G<<8 | R.
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function layerCanvas(labels: LabelMap, paint: (pixels: Uint32Array) => void): HTMLCanvasElement {
  const image = new ImageData(labels.width, labels.height);
  paint(new Uint32Array(image.data.buffer));
  const layer = document.createElement("canvas");
  layer.width = labels.width;
  layer.height = labels.height;
  layer.getContext("2d")!.putImageData(image, 0, 0);
  return layer;
}

// ---------------------------------------------------------------- layers

/**
 * One region (all structures with mask[structure] = 1): a translucent fill
 * plus a solid outline, so even small regions stay visible.
 */
export function regionLayer(labels: LabelMap, mask: Uint8Array, color = HIGHLIGHT): HTMLCanvasElement {
  const fill = packColor(color, 120);
  const edge = packColor(color, 255);
  const { width, height, data } = labels;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[data[y * width + x]] === 1;
  return layerCanvas(labels, (px) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(x, y)) continue;
        const isEdge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        px[y * width + x] = isEdge ? edge : fill;
      }
    }
  });
}

export interface AtlasLayerOptions {
  /** groupOf[structure] = the region it belongs to at the chosen detail level (0 = none). */
  groupOf: Uint16Array;
  outlines: boolean;
  /** groupColors[group] = packed colour, or null for no fill. */
  groupColors: Uint32Array | null;
  /** Structures to highlight (hovered or selected region), or null. */
  highlight: Uint8Array | null;
}

/** Study mode: outlines between regions, optional atlas colours, optional highlight. */
export function atlasLayer(labels: LabelMap, o: AtlasLayerOptions): HTMLCanvasElement {
  const { width, height, data } = labels;
  const line = packColor("#FFFFFF", 150);
  const hiFill = packColor(HIGHLIGHT, 130);
  const hiEdge = packColor(HIGHLIGHT, 255);
  return layerCanvas(labels, (px) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const label = data[i];
        const group = o.groupOf[label];
        let color = 0;
        if (o.groupColors && group) color = o.groupColors[group];
        if (o.outlines) {
          const right = x + 1 < width ? o.groupOf[data[i + 1]] : group;
          const below = y + 1 < height ? o.groupOf[data[i + width]] : group;
          if (right !== group || below !== group) color = line;
        }
        if (o.highlight && o.highlight[label]) {
          const h = o.highlight;
          const edge =
            x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !h[data[i - 1]] || !h[data[i + 1]] || !h[data[i - width]] || !h[data[i + width]];
          color = edge ? hiEdge : hiFill;
        }
        px[i] = color;
      }
    }
  });
}

// ---------------------------------------------------------------- markers

type Point = { x: number; y: number }; // slice coordinates

/** Size unit: canvas pixels per CSS pixel as the canvas is shown now, so markers
 *  look the same size on screen for wide mouse slices and tall human plates. */
function unit(stage: Stage): number {
  const shown = stage.canvas.getBoundingClientRect().width;
  return shown > 0 ? stage.canvas.width / shown : 2;
}

function toCanvas(stage: Stage, p: Point): Point {
  return { x: p.x * stage.scale, y: p.y * stage.scale };
}

/** The player's dart: a yellow pin with a dark ring and a soft shadow. */
export function drawPin(stage: Stage, p: Point): void {
  const { ctx } = stage;
  const c = toCanvas(stage, p);
  const u = unit(stage);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6 * u;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 8 * u, 0, Math.PI * 2);
  ctx.fillStyle = PIN;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(c.x, c.y, 8 * u, 0, Math.PI * 2);
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = "#1a1433";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.x, c.y, 2.5 * u, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1433";
  ctx.fill();
}

/** Small cyan dot where the line meets the target. */
export function drawTargetPoint(stage: Stage, p: Point): void {
  const { ctx } = stage;
  const c = toCanvas(stage, p);
  const u = unit(stage);
  ctx.beginPath();
  ctx.arc(c.x, c.y, 5 * u, 0, Math.PI * 2);
  ctx.fillStyle = HIGHLIGHT;
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

/** Dashed line from the click towards the target; `progress` 0–1 draws part of it. */
export function drawLine(stage: Stage, from: Point, to: Point, progress = 1): void {
  const { ctx } = stage;
  const a = toCanvas(stage, from);
  const b = toCanvas(stage, to);
  const u = unit(stage);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress);
  ctx.setLineDash([10 * u, 7 * u]);
  ctx.lineCap = "round";
  ctx.strokeStyle = PIN;
  ctx.lineWidth = 3.5 * u;
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4 * u;
  ctx.stroke();
  ctx.restore();
}
