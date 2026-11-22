// Entry point: loads the atlas index, wires the menu, and switches screens.
// The screens themselves live in play.ts (game) and study.ts (study mode).

import "@fontsource-variable/rubik/wght.css";
import "@fontsource-variable/rubik/wght-italic.css";
import "./style.css";

import { loadIndex, type AtlasIndex } from "./data";
import { ROUNDS_PER_GAME } from "./game";
import { initPlay, startGame } from "./play";
import { MAX_POINTS } from "./scoring";
import { getBestScore, getQuality, setQuality } from "./storage";
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

function refreshMenu(): void {
  for (const level of DIFFICULTIES) {
    const best = getBestScore(level);
    document.querySelector(`[data-best="${level}"]`)!.textContent =
      best === null ? "Not played yet" : `Best ${formatNumber(best)} / ${formatNumber(ROUNDS_PER_GAME * MAX_POINTS)}`;
  }
  const quality = getQuality();
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quality button")) {
    button.setAttribute("aria-pressed", String(button.dataset.quality === quality));
  }
}

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
  initPlay(atlas, showScreen);
  initStudy(atlas);

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
