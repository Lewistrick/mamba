/**
 * Mamba Phase 5 — solo + AI opponent, auth, local + global leaderboards.
 */

import {
  AiBrain,
  FIELD_SIZES,
  Game,
  type AiDifficulty,
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
  type GameMode,
  type LeaderboardPeriod,
  type ScoreEntry,
} from "./leaderboard.ts";
import { Renderer } from "./renderer.ts";
import { gameOverScoreLines } from "./scoreBreakdown.ts";
import {
  loadSettings,
  playModeKey,
  saveSettings,
  type Settings,
} from "./settings.ts";
import {
  fetchProfile,
  getSession,
  setAccountUsername,
  signInWithMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  supabase,
  supabaseConfigured,
  type Profile,
} from "./supabase.ts";
import "./style.css";

/** Fixed simulation rate (ticks per second). */
const TICKS_PER_SECOND = 10;
const MAGIC_COOLDOWN_MS = 60_000;
const MAGIC_COOLDOWN_KEY = "mamba.magicLinkAt";

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
  headingsAi?: Direction[];
  mode: GameMode;
}

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const stageEl = document.querySelector<HTMLElement>("#stage");
const playBtnEl = document.querySelector<HTMLButtonElement>("#btn-play");
const soundToggleEl = document.querySelector<HTMLInputElement>("#sound-enabled");
const statusNode = document.querySelector<HTMLElement>("#status");
const lbPeriodSelect = document.querySelector<HTMLSelectElement>("#lb-period");
const lbList = document.querySelector<HTMLOListElement>("#lb-list");
const lbEmpty = document.querySelector<HTMLElement>("#lb-empty");
const aiDifficultyField = document.querySelector<HTMLElement>("#ai-difficulty-field");
const playModeInputs = document.querySelectorAll<HTMLInputElement>('input[name="play-mode"]');
const aiDifficultyInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="ai-difficulty"]',
);
const authPanel = document.querySelector<HTMLElement>("#auth-panel");
const authStatus = document.querySelector<HTMLElement>("#auth-status");
const authForm = document.querySelector<HTMLFormElement>("#auth-form");
const authEmail = document.querySelector<HTMLInputElement>("#auth-email");
const authPassword = document.querySelector<HTMLInputElement>("#auth-password");
const authConfirm = document.querySelector<HTMLElement>("#auth-confirm");
const signInBtn = document.querySelector<HTMLButtonElement>("#btn-sign-in");
const signUpBtn = document.querySelector<HTMLButtonElement>("#btn-sign-up");
const magicLinkBtn = document.querySelector<HTMLButtonElement>("#btn-magic-link");
const usernameForm = document.querySelector<HTMLFormElement>("#username-form");
const accountUsername = document.querySelector<HTMLInputElement>("#account-username");
const signOutBtn = document.querySelector<HTMLButtonElement>("#btn-sign-out");
const gameoverOverlay = document.querySelector<HTMLElement>("#gameover-overlay");
const goScore = document.querySelector<HTMLElement>("#go-score");
const goSaveStatus = document.querySelector<HTMLElement>("#go-save-status");
const guestScoreForm = document.querySelector<HTMLFormElement>("#guest-score-form");
const guestNameInput = document.querySelector<HTMLInputElement>("#guest-name");
const playAgainBtn = document.querySelector<HTMLButtonElement>("#btn-play-again");
const sizeInputs = document.querySelectorAll<HTMLInputElement>('input[name="size"]');

if (
  !canvasEl ||
  !stageEl ||
  !playBtnEl ||
  !soundToggleEl ||
  !statusNode ||
  !lbPeriodSelect ||
  !lbList ||
  !lbEmpty ||
  !aiDifficultyField ||
  !authPanel ||
  !authStatus ||
  !authForm ||
  !authEmail ||
  !authPassword ||
  !authConfirm ||
  !signInBtn ||
  !signUpBtn ||
  !magicLinkBtn ||
  !usernameForm ||
  !accountUsername ||
  !signOutBtn ||
  !gameoverOverlay ||
  !goScore ||
  !goSaveStatus ||
  !guestScoreForm ||
  !guestNameInput ||
  !playAgainBtn
) {
  throw new Error("Required DOM nodes missing");
}

