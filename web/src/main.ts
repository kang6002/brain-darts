// Entry point: species picker, per-species menu, and screen switching.
// The address decides the species: …/#mouse or …/#human (empty = picker).
// The screens themselves live in play.ts (game) and study.ts (study mode).

import "@fontsource-variable/rubik/wght.css";
import "@fontsource-variable/rubik/wght-italic.css";
import "./style.css";

import { loadIndex, type AtlasIndex } from "./data";
import { ROUNDS_PER_GAME } from "./game";
import { askableAt, initPlay, reviewQueue, setPlayAtlas, startGame, startReview } from "./play";
import { masteredCount } from "./review";
import { MAX_POINTS } from "./scoring";
import { getBestScore, getQuality, loadProgress, resetProgress, setLastSpecies, setQuality } from "./storage";
import { initStudy, openStudy, setStudyAtlas } from "./study";
import { DIFFICULTIES, SPECIES, type Difficulty, type Quality, type SpeciesId } from "./types";
import { el, formatNumber } from "./ui";

const SCREENS = ["species", "menu", "play", "end", "study"] as const;

const LEVEL_DESC: Record<SpeciesId, Record<Difficulty, string>> = {
  mouse: {
    easy: "Major divisions: isocortex, thalamus, cerebellum…",
    medium: "Cortical areas and classic nuclei: VPM, SNr, PVH, CA1…",
    hard: "Almost 300 nuclei and fields, down to the small ones.",
  },
  human: {
    easy: "Lobes and big structures: frontal lobe, thalamus, putamen…",
    medium: "Gyri, cerebellar lobules and classic nuclei: STG, pulvinar, SN…",
    hard: "Brodmann areas and 500 detailed nuclei and fields.",
  },
};

const STATUS: Record<SpeciesId, (n: number) => string> = {
  mouse: (n) => `${n} coronal slices of the mouse brain`,
  human: (n) => `${n} annotated coronal plates of an adult human brain · one hemisphere`,
};

let atlas: AtlasIndex | null = null;

function showScreen(name: string): void {
  for (const screen of SCREENS) el(screen).hidden = screen !== name;
  el("hud").hidden = name !== "play";
  el("home-btn").hidden = name === "species";
  el("species-switch").hidden = name === "species" || name === "play";
  document.body.dataset.screen = name;
  if (name === "menu") refreshMenu();
  window.scrollTo({ top: 0 });
}

function refreshMenu(): void {
  if (!atlas) return;
  const species = atlas.species.id;
  for (const level of DIFFICULTIES) {
    const best = getBestScore(species, level);
    document.querySelector(`[data-best="${level}"]`)!.textContent =
      best === null ? "Not played yet" : `Best ${formatNumber(best)} / ${formatNumber(ROUNDS_PER_GAME * MAX_POINTS)}`;
    document.querySelector(`[data-desc="${level}"]`)!.textContent = LEVEL_DESC[species][level];
  }
  const quality = getQuality();
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quality button")) {
    button.setAttribute("aria-pressed", String(button.dataset.quality === quality));
  }
  refreshProgress();
}

/** "Mastered X / Y" on each level card and the number of regions due for review. */
function refreshProgress(): void {
  if (!atlas) return;
  const { structures } = atlas;
  const progress = loadProgress(atlas.species.id);
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

/** Load a species' atlas (once) and show its menu. */
async function openSpecies(species: SpeciesId): Promise<void> {
  document.body.dataset.species = species;
  for (const button of document.querySelectorAll<HTMLButtonElement>("#species-switch button")) {
    button.setAttribute("aria-pressed", String(button.dataset.species === species));
  }
  el("menu-species").textContent = species === "human" ? "Human" : "Mouse";
  el("status").textContent = "Loading atlas…";
  for (const b of document.querySelectorAll<HTMLButtonElement>("button.level, #study-btn")) b.disabled = true;
  showScreen("menu");
  try {
    atlas = await loadIndex(species);
  } catch (error) {
    el("status").textContent = `Could not load the ${species} atlas: ${String(error)}`;
    throw error;
  }
  if (document.body.dataset.species !== species) return; // switched again while loading
  setPlayAtlas(atlas);
  setStudyAtlas(atlas);
  setLastSpecies(species);
  el("status").textContent = STATUS[species](atlas.slices.length);
  for (const b of document.querySelectorAll<HTMLButtonElement>("button.level, #study-btn")) b.disabled = false;
  refreshMenu();
}

/** Follow the address: #mouse / #human open that species, anything else the picker. */
function route(): void {
  const wanted = location.hash.slice(1);
  if ((SPECIES as readonly string[]).includes(wanted)) {
    void openSpecies(wanted as SpeciesId);
  } else {
    atlas = null;
    delete document.body.dataset.species;
    showScreen("species");
  }
}

function init(): void {
  initPlay(showScreen);
  initStudy();

  // Species picker thumbnails (public files, so they need the site's base path).
  const base = import.meta.env.BASE_URL;
  el<HTMLImageElement>("thumb-mouse").src = `${base}data/mouse/coronal_288_25um.png`;
  el<HTMLImageElement>("thumb-human").src = `${base}data/human/plate_060_light.jpg`;
  for (const tile of document.querySelectorAll<HTMLButtonElement>("button.species-tile, #species-switch button")) {
    tile.addEventListener("click", () => {
      location.hash = tile.dataset.species!;
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("button.level")) {
    button.addEventListener("click", () => startGame(button.dataset.difficulty as Difficulty));
  }
  el("review-btn").addEventListener("click", startReview);
  el("study-btn").addEventListener("click", () => {
    showScreen("study");
    openStudy();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("#quality button")) {
    button.addEventListener("click", () => {
      setQuality(button.dataset.quality as Quality);
      refreshMenu();
    });
  }
  el("reset-btn").addEventListener("click", () => {
    if (!atlas) return;
    const name = atlas.species.name.toLowerCase();
    if (confirm(`Forget which ${name} regions you know and which are due for review? Best scores are kept.`)) {
      resetProgress(atlas.species.id);
      refreshProgress();
    }
  });
  // The logo goes to the current species' menu (or the picker if none is open).
  el("home-btn").addEventListener("click", () => (atlas ? showScreen("menu") : route()));
  el("menu-btn").addEventListener("click", () => showScreen("menu"));
  el("pick-species").addEventListener("click", () => {
    location.hash = "";
  });

  window.addEventListener("hashchange", route);
  route();
}

init();
