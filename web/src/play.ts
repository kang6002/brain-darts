// The game screen: 10 rounds, click → score → reveal → next.
// Game logic lives in game.ts, scoring.ts and labelmap.ts; this file wires
// it to the page.

import { loadSlice, type AtlasIndex, type LoadedSlice } from "./data";
import { makeRounds, rankFor, ROUNDS_PER_GAME, type Round } from "./game";
import { countPixels, labelAt, nearestTargetPoint, OUTSIDE, screenToSlice } from "./labelmap";
import { drawBase, drawLayer, drawLine, drawPin, drawTargetPoint, makeStage, regionLayer, type Stage } from "./render";
import { MAX_POINTS, scoreClick, type Score } from "./scoring";
import { getBestScore, getQuality, recordScore } from "./storage";
import { descendantMask, displayName, regionAtLevel } from "./tree";
import type { Difficulty } from "./types";
import { animate, confetti, countUp, el, formatNumber } from "./ui";

const MAX_TOTAL = ROUNDS_PER_GAME * MAX_POINTS;

let atlas: AtlasIndex;
let showScreen: (name: string) => void;
let difficulty: Difficulty = "easy";
let rounds: Round[] = [];
let roundNumber = 0; // 0-based
let total = 0;
let current: LoadedSlice | null = null; // slice on screen; null while loading
let stage: Stage | null = null;
let answered = false;
const results: { target: string; points: number }[] = [];

const canvas = () => el<HTMLCanvasElement>("game-canvas");

export function initPlay(index: AtlasIndex, show: (name: string) => void): void {
  atlas = index;
  showScreen = show;
  canvas().addEventListener("click", handleClick);
  el("next-btn").addEventListener("click", nextRound);
  el("again-btn").addEventListener("click", () => startGame(difficulty));
  document.addEventListener("keydown", (e) => {
    // Space / Enter for "next", unless a button already has focus (it handles the key itself).
    if ((e.key === " " || e.key === "Enter") && !el("result").hidden && !(document.activeElement instanceof HTMLButtonElement)) {
      e.preventDefault();
      nextRound();
    }
  });
}

export function startGame(level: Difficulty): void {
  difficulty = level;
  rounds = makeRounds(atlas.slices, difficulty);
  roundNumber = 0;
  total = 0;
  results.length = 0;
  el("hud-level").textContent = level;
  showScreen("play");
  void startRound();
}

function updateHud(): void {
  el("hud-round").textContent = `${roundNumber + 1} / ${ROUNDS_PER_GAME}`;
  el("hud-score").textContent = formatNumber(total);
}

async function startRound(): Promise<void> {
  const round = rounds[roundNumber];
  const target = atlas.structures[round.target];
  current = null; // ignore clicks until the slice is ready
  answered = false;
  updateHud();
  el("target-name").textContent = displayName(target);
  // Some Allen acronyms just repeat the name ("fiber tracts"); don't show those twice.
  const sameAsName = target.acronym.toLowerCase() === target.name.toLowerCase();
  el("target-acronym").textContent = sameAsName ? "" : target.acronym;
  el("target-acronym").hidden = sameAsName;
  el("result").hidden = true;
  el("game-loading").hidden = false;
  const prompt = el("prompt");
  prompt.classList.remove("pop");
  void prompt.offsetWidth; // restart the CSS animation
  prompt.classList.add("pop");

  const quality = getQuality();
  const loaded = await loadSlice(round.slice, quality);
  // While we waited, the player may have moved on (new round, new game, menu).
  if (rounds[roundNumber] !== round || el("play").hidden) return;
  current = loaded;
  el("game-loading").hidden = true;
  el("slice-info").textContent =
    `Coronal slice · ${loaded.meta.apMm.toFixed(2)} mm from the front of the atlas · dorsal is up`;
  canvas().classList.add("active");
  stage = makeStage(canvas(), loaded.variant.width, loaded.variant.height);
  drawBase(stage, loaded.image);

  // Download the next round's slice while the player thinks.
  const next = rounds[roundNumber + 1];
  if (next) void loadSlice(next.slice, quality).catch(() => {}); // errors resurface when it is needed
}