const canvas = canvasEl;
const stage = stageEl;
const playBtn = playBtnEl;
const soundToggle = soundToggleEl;
const statusEl = statusNode;
const periodSelect = lbPeriodSelect;
const listEl = lbList;
const emptyEl = lbEmpty;
const aiDifficultyFieldEl = aiDifficultyField;
const authEl = authPanel;
const authStatusEl = authStatus;
const authFormEl = authForm;
const authEmailEl = authEmail;
const authPasswordEl = authPassword;
const authConfirmEl = authConfirm;
const signUpEl = signUpBtn;
const magicLinkEl = magicLinkBtn;
const usernameFormEl = usernameForm;
const accountUsernameEl = accountUsername;
const signOutEl = signOutBtn;
const overlayEl = gameoverOverlay;
const goScoreEl = goScore;
const goSaveStatusEl = goSaveStatus;
const guestFormEl = guestScoreForm;
const guestNameEl = guestNameInput;
const playAgainEl = playAgainBtn;

const settings: Settings = loadSettings();
const sounds = new SoundBoard(!settings.soundEnabled);
const renderer = new Renderer(canvas);

let game: Game | null = null;
let state: GameState | null = null;
let aiBrain: AiBrain | null = null;
let screen: Screen = "menu";
let accumulator = 0;
let paused = false;
let lastTime = performance.now();
let pendingScore: PendingScore | null = null;
let scoreSaved = false;
let signedInEmail: string | null = null;
let profile: Profile | null = null;

/**
 * True when keyboard focus is in a text field.
 *
 * @param target - Event target.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * Whether the signed-in account still needs a locked username.
 * Missing profile counts as needing setup (upsert creates the row).
 */
function needsUsername(): boolean {
  return Boolean(signedInEmail && (!profile || !profile.usernameSet));
}

/**
 * Applies persisted settings to the menu controls.
 */
