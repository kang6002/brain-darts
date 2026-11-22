// Entry point: loads the atlas index, wires the menu, and switches screens.
// The screens themselves live in play.ts (game) and study.ts (study mode).

import "@fontsource-variable/rubik/wght.css";
import "@fontsource-variable/rubik/wght-italic.css";
import "./style.css";

import { loadIndex, type AtlasIndex } from "./data";
import { ROUNDS_PER_GAME } from "./game";
import { askableAt, initPlay, reviewQueue, startGame, startReview } from "./play";
import { masteredCount } from "./review";
import { MAX_POINTS } from "./scoring";
import { getBestScore, getQuality, loadProgress, resetProgress, setQuality } from "./storage";
import { initStudy, openStudy } from "./study";
import { DIFFICULTIES, type Difficulty, type Quality } from "./types";
import { el, formatNumber } from "./ui";

const SCREENS = ["menu", "play", "end", "study"] as const;
type ScreenName = (typeof SCREENS)[number];

function showScreen(name: string): void {
  for (const screen of SCREENS) el(screen).hidden = screen !== name;
  el("hud").hidden = name !== "play";
  el("home-btn").hidden = name === "menu";
  document.body.dataset.screen = name;
  if (name === "menu") refreshMenu();
  window.scrollTo({ top: 0 });
}

let atlasReady = false;

function refreshMenu(): void {
  for (const level of DIFFICULTIES) {
    const best = getBestScore(level);
    document.querySelector(`[data-best="${level}"]`)!.textContent =
      best === null ? "Not played yet" : `Best ${formatNumber(best)} / ${formatNumber(ROUNDS_PER_GAME * MAX_POINTS)}`;
  }
  if (atlasReady) refreshProgress();
  const quality = getQuality();
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quality button")) {
    button.setAttribute("aria-pressed", String(button.dataset.quality === quality));
  }
}

/** "Mastered X / Y" on each level card and the number of regions due for review. */
function refreshProgress(): void {
  const progress = loadProgress();
  for (const level of DIFFICULTIES) {
    const ids = [...askableAt(level)].map((i) => structures[i].id);
    const mastered = masteredCount(progress, ids);
    const box = document.querySelector<HTMLElement>(`[data-mastery="${level}"]`)!;
    box.querySelector("i")!.style.width = `${(mastered / ids.length) * 100}%`;
    box.querySelector("small")!.textContent = `${mastered} / ${ids.length} mastered`;
  }
  const due = reviewQueue(progress).length;
  const button = el<HTMLButtonElement>("review-btn");
  const count = el("review-count");
  button.disabled = due === 0;
  count.hidden = due === 0;
  count.textContent = String(due);
  el("review-desc").textContent =
    due > 0
      ? `${due} region${due === 1 ? "" : "s"} due. Practise the ones you missed until they stick.`
      : Object.keys(progress.regions).length === 0
        ? "Play a game first: regions you miss land here and come back until you know them."
        : "Nothing due right now. Regions come back after a few more games.";
}

let structures: AtlasIndex["structures"] = [];

async function init(): Promise<void> {
  showScreen("menu");
  let atlas: AtlasIndex;
  try {
    atlas = await loadIndex();
  } catch (error) {
    el("status").textContent = `Could not load the atlas data: ${String(error)}`;
    throw error;
  }
  el("status").textContent = `${atlas.slices.length} coronal slices of the mouse brain`;
  structures = atlas.structures;
  initPlay(atlas, showScreen);
  initStudy(atlas);
  atlasReady = true;
  refreshProgress();
  el("review-btn").addEventListener("click", startReview);
  el("reset-btn").addEventListener("click", () => {
    if (confirm("Forget which regions you know and which are due for review? Best scores are kept.")) {
      resetProgress();
      refreshProgress();
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("button.level")) {
    button.disabled = false;
    button.addEventListener("click", () => startGame(button.dataset.difficulty as Difficulty));
  }
  const study = el<HTMLButtonElement>("study-btn");
  study.disabled = false;
  study.addEventListener("click", () => {
    showScreen("study" satisfies ScreenName);
    openStudy();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quality button")) {
    button.addEventListener("click", () => {
      setQuality(button.dataset.quality as Quality);
      refreshMenu();
    });
  }
  el("home-btn").addEventListener("click", () => showScreen("menu"));
  el("menu-btn").addEventListener("click", () => showScreen("menu"));
}

void init();
