// Wires the page together: screens, clicks, and drawing.
// Game logic lives in game.ts, scoring.ts and labelmap.ts.

import { loadIndex, loadSlice, type AtlasIndex, type LoadedSlice } from "./data";
import { makeRounds, ROUNDS_PER_GAME, type Round } from "./game";
import { labelAt, nearestTargetPoint, screenToSlice, OUTSIDE } from "./labelmap";
import { drawClick, drawLine, drawRegion, drawSlice, HIGHLIGHT, setupCanvas } from "./render";
import { MAX_POINTS, scoreClick } from "./scoring";
import { getBestScore, recordScore } from "./storage";
import { descendantMask, displayName, regionAtLevel } from "./tree";
import { DIFFICULTIES, type Difficulty } from "./types";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id} in index.html`);
  return found as T;
}

const screens = { start: el("start"), play: el("play"), end: el("end") };
const canvas = el<HTMLCanvasElement>("canvas");
const MAX_TOTAL = ROUNDS_PER_GAME * MAX_POINTS;

let atlas: AtlasIndex;
let difficulty: Difficulty = "easy";
let rounds: Round[] = [];
let roundNumber = 0; // 0-based
let total = 0;
let current: LoadedSlice | null = null; // slice on screen; null while loading
let answered = false;
const results: { target: string; points: number }[] = [];

function show(name: keyof typeof screens): void {
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function showMenu(): void {
  for (const level of DIFFICULTIES) {
    const best = getBestScore(level);
    document.querySelector(`[data-best="${level}"]`)!.textContent =
      best === null ? "No best score yet" : `Best: ${best} / ${MAX_TOTAL}`;
  }
  el("subtitle").textContent = "Mouse · coronal slices";
  show("start");
}

function startGame(level: Difficulty): void {
  difficulty = level;
  rounds = makeRounds(atlas.slices, difficulty);
  roundNumber = 0;
  total = 0;
  results.length = 0;
  el("subtitle").textContent = `Mouse · coronal slices · ${level}`;
  show("play");
  void startRound();
}

async function startRound(): Promise<void> {
  const round = rounds[roundNumber];
  const target = atlas.structures[round.target];
  current = null; // ignore clicks until the slice is ready
  answered = false;
  el("round-label").textContent = `Round ${roundNumber + 1} / ${ROUNDS_PER_GAME}`;
  el("total-label").textContent = `${total} points`;
  el("target-name").textContent = displayName(target);
  // Some Allen acronyms just repeat the name ("fiber tracts"); don't show those twice.
  const sameAsName = target.acronym.toLowerCase() === target.name.toLowerCase();
  el("target-acronym").textContent = sameAsName ? "" : `(${target.acronym})`;
  el("result").hidden = true;
  el("slice-info").textContent = "Loading slice…";

  const loaded = await loadSlice(round.slice);
  // While we waited, the player may have moved on (new round, new game, menu).
  if (rounds[roundNumber] !== round || screens.play.hidden) return;
  current = loaded;
  el("slice-info").textContent =
    `Coronal slice ${loaded.meta.apMm.toFixed(2)} mm from the front of the atlas volume. Dorsal is up.`;
  canvas.classList.add("active");
  const ctx = setupCanvas(canvas, loaded.meta.width, loaded.meta.height);
  drawSlice(ctx, loaded.image);

  // Download the next round's slice while the player thinks.
  const next = rounds[roundNumber + 1];
  if (next) void loadSlice(next.slice).catch(() => {}); // errors resurface when it is needed
}

function handleClick(event: MouseEvent): void {
  if (answered || !current) return;
  const { meta, image, labels } = current;
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
  el("result-detail").textContent = describeClick(clickedIndex) + describeCredit(score.creditedParent);
  el("total-label").textContent = `${total} points`;
  const next = el<HTMLButtonElement>("next-btn");
  next.textContent = roundNumber + 1 < ROUNDS_PER_GAME ? "Next round" : "See results";
  el("result").hidden = false;
  next.focus(); // so Enter / Space moves on
}

/** "You clicked: Primary motor area, Layer 6a (part of Somatomotor areas)." */
function describeClick(clickedIndex: number): string {
  if (clickedIndex === OUTSIDE) return "You clicked outside the brain.";
  const { structures } = atlas;
  const exact = displayName(structures[clickedIndex]);
  const atLevel = regionAtLevel(clickedIndex, atlas.levels[difficulty], structures);
  if (atLevel === null || atLevel === clickedIndex) return `You clicked: ${exact}.`;
  return `You clicked: ${exact} (part of ${displayName(structures[atLevel])}).`;
}

function describeCredit(creditedParent: number | null): string {
  if (creditedParent === null) return "";
  return ` That is inside ${displayName(atlas.structures[creditedParent])}, so you get partial credit.`;
}

function nextRound(): void {
  roundNumber++;
  if (roundNumber < ROUNDS_PER_GAME) {
    void startRound();
  } else {
    endGame();
  }
}

function endGame(): void {
  const isBest = recordScore(difficulty, total);
  el("final-score").textContent = `${capitalized(difficulty)}: ${total} / ${MAX_TOTAL} points`;
  const best = getBestScore(difficulty);
  el("best-end").textContent = isBest ? "New best score!" : `Best score: ${best} / ${MAX_TOTAL}`;
  el("summary").replaceChildren(
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
  showMenu();
  try {
    atlas = await loadIndex();
  } catch (error) {
    el("status").textContent = `Could not load the atlas data: ${String(error)}`;
    throw error;
  }
  el("status").textContent = `${atlas.slices.length} slices available. Choose a difficulty:`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("button.level")) {
    button.disabled = false;
    button.addEventListener("click", () => startGame(button.dataset.difficulty as Difficulty));
  }
  el("next-btn").addEventListener("click", nextRound);
  el("again-btn").addEventListener("click", () => startGame(difficulty));
  el("menu-btn").addEventListener("click", showMenu);
  canvas.addEventListener("click", handleClick);
}

void init();
