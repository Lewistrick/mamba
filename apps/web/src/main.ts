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
import { gameOverScoreLines, mpScoreTable } from "./scoreBreakdown.ts";
import {
  MpLobbyController,
  hideLobbyForMatchOver,
  mpEloText,
  mpResultText,
  mpSpectateResultText,
} from "./mpLobby.ts";
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
const scoresPanel = document.querySelector<HTMLElement>("#scores");
const mpStandingsPanel = document.querySelector<HTMLElement>("#mp-standings");
const mpStandingsNameA = document.querySelector<HTMLElement>("#mp-standings-name-a");
const mpStandingsNameB = document.querySelector<HTMLElement>("#mp-standings-name-b");
const mpStandingsWinsA = document.querySelector<HTMLElement>("#mp-standings-wins-a");
const mpStandingsWinsB = document.querySelector<HTMLElement>("#mp-standings-wins-b");
const mpStandingsTable = document.querySelector<HTMLTableElement>("#mp-standings-table");
const mpStandingsEmpty = document.querySelector<HTMLElement>("#mp-standings-empty");
const mpStandingsQueue = document.querySelector<HTMLElement>("#mp-standings-queue");
const mpSpectateQueueText = document.querySelector<HTMLElement>("#mp-spectate-queue");
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
const goMpSummary = document.querySelector<HTMLElement>("#go-mp-summary");
const goMpResult = document.querySelector<HTMLElement>("#go-mp-result");
const goMpTable = document.querySelector<HTMLTableElement>("#go-mp-table");
const goMpElo = document.querySelector<HTMLElement>("#go-mp-elo");
const goSaveStatus = document.querySelector<HTMLElement>("#go-save-status");
const guestScoreForm = document.querySelector<HTMLFormElement>("#guest-score-form");
const guestNameInput = document.querySelector<HTMLInputElement>("#guest-name");
const playAgainBtn = document.querySelector<HTMLButtonElement>("#btn-play-again");
const playAgainWait = document.querySelector<HTMLElement>("#go-play-again-wait");
const leaveRoomBtn = document.querySelector<HTMLButtonElement>("#btn-leave-room");
const mpReadyLeaveBtn = document.querySelector<HTMLButtonElement>("#btn-mp-ready-leave");
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
  !scoresPanel ||
  !mpStandingsPanel ||
  !mpStandingsNameA ||
  !mpStandingsNameB ||
  !mpStandingsWinsA ||
  !mpStandingsWinsB ||
  !mpStandingsTable ||
  !mpStandingsEmpty ||
  !mpStandingsQueue ||
  !mpSpectateQueueText ||
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
  !goMpSummary ||
  !goMpResult ||
  !goMpTable ||
  !goMpElo ||
  !goSaveStatus ||
  !guestScoreForm ||
  !guestNameInput ||
  !playAgainBtn ||
  !playAgainWait ||
  !leaveRoomBtn ||
  !mpReadyLeaveBtn ||
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
const scoresPanelEl = scoresPanel;
const mpStandingsPanelEl = mpStandingsPanel;
const mpStandingsNameAEl = mpStandingsNameA;
const mpStandingsNameBEl = mpStandingsNameB;
const mpStandingsWinsAEl = mpStandingsWinsA;
const mpStandingsWinsBEl = mpStandingsWinsB;
const mpStandingsTableEl = mpStandingsTable;
const mpStandingsEmptyEl = mpStandingsEmpty;
const mpStandingsQueueEl = mpStandingsQueue;
const mpSpectateQueueTextEl = mpSpectateQueueText;
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
const goMpSummaryEl = goMpSummary;
const goMpResultEl = goMpResult;
const goMpTableEl = goMpTable;
const goMpEloEl = goMpElo;
const goSaveStatusEl = goSaveStatus;
const guestFormEl = guestScoreForm;
const guestNameEl = guestNameInput;
const playAgainEl = playAgainBtn;
const playAgainWaitEl = playAgainWait;
const leaveRoomEl = leaveRoomBtn;
const mpReadyLeaveEl = mpReadyLeaveBtn;
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
/**
 * Broader than mpPlaying/spectating: true from room entry until the player
 * actually leaves, including the post-match/rematch-wait screen (where
 * mpPlaying is briefly false). Drives the Scores vs. standings panel swap.
 */
let inMpRoom = false;
/**
 * Easter egg: true right after a single P press, cleared by any arrow key.
 * A second P while still armed (mid-match) freezes the local snake in
 * place — manual testing only.
 */
