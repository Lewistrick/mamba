/**
 * Mamba Phase 6 — solo, AI, online 1v1, auth, local + global leaderboards.
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
import { fetchGlobalBoard, fetchGlobalStanding, submitGlobalScore } from "./globalLeaderboard.ts";
import {
  getBoard,
  qualifiesForBoard,
  sanitizeName,
  submitScore,
  type GameMode,
  type LeaderboardPeriod,
  type ScoreEntry,
} from "./leaderboard.ts";
import {
  buildStatRows,
  drawScoreHistoryChart,
  formatModeLabel,
  formatSizeLabel,
  sortStatRows,
  type ChartXMode,
  type StatRow,
  type StatSort,
  type StatSortKey,
} from "./profileStats.ts";
import { Renderer } from "./renderer.ts";
import { gameOverScoreLines } from "./scoreBreakdown.ts";
import { MpLobbyController, hideLobbyForMatchOver, mpGameOverText } from "./mpLobby.ts";
import {
  loadSettings,
  playModeKey,
  saveSettings,
  type Settings,
} from "./settings.ts";
import {
  fetchMyScores,
  fetchProfile,
  getSession,
  setAccountUsername,
  signInWithMagicLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  supabase,
  supabaseConfigured,
  updateAccountPassword,
  updateAccountUsername,
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

type Screen = "menu" | "playing" | "gameover" | "profile" | "help" | "multiplayer";

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
const multiplayerBtn = document.querySelector<HTMLButtonElement>("#btn-multiplayer");
const statusNode = document.querySelector<HTMLElement>("#status");
const lbPeriodSelect = document.querySelector<HTMLSelectElement>("#lb-period");
const lbScopeSelect = document.querySelector<HTMLSelectElement>("#lb-scope");
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
const profileBtn = document.querySelector<HTMLButtonElement>("#btn-profile");
const signOutBtn = document.querySelector<HTMLButtonElement>("#btn-sign-out");
const gameoverOverlay = document.querySelector<HTMLElement>("#gameover-overlay");
const goScore = document.querySelector<HTMLElement>("#go-score");
const goSaveStatus = document.querySelector<HTMLElement>("#go-save-status");
const guestScoreForm = document.querySelector<HTMLFormElement>("#guest-score-form");
const guestNameInput = document.querySelector<HTMLInputElement>("#guest-name");
const playAgainBtn = document.querySelector<HTMLButtonElement>("#btn-play-again");
const leaveRoomBtn = document.querySelector<HTMLButtonElement>("#btn-leave-room");
const helpBtn = document.querySelector<HTMLButtonElement>("#btn-help");
const sizeInputs = document.querySelectorAll<HTMLInputElement>('input[name="size"]');
const gameShell = document.querySelector<HTMLElement>("#game-shell");
const profilePage = document.querySelector<HTMLElement>("#profile-page");
const helpPage = document.querySelector<HTMLElement>("#help-page");
const helpBackBtn = document.querySelector<HTMLButtonElement>("#btn-help-back");
const mpPage = document.querySelector<HTMLElement>("#mp-page");
const profileBackBtn = document.querySelector<HTMLButtonElement>("#btn-profile-back");
const profileUsernameForm = document.querySelector<HTMLFormElement>("#profile-username-form");
const profileUsernameInput = document.querySelector<HTMLInputElement>("#profile-username");
const profileUsernameMsg = document.querySelector<HTMLElement>("#profile-username-msg");
const profileElo = document.querySelector<HTMLElement>("#profile-elo");
const profilePasswordForm = document.querySelector<HTMLFormElement>("#profile-password-form");
const profilePasswordInput = document.querySelector<HTMLInputElement>("#profile-password");
const profilePasswordConfirm = document.querySelector<HTMLInputElement>(
  "#profile-password-confirm",
);
const profilePasswordMsg = document.querySelector<HTMLElement>("#profile-password-msg");
const profileStatsEmpty = document.querySelector<HTMLElement>("#profile-stats-empty");
const profileStatsTable = document.querySelector<HTMLTableElement>("#profile-stats-table");
const profileStatsBody = document.querySelector<HTMLElement>("#profile-stats-body");
const profileChartPanel = document.querySelector<HTMLElement>("#profile-chart-panel");
const profileChartTitle = document.querySelector<HTMLElement>("#profile-chart-title");
const profileChartCanvas = document.querySelector<HTMLCanvasElement>("#profile-chart");

if (
  !canvasEl ||
  !stageEl ||
  !playBtnEl ||
  !multiplayerBtn ||
  !statusNode ||
  !lbPeriodSelect ||
  !lbScopeSelect ||
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
  !profileBtn ||
  !signOutBtn ||
  !gameoverOverlay ||
  !goScore ||
  !goSaveStatus ||
  !guestScoreForm ||
  !guestNameInput ||
  !playAgainBtn ||
  !leaveRoomBtn ||
  !helpBtn ||
  !gameShell ||
  !profilePage ||
  !helpPage ||
  !helpBackBtn ||
  !mpPage ||
  !profileBackBtn ||
  !profileUsernameForm ||
  !profileUsernameInput ||
  !profileUsernameMsg ||
  !profileElo ||
  !profilePasswordForm ||
  !profilePasswordInput ||
  !profilePasswordConfirm ||
  !profilePasswordMsg ||
  !profileStatsEmpty ||
  !profileStatsTable ||
  !profileStatsBody ||
  !profileChartPanel ||
  !profileChartTitle ||
  !profileChartCanvas
) {
  throw new Error("Required DOM nodes missing");
}

const canvas = canvasEl;
const stage = stageEl;
const playBtn = playBtnEl;
const multiplayerBtnEl = multiplayerBtn!;
const statusEl = statusNode;
const periodSelect = lbPeriodSelect;
const scopeSelect = lbScopeSelect;
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
const profileBtnEl = profileBtn;
const signOutEl = signOutBtn;
const overlayEl = gameoverOverlay;
const goScoreEl = goScore;
const goSaveStatusEl = goSaveStatus;
const guestFormEl = guestScoreForm;
const guestNameEl = guestNameInput;
const playAgainEl = playAgainBtn;
const leaveRoomEl = leaveRoomBtn;
const helpBtnEl = helpBtn;
const gameShellEl = gameShell;
const profilePageEl = profilePage;
const helpPageEl = helpPage;
const helpBackEl = helpBackBtn;
const mpPageEl = mpPage!;
const profileBackEl = profileBackBtn;
const profileUsernameFormEl = profileUsernameForm;
const profileUsernameEl = profileUsernameInput;
const profileUsernameMsgEl = profileUsernameMsg;
const profileEloEl = profileElo;
const profilePasswordFormEl = profilePasswordForm;
const profilePasswordEl = profilePasswordInput;
const profilePasswordConfirmEl = profilePasswordConfirm;
const profilePasswordMsgEl = profilePasswordMsg;
const profileStatsEmptyEl = profileStatsEmpty;
const profileStatsTableEl = profileStatsTable;
const profileStatsBodyEl = profileStatsBody;
const profileChartPanelEl = profileChartPanel;
const profileChartTitleEl = profileChartTitle;
const profileChartEl = profileChartCanvas;

const settings: Settings = loadSettings();
const sounds = new SoundBoard(!settings.soundEnabled);
const renderer = new Renderer(canvas);

let game: Game | null = null;
let state: GameState | null = null;
let aiBrain: AiBrain | null = null;
let screen: Screen = "menu";
let mpPlaying = false;
let spectating = false;
let accumulator = 0;
let paused = false;
let lastTime = performance.now();
let pendingScore: PendingScore | null = null;
let scoreSaved = false;
let signedInEmail: string | null = null;
let profile: Profile | null = null;
let profileStatRows: StatRow[] = [];
let selectedStatKey: string | null = null;
let profileStatSort: StatSort = { key: "size", dir: "asc" };
let profileChartXMode: ChartXMode = "date";

const mpLobby = new MpLobbyController(mpPageEl, {
  setStatus,
  hideOverlays: () => {
    hideGameOverOverlay();
  },
  showGameShell,
  playJoinSuccess: () => {
    sounds.resume();
    sounds.playJoinSuccess();
  },
  playMatchCountdown: () => {
    sounds.resume();
    sounds.playMatchCountdown();
  },
  hideReadyOverlay: () => {
    const el = document.querySelector<HTMLElement>("#mp-ready-overlay");
    if (el) {
      el.hidden = true;
    }
    const toggle = document.querySelector<HTMLInputElement>("#mp-ready-toggle");
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = false;
    }
    const codeEl = document.querySelector<HTMLElement>("#mp-ready-code");
    if (codeEl) {
      codeEl.hidden = true;
    }
  },
  onWaitingForOpponent: (code, sizeId) => {
    state = placeholderState(FIELD_SIZES[sizeId]);
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = true;
    mpPlaying = true;
    playBtn.textContent = "Leave match";
    setStatus(
      code
        ? `Waiting for opponent — room code ${code}`
        : "Creating room — waiting for opponent…",
    );

    // Reuse the ready overlay to show the shareable room code — the ready
    // checkbox stays hidden until an opponent is actually seated.
    const overlay = document.querySelector<HTMLElement>("#mp-ready-overlay");
    const joined = document.querySelector<HTMLElement>("#mp-ready-joined");
    const codeEl = document.querySelector<HTMLElement>("#mp-ready-code");
    const label = document.querySelector<HTMLElement>(".mp-ready-label");
    const peer = document.querySelector<HTMLElement>("#mp-ready-peer");
    if (overlay) {
      overlay.hidden = false;
    }
    if (label) {
      label.hidden = true;
    }
    if (peer) {
      peer.textContent = "";
    }
    if (joined) {
      joined.textContent = "Waiting for an opponent to join…";
    }
    if (codeEl) {
      codeEl.hidden = code === null;
      codeEl.textContent = code ? `Room code: ${code}` : "";
    }
  },
  onPregame: (view) => {
    state = view;
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = true;
    mpPlaying = true;
    playBtn.textContent = "Leave match";
    setStatus("Opponent joined — toggle Ready when set");
  },
  onCountdown: (view) => {
    state = view;
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = true;
    mpPlaying = true;
    playBtn.textContent = "Leave match";
    setStatus("Starting…");
  },
  onMatchState: (view) => {
    mpPlaying = true;
    state = view;
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = false;
    playBtn.textContent = "Leave match";
    sounds.playEvents(view.events);
  },
  onMatchOver: (view, youIndex, names, winnerIndex, elo) => {
    mpPlaying = false;
    state = view;
    screen = "gameover";
    playBtn.textContent = "Play again";
    // Stay on the game shell with the overlay — do not reveal #mp-page
    // beside it (that stacked the lobby next to GAME OVER).
    hideLobbyForMatchOver(mpPageEl);
    const text = mpGameOverText(
      view,
      names,
      youIndex,
      winnerIndex,
      elo?.you ?? null,
    );
    goScoreEl.textContent = text;
    overlayEl.hidden = false;
    guestFormEl.hidden = true;
    leaveRoomEl.hidden = false;
    setGoSaveStatus("Saved to local scores (mode: mp)", "ok");
    setStatus(
      winnerIndex === youIndex
        ? "You win"
        : winnerIndex === null
          ? "Draw"
          : "You lose",
    );
    if (elo?.you && profile) {
      profile = { ...profile, elo: elo.you.after };
    }
    void refreshLeaderboard();
  },
  onMatchPlaying: (playing) => {
    mpPlaying = playing;
  },
  onSpectateState: (view, names, roomStatus) => {
    spectating = true;
    state = view;
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = false;
    playBtn.textContent = "Stop watching";
    const phase =
      roomStatus === "readying"
        ? "Readying up"
        : roomStatus === "countdown"
          ? "Starting"
          : "Watching";
    setStatus(`${phase}: ${names[0] || "?"} vs ${names[1] || "?"}`);
  },
  onSpectateGameOver: (view, names, winnerIndex) => {
    state = view;
    const summary = winnerIndex == null ? "Draw" : `${names[winnerIndex] || "?"} wins`;
    setStatus(`Watching — ${summary}`);
  },
  onSpectateEnded: (reason) => {
    spectating = false;
    state = null;
    screen = "multiplayer";
    playBtn.textContent = "Play";
    setStatus(reason);
    mpPageEl.hidden = false;
  },
});

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
  sounds.setMuted(!settings.soundEnabled);
  guestNameEl.value = settings.playerName;
  scopeSelect.value = settings.leaderboardScope;
}

/**
 * Empty placeholder board for screens with no live game yet (menu preview,
 * waiting for a multiplayer opponent).
 *
 * @param size - Field dimensions.
 * @returns Static empty-field state.
 */
