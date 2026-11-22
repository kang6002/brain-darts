// Wires the page together: screens, clicks, and drawing.
// Game logic lives in game.ts, scoring.ts and labelmap.ts.

import { loadAtlas, type Atlas, type LoadedSlice } from "./data";
import { makeRounds, ROUNDS_PER_GAME, type Round } from "./game";
import { labelAt, nearestTargetPoint, screenToSlice, OUTSIDE } from "./labelmap";
import { drawClick, drawLine, drawRegion, drawSlice, HIGHLIGHT, setupCanvas } from "./render";
import { MAX_POINTS, scoreClick } from "./scoring";
import { getBestScore, recordScore } from "./storage";
import { descendantMask, displayName } from "./tree";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id} in index.html`);
  return found as T;
}

const screens = { start: el("start"), play: el("play"), end: el("end") };
const canvas = el<HTMLCanvasElement>("canvas");

let atlas: Atlas;
let rounds: Round[] = [];
let roundNumber = 0; // 0-based
let total = 0;
let answered = false;
const results: { target: string; points: number }[] = [];

function show(name: keyof typeof screens): void {
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
}

function currentSlice(): LoadedSlice {
  return atlas.slices.get(rounds[roundNumber].slice.id)!;
}

function bestText(): string {
  const best = getBestScore();
  return best === null ? "No best score yet." : `Best score: ${best} / ${ROUNDS_PER_GAME * MAX_POINTS}`;
}

function startGame(): void {
  rounds = makeRounds([...atlas.slices.values()].map((s) => s.meta), "easy");
  roundNumber = 0;
  total = 0;
  results.length = 0;
  show("play");
  startRound();
}

function startRound(): void {
  answered = false;
  const { meta, image } = currentSlice();
  const target = atlas.structures[rounds[roundNumber].target];
  el("round-label").textContent = `Round ${roundNumber + 1} / ${ROUNDS_PER_GAME}`;
  el("total-label").textContent = `${total} points`;
  el("target-name").textContent = displayName(target);
  // Some Allen acronyms just repeat the name ("fiber tracts"); don't show those twice.
  const sameAsName = target.acronym.toLowerCase() === target.name.toLowerCase();
  el("target-acronym").textContent = sameAsName ? "" : `(${target.acronym})`;
  el("slice-info").textContent =
    `Coronal slice ${meta.apMm.toFixed(2)} mm from the front of the atlas volume. Dorsal is up.`;
  el("result").hidden = true;
  canvas.classList.add("active");
  const ctx = setupCanvas(canvas, meta.width, meta.height);
  drawSlice(ctx, image);
}

function handleClick(event: MouseEvent): void {
  if (answered) return;
  const { meta, image, labels } = currentSlice();
  const { structures } = atlas;
  const targetIndex = rounds[roundNumber].target;
  const click = screenToSlice(event.clientX, event.clientY, canvas.getBoundingClientRect(), meta.width, meta.height);
  const clickedIndex = labelAt(labels, click.x, click.y);
  const nearest = nearestTargetPoint(labels, targetIndex, structures, click.x, click.y);
  if (!nearest) throw new Error(`target ${targetIndex} is not on slice ${meta.id}`); // pipeline bug
  const score = scoreClick(nearest.distancePx * meta.mmPerPixel, clickedIndex, targetIndex, structures);

  answered = true;
  total += score.points;
  results.push({ target: displayName(structures[targetIndex]), points: score.points });

  // Reveal: target region, line to its nearest point, and the click.
  const ctx = canvas.getContext("2d")!;
  drawSlice(ctx, image);
  drawRegion(ctx, labels, descendantMask(targetIndex, structures), HIGHLIGHT);
  if (score.distanceMm > 0) drawLine(ctx, click, nearest.point);
  drawClick(ctx, click);
  canvas.classList.remove("active");

  el("result-main").textContent =
    score.distanceMm === 0
      ? `Spot on! +${score.points} points`
      : `${score.distanceMm.toFixed(2)} mm away · +${score.points} points`;
  const clickedText =
    clickedIndex === OUTSIDE ? "You clicked outside the brain." : `You clicked: ${displayName(structures[clickedIndex])}.`;
  const parentText =
    score.creditedParent !== null
      ? ` That is inside ${displayName(structures[score.creditedParent])}, so you get partial credit.`
      : "";
  el("result-detail").textContent = clickedText + parentText;
  el("total-label").textContent = `${total} points`;
  const next = el<HTMLButtonElement>("next-btn");
  next.textContent = roundNumber + 1 < ROUNDS_PER_GAME ? "Next round" : "See results";
  el("result").hidden = false;
  next.focus(); // so Enter / Space moves on
}

function nextRound(): void {
  roundNumber++;
  if (roundNumber < ROUNDS_PER_GAME) {
    startRound();
  } else {
    endGame();
  }
}

function endGame(): void {
  const isBest = recordScore(total);
  el("final-score").textContent = `${total} / ${ROUNDS_PER_GAME * MAX_POINTS} points`;
  el("best-end").textContent = isBest ? "New best score!" : bestText();
  const list = el("summary");
  list.replaceChildren(
    ...results.map((r) => {
      const li = document.createElement("li");
      li.textContent = `${r.target}: ${r.points}`;
      return li;
    }),
  );
  show("end");
  el("again-btn").focus();
}

async function init(): Promise<void> {
  el("best-start").textContent = bestText();
  try {
    atlas = await loadAtlas();
  } catch (error) {
    el("status").textContent = `Could not load the atlas data: ${String(error)}`;
    throw error;
  }
  el("status").textContent = `${atlas.slices.size} slices loaded.`;
  const start = el<HTMLButtonElement>("start-btn");
  start.disabled = false;
  start.addEventListener("click", startGame);
  el("next-btn").addEventListener("click", nextRound);
  el("again-btn").addEventListener("click", startGame);
  canvas.addEventListener("click", handleClick);
}

void init();
