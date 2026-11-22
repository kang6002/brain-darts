// The game screen: 10 rounds, click → score → reveal → next. Also review
// games (the regions you are weakest at). Game logic lives in game.ts,
// scoring.ts, review.ts and labelmap.ts; this file wires it to the page.

import { loadSlice, sliceCaption, type AtlasIndex, type LoadedSlice } from "./data";
import { makeReviewRounds, makeRounds, rankFor, type Round } from "./game";
import { countPixels, labelAt, nearestTargetPoint, OUTSIDE, screenToSlice } from "./labelmap";
import { drawBase, drawLayer, drawLine, drawPin, drawTargetPoint, makeStage, regionLayer, type Stage } from "./render";
import { dueRegions, HIT_POINTS, MASTERED_BOX, MISS_POINTS, updateRecord, weightFor, type Progress } from "./review";
import { MAX_POINTS, scoreClick, type Score } from "./scoring";
import { getBestScore, getQuality, loadProgress, recordScore, saveProgress } from "./storage";
import { descendantMask, displayName, regionAtLevel } from "./tree";
import { DIFFICULTIES, type Difficulty } from "./types";
import { animate, confetti, countUp, el, formatNumber } from "./ui";

type Mode = Difficulty | "review";

interface Result {
  target: string;
  points: number;
  /** What happened to the region's review box. */
  change: "to-review" | "up" | "mastered" | "same";
}

let atlas: AtlasIndex;
let showScreen: (name: string) => void;
let mode: Mode = "easy";
let rounds: Round[] = [];
let roundNumber = 0; // 0-based
let total = 0;
let current: LoadedSlice | null = null; // slice on screen; null while loading
let stage: Stage | null = null;
let answered = false;
let progress: Progress;
const results: Result[] = [];
/** Every region that can be asked on some slice at some level (structure indices). */
let askable: number[] = [];

const canvas = () => el<HTMLCanvasElement>("game-canvas");
const maxTotal = () => rounds.length * MAX_POINTS;
const idOf = (index: number) => atlas.structures[index].id;

const species = () => atlas.species.id;

/** Regions due for review right now (structure indices), most urgent first. */
export function reviewQueue(p: Progress = loadProgress(species())): number[] {
  const byId = new Map(askable.map((i) => [idOf(i), i]));
  return dueRegions(p, byId.keys()).map((id) => byId.get(id)!);
}

/** Region indices that can be asked at a level (for "mastered X / Y" on the menu). */
export function askableAt(level: Difficulty): Set<number> {
  return new Set(atlas.slices.flatMap((s) => s.targets[level]));
}

/** Switch the game to another species' atlas (mouse or human). */
export function setPlayAtlas(index: AtlasIndex): void {
  atlas = index;
  askable = [...new Set(DIFFICULTIES.flatMap((level) => [...askableAt(level)]))];
}

/** Wire up the game screen once (the atlas is set separately per species). */
export function initPlay(show: (name: string) => void): void {
  showScreen = show;
  canvas().addEventListener("click", handleClick);
  el("next-btn").addEventListener("click", nextRound);
  el("again-btn").addEventListener("click", () => {
    if (mode !== "review") startGame(mode);
    else if (reviewQueue().length > 0) startReview();
    else showScreen("menu");
  });
  document.addEventListener("keydown", (e) => {
    // Space / Enter for "next", unless a button already has focus (it handles the key itself).
    if ((e.key === " " || e.key === "Enter") && !el("result").hidden && !(document.activeElement instanceof HTMLButtonElement)) {
      e.preventDefault();
      nextRound();
    }
  });
}

/** A normal game: weak regions (low review box) come up more often. */
export function startGame(level: Difficulty): void {
  progress = loadProgress(species());
  const weight = (i: number) => weightFor(progress.regions[idOf(i)]);
  begin(level, makeRounds(atlas.slices, level, undefined, Math.random, weight));
}

/** A review game: up to 10 of the regions due for review. */
export function startReview(): void {
  progress = loadProgress(species());
  begin("review", makeReviewRounds(atlas.slices, reviewQueue(progress)));
}

function begin(newMode: Mode, newRounds: Round[]): void {
  if (newRounds.length === 0) return; // nothing to review
  mode = newMode;
  rounds = newRounds;
  roundNumber = 0;
  total = 0;
  results.length = 0;
  progress.gamesPlayed++; // answers in this game are stamped with this game number
  saveProgress(species(), progress);
  el("hud-level").textContent = mode;
  showScreen("play");
  void startRound();
}