function placeholderState(size: { width: number; height: number }): GameState {
  return {
    width: size.width,
    height: size.height,
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
  };
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
  settings.playMode = selectedPlayMode();
  settings.aiDifficulty = selectedAiDifficulty();
  settings.leaderboardScope = selectedScope();
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
  const scope = selectedScope();

  if (scope === "local") {
    renderBoard(getBoard(sizeId, mode, period));
    return;
  }

  if (!supabaseConfigured) {
    emptyEl.hidden = false;
    emptyEl.textContent = "Configure Supabase for global scores";
    listEl.replaceChildren();
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
  profileBtnEl.hidden = true;
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
    if (screen === "profile") {
      showGameShell();
    }
    return;
  }

  signOutEl.hidden = false;
  profileBtnEl.hidden = false;

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
 * Shows a short status under a profile form.
 *
 * @param el - Message element.
 * @param text - Message, or null to hide.
 * @param kind - Success or error.
 */
function setProfileMsg(
  el: HTMLElement,
  text: string | null,
  kind: "ok" | "error" = "ok",
): void {
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.style.color = kind === "ok" ? "var(--accent-blue)" : "var(--accent-red)";
}

/**
 * Returns from the profile, help, or multiplayer lobby to the game shell.
 */
function showGameShell(): void {
  profilePageEl.hidden = true;
  helpPageEl.hidden = true;
  if (!mpPlaying) {
    mpPageEl.hidden = true;
  }
  gameShellEl.hidden = false;
  if (mpPlaying) {
    screen = "playing";
    return;
  }
  screen = game && state?.status === "gameover" ? "gameover" : "menu";
  if (screen === "menu") {
    paused = false;
  }
}

/**
 * Opens the multiplayer lobby page.
 */
function openMultiplayerPage(): void {
  if (!supabaseConfigured) {
    setStatus(
      "Multiplayer needs Supabase — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local, then restart Vite",
    );
    return;
  }
  if (!signedInEmail) {
    setStatus("Sign in under Account (below Multiplayer), then try again");
    authFormEl.hidden = false;
    authEl.hidden = false;
    authEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    authEmailEl.focus();
    return;
  }
  if (needsUsername()) {
    setStatus("Choose a username under Account, then try again");
    usernameFormEl.hidden = false;
    authEl.hidden = false;
    authEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    accountUsernameEl.focus();
    return;
  }
  hideGameOverOverlay();
  paused = true;
  screen = "multiplayer";
  gameShellEl.hidden = true;
  profilePageEl.hidden = true;
  helpPageEl.hidden = true;
  mpPageEl.hidden = false;
  void mpLobby.open();
}

/**
 * Opens the help page (from game over). Keeps the overlay score state intact.
 */
function openHelpPage(): void {
  paused = true;
  screen = "help";
  gameShellEl.hidden = true;
  profilePageEl.hidden = true;
  helpPageEl.hidden = false;
}

/**
 * Opens the profile page and loads stats.
 */
async function openProfilePage(): Promise<void> {
  if (!signedInEmail) {
    return;
  }
  hideGameOverOverlay();
  paused = true;
  screen = "profile";
  gameShellEl.hidden = true;
  helpPageEl.hidden = true;
  profilePageEl.hidden = false;
  profileUsernameEl.value = profile?.displayName ?? "";
  profileEloEl.textContent =
    profile != null ? `Elo ${profile.elo}` : "Elo —";
  profilePasswordEl.value = "";
  profilePasswordConfirmEl.value = "";
  setProfileMsg(profileUsernameMsgEl, null);
  setProfileMsg(profilePasswordMsgEl, null);
  selectedStatKey = null;
  profileChartPanelEl.hidden = true;
  await refreshProfileStats();
}

/**
 * Reloads size/mode play counts for the signed-in user.
 */
async function refreshProfileStats(): Promise<void> {
  profileStatsBodyEl.replaceChildren();
  profileStatsEmptyEl.hidden = false;
  profileStatsTableEl.hidden = true;
  profileChartPanelEl.hidden = true;

  const scores = await fetchMyScores();
  profileStatRows = buildStatRows(scores);
  if (profileStatRows.length === 0) {
    profileStatsEmptyEl.textContent = "No global games yet";
    return;
  }

  profileStatsEmptyEl.hidden = true;
  profileStatsTableEl.hidden = false;
  renderProfileStatsTable();

  if (selectedStatKey) {
    const selected = profileStatRows.find(
      (r) => `${r.sizeId}|${r.mode}` === selectedStatKey,
    );
    if (selected) {
      showProfileChart(selected);
    }
  }
}

/**
 * Updates sort-header indicators to match the active sort.
 */
function syncProfileSortHeaders(): void {
  for (const btn of profileStatsTableEl.querySelectorAll<HTMLButtonElement>(".stats-sort")) {
    const key = btn.dataset.sort as StatSortKey | undefined;
    if (key === profileStatSort.key) {
      btn.dataset.dir = profileStatSort.dir;
    } else {
      delete btn.dataset.dir;
    }
  }
}

/**
 * Renders the stats table body using the current sort.
 */
function renderProfileStatsTable(): void {
  syncProfileSortHeaders();
  profileStatsBodyEl.replaceChildren();
  const rows = sortStatRows(profileStatRows, profileStatSort);
  for (const row of rows) {
    const tr = document.createElement("tr");
    const key = `${row.sizeId}|${row.mode}`;
    tr.dataset.key = key;
    if (key === selectedStatKey) {
      tr.dataset.active = "true";
    }
    tr.innerHTML = `<td></td><td></td><td></td>`;
    tr.children[0].textContent = formatSizeLabel(row.sizeId);
    tr.children[1].textContent = formatModeLabel(row.mode);
    tr.children[2].textContent = String(row.plays);
    tr.addEventListener("click", () => {
      selectedStatKey = key;
      for (const el of profileStatsBodyEl.querySelectorAll("tr")) {
        el.dataset.active = el === tr ? "true" : "false";
      }
      showProfileChart(row);
    });
    profileStatsBodyEl.append(tr);
  }
}

/**
 * Toggles or switches the stats table sort.
 *
 * @param key - Column to sort by.
 */
function setProfileStatSort(key: StatSortKey): void {
  if (profileStatSort.key === key) {
    profileStatSort = {
      key,
      dir: profileStatSort.dir === "asc" ? "desc" : "asc",
    };
  } else {
    profileStatSort = { key, dir: key === "plays" ? "desc" : "asc" };
  }
  renderProfileStatsTable();
}

/**
 * Reads the selected chart X-axis mode from the radio group.
 *
 * @returns Active mode.
 */
function selectedChartXMode(): ChartXMode {
  const checked = document.querySelector<HTMLInputElement>(
    'input[name="chart-x"]:checked',
  );
  return checked?.value === "game" ? "game" : "date";
}

/**
 * Syncs radio buttons to the in-memory chart X mode.
 */
function syncChartXModeInputs(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="chart-x"]')) {
    input.checked = input.value === profileChartXMode;
  }
}

