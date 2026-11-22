// Study mode: browse every slice, hover (or tap) to name regions, show
// outlines or atlas colours at a chosen level of detail, search a region.

import { loadSlice, type AtlasIndex, type LoadedSlice } from "./data";
import { labelAt, OUTSIDE, screenToSlice } from "./labelmap";
import { atlasLayer, drawBase, drawLayer, makeStage, packColor, type Stage } from "./render";
import { isDue, MASTERED_BOX, MAX_BOX, emptyProgress, type Progress } from "./review";
import { getQuality, loadProgress } from "./storage";
import { breadcrumb, descendantMask, displayName, levelLookup } from "./tree";
import { DIFFICULTIES, type Difficulty } from "./types";
import { el } from "./ui";

const LEVEL_NOTES: Record<Difficulty, string> = {
  easy: "the major divisions (easy level)",
  medium: "areas and classic nuclei (medium level)",
  hard: "detailed nuclei and fields (hard level)",
};

let atlas: AtlasIndex;
let sliceIndex = 0;
let level: Difficulty = "medium";
let current: LoadedSlice | null = null;
let stage: Stage | null = null;
let hovered: number | null = null; // region under the pointer
let pinned: number | null = null; // region chosen by click, tap or search
let loadToken = 0;
let progress: Progress = emptyProgress();
const groupOfCache = new Map<Difficulty, Uint16Array>();
const colorCache = new Map<Difficulty, Uint32Array>();
const searchIndex = new Map<string, number>(); // datalist text → region index

const canvas = () => el<HTMLCanvasElement>("study-canvas");

function groupOf(): Uint16Array {
  let lookup = groupOfCache.get(level);
  if (!lookup) {
    lookup = levelLookup(atlas.levels[level], atlas.structures);
    groupOfCache.set(level, lookup);
  }
  return lookup;
}

function groupColors(): Uint32Array {
  let colors = colorCache.get(level);
  if (!colors) {
    colors = new Uint32Array(atlas.structures.length);
    for (const i of atlas.levels[level]) colors[i] = packColor(atlas.structures[i].color, 150);
    colorCache.set(level, colors);
  }
  return colors;
}

export function initStudy(index: AtlasIndex): void {
  atlas = index;
  const range = el<HTMLInputElement>("slice-range");
  range.max = String(atlas.slices.length - 1);
  range.addEventListener("input", () => void showSlice(Number(range.value)));
  el("prev-slice").addEventListener("click", () => void showSlice(sliceIndex - 1));
  el("next-slice").addEventListener("click", () => void showSlice(sliceIndex + 1));

  for (const button of document.querySelectorAll<HTMLButtonElement>("#study-level button")) {
    button.addEventListener("click", () => {
      level = button.dataset.level as Difficulty;
      updateLevelButtons();
      redraw();
    });
  }
  el("show-outlines").addEventListener("change", redraw);
  el("show-colors").addEventListener("change", redraw);

  const c = canvas();
  c.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") setHovered(regionUnder(e), e);
  });
  c.addEventListener("pointerleave", () => setHovered(null));
  c.addEventListener("click", (e) => {
    pinned = regionUnder(e);
    hovered = null;
    el("tooltip").hidden = true;
    updateInfo();
    redraw();
  });

  // Search: every region of any difficulty, as "Name (ACRONYM)".
  const options: HTMLOptionElement[] = [];
  const all = new Set([...atlas.levels.easy, ...atlas.levels.medium, ...atlas.levels.hard]);
  for (const i of [...all].sort((a, b) => atlas.structures[a].name.localeCompare(atlas.structures[b].name))) {
    if (!atlas.bestSlice.has(i)) continue; // never on any of our slices
    const s = atlas.structures[i];
    const text = `${displayName(s)} (${s.acronym})`;
    searchIndex.set(text.toLowerCase(), i);
    const option = document.createElement("option");
    option.value = text;
    options.push(option);
  }
  el("region-list").replaceChildren(...options);
  const search = el<HTMLInputElement>("search");
  search.addEventListener("change", () => findRegion(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") findRegion(search.value);
  });

  document.addEventListener("keydown", (e) => {
    if (el("study").hidden || document.activeElement === search) return;
    if (e.key === "ArrowLeft") void showSlice(sliceIndex - 1);
    if (e.key === "ArrowRight") void showSlice(sliceIndex + 1);
  });
  updateLevelButtons();
}

export function openStudy(): void {
  progress = loadProgress(); // your review records, shown in the info panel
  if (!current) sliceIndex = Math.floor(atlas.slices.length / 2);
  void showSlice(sliceIndex, true);
}

function updateLevelButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("#study-level button")) {
    button.setAttribute("aria-pressed", String(button.dataset.level === level));
  }
  el("level-note").textContent = `Outlines and colours show ${LEVEL_NOTES[level]}.`;
}