function updateHud(): void {
  el("hud-round").textContent = `${roundNumber + 1} / ${rounds.length}`;
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
  const loaded = await loadSlice(atlas, round.slice, quality);
  // While we waited, the player may have moved on (new round, new game, menu).
  if (rounds[roundNumber] !== round || el("play").hidden) return;
  current = loaded;
  el("game-loading").hidden = true;
  el("slice-info").textContent = sliceCaption(atlas, loaded.meta);
  // Wide mouse slices and tall human plates: the layout sizes the frame by this ratio.
  el("play").style.setProperty("--aspect", String(loaded.variant.width / loaded.variant.height));
  canvas().classList.add("active");
  stage = makeStage(canvas(), loaded.variant.width, loaded.variant.height);
  drawBase(stage, loaded.image);

  // Download the next round's slice while the player thinks.
  const next = rounds[roundNumber + 1];
  if (next) void loadSlice(atlas, next.slice, quality).catch(() => {}); // errors resurface when it is needed
}

function handleClick(event: MouseEvent): void {
  if (answered || !current || !stage) return;
  const { meta, variant, image } = current;
  const { structures } = atlas;
  const round = rounds[roundNumber];
  const targetIndex = round.target;
  // Human: easy/medium questions use the gyri map, hard ones the Brodmann map.
  const labels = current.labels[atlas.species.mapForLevel[round.level]];
  const click = screenToSlice(event.clientX, event.clientY, canvas().getBoundingClientRect(), variant.width, variant.height);
  const clickedIndex = labelAt(labels, click.x, click.y);
  const nearest = nearestTargetPoint(labels, targetIndex, structures, click.x, click.y);
  if (!nearest) throw new Error(`target ${targetIndex} is not on slice ${meta.id}`); // pipeline bug
  const areaPx = (i: number) => countPixels(labels, descendantMask(i, structures));
  const score = scoreClick(
    nearest.distancePx * variant.mmPerPixel, clickedIndex, targetIndex, structures, areaPx, atlas.species.decayMm);

  answered = true;
  total += score.points;
  // Spaced repetition: update this region's review box and save right away.
  const id = idOf(targetIndex);
  const before = progress.regions[id]?.box ?? 0;
  const record = updateRecord(progress.regions[id], score.points, progress.gamesPlayed);
  progress.regions[id] = record;
  saveProgress(species(), progress);
  const change: Result["change"] =
    score.points < MISS_POINTS ? "to-review"
    : record.box >= MASTERED_BOX && before < MASTERED_BOX ? "mastered"
    : record.box > before && score.points >= HIT_POINTS ? "up"
    : "same";
  results.push({ target: displayName(structures[targetIndex]), points: score.points, change });
  canvas().classList.remove("active");
  void reveal(stage, image, labels, targetIndex, click, nearest.point, score, clickedIndex);
}

async function reveal(
  s: Stage,
  image: HTMLImageElement,
  labels: LoadedSlice["labels"][string],
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
  next.textContent = roundNumber + 1 < rounds.length ? "Next round" : "See results";
  next.focus({ preventScroll: true }); // so Enter / Space moves on
}

/** "You clicked: Primary motor area, Layer 6a (part of Somatomotor areas)." */
function describeClick(clickedIndex: number): string {
  if (clickedIndex === OUTSIDE) return "You clicked outside the brain.";
  const { structures } = atlas;
  const exact = displayName(structures[clickedIndex]);
  const atLevel = regionAtLevel(clickedIndex, atlas.levels[rounds[roundNumber].level], structures);
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
  if (roundNumber < rounds.length) {
    void startRound();
  } else {
    endGame();
  }
}

const BADGES: Record<Result["change"], string> = {
  "to-review": "→ review",
  up: "↑ learning",
  mastered: "★ mastered",
  same: "",
};

function endGame(): void {
  showScreen("end");
  el("end-level").textContent = `${atlas.species.name} · ${mode} · ${rounds.length} rounds`;
  el("final-max").textContent = `/ ${formatNumber(maxTotal())}`;
  el("rank").textContent = rankFor(total, maxTotal());
  const again = el("again-btn");
  if (mode === "review") {
    // Practice: no best score. Say how it went and what is still due.
    const good = results.filter((r) => r.points >= HIT_POINTS).length;
    const left = reviewQueue(progress).length;
    el("best-end").textContent =
      `${good} of ${results.length} answered well · ` + (left > 0 ? `${left} still due for review` : "nothing left to review");
    el("best-end").classList.remove("new-best");
    again.textContent = left > 0 ? "Review more" : "Back to menu";
  } else {
    const isBest = recordScore(species(), mode, total);
    const best = getBestScore(species(), mode);
    el("best-end").textContent = isBest ? "New personal best!" : `Your best: ${formatNumber(best ?? 0)}`;
    el("best-end").classList.toggle("new-best", isBest);
    again.textContent = "Play again";
  }
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
      const badge = document.createElement("span");
      badge.className = `badge badge-${r.change}`;
      badge.textContent = BADGES[r.change];
      const pts = document.createElement("b");
      pts.textContent = formatNumber(r.points);
      li.append(name, bar, badge, pts);
      return li;
    }),
  );
  el("again-btn").focus({ preventScroll: true });
}
