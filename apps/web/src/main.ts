/**
 * Mamba Phase 4 — local + global leaderboards, auth, replay submit.
 */

import {
  FIELD_SIZES,
  Game,
  type Direction,
  type FieldSizeId,
  type GameState,
} from "@mamba/engine";
import { SoundBoard } from "./audio.ts";
import { fetchGlobalBoard, submitGlobalScore } from "./globalLeaderboard.ts";
import {
  getBoard,
  qualifiesForBoard,
  sanitizeName,
  submitScore,
  type LeaderboardPeriod,
  type ScoreEntry,
} from "./leaderboard.ts";
import { Renderer } from "./renderer.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";
import {
  getSession,
  signInWithEmail,
  signOut,
  supabase,
  supabaseConfigured,
} from "./supabase.ts";
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

interface PendingScore {
  score: number;
  level: number;
  sizeId: FieldSizeId;
  seed: number;
  headings: Direction[];
}

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const stageEl = document.querySelector<HTMLElement>("#stage");
const playBtnEl = document.querySelector<HTMLButtonElement>("#btn-play");
const soundToggleEl = document.querySelector<HTMLInputElement>("#sound-enabled");
const statusNode = document.querySelector<HTMLElement>("#status");
const highscorePanel = document.querySelector<HTMLElement>("#highscore-panel");
const playerNameInput = document.querySelector<HTMLInputElement>("#player-name");
const saveScoreBtn = document.querySelector<HTMLButtonElement>("#btn-save-score");
const lbPeriodSelect = document.querySelector<HTMLSelectElement>("#lb-period");
const lbScopeSelect = document.querySelector<HTMLSelectElement>("#lb-scope");
const lbList = document.querySelector<HTMLOListElement>("#lb-list");
const lbEmpty = document.querySelector<HTMLElement>("#lb-empty");
const authPanel = document.querySelector<HTMLElement>("#auth-panel");
const authStatus = document.querySelector<HTMLElement>("#auth-status");
const authForm = document.querySelector<HTMLFormElement>("#auth-form");
const authEmail = document.querySelector<HTMLInputElement>("#auth-email");
const signOutBtn = document.querySelector<HTMLButtonElement>("#btn-sign-out");
const globalSaveHint = document.querySelector<HTMLElement>("#global-save-hint");
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
  !lbScopeSelect ||
  !lbList ||
  !lbEmpty ||
  !authPanel ||
  !authStatus ||
  !authForm ||
  !authEmail ||
  !signOutBtn ||
  !globalSaveHint
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
const scopeSelect = lbScopeSelect;
const listEl = lbList;
const emptyEl = lbEmpty;
const authEl = authPanel;
const authStatusEl = authStatus;
const authFormEl = authForm;
const authEmailEl = authEmail;
const signOutEl = signOutBtn;
const globalHintEl = globalSaveHint;

const settings: Settings = loadSettings();
const sounds = new SoundBoard(!settings.soundEnabled);
const renderer = new Renderer(canvas);

let game: Game | null = null;
let state: GameState | null = null;
let screen: Screen = "menu";
let accumulator = 0;
let lastTime = performance.now();
let pendingScore: PendingScore | null = null;
let scoreSaved = false;
let signedInEmail: string | null = null;

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
  scopeSelect.value = settings.leaderboardScope;
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
 * Reads local/global scope from the select control.
 *
 * @returns Scope id.
 */
function selectedScope(): "local" | "global" {
  return scopeSelect.value === "global" ? "global" : "local";
}

/**
 * Persists current menu choices.
 */