async function showSlice(i: number, force = false): Promise<void> {
  i = Math.max(0, Math.min(atlas.slices.length - 1, i));
  if (i === sliceIndex && current && !force && current.variant === atlas.slices[i].variants[getQuality()]) return;
  sliceIndex = i;
  el<HTMLInputElement>("slice-range").value = String(i);
  const meta = atlas.slices[i];
  el("study-slice-info").textContent = `Slice ${i + 1} of ${atlas.slices.length} · ${meta.apMm.toFixed(2)} mm from the front`;
  const token = ++loadToken;
  el("study-loading").hidden = false;
  const loaded = await loadSlice(meta, getQuality());
  if (token !== loadToken) return; // a newer slice was requested meanwhile
  el("study-loading").hidden = true;
  current = loaded;
  stage = makeStage(canvas(), loaded.variant.width, loaded.variant.height);
  hovered = null;
  updateInfo();
  redraw();
  // Neighbours load in the background so the slider feels instant.
  for (const n of [i - 1, i + 1]) {
    if (atlas.slices[n]) void loadSlice(atlas.slices[n], getQuality()).catch(() => {});
  }
}

/** Region under the pointer at the chosen level (or the exact structure if no region of that level contains it). */
function regionUnder(e: MouseEvent): number | null {
  if (!current) return null;
  const { variant, labels } = current;
  const p = screenToSlice(e.clientX, e.clientY, canvas().getBoundingClientRect(), variant.width, variant.height);
  const label = labelAt(labels, p.x, p.y);
  if (label === OUTSIDE) return null;
  return groupOf()[label] || label;
}

function setHovered(region: number | null, e?: MouseEvent): void {
  const tooltip = el("tooltip");
  if (region === null || !e) {
    tooltip.hidden = true;
  } else {
    const rect = el("study-stage").getBoundingClientRect();
    const s = atlas.structures[region];
    tooltip.textContent = s.acronym.toLowerCase() === s.name.toLowerCase() ? displayName(s) : `${displayName(s)} · ${s.acronym}`;
    tooltip.hidden = false;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const flip = x > rect.width - 260;
    tooltip.style.left = flip ? "" : `${x + 16}px`;
    tooltip.style.right = flip ? `${rect.width - x + 16}px` : "";
    tooltip.style.top = `${y + 16}px`;
  }
  if (region !== hovered) {
    hovered = region;
    updateInfo();
    redraw();
  }
}

function redraw(): void {
  if (!current || !stage) return;
  const shown = hovered ?? pinned;
  drawBase(stage, current.image);
  const layer = atlasLayer(current.labels, {
    groupOf: groupOf(),
    outlines: el<HTMLInputElement>("show-outlines").checked,
    groupColors: el<HTMLInputElement>("show-colors").checked ? groupColors() : null,
    highlight: shown === null ? null : descendantMask(shown, atlas.structures),
  });
  drawLayer(stage, layer);
}

function updateInfo(): void {
  const info = el("study-info");
  const shown = hovered ?? pinned;
  if (shown === null) {
    info.innerHTML = `<p class="muted">Hover over the slice (or tap it) to name a region. Use ← → or the slider to move through the brain.</p>`;
    return;
  }
  const s = atlas.structures[shown];
  const title = document.createElement("h3");
  title.textContent = displayName(s);
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = s.acronym;
  const path = document.createElement("p");
  path.className = "breadcrumb";
  path.textContent = breadcrumb(shown, atlas.structures)
    .slice(0, -1)
    .map((i) => displayName(atlas.structures[i]))
    .join(" › ");
  const quiz = document.createElement("p");
  quiz.className = "muted small";
  const levels = DIFFICULTIES.filter((d) => atlas.levels[d].has(shown));
  quiz.textContent = levels.length ? `Asked in: ${levels.join(", ")}` : "Not asked in the game at any level";
  const parts: HTMLElement[] = [title, chip, path, quiz];
  if (levels.length) parts.push(recordLine(s.id));
  const best = atlas.bestSlice.get(shown);
  const bestIndex = atlas.slices.findIndex((m) => m.id === best);
  if (bestIndex >= 0 && bestIndex !== sliceIndex) {
    const go = document.createElement("button");
    go.className = "ghost small-btn";
    go.textContent = `Show where it is largest (slice ${bestIndex + 1})`;
    go.addEventListener("click", () => {
      pinned = shown;
      void showSlice(bestIndex);
    });
    parts.push(go);
  }
  info.replaceChildren(...parts);
}

/** "Your record: 3 tries · 2 hits · box 2 of 5 · due for review" */
function recordLine(allenId: number): HTMLElement {
  const line = document.createElement("p");
  line.className = "record";
  const r = progress.regions[allenId];
  if (!r) {
    line.textContent = "Your record: not asked yet";
    return line;
  }
  const status = isDue(r, progress.gamesPlayed) ? "due for review" : r.box >= MASTERED_BOX ? "mastered" : "learning";
  line.textContent = `Your record: ${r.tries} ${r.tries === 1 ? "try" : "tries"} · ${r.hits} ${r.hits === 1 ? "hit" : "hits"} · box ${r.box} of ${MAX_BOX} · ${status}`;
  line.dataset.status = status;
  return line;
}

function findRegion(text: string): void {
  const region = searchIndex.get(text.trim().toLowerCase());
  if (region === undefined) return;
  pinned = region;
  const best = atlas.bestSlice.get(region);
  const i = atlas.slices.findIndex((m) => m.id === best);
  if (i >= 0) void showSlice(i, true);
  el<HTMLInputElement>("search").blur();
}