let pArmed = false;
/** True while the local snake is frozen (the easter egg above) — any next keypress unfreezes it. */
let frozen = false;
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
    inMpRoom = true;
    pArmed = false;
    frozen = false;
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
    inMpRoom = true;
    pArmed = false;
    frozen = false;
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
    inMpRoom = true;
    pArmed = false;
    frozen = false;
    playBtn.textContent = "Leave match";
    setStatus("Starting…");
  },
  onMatchState: (view) => {
    mpPlaying = true;
    inMpRoom = true;
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
    inMpRoom = true;
    pArmed = false;
    frozen = false;
    state = view;
    screen = "gameover";
    playBtn.textContent = "Play again";
    // Stay on the game shell with the overlay — do not reveal #mp-page
    // beside it (that stacked the lobby next to GAME OVER).
    hideLobbyForMatchOver(mpPageEl);
    renderMpGameOver(
      view,
      names,
      youIndex,
      winnerIndex,
      elo?.you ?? null,
      mpResultText(names, youIndex, winnerIndex),
    );
    overlayEl.hidden = false;
    guestFormEl.hidden = true;
    leaveRoomEl.hidden = false;
    setGoSaveStatus(null);
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
    inMpRoom = true;
    state = view;
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = false;
    playBtn.textContent = "Stop watching";
    // A live match exists again — clear any game-over table left over from
    // a previous match in this room.
    overlayEl.hidden = true;
    const phase =
      roomStatus === "readying"
        ? "Readying up"
        : roomStatus === "countdown"
          ? "Starting"
          : "Watching";
    setStatus(`${phase}: ${names[0] || "?"} vs ${names[1] || "?"}`);
  },
  onSpectateWaiting: (sizeId, names, roomStatus) => {
    spectating = true;
    inMpRoom = true;
    state = placeholderState(FIELD_SIZES[sizeId]);
    game = null;
    aiBrain = null;
    screen = "playing";
    paused = true;
    mpPlaying = false;
    playBtn.textContent = "Stop watching";
    overlayEl.hidden = true;
    const matchup = names[1] ? `${names[0] || "?"} vs ${names[1]}` : names[0] || "?";
    setStatus(
      roomStatus === "finished"
        ? `Waiting for rematch: ${matchup}`
        : `Waiting for opponent: ${matchup}`,
    );

    const overlay = document.querySelector<HTMLElement>("#mp-spectate-overlay");
    const title = document.querySelector<HTMLElement>("#mp-spectate-title");
    if (overlay) {
      overlay.hidden = false;
    }
    if (title) {
      title.textContent =
        roomStatus === "finished"
          ? `Match finished — waiting for rematch: ${matchup}`
          : names[0]
            ? `Game hasn't started yet — waiting for ${names[0]}'s opponent`
            : "Game hasn't started yet";
    }
  },
  onSpectateGameOver: (view, names, winnerIndex) => {
    inMpRoom = true;
    state = view;
    playBtn.textContent = "Stop watching";
    renderMpGameOver(
      view,
      names,
      0,
      winnerIndex,
      null,
      mpSpectateResultText(names, winnerIndex),
    );
    overlayEl.hidden = false;
    guestFormEl.hidden = true;
    playAgainEl.hidden = true;
    playAgainWaitEl.hidden = true;
    leaveRoomEl.hidden = true;
    setGoSaveStatus(null);
    setStatus(`Watching — ${mpSpectateResultText(names, winnerIndex)}`);
  },
  onSpectateEnded: (reason) => {
    spectating = false;
    inMpRoom = false;
    state = null;
    screen = "multiplayer";
    playBtn.textContent = "Play";
    overlayEl.hidden = true;
    setStatus(reason);
    mpPageEl.hidden = false;
  },
  onStandings: (names, wins) => {
    mpStandingsNameAEl.textContent = names[0] || "?";
    mpStandingsNameBEl.textContent = names[1] || "?";
    mpStandingsWinsAEl.textContent = String(wins[0]);
    mpStandingsWinsBEl.textContent = String(wins[1]);
  },
  onQueueInfo: (text) => {
    mpSpectateQueueTextEl.textContent = text ?? "";
  },
  onEnterRoom: () => {
    mpStandingsTableEl.hidden = true;
    mpStandingsTableEl.replaceChildren();
    mpStandingsEmptyEl.hidden = false;
    mpStandingsNameAEl.textContent = "";
    mpStandingsNameBEl.textContent = "";
    mpStandingsWinsAEl.textContent = "0";
    mpStandingsWinsBEl.textContent = "0";
  },
  onLastGame: (lastGame) => {
    if (!lastGame) {
      mpStandingsTableEl.hidden = true;
      mpStandingsTableEl.replaceChildren();
      mpStandingsEmptyEl.hidden = false;
      return;
    }
    const { names, winnerIndex, state } = lastGame;
    const youWins = winnerIndex !== null && winnerIndex === 0;
    const oppWins = winnerIndex !== null && winnerIndex === 1;
    const { rows } = mpScoreTable(state, names, 0);
    mpStandingsEmptyEl.hidden = true;
    mpStandingsTableEl.hidden = false;
    buildStandingsTable(mpStandingsTableEl, rows, youWins, oppWins);
  },
});