function syncMenuFromSettings(): void {
  for (const input of sizeInputs) {
    input.checked = input.value === settings.sizeId;
  }
  for (const input of playModeInputs) {
    input.checked = input.value === settings.playMode;
  }
  for (const input of aiDifficultyInputs) {
    input.checked = input.value === settings.aiDifficulty;
  }
  aiDifficultyFieldEl.hidden = settings.playMode !== "ai";
  soundToggle.checked = settings.soundEnabled;
  sounds.setMuted(!settings.soundEnabled);
  guestNameEl.value = settings.playerName;
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
 * Reads solo vs AI from the menu.
 */
function selectedPlayMode(): "solo" | "ai" {
  for (const input of playModeInputs) {
    if (input.checked && input.value === "ai") {
      return "ai";
    }
  }
  return "solo";
}

/**
 * Reads AI difficulty from the menu.
 */
function selectedAiDifficulty(): AiDifficulty {
  for (const input of aiDifficultyInputs) {
    if (
      input.checked &&
      (input.value === "easy" || input.value === "medium" || input.value === "hard")
    ) {
      return input.value;
    }
  }
  return "medium";
}

/**
 * Current submit / board mode string.
 */
function currentMode(): GameMode {
  return playModeKey(settings) as GameMode;
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
 * Whether to show the global board (signed-in + Supabase) or local.
 */
function useGlobalBoard(): boolean {
  return Boolean(supabaseConfigured && signedInEmail);
}

/**
 * Persists current menu choices.
 */
function persistFromMenu(): void {
  settings.sizeId = selectedSizeId();
  settings.playMode = selectedPlayMode();
  settings.aiDifficulty = selectedAiDifficulty();
  settings.soundEnabled = soundToggle.checked;
  aiDifficultyFieldEl.hidden = settings.playMode !== "ai";
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
 * Enables/disables Play based on username gate.
 */
function syncPlayButton(): void {
  const blocked = needsUsername();
  playBtn.disabled = blocked;
  playBtn.title = blocked ? "Set a username first" : "";
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
    emptyEl.textContent = "No scores yet";
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
 * Refreshes the visible leaderboard for the menu size + mode.
 */
async function refreshLeaderboard(): Promise<void> {
  const sizeId = selectedSizeId();
  const period = selectedPeriod();
  const mode = currentMode();

  if (!useGlobalBoard()) {
    renderBoard(getBoard(sizeId, mode, period));
    return;
  }

  emptyEl.hidden = false;
  emptyEl.textContent = "Loading…";
  listEl.replaceChildren();
  const board = await fetchGlobalBoard(sizeId, mode, period);
  renderBoard(board);
}

/**
 * Shows an inline auth message.
 *
 * @param text - Message text.
 * @param kind - Success or error styling.
 */
function showAuthMessage(text: string, kind: "ok" | "error"): void {
  authConfirmEl.hidden = false;
  authConfirmEl.textContent = text;
  authConfirmEl.style.color =
    kind === "ok" ? "var(--accent-blue)" : "var(--accent-red)";
}

/**
 * Remaining magic-link cooldown in milliseconds.
 */
function magicCooldownRemaining(): number {
  const last = Number(localStorage.getItem(MAGIC_COOLDOWN_KEY) ?? 0);
  return Math.max(0, last + MAGIC_COOLDOWN_MS - Date.now());
}

/**
 * Starts the client-side magic-link cooldown and updates the button label.
 */
function armMagicCooldown(): void {
  localStorage.setItem(MAGIC_COOLDOWN_KEY, String(Date.now()));
  syncMagicLinkButton();
}

/**
 * Disables the magic-link button while the cooldown is active.
 */
function syncMagicLinkButton(): void {
  const remaining = magicCooldownRemaining();
  if (remaining <= 0) {
    magicLinkEl.disabled = false;
    magicLinkEl.textContent = "Email a magic link instead";
    return;
  }
  magicLinkEl.disabled = true;
  const seconds = Math.ceil(remaining / 1000);
  magicLinkEl.textContent = `Magic link available in ${seconds}s`;
  window.setTimeout(syncMagicLinkButton, 1000);
}

/**
 * Updates auth panel visibility and labels.
 */
async function refreshAuthUi(): Promise<void> {
  // Always reset forms first so CSS/state can't leave the wrong one visible.
  authConfirmEl.hidden = true;
  authConfirmEl.textContent = "";
  authFormEl.hidden = true;
  usernameFormEl.hidden = true;
  signOutEl.hidden = true;

  if (!supabaseConfigured) {
    authEl.hidden = true;
    profile = null;
    signedInEmail = null;
    syncPlayButton();
    return;
  }

  authEl.hidden = false;
  const session = await getSession();
  signedInEmail = session?.user.email ?? null;
  profile = signedInEmail ? await fetchProfile() : null;

  if (!signedInEmail) {
    authStatusEl.textContent = "Guest — local scores only";
    authFormEl.hidden = false;
    syncMagicLinkButton();
    syncPlayButton();
    return;
  }

  signOutEl.hidden = false;

  if (profile?.usernameSet) {
    authStatusEl.textContent = profile.displayName;
  } else {
    authStatusEl.textContent = "Signed in — choose a username";
    usernameFormEl.hidden = false;
    accountUsernameEl.value = "";
  }

  syncPlayButton();
}

/**
 * Sets the game-over overlay save status line.
 *
 * @param text - Message, or null to hide.
 * @param kind - Success or error styling.
 */
function setGoSaveStatus(text: string | null, kind: "ok" | "error" | "pending" = "ok"): void {
  if (!text) {
    goSaveStatusEl.hidden = true;
    goSaveStatusEl.textContent = "";
    return;
  }
  goSaveStatusEl.hidden = false;
  goSaveStatusEl.textContent = text;
  goSaveStatusEl.dataset.kind = kind;
}

/**
 * Hides the game-over stage overlay.
 */
function hideGameOverOverlay(): void {
  overlayEl.hidden = true;
  guestFormEl.hidden = true;
  setGoSaveStatus(null);
  pendingScore = null;
  scoreSaved = false;
}

/**
 * Shows the game-over overlay over the playfield.
 *
 * @param pending - Score + replay payload.
 * @param mode - Guest name entry vs signed-in auto result.
 */
function showGameOverOverlay(
  pending: PendingScore,
  mode: "guest" | "account",
): void {
  pendingScore = pending;
  scoreSaved = false;
  overlayEl.hidden = false;
  goScoreEl.textContent = `Score: ${pending.score}`;
  if (mode === "guest") {
    setGoSaveStatus(null);
    guestFormEl.hidden = false;
    guestNameEl.value = settings.playerName;
    guestNameEl.focus();
    guestNameEl.select();
  } else {
    guestFormEl.hidden = true;
    setGoSaveStatus("Saving score…", "pending");
  }
}

/**
 * Saves a guest local high score from the overlay form.
 *
 * @returns True if saved.
 */
async function saveGuestScore(): Promise<boolean> {
  if (!pendingScore || scoreSaved) {
    return false;
  }
  const name = sanitizeName(guestNameEl.value);
  guestNameEl.value = name;
  settings.playerName = name;
  saveSettings(settings);

  const { rank } = submitScore({
    name,
    score: pendingScore.score,
    level: pendingScore.level,
    sizeId: pendingScore.sizeId,
    mode: pendingScore.mode,
    createdAt: Date.now(),
  });
  scoreSaved = true;
  guestFormEl.hidden = true;
  const message = rank !== null ? `Saved — rank #${rank}` : "Saved";
  setGoSaveStatus(message, "ok");
  setStatus(message);
  await refreshLeaderboard();
  return true;
}

/**
 * Auto-saves a signed-in run to local + global boards.
 *
 * @param pending - Score + replay payload.
 */
async function autoSaveAccountScore(pending: PendingScore): Promise<void> {
  const name = sanitizeName(profile?.displayName ?? "AAA");
  const { rank } = submitScore({
    name,
    score: pending.score,
    level: pending.level,
    sizeId: pending.sizeId,
    mode: pending.mode,
    createdAt: Date.now(),
  });
  scoreSaved = true;

  const { error } = await submitGlobalScore({
    seed: pending.seed,
    sizeId: pending.sizeId,
    mode: pending.mode,
    headings: pending.headings,
    headingsAi: pending.headingsAi,
    claimedScore: pending.score,
    claimedLevel: pending.level,
    displayName: name,
  });

  let message = rank !== null ? `Saved — local #${rank}` : "Saved locally";
  message = error ? `${message} · global failed: ${error}` : `${message} · global OK`;
  setGoSaveStatus(message, error ? "error" : "ok");
  setStatus(message);
  await refreshLeaderboard();
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  if (needsUsername()) {
    setStatus("Choose a username before playing");
    accountUsernameEl.focus();
    return;
  }
  hideGameOverOverlay();
  persistFromMenu();
  sounds.resume();
  paused = false;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  if (settings.playMode === "ai") {
    game = Game.versusAi(settings.sizeId, seed);
    aiBrain = new AiBrain(settings.aiDifficulty, seed);
  } else {
    game = Game.withSize(settings.sizeId, seed);
    aiBrain = null;
  }
  state = game.getState();
  screen = "playing";
  accumulator = 0;
  playBtn.textContent = "Restart";
  setStatus(settings.playMode === "ai" ? `vs AI (${settings.aiDifficulty})` : "");
  void refreshLeaderboard();
}

/**
 * Formats the game-over score breakdown for the overlay.
 *
 * @param final - Final engine state.
 * @returns Multi-line summary.
 */
function formatGameOverScore(final: GameState): string {
  return gameOverScoreLines(final).join("\n");
}

/**
 * Handles end-of-run UI and score save flow.
 *
 * @param final - Final engine state.
 * @param run - Game instance that just ended.
 */
function onGameOver(final: GameState, run: Game): void {
  screen = "gameover";
  paused = false;
  accumulator = 0;
  playBtn.textContent = "Play again";
  const sizeId = settings.sizeId;
  const mode = currentMode();
  const score = final.netScore;
  const byPlayer = run.getReplayHeadingsByPlayer();
  const pending: PendingScore = {
    score,
    level: final.level,
    sizeId,
    seed: run.seed,
    headings: byPlayer[0] ?? run.getReplayHeadings(),
    headingsAi: byPlayer.length > 1 ? byPlayer[1] : undefined,
    mode,
  };

  const summary = formatGameOverScore(final);
  const shortStatus =
    final.players.length > 1 ? `Net ${score}` : `Score ${score}`;

  if (signedInEmail && profile?.usernameSet) {
    showGameOverOverlay(pending, "account");
    goScoreEl.textContent = summary;
    void autoSaveAccountScore(pending);
  } else if (!signedInEmail && qualifiesForBoard(score, sizeId, mode)) {
    showGameOverOverlay(pending, "guest");
    goScoreEl.textContent = summary;
    setStatus(shortStatus);
  } else {
    hideGameOverOverlay();
    setStatus(shortStatus);
  }
  void refreshLeaderboard();
}

/**
 * Toggles pause while a run is in progress.
 */
function togglePause(): void {
  if (screen !== "playing") {
    return;
  }
  paused = !paused;
  accumulator = 0;
  setStatus(paused ? "Paused — P to resume" : "");
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
 * Handles keyboard input for movement, restart, pause, and sound.
 *
 * @param event - Keyboard event.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (isTypingTarget(event.target)) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    if (screen !== "playing") {
      event.preventDefault();
      startGame();
    }
    return;
  }

  if (event.key === "p" || event.key === "P") {
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    togglePause();
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
  if (dir && game && screen === "playing" && !paused) {
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

  if (screen === "playing" && game && !paused) {
    accumulator += dt;
    const step = 1 / TICKS_PER_SECOND;
    while (accumulator >= step) {
      if (aiBrain && game.playerCount > 1) {
        const view = game.getState();
        if (view.status === "playing") {
          game.queueDirection(1, aiBrain.decide(view));
        }
      }
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
      players: [
        {
          body: [],
          direction: "Right",
          score: 0,
          survivalScore: 0,
          winBonus: 0,
          level: 1,
          pelletsEatenThisLife: 0,
          moltThreshold: 0,
          alive: true,
          blueValue: 1,
          greenValue: 10,
        },
      ],
      snake: [],
      direction: "Right",
      walls: [],
      bluePellets: [],
      greenPellets: [],
      yellowPellet: null,
      score: 0,
      survivalScore: 0,
      winBonus: 0,
      level: 1,
      pelletsEatenThisLife: 0,
      moltThreshold: 0,
      netScore: 0,
      status: "playing",
      tick: 0,
      blueValue: 1,
      greenValue: 10,
      events: [],
    } satisfies GameState);

  // HTML overlay owns the interactive game-over UI; skip canvas text overlay then.
  const overlay =
    screen === "playing" && paused
      ? "paused"
      : screen === "gameover" && overlayEl.hidden
        ? "gameover"
        : null;
  renderer.draw(screen === "menu" ? drawState : state, overlay, stageBudget());
  requestAnimationFrame(frame);
}

playBtn.addEventListener("click", () => {
  startGame();
});

playAgainEl.addEventListener("click", () => {
  startGame();
});

guestFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveGuestScore();
});

soundToggle.addEventListener("change", () => {
  persistFromMenu();
  sounds.resume();
});

periodSelect.addEventListener("change", () => {
  void refreshLeaderboard();
});

for (const input of playModeInputs) {
  input.addEventListener("change", () => {
    persistFromMenu();
    void refreshLeaderboard();
  });
}

for (const input of aiDifficultyInputs) {
  input.addEventListener("change", () => {
    persistFromMenu();
    void refreshLeaderboard();
  });
}

authFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const { error } = await signInWithPassword(authEmailEl.value, authPasswordEl.value);
    if (error) {
      showAuthMessage(error, "error");
      return;
    }
    authPasswordEl.value = "";
    await refreshAuthUi();
    await refreshLeaderboard();
  })();
});