function handleClick(event: MouseEvent): void {
  if (answered || !current || !stage) return;
  const { meta, variant, image, labels } = current;
  const { structures } = atlas;
  const targetIndex = rounds[roundNumber].target;
  const click = screenToSlice(event.clientX, event.clientY, canvas().getBoundingClientRect(), variant.width, variant.height);
  const clickedIndex = labelAt(labels, click.x, click.y);
  const nearest = nearestTargetPoint(labels, targetIndex, structures, click.x, click.y);
  if (!nearest) throw new Error(`target ${targetIndex} is not on slice ${meta.id}`); // pipeline bug
  const areaPx = (i: number) => countPixels(labels, descendantMask(i, structures));
  const score = scoreClick(nearest.distancePx * variant.mmPerPixel, clickedIndex, targetIndex, structures, areaPx);

  answered = true;
  total += score.points;
  results.push({ target: displayName(structures[targetIndex]), points: score.points });
  canvas().classList.remove("active");
  void reveal(stage, image, labels, targetIndex, click, nearest.point, score, clickedIndex);
}

async function reveal(
  s: Stage,
  image: HTMLImageElement,
  labels: LoadedSlice["labels"],
  targetIndex: number,
  click: { x: number; y: number },
  point: { x: number; y: number },
  score: Score,
  clickedIndex: number,
): Promise<void> {
  const layer = regionLayer(labels, descendantMask(targetIndex, atlas.structures));
  const frame = (t: number) => {
    drawBase(s, image);
    drawLayer(s, layer, t);
    if (score.distanceMm > 0) {
      drawLine(s, click, point, t);
      if (t === 1) drawTargetPoint(s, point);
    }
    drawPin(s, click);
  };
  const lineDone = animate(score.distanceMm > 0 ? 650 : 300, frame);
  showResult(score, clickedIndex);
  await lineDone;
  frame(1);
}

function verdict(score: Score): string {
  if (score.distanceMm === 0) return "Bullseye!";
  if (score.creditedParent !== null) return "Partial credit";
  if (score.points >= 750) return "So close!";
  if (score.points >= 400) return "Nice!";
  if (score.points >= 100) return "Not bad";
  return "Missed!";
}

function showResult(score: Score, clickedIndex: number): void {
  const result = el("result");
  result.hidden = false;
  result.dataset.tier = score.distanceMm === 0 ? "bullseye" : score.points >= 400 ? "good" : score.points >= 100 ? "ok" : "miss";
  el("verdict").textContent = verdict(score);
  el("distance").textContent =
    score.distanceMm === 0 ? "Right inside the region" : `${score.distanceMm.toFixed(2)} mm away`;
  el("result-detail").textContent = describeClick(clickedIndex) + describeCredit(score.creditedParent);
  void countUp(el("points"), score.points, 700);
  const bar = el("points-bar");
  bar.style.width = "0%";
  requestAnimationFrame(() => (bar.style.width = `${(score.points / MAX_POINTS) * 100}%`));
  updateHud();
  if (score.distanceMm === 0) confetti(el("game-stage"));
  const next = el<HTMLButtonElement>("next-btn");
  next.textContent = roundNumber + 1 < ROUNDS_PER_GAME ? "Next round" : "See results";
  next.focus({ preventScroll: true }); // so Enter / Space moves on
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
  if (el("result").hidden) return;
  roundNumber++;
  if (roundNumber < ROUNDS_PER_GAME) {
    void startRound();
  } else {
    endGame();
  }
}

function endGame(): void {
  const isBest = recordScore(difficulty, total);
  showScreen("end");
  el("end-level").textContent = `${difficulty} · ${ROUNDS_PER_GAME} rounds`;
  el("rank").textContent = rankFor(total, MAX_TOTAL);
  const best = getBestScore(difficulty);
  el("best-end").textContent = isBest ? "New personal best!" : `Your best: ${formatNumber(best ?? 0)}`;
  el("best-end").classList.toggle("new-best", isBest);
  void countUp(el("final-score"), total, 1200);
  el("summary").replaceChildren(
    ...results.map((r, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "round-name";
      name.textContent = `${i + 1}. ${r.target}`;
      const bar = document.createElement("span");
      bar.className = "round-bar";
      const fill = document.createElement("span");
      fill.style.width = `${(r.points / MAX_POINTS) * 100}%`;
      bar.append(fill);
      const pts = document.createElement("b");
      pts.textContent = formatNumber(r.points);
      li.append(name, bar, pts);
      return li;
    }),
  );
  el("again-btn").focus({ preventScroll: true });
}
