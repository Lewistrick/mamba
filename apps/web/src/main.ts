/**
 * Mamba Phase 3 — local leaderboards + Phase 2 client shell.
 */

import {
  FIELD_SIZES,
  Game,
  type Direction,
  type FieldSizeId,
  type GameState,
} from "@mamba/engine";
import { SoundBoard } from "./audio.ts";
import {
  getBoard,
  qualifiesForBoard,
  sanitizeName,
  submitScore,
  type LeaderboardPeriod,
} from "./leaderboard.ts";
import { Renderer } from "./renderer.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";
import "./style.css";

/** Fixed simulation rate (ticks per second). */
const TICKS_PER_SECOND = 10;
const MODE = "solo" as const;

const KEY_TO_DIR: Record<string, Direction> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

type Screen = "menu" | "playing" | "gameover";

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const stageEl = document.querySelector<HTMLElement>("#stage");
const playBtnEl = document.querySelector<HTMLButtonElement>("#btn-play");
const soundToggleEl = document.querySelector<HTMLInputElement>("#sound-enabled");
const statusNode = document.querySelector<HTMLElement>("#status");
const highscorePanel = document.querySelector<HTMLElement>("#highscore-panel");
const playerNameInput = document.querySelector<HTMLInputElement>("#player-name");
const saveScoreBtn = document.querySelector<HTMLButtonElement>("#btn-save-score");
const lbPeriodSelect = document.querySelector<HTMLSelectElement>("#lb-period");
const lbList = document.querySelector<HTMLOListElement>("#lb-list");
const lbEmpty = document.querySelector<HTMLElement>("#lb-empty");
const sizeInputs = document.querySelectorAll<HTMLInputElement>('input[name="size"]');

if (
  !canvasEl ||
  !stageEl ||
  !playBtnEl ||
  !soundToggleEl ||
  !statusNode ||
  !highscorePanel ||
  !playerNameInput ||
  !saveScoreBtn ||
  !lbPeriodSelect ||
  !lbList ||
  !lbEmpty
) {
  throw new Error("Required DOM nodes missing");
}

const canvas = canvasEl;
const stage = stageEl;
const playBtn = playBtnEl;
const soundToggle = soundToggleEl;
const statusEl = statusNode;
const highscoreEl = highscorePanel;
const nameInput = playerNameInput;
const saveBtn = saveScoreBtn;
const periodSelect = lbPeriodSelect;
const listEl = lbList;
const emptyEl = lbEmpty;

const settings: Settings = loadSettings();
const sounds = new SoundBoard(!settings.soundEnabled);
const renderer = new Renderer(canvas);

let game: Game | null = null;
let state: GameState | null = null;
let screen: Screen = "menu";
let accumulator = 0;
let lastTime = performance.now();
let pendingScore: { score: number; level: number; sizeId: FieldSizeId } | null = null;
let scoreSaved = false;

/**
 * True when keyboard focus is in a text field.
 *
 * @param target - Event target.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Applies persisted settings to the menu controls.
 */
function syncMenuFromSettings(): void {
  for (const input of sizeInputs) {
    input.checked = input.value === settings.sizeId;
  }
  soundToggle.checked = settings.soundEnabled;
  sounds.setMuted(!settings.soundEnabled);
  nameInput.value = settings.playerName;
}

/**
 * Reads the selected board size from the radio group.
 *
 * @returns Field size id.
 */
function selectedSizeId(): FieldSizeId {
  for (const input of sizeInputs) {
    if (input.checked && (input.value === "small" || input.value === "medium" || input.value === "large")) {
      return input.value;
    }
  }
  return "medium";
}

/**
 * Reads the leaderboard period from the select control.
 *
 * @returns Period id.
 */
function selectedPeriod(): LeaderboardPeriod {
  const value = periodSelect.value;
  if (value === "weekly" || value === "daily" || value === "all") {
    return value;
  }
  return "all";
}

/**
 * Persists current menu choices.
 */
function persistFromMenu(): void {
  settings.sizeId = selectedSizeId();
  settings.soundEnabled = soundToggle.checked;
  settings.playerName = sanitizeName(nameInput.value);
  nameInput.value = settings.playerName;
  sounds.setMuted(!settings.soundEnabled);
  saveSettings(settings);
}

/**
 * Stage pixel budget for live board rescale.
 *
 * @returns Max CSS width/height for the canvas.
 */
function stageBudget(): { maxWidth: number; maxHeight: number } {
  const rect = stage.getBoundingClientRect();
  return {
    maxWidth: Math.max(200, Math.floor(rect.width)),
    maxHeight: Math.max(200, Math.floor(rect.height)),
  };
}

/**
 * Updates the status line under the Play button.
 *
 * @param text - Message to show.
 */
function setStatus(text: string): void {
  statusEl.textContent = text;
}

/**
 * Renders the local leaderboard for the current size + selected period.
 */