function persistFromMenu(): void {
  settings.sizeId = selectedSizeId();
  settings.soundEnabled = soundToggle.checked;
  settings.playerName = sanitizeName(nameInput.value);
  settings.leaderboardScope = selectedScope();
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
 * Updates the status line.
 *
 * @param text - Message to show.
 */
function setStatus(text: string): void {
  statusEl.textContent = text;
}

/**
 * Renders a score list into the leaderboard DOM.
 *
 * @param board - Rows to show.
 */
function renderBoard(board: ScoreEntry[]): void {
  listEl.replaceChildren();
  if (board.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent =
      selectedScope() === "global" && !supabaseConfigured
        ? "Configure Supabase for global scores"
        : "No scores yet";
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
 * Refreshes the visible leaderboard (local or global).
 */
async function refreshLeaderboard(): Promise<void> {
  const sizeId = selectedSizeId();
  const period = selectedPeriod();
  const scope = selectedScope();

  if (scope === "local") {
    renderBoard(getBoard(sizeId, MODE, period));
    return;
  }

  if (!supabaseConfigured) {
    renderBoard([]);
    return;
  }

  emptyEl.hidden = false;
  emptyEl.textContent = "Loading…";
  listEl.replaceChildren();
  const board = await fetchGlobalBoard(sizeId, MODE, period);
  renderBoard(board);
}

/**
 * Updates auth panel visibility and labels.
 */
async function refreshAuthUi(): Promise<void> {
  if (!supabaseConfigured) {
    authEl.hidden = true;
    globalHintEl.hidden = true;
    return;
  }

  authEl.hidden = false;
  const session = await getSession();
  signedInEmail = session?.user.email ?? null;
  if (signedInEmail) {
    authStatusEl.textContent = signedInEmail;
    authFormEl.hidden = true;
    signOutEl.hidden = false;
    globalHintEl.hidden = false;
  } else {
    authStatusEl.textContent = "Guest — local scores only";
    authFormEl.hidden = false;
    signOutEl.hidden = true;
    globalHintEl.hidden = true;
    if (settings.leaderboardScope === "global") {
      // Guests can still browse global boards (public read).
    }
  }
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
 * @param pending - Score + replay payload.
 */
function offerHighscore(pending: PendingScore): void {
  pendingScore = pending;
  scoreSaved = false;
  highscoreEl.hidden = false;
  nameInput.value = settings.playerName;
  nameInput.focus();
  nameInput.select();
  setStatus(`Score ${pending.score}`);
}

/**
 * Saves the pending high score locally and, when signed in, globally.
 *
 * @returns True if a local row was written.
 */
async function savePendingScore(): Promise<boolean> {
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

  let message = rank !== null ? `Saved locally — rank #${rank}` : "Saved locally";

  if (signedInEmail) {
    const { error } = await submitGlobalScore({
      seed: pendingScore.seed,
      sizeId: pendingScore.sizeId,
      mode: MODE,
      headings: pendingScore.headings,
      claimedScore: pendingScore.score,
      claimedLevel: pendingScore.level,
      displayName: name,
    });
    message = error
      ? `${message} · global failed: ${error}`
      : `${message} · global OK`;
  }

  setStatus(message);
  await refreshLeaderboard();
  return true;
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  hideHighscorePanel();
  persistFromMenu();
  sounds.resume();
  game = Game.withSize(settings.sizeId, (Math.random() * 0xffffffff) >>> 0);
  state = game.getState();
  screen = "playing";
  accumulator = 0;
  playBtn.textContent = "Restart";
  setStatus("");
  void refreshLeaderboard();
}

/**
 * Handles end-of-run UI and optional high-score offer.
 *
 * @param final - Final engine state.
 * @param run - Game instance that just ended.
 */
function onGameOver(final: GameState, run: Game): void {
  screen = "gameover";
  accumulator = 0;
  playBtn.textContent = "Play again";
  const sizeId = settings.sizeId;
  const localQualify = qualifiesForBoard(final.score, sizeId, MODE);
  const canSave = localQualify || (Boolean(signedInEmail) && final.score > 0);
  if (canSave) {
    offerHighscore({
      score: final.score,
      level: final.level,
      sizeId,
      seed: run.seed,
      headings: run.getReplayHeadings(),
    });
  } else {
    hideHighscorePanel();
    setStatus(`Score ${final.score}`);
  }
  void refreshLeaderboard();
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
      void savePendingScore();
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
        onGameOver(state, game);
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
  void savePendingScore();
});

soundToggle.addEventListener("change", () => {
  persistFromMenu();
  sounds.resume();
});

periodSelect.addEventListener("change", () => {
  void refreshLeaderboard();
});

scopeSelect.addEventListener("change", () => {
  persistFromMenu();
  void refreshLeaderboard();
});

nameInput.addEventListener("change", () => {
  settings.playerName = sanitizeName(nameInput.value);
  nameInput.value = settings.playerName;
  saveSettings(settings);
});

authFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const { error } = await signInWithEmail(authEmailEl.value);
    setStatus(error ? error : "Check your email for the magic link");
  })();
});

signOutEl.addEventListener("click", () => {
  void (async () => {
    await signOut();
    await refreshAuthUi();
    await refreshLeaderboard();
    setStatus("Signed out");
  })();
});

for (const input of sizeInputs) {
  input.addEventListener("change", () => {
    persistFromMenu();
    if (screen === "menu" || screen === "gameover") {
      state = null;
    }
    void refreshLeaderboard();
  });
}

if (supabase) {
  supabase.auth.onAuthStateChange(() => {
    void refreshAuthUi().then(() => refreshLeaderboard());
  });
}

window.addEventListener("keydown", onKeyDown);
syncMenuFromSettings();
setStatus("");
void refreshAuthUi().then(() => refreshLeaderboard());
requestAnimationFrame(frame);