/**
 * Shows the score history chart for one size/mode row.
 *
 * @param row - Selected stats row.
 */
function showProfileChart(row: StatRow): void {
  profileChartPanelEl.hidden = false;
  profileChartTitleEl.textContent = `${row.label} — scores over time`;
  syncChartXModeInputs();
  drawScoreHistoryChart(profileChartEl, row.scores, { xMode: profileChartXMode });
}

/**
 * Redraws the chart for the currently selected stats row.
 */
function redrawSelectedProfileChart(): void {
  if (!selectedStatKey) {
    return;
  }
  const selected = profileStatRows.find(
    (r) => `${r.sizeId}|${r.mode}` === selectedStatKey,
  );
  if (selected) {
    drawScoreHistoryChart(profileChartEl, selected.scores, {
      xMode: profileChartXMode,
    });
  }
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
  leaveRoomEl.hidden = true;
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
  leaveRoomEl.hidden = true;
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
  submitScore({
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

  if (error) {
    setGoSaveStatus(`Global save failed: ${error}`, "error");
    setStatus(`Global save failed: ${error}`);
    await refreshLeaderboard();
    return;
  }

  const [daily, allTime] = await Promise.all([
    fetchGlobalStanding(pending.sizeId, pending.mode, pending.score, "daily"),
    fetchGlobalStanding(pending.sizeId, pending.mode, pending.score, "all"),
  ]);

  const lines: string[] = [];
  if (daily !== null) {
    lines.push(
      `Daily global #${daily.rank} · ${formatTopOrBottom(daily.rank, daily.total)}`,
    );
  }
  if (allTime !== null) {
    lines.push(
      `All-time global #${allTime.rank} · ${formatTopOrBottom(allTime.rank, allTime.total)}`,
    );
  }
  const message = lines.length > 0 ? lines.join("\n") : "Saved to global board";
  setGoSaveStatus(message, "ok");
  setStatus(lines[0] ?? message);
  await refreshLeaderboard();
}

/**
 * Labels a standing as “top x%” or “bottom x%”, whichever end is closer.
 *
 * @param rank - 1-based rank (1 = best).
 * @param total - Field size (≥ 1).
 * @returns e.g. `top 4%` or `bottom 12%`.
 */
function formatTopOrBottom(rank: number, total: number): string {
  const n = Math.max(1, total);
  const topPct = Math.max(1, Math.min(100, Math.round((100 * rank) / n)));
  const bottomPct = Math.max(
    1,
    Math.min(100, Math.round((100 * (n - rank + 1)) / n)),
  );
  return topPct <= bottomPct ? `top ${topPct}%` : `bottom ${bottomPct}%`;
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  if (mpLobby.requestPlayAgain()) {
    return;
  }
  if (mpPlaying || spectating) {
    const wasSpectating = spectating;
    mpLobby.close();
    mpPlaying = false;
    spectating = false;
    screen = "menu";
    playBtn.textContent = "Play";
    setStatus(wasSpectating ? "Stopped watching" : "Left multiplayer match");
    return;
  }
  if (needsUsername()) {
    setStatus("Choose a username before playing");
    accountUsernameEl.focus();
    return;
  }
  if (screen === "profile" || screen === "help" || screen === "multiplayer") {
    showGameShell();
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
  if (mpPlaying || screen !== "playing") {
    return;
  }
  paused = !paused;
  accumulator = 0;
  setStatus(paused ? "Paused — P to resume" : "");
}

/**
 * Toggles sound on/off via the S hotkey.
 */
function toggleSound(): void {
  settings.soundEnabled = !settings.soundEnabled;
  saveSettings(settings);
  sounds.setMuted(!settings.soundEnabled);
  sounds.resume();
  setStatus(settings.soundEnabled ? "Sound on" : "Sound off");
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

  if (screen === "profile" || screen === "help" || screen === "multiplayer") {
    if (event.key === "Escape") {
      event.preventDefault();
      if (screen === "multiplayer") {
        mpLobby.close();
      }
      showGameShell();
    }
    return;
  }

  if (event.key === "Escape") {
    if (screen === "gameover" && !leaveRoomEl.hidden) {
      event.preventDefault();
      leaveRoomEl.click();
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

  if (event.key === "r" || event.key === "R") {
    const readyOverlay = document.querySelector<HTMLElement>("#mp-ready-overlay");
    const readyToggle = document.querySelector<HTMLInputElement>("#mp-ready-toggle");
    if (readyOverlay && !readyOverlay.hidden && readyToggle && !readyToggle.disabled) {
      event.preventDefault();
      readyToggle.checked = !readyToggle.checked;
      readyToggle.dispatchEvent(new Event("change"));
    }
    return;
  }

  if (event.key === "p" || event.key === "P") {
    if (event.repeat || mpPlaying || spectating) {
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
  if (dir && screen === "playing" && !paused) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    if (mpPlaying) {
      mpLobby.sendInput(dir);
      return;
    }
    if (game) {
      game.queueDirection(dir);
    }
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

  if (screen === "profile" || screen === "help" || screen === "multiplayer") {
    requestAnimationFrame(frame);
    return;
  }

  if (screen === "playing" && game && !paused && !mpPlaying) {
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
  const drawState = state ?? placeholderState(previewSize);

  // HTML overlay owns the interactive game-over UI; skip canvas text overlay then.
  const overlay =
    screen === "playing" && paused
      ? "paused"
      : screen === "gameover" && overlayEl.hidden
        ? "gameover"
        : null;
  renderer.draw(screen === "menu" ? drawState : state, overlay, stageBudget(), {
    opponentLabel: aiBrain ? "AI" : "Opp",
    fair: mpPlaying || spectating,
  });
  requestAnimationFrame(frame);
}

playBtn.addEventListener("click", () => {
  startGame();
});

multiplayerBtnEl.addEventListener("click", () => {
  openMultiplayerPage();
});

playAgainEl.addEventListener("click", () => {
  if (mpLobby.requestPlayAgain()) {
    return;
  }
  startGame();
});

leaveRoomEl.addEventListener("click", () => {
  mpLobby.close();
  mpPlaying = false;
  spectating = false;
  screen = "menu";
  playBtn.textContent = "Play";
  hideGameOverOverlay();
  setStatus("Left multiplayer match");
});

guestFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveGuestScore();
});

periodSelect.addEventListener("change", () => {
  void refreshLeaderboard();
});

scopeSelect.addEventListener("change", () => {
  persistFromMenu();
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
    if (screen === "profile") {
      showGameShell();
    }
    await refreshAuthUi();
    await refreshLeaderboard();
    setStatus("Signed out");
  })();
});

profileBtnEl.addEventListener("click", () => {
  void openProfilePage();
});

profileBackEl.addEventListener("click", () => {
  showGameShell();
});

helpBtnEl.addEventListener("click", () => {
  openHelpPage();
});

helpBackEl.addEventListener("click", () => {
  showGameShell();
});

for (const btn of profileStatsTableEl.querySelectorAll<HTMLButtonElement>(".stats-sort")) {
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    const key = btn.dataset.sort as StatSortKey | undefined;
    if (key === "size" || key === "mode" || key === "plays") {
      setProfileStatSort(key);
    }
  });
}

profileUsernameFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const { error } = await updateAccountUsername(profileUsernameEl.value);
    if (error) {
      setProfileMsg(profileUsernameMsgEl, error, "error");
      return;
    }
    profile = await fetchProfile();
    setProfileMsg(profileUsernameMsgEl, "Username updated", "ok");
    await refreshAuthUi();
  })();
});

profilePasswordFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    if (profilePasswordEl.value !== profilePasswordConfirmEl.value) {
      setProfileMsg(profilePasswordMsgEl, "Passwords do not match", "error");
      return;
    }
    const { error } = await updateAccountPassword(profilePasswordEl.value);
    if (error) {
      setProfileMsg(profilePasswordMsgEl, error, "error");
      return;
    }
    profilePasswordEl.value = "";
    profilePasswordConfirmEl.value = "";
    setProfileMsg(profilePasswordMsgEl, "Password updated", "ok");
  })();
});

window.addEventListener("resize", () => {
  if (screen !== "profile" || !selectedStatKey) {
    return;
  }
  redrawSelectedProfileChart();
});

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="chart-x"]')) {
  input.addEventListener("change", () => {
    profileChartXMode = selectedChartXMode();
    redrawSelectedProfileChart();
  });
}

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