/**
 * True when keyboard focus is in a text field.
 *
 * @param target - Event target.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }
  // Checkboxes/radios (e.g. the Ready toggle) keep keyboard focus after a
  // mouse click but aren't "typing" — don't let them swallow hotkeys.
  return (
    target instanceof HTMLInputElement &&
    target.type !== "checkbox" &&
    target.type !== "radio"
  );
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
  playAgainEl.hidden = false;
  playAgainWaitEl.hidden = true;
  goMpSummaryEl.hidden = true;
  goScoreEl.hidden = false;
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
  goMpSummaryEl.hidden = true;
  goScoreEl.hidden = false;
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
 * Populates the MP game-over table (level/score/time/win/net per player,
 * winner column in green) plus the result and Elo lines.
 *
 * @param view - Remapped final state (player 0 = local "you").
 * @param names - Absolute seat display names.
 * @param youIndex - Local absolute seat.
 * @param winnerIndex - Absolute winner seat, or null for a draw.
 * @param elo - Elo change for the local player, if applicable.
 */
/**
 * Fills a level/score/time/win/net table for two players, with the winner's
 * column marked green. Shared by the Game Over overlay and the persistent
 * multiplayer standings panel.
 *
 * @param tableEl - Target `<table>`.
 * @param youName - Left player-column header.
 * @param oppName - Right player-column header.
 * @param rows - Row label + per-player values.
 * @param youWins - Highlight the left column.
 * @param oppWins - Highlight the right column.
 */
function buildScoreTable(
  tableEl: HTMLTableElement,
  youName: string,
  oppName: string,
  rows: { label: string; you: number; opp: number }[],
  youWins: boolean,
  oppWins: boolean,
): void {
  tableEl.replaceChildren();
  const headRow = document.createElement("tr");
  headRow.append(document.createElement("th"));
  const youHeadCell = document.createElement("th");
  youHeadCell.textContent = youName;
  youHeadCell.classList.toggle("winner", youWins);
  const oppHeadCell = document.createElement("th");
  oppHeadCell.textContent = oppName;
  oppHeadCell.classList.toggle("winner", oppWins);
  headRow.append(youHeadCell, oppHeadCell);
  tableEl.append(headRow);

  for (const row of rows) {
    const tr = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.textContent = row.label;
    const youCell = document.createElement("td");
    youCell.textContent = String(row.you);
    youCell.classList.toggle("winner", youWins);
    const oppCell = document.createElement("td");
    oppCell.textContent = String(row.opp);
    oppCell.classList.toggle("winner", oppWins);
    tr.append(labelCell, youCell, oppCell);
    tableEl.append(tr);
  }
}

/**
 * Fills the standings panel's last-game table: no header row (names already
 * shown above it in the panel), columns reordered to left value | label |
 * right value so each value sits under its matching name.
 *
 * @param tableEl - Target `<table>`.
 * @param rows - Row label + per-player values.
 * @param youWins - Highlight the left column.
 * @param oppWins - Highlight the right column.
 */
function buildStandingsTable(
  tableEl: HTMLTableElement,
  rows: { label: string; you: number; opp: number }[],
  youWins: boolean,
  oppWins: boolean,
): void {
  tableEl.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const youCell = document.createElement("td");
    youCell.textContent = String(row.you);
    youCell.classList.toggle("winner", youWins);
    const labelCell = document.createElement("td");
    labelCell.textContent = row.label;
    const oppCell = document.createElement("td");
    oppCell.textContent = String(row.opp);
    oppCell.classList.toggle("winner", oppWins);
    tr.append(youCell, labelCell, oppCell);
    tableEl.append(tr);
  }
}