signUpEl.addEventListener("click", () => {
  void (async () => {
    if (!authFormEl.reportValidity()) {
      return;
    }
    const { error, needsEmailConfirm } = await signUpWithPassword(
      authEmailEl.value,
      authPasswordEl.value,
    );
    if (error) {
      showAuthMessage(error, "error");
      return;
    }
    authPasswordEl.value = "";
    if (needsEmailConfirm) {
      showAuthMessage(
        "Confirm email is still enabled in Supabase (Authentication → Providers → Email). Disable it for password signup without mail, or confirm the link then sign in.",
        "error",
      );
      return;
    }
    await refreshAuthUi();
    await refreshLeaderboard();
  })();
});

magicLinkEl.addEventListener("click", () => {
  void (async () => {
    if (!authEmailEl.value.trim()) {
      showAuthMessage("Enter your email first", "error");
      authEmailEl.focus();
      return;
    }
    const remaining = magicCooldownRemaining();
    if (remaining > 0) {
      showAuthMessage(
        `Please wait ${Math.ceil(remaining / 1000)}s before requesting another link.`,
        "error",
      );
      return;
    }
    const { error } = await signInWithMagicLink(authEmailEl.value);
    if (error) {
      const rateLimited = /rate limit/i.test(error);
      showAuthMessage(
        rateLimited
          ? "Email rate limit hit — use password sign-in, or wait a few minutes."
          : error,
        "error",
      );
      if (rateLimited) {
        armMagicCooldown();
      }
      return;
    }
    armMagicCooldown();
    showAuthMessage("Check your email for the magic link.", "ok");
  })();
});

usernameFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const { error } = await setAccountUsername(accountUsernameEl.value);
    if (error) {
      showAuthMessage(error, "error");
      setStatus(error);
      return;
    }
    await refreshAuthUi();
    setStatus("Username saved — you can play");
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