function refreshLeaderboard(): void {
  const board = getBoard(selectedSizeId(), MODE, selectedPeriod());
  listEl.replaceChildren();
  if (board.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  board.forEach((row, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">${index + 1}.</span><span class="name"></span><span class="score"></span>`;
    li.querySelector(".name")!.textContent = row.name;
    li.querySelector(".score")!.textContent = String(row.score);
    listEl.append(li);
  });
}

/**
 * Hides the high-score save panel.
 */
function hideHighscorePanel(): void {
  highscoreEl.hidden = true;
  pendingScore = null;
  scoreSaved = false;
}

/**
 * Shows the high-score panel after a qualifying run.
 *
 * @param score - Final score.
 * @param level - Final level.
 * @param sizeId - Board size used for the run.
 */
function offerHighscore(score: number, level: number, sizeId: FieldSizeId): void {
  pendingScore = { score, level, sizeId };
  scoreSaved = false;
  highscoreEl.hidden = false;
  nameInput.value = settings.playerName;
  nameInput.focus();
  nameInput.select();
  setStatus(`Score ${score}`);
}

/**
 * Saves the pending high score if present and not yet saved.
 *
 * @returns True if a row was written.
 */
function savePendingScore(): boolean {
  if (!pendingScore || scoreSaved) {
    return false;
  }
  const name = sanitizeName(nameInput.value);
  nameInput.value = name;
  settings.playerName = name;
  saveSettings(settings);

  const { rank } = submitScore({
    name,
    score: pendingScore.score,
    level: pendingScore.level,
    sizeId: pendingScore.sizeId,
    mode: MODE,
    createdAt: Date.now(),
  });
  scoreSaved = true;
  highscoreEl.hidden = true;
  refreshLeaderboard();
  setStatus(rank !== null ? `Saved — rank #${rank}` : "Saved");
  return true;
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  if (pendingScore && !scoreSaved) {
    // Switching away from game over without saving discards the offer.
  }
  hideHighscorePanel();
  persistFromMenu();
  sounds.resume();
  game = Game.withSize(settings.sizeId, (Math.random() * 0xffffffff) >>> 0);
  state = game.getState();
  screen = "playing";
  accumulator = 0;
  playBtn.textContent = "Restart";
  setStatus("");
  refreshLeaderboard();
}

/**
 * Handles end-of-run UI and optional high-score offer.
 *
 * @param final - Final engine state.
 */
function onGameOver(final: GameState): void {
  screen = "gameover";
  accumulator = 0;
  playBtn.textContent = "Play again";
  const sizeId = settings.sizeId;
  if (qualifiesForBoard(final.score, sizeId, MODE)) {
    offerHighscore(final.score, final.level, sizeId);
  } else {
    hideHighscorePanel();
    setStatus(`Score ${final.score}`);
  }
  refreshLeaderboard();
}

/**
 * Toggles sound on/off and syncs the menu checkbox.
 */
function toggleSound(): void {
  soundToggle.checked = !soundToggle.checked;
  persistFromMenu();
  sounds.resume();
}

/**
 * Handles keyboard input for movement, restart, and sound.
 *
 * @param event - Keyboard event.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) {
    if (event.key === "Enter" && screen === "gameover" && !highscoreEl.hidden) {
      event.preventDefault();
      savePendingScore();
    }
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    if (screen !== "playing") {
      event.preventDefault();
      startGame();
    }
    return;
  }

  if (event.key === "s" || event.key === "S") {
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    toggleSound();
    return;
  }

  const dir = KEY_TO_DIR[event.key];
  if (dir && game && screen === "playing") {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    game.queueDirection(dir);
  }
}

/**
 * Main animation / simulation loop.
 *
 * @param now - RAF timestamp.
 */
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (screen === "playing" && game) {
    accumulator += dt;
    const step = 1 / TICKS_PER_SECOND;
    while (accumulator >= step) {
      state = game.tick();
      sounds.playEvents(state.events);
      accumulator -= step;
      if (state.status === "gameover") {
        onGameOver(state);
        break;
      }
    }
  }

  const previewSize = FIELD_SIZES[selectedSizeId()];
  const drawState =
    state ??
    ({
      width: previewSize.width,
      height: previewSize.height,
      snake: [],
      direction: "Right",
      walls: [],
      bluePellets: [],
      greenPellets: [],
      yellowPellet: null,
      score: 0,
      level: 1,
      pelletsEatenThisLife: 0,
      moltThreshold: 0,
      status: "playing",
      tick: 0,
      blueValue: 1,
      greenValue: 10,
      events: [],
    } satisfies GameState);

  const overlay = screen === "gameover" ? "gameover" : null;
  renderer.draw(screen === "menu" ? drawState : state, overlay, stageBudget());
  requestAnimationFrame(frame);
}

playBtn.addEventListener("click", () => {
  startGame();
});

saveBtn.addEventListener("click", () => {
  savePendingScore();
});

soundToggle.addEventListener("change", () => {
  persistFromMenu();
  sounds.resume();
});

periodSelect.addEventListener("change", () => {
  refreshLeaderboard();
});

nameInput.addEventListener("change", () => {
  settings.playerName = sanitizeName(nameInput.value);
  nameInput.value = settings.playerName;
  saveSettings(settings);
});

for (const input of sizeInputs) {
  input.addEventListener("change", () => {
    persistFromMenu();
    if (screen === "menu" || screen === "gameover") {
      state = null;
    }
    refreshLeaderboard();
  });
}

window.addEventListener("keydown", onKeyDown);
syncMenuFromSettings();
setStatus("");
refreshLeaderboard();
requestAnimationFrame(frame);