function renderMpGameOver(
  view: GameState,
  names: [string, string],
  youIndex: number,
  winnerIndex: number | null,
  elo: { before: number; after: number; delta: number } | null,
  resultText: string,
): void {
  goScoreEl.hidden = true;
  goMpSummaryEl.hidden = false;
  goMpResultEl.textContent = resultText;

  const youWins = winnerIndex !== null && winnerIndex === youIndex;
  const oppWins = winnerIndex !== null && winnerIndex !== youIndex;
  const { youName, oppName, rows } = mpScoreTable(view, names, youIndex);
  buildScoreTable(goMpTableEl, youName, oppName, rows, youWins, oppWins);

  const eloLine = mpEloText(elo);
  goMpEloEl.hidden = eloLine === null;
  goMpEloEl.textContent = eloLine ?? "";
  // The standings panel's last-game table is driven separately by
  // onLastGame (server-tracked, so it's correct for latecomers too) — the
  // "room" broadcast carrying it arrives before this game_over/onMatchOver.
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
 * Leaves the current multiplayer room entirely (from the ready screen or
 * the game-over screen) and returns to the main menu.
 */
function leaveMultiplayerRoom(): void {
  const wasSpectating = spectating;
  mpLobby.close();
  mpPlaying = false;
  spectating = false;
  inMpRoom = false;
  pArmed = false;
  frozen = false;
  screen = "menu";
  state = null;
  game = null;
  aiBrain = null;
  paused = false;
  accumulator = 0;
  playBtn.textContent = "Play";
  hideGameOverOverlay();
  setStatus(wasSpectating ? "Stopped watching" : "Left multiplayer match");
}

/**
 * Requests a multiplayer rematch, if we're on a finished MP match's
 * game-over screen. Swaps the Play again button for a "waiting" line.
 *
 * @returns True when a rematch request was sent (caller should not start solo).
 */
function requestRematch(): boolean {
  if (!mpLobby.requestPlayAgain()) {
    return false;
  }
  playAgainEl.hidden = true;
  playAgainWaitEl.hidden = false;
  playAgainWaitEl.textContent = "You're ready — waiting for opponent…";
  return true;
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  if (requestRematch()) {
    return;
  }
  if (mpPlaying || spectating) {
    leaveMultiplayerRoom();
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
  if (mpPlaying || spectating || screen !== "playing") {
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

  if (frozen) {
    // Any keypress unfreezes — falls through so this same key still does
    // its normal thing too (e.g. an arrow key also steers).
    frozen = false;
    mpLobby.toggleFreeze();
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
    } else {
      const readyOverlay = document.querySelector<HTMLElement>("#mp-ready-overlay");
      if (readyOverlay && !readyOverlay.hidden) {
        event.preventDefault();
        mpReadyLeaveEl.click();
      }
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
    if (event.repeat) {
      return;
    }
    if (mpPlaying && !paused && screen === "playing") {
      // Easter egg: P, P (no arrow keys in between) freezes your own snake
      // in place for manual testing — the opponent keeps playing normally.
      event.preventDefault();
      if (pArmed) {
        pArmed = false;
        mpLobby.toggleFreeze();
        frozen = true;
      } else {
        pArmed = true;
      }
      return;
    }
    if (mpPlaying || spectating) {
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
  if (dir) {
    pArmed = false;
  }
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
  // MP pregame/countdown/waiting/spectating also set paused=true, but those
  // are covered by their own HTML overlays / status text, not "PAUSED".
  const overlay =
    screen === "playing" && paused && !mpPlaying && !spectating
      ? "paused"
      : screen === "gameover" && overlayEl.hidden
        ? "gameover"
        : null;
  renderer.draw(screen === "menu" ? drawState : state, overlay, stageBudget(), {
    opponentLabel: aiBrain ? "AI" : "Opp",
    fair: mpPlaying || spectating,
  });

  // Scores leaderboard doesn't apply in multiplayer — swap in the standings
  // panel (names, games-won tally, last-game breakdown) instead. Uses the
  // broader inMpRoom (not mpPlaying/spectating) so it stays shown through
  // the post-match/rematch-wait screen too.
  scoresPanelEl.hidden = inMpRoom;
  mpStandingsPanelEl.hidden = !inMpRoom;
  mpStandingsQueueEl.hidden = !spectating;

  requestAnimationFrame(frame);
}

playBtn.addEventListener("click", () => {
  startGame();
});

multiplayerBtnEl.addEventListener("click", () => {
  openMultiplayerPage();
});

playAgainEl.addEventListener("click", () => {
  if (requestRematch()) {
    return;
  }
  startGame();
});

leaveRoomEl.addEventListener("click", leaveMultiplayerRoom);
mpReadyLeaveEl.addEventListener("click", leaveMultiplayerRoom);

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
