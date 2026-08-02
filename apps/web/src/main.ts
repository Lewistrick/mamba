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
  type Point,
} from "@mamba/engine";
import { SoundBoard } from "./audio.ts";
import {
  fetchGlobalBoard,
  fetchGlobalBoardWindow,
  fetchGlobalStanding,
  fetchGlobalStandingExact,
  submitGlobalScore,
} from "./globalLeaderboard.ts";
import {
  getBoard,
  neighborRanks,
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
import { advancePredicted, queueLocalDirection } from "./predictedSelf.ts";
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
  isDisplayNameReserved,
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
/**
 * How long without a fresh multiplayer state message before the opponent's
 * snake is dimmed instead of assumed to keep moving — about 2–2.5× the
 * server's tick interval, so ordinary jitter doesn't flicker but a real
 * stutter dims within roughly one missed tick.
 */
const MP_OPPONENT_STALE_MS = 220;
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
const soloCountdownOverlay = document.querySelector<HTMLElement>("#solo-countdown-overlay");
const soloCountdown = document.querySelector<HTMLElement>("#solo-countdown");
const playBtnEl = document.querySelector<HTMLButtonElement>("#btn-play");
const multiplayerBtn = document.querySelector<HTMLButtonElement>("#btn-multiplayer");
const statusNode = document.querySelector<HTMLElement>("#status");
const lbPeriodSelect = document.querySelector<HTMLSelectElement>("#lb-period");
const lbScopeSelect = document.querySelector<HTMLSelectElement>("#lb-scope");
const lbList = document.querySelector<HTMLOListElement>("#lb-list");
const lbEmpty = document.querySelector<HTMLElement>("#lb-empty");
const lbHideGuestsField = document.querySelector<HTMLElement>("#lb-hide-guests-field");
const lbHideGuests = document.querySelector<HTMLInputElement>("#lb-hide-guests");
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
const guestGate = document.querySelector<HTMLElement>("#guest-gate");
const guestGateForm = document.querySelector<HTMLFormElement>("#guest-gate-form");
const guestGateNameInput = document.querySelector<HTMLInputElement>("#guest-gate-name");
const guestGateMsg = document.querySelector<HTMLElement>("#guest-gate-msg");
const guestChangeNameBtn = document.querySelector<HTMLButtonElement>("#btn-guest-change-name");
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
const mpRankedField = document.querySelector<HTMLElement>("#mp-ranked-field");
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
  !soloCountdownOverlay ||
  !soloCountdown ||
  !playBtnEl ||
  !multiplayerBtn ||
  !statusNode ||
  !lbPeriodSelect ||
  !lbScopeSelect ||
  !lbList ||
  !lbEmpty ||
  !lbHideGuestsField ||
  !lbHideGuests ||
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
  !guestGate ||
  !guestGateForm ||
  !guestGateNameInput ||
  !guestGateMsg ||
  !guestChangeNameBtn ||
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
  !mpRankedField ||
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
const soloCountdownOverlayEl = soloCountdownOverlay;
const soloCountdownEl = soloCountdown;
const playBtn = playBtnEl;
const multiplayerBtnEl = multiplayerBtn!;
const statusEl = statusNode;
const periodSelect = lbPeriodSelect;
const scopeSelect = lbScopeSelect;
const listEl = lbList;
const emptyEl = lbEmpty;
const lbHideGuestsFieldEl = lbHideGuestsField;
const lbHideGuestsEl = lbHideGuests;
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
const guestGateEl = guestGate;
const guestGateFormEl = guestGateForm;
const guestGateNameEl = guestGateNameInput;
const guestGateMsgEl = guestGateMsg;
const guestChangeNameEl = guestChangeNameBtn;
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
const mpRankedFieldEl = mpRankedField;
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
/**
 * Easter egg: secret hotkey A, solo/vs-AI only. While on, the game
 * auto-pauses the instant the yellow-pellet spawn search runs, labeling every
 * candidate cell it considered with dOpponent − dMolter; unpausing reveals
 * the board with the pellet already placed. A again turns admin mode off.
 */
let adminMode = false;
/** Candidate cells to label, or null when there's nothing to show. */
let adminCandidates: { pos: Point; diff: number }[] | null = null;
let accumulator = 0;
let paused = false;
/** True during the local 3-2-1-GO countdown before a Solo/vs-AI match ticks. */
let countingDown = false;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let lastTime = performance.now();
/**
 * Lightweight local prediction for the player's own snake in multiplayer —
 * lets a keypress move it immediately instead of waiting on a full server
 * round trip. Re-seeded from the authoritative state on every pregame/
 * countdown/state message; pellets, collisions, and scoring are never
 * predicted, only the body/direction/queued turns. See predictedSelf.ts.
 */
let predictedBody: Point[] = [];
let predictedDirection: Direction = "Right";
let predictedQueue: Direction[] = [];
/** Wall-clock time of the last authoritative multiplayer match update, for opponent staleness dimming. */
let lastMpStateAt = performance.now();
let signedInEmail: string | null = null;
/** True while the guest name gate is shown voluntarily (via "Change name"), not because it's required. */
let guestGateOpen = false;
/**
 * The most recently finished Solo/vs-AI run's saved score, used to highlight
 * it (green) in the Scores panel — cleared when a new run starts. Matched
 * against the currently selected board only when sizeId/mode agree; period
 * and scope are re-evaluated live since the run qualifies for all of them.
 * `localCreatedAt` identifies the row in the local board; `globalCreatedAt`
 * (server-assigned, set once the global submit resolves) identifies it in
 * the global board — two different clocks, two different keys, and ties on
 * score make an approximate match unsafe (could highlight someone else's row).
 */
let lastPlayedEntry: {
  sizeId: FieldSizeId;
  mode: GameMode;
  name: string;
  score: number;
  localCreatedAt: number;
  globalCreatedAt: number | null;
} | null = null;
let profile: Profile | null = null;
let profileStatRows: StatRow[] = [];
let selectedStatKey: string | null = null;
let profileStatSort: StatSort = { key: "size", dir: "asc" };
let profileChartXMode: ChartXMode = "date";

/**
 * Re-seeds local prediction from the authoritative multiplayer state (the
 * "snap" half of predict-and-snap) and marks it as fresh for opponent
 * staleness dimming.
 *
 * @param view - Authoritative state, already remapped so players[0] is you.
 */
/**
 * Pulls the yellow-pellet candidates out of a tick's events, if the search
 * ran this tick (admin-mode debug overlay only).
 *
 * @param events - This tick's events.
 * @returns Candidate cells with dOpponent − dMolter, or null if no search ran.
 */
function extractYellowCandidates(events: GameState["events"]): { pos: Point; diff: number }[] | null {
  for (const e of events) {
    if (e.type === "yellow_candidates") {
      return e.candidates.map((c) => ({ pos: { x: c.pos.x, y: c.pos.y }, diff: c.diff }));
    }
  }
  return null;
}

/**
 * Resyncs the local player's predicted body/direction to the authoritative
 * state.
 *
 * @param view - Authoritative state.
 * @param clearQueue - True to also discard any locally-queued-but-not-yet-
 * applied turn — only correct at a genuinely fresh match start (pregame/
 * countdown). During live play, `state` messages arrive far more often than
 * the player turns, so clearing the queue here would wipe out a turn the
 * server hasn't caught up to yet almost every time it happens — the snake
 * keeps going straight, then snaps into the turn only once the server's own
 * broadcast catches up, instead of turning smoothly.
 */
function resyncPrediction(view: GameState, clearQueue: boolean): void {
  const you = view.players[0];
  predictedBody = you.body.map((p) => ({ x: p.x, y: p.y }));
  predictedDirection = you.direction;
  if (clearQueue) {
    predictedQueue = [];
  }
  lastMpStateAt = performance.now();
}

/**
 * Splices the locally-predicted body/direction into `players[0]` for
 * rendering, when playing (not spectating) online. Everything else — the
 * opponent, pellets, walls, score — always comes straight from the
 * authoritative state; only the local player's own position is predicted.
 *
 * @param view - Authoritative state.
 * @returns View to render.
 */
function withPredictedSelf(view: GameState): GameState {
  if (!mpPlaying || spectating || view.players.length === 0) {
    return view;
  }
  const you = view.players[0];
  return {
    ...view,
    players: [{ ...you, body: predictedBody, direction: predictedDirection }, ...view.players.slice(1)],
    snake: predictedBody,
    direction: predictedDirection,
  };
}

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
    resyncPrediction(view, true);
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
    resyncPrediction(view, true);
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
    resyncPrediction(view, false);
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
  getGuestIdentity: () => {
    if (!settings.hasChosenName) {
      return null;
    }
    return { guestId: settings.guestId, displayName: settings.playerName };
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
 * Whether a guest must choose a name before Play/Multiplayer unlock.
 * Signed-in accounts never hit this — they're gated by needsUsername instead.
 */
function guestGateRequired(): boolean {
  return !signedInEmail && !settings.hasChosenName;
}

/**
 * Shows/hides the pre-play guest name gate: required (blocking) when a
 * guest hasn't chosen a name yet, or voluntarily reopened via "Change name".
 */
function syncGuestGate(): void {
  const show = guestGateRequired() || guestGateOpen;
  guestGateEl.hidden = !show;
  if (show) {
    guestGateNameEl.value = settings.playerName;
    setProfileMsg(guestGateMsgEl, null);
  }
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
  guestGateNameEl.value = settings.playerName;
  scopeSelect.value = settings.leaderboardScope;
  lbHideGuestsEl.checked = settings.hideGuestScores;
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
    yellowPellets: [],
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
  syncGuestGate();
  const blocked = needsUsername() || guestGateRequired();
  const title = needsUsername()
    ? "Set a username first"
    : guestGateRequired()
      ? "Choose a name first"
      : "";
  playBtn.disabled = blocked;
  playBtn.title = title;
  multiplayerBtnEl.hidden = false;
  multiplayerBtnEl.disabled = blocked;
  multiplayerBtnEl.title = title;
}

/**
 * Builds one leaderboard row, optionally highlighted as the local player's
 * own just-played score.
 *
 * @param rank - 1-based rank to display.
 * @param row - Score data.
 * @param isYou - Highlights the row green (this game's own score).
 */
function buildScoreRow(rank: number, row: ScoreEntry, isYou: boolean): HTMLLIElement {
  const li = document.createElement("li");
  if (isYou) {
    li.className = "you";
  }
  li.innerHTML = `<span class="rank">${rank}.</span><span class="name"></span><span class="score"></span>`;
  li.querySelector(".name")!.textContent = row.verified ? `✓ ${row.name}` : row.name;
  li.querySelector(".score")!.textContent = String(row.score);
  return li;
}

/**
 * Renders a score list into the leaderboard DOM. When `highlightRank` falls
 * outside `board` (the just-played score didn't place in the displayed top
 * N), `extraRows` are appended after a "···" separator so the player can
 * still see where they landed.
 *
 * @param board - Top-N rows to show.
 * @param highlightRank - 1-based rank of the local player's just-played
 * score, or null if there isn't one for the current filters.
 * @param extraRows - Rank-neighbor rows to append (already excludes ranks
 * covered by `board`); ignored when `highlightRank` is within `board`.
 */
function renderBoard(
  board: ScoreEntry[],
  highlightRank: number | null = null,
  extraRows: { rank: number; entry: ScoreEntry }[] = [],
): void {
  listEl.replaceChildren();
  if (board.length === 0 && extraRows.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent = "No scores yet";
    return;
  }
  emptyEl.hidden = true;
  board.forEach((row, index) => {
    const rank = index + 1;
    listEl.append(buildScoreRow(rank, row, rank === highlightRank));
  });
  if (extraRows.length > 0) {
    const separator = document.createElement("li");
    separator.className = "lb-separator";
    separator.textContent = "···";
    listEl.append(separator);
    for (const { rank, entry } of extraRows) {
      listEl.append(buildScoreRow(rank, entry, rank === highlightRank));
    }
  }
}

/**
 * Picks out the extra rank rows from a fetched/sliced window, keyed by
 * their 1-based rank (`windowStartRank` is the rank of `rows[0]`).
 */
function pickRanksFromWindow(
  ranks: number[],
  rows: ScoreEntry[],
  windowStartRank: number,
): { rank: number; entry: ScoreEntry }[] {
  const picked: { rank: number; entry: ScoreEntry }[] = [];
  for (const rank of ranks) {
    const entry = rows[rank - windowStartRank];
    if (entry) {
      picked.push({ rank, entry });
    }
  }
  return picked;
}

/**
 * Refreshes the visible leaderboard for the menu size + mode. If the last
 * Solo/vs-AI run matches the current size/mode, highlights it (green) even
 * when it falls outside the displayed top N, alongside its rank neighbors.
 */
async function refreshLeaderboard(): Promise<void> {
  const sizeId = selectedSizeId();
  const period = selectedPeriod();
  const mode = currentMode();
  const scope = selectedScope();
  lbHideGuestsFieldEl.hidden = scope !== "global";

  const highlight =
    lastPlayedEntry && lastPlayedEntry.sizeId === sizeId && lastPlayedEntry.mode === mode
      ? lastPlayedEntry
      : null;

  if (scope === "local") {
    const board = getBoard(sizeId, mode, period);
    if (!highlight) {
      renderBoard(board);
      return;
    }
    const full = getBoard(sizeId, mode, period, Date.now(), undefined, Number.POSITIVE_INFINITY);
    const rankIndex = full.findIndex(
      (row) =>
        row.createdAt === highlight.localCreatedAt &&
        row.score === highlight.score &&
        row.name === highlight.name,
    );
    if (rankIndex < 0) {
      renderBoard(board);
      return;
    }
    const rank = rankIndex + 1;
    const ranks = neighborRanks(rank, board.length, full.length);
    renderBoard(board, rank, pickRanksFromWindow(ranks, full, 1));
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
  const board = await fetchGlobalBoard(sizeId, mode, period, settings.hideGuestScores);
  if (!highlight || highlight.globalCreatedAt === null) {
    renderBoard(board);
    return;
  }
  // Exact (tie-broken) rank, not fetchGlobalStanding's tie-blind one — a
  // score tied with someone else's must still single out our own row.
  const standing = await fetchGlobalStandingExact(
    sizeId,
    mode,
    highlight.score,
    highlight.globalCreatedAt,
    period,
    settings.hideGuestScores,
  );
  if (!standing) {
    renderBoard(board);
    return;
  }
  const ranks = neighborRanks(standing.rank, board.length, standing.total);
  if (ranks.length === 0) {
    renderBoard(board, standing.rank);
    return;
  }
  const rankWindow = await fetchGlobalBoardWindow(
    sizeId,
    mode,
    period,
    ranks[0],
    ranks[ranks.length - 1],
    settings.hideGuestScores,
  );
  renderBoard(board, standing.rank, pickRanksFromWindow(ranks, rankWindow, ranks[0]));
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
    authStatusEl.textContent = settings.hasChosenName
      ? `Guest — playing as "${settings.playerName}"`
      : "Guest — choose a name to play";
    guestChangeNameEl.hidden = !settings.hasChosenName;
    mpRankedFieldEl.hidden = true;
    authFormEl.hidden = false;
    syncMagicLinkButton();
    syncPlayButton();
    if (screen === "profile") {
      showGameShell();
    }
    return;
  }

  guestChangeNameEl.hidden = true;
  mpRankedFieldEl.hidden = false;
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
  if (guestGateRequired()) {
    setStatus("Choose a name to play online, then try again");
    guestGateOpen = true;
    syncGuestGate();
    guestGateEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    guestGateNameEl.focus();
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
  leaveRoomEl.hidden = true;
  playAgainEl.hidden = false;
  playAgainWaitEl.hidden = true;
  goMpSummaryEl.hidden = true;
  goScoreEl.hidden = false;
  setGoSaveStatus(null);
}

/**
 * Shows the game-over overlay over the playfield.
 *
 * @param pending - Score + replay payload.
 */
function showGameOverOverlay(pending: PendingScore): void {
  overlayEl.hidden = false;
  leaveRoomEl.hidden = true;
  goMpSummaryEl.hidden = true;
  goScoreEl.hidden = false;
  goScoreEl.textContent = `Score: ${pending.score}`;
  setGoSaveStatus("Saving score…", "pending");
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

/**
 * Populates the level/score/time/win/net game-over table, shared by real
 * multiplayer and vs-AI.
 *
 * @param fair - Real multiplayer: opponent pellets are never deducted from
 * either column's net score. vs-AI (fair=false): each column's net score
 * deducts the other player's pellets, matching vs-AI's existing scoring.
 */
function renderMpGameOver(
  view: GameState,
  names: [string, string],
  youIndex: number,
  winnerIndex: number | null,
  elo: { before: number; after: number; delta: number } | null,
  resultText: string,
  fair = true,
): void {
  goScoreEl.hidden = true;
  goMpSummaryEl.hidden = false;
  goMpResultEl.textContent = resultText;

  const youWins = winnerIndex !== null && winnerIndex === youIndex;
  const oppWins = winnerIndex !== null && winnerIndex !== youIndex;
  const { youName, oppName, rows } = mpScoreTable(view, names, youIndex, fair);
  buildScoreTable(goMpTableEl, youName, oppName, rows, youWins, oppWins);

  const eloLine = mpEloText(elo);
  goMpEloEl.hidden = eloLine === null;
  goMpEloEl.textContent = eloLine ?? "";
  // The standings panel's last-game table is driven separately by
  // onLastGame (server-tracked, so it's correct for latecomers too) — the
  // "room" broadcast carrying it arrives before this game_over/onMatchOver.
}

/**
 * Saves a run to local + global boards under the given display name, then
 * reports the resulting global standing. Shared by the signed-in and guest
 * auto-save paths — they differ only in where the name comes from and
 * whether a guestId accompanies the global submission.
 *
 * @param pending - Score + replay payload.
 * @param name - Sanitized display name to save under.
 * @param guestId - Persisted guest id, or undefined for a signed-in submit.
 */
async function autoSaveScore(
  pending: PendingScore,
  name: string,
  guestId?: string,
): Promise<void> {
  const localCreatedAt = Date.now();
  submitScore({
    name,
    score: pending.score,
    level: pending.level,
    sizeId: pending.sizeId,
    mode: pending.mode,
    createdAt: localCreatedAt,
  });
  lastPlayedEntry = {
    sizeId: pending.sizeId,
    mode: pending.mode,
    name,
    score: pending.score,
    localCreatedAt,
    globalCreatedAt: null,
  };

  const { error, createdAt: globalCreatedAt } = await submitGlobalScore({
    seed: pending.seed,
    sizeId: pending.sizeId,
    mode: pending.mode,
    headings: pending.headings,
    headingsAi: pending.headingsAi,
    claimedScore: pending.score,
    claimedLevel: pending.level,
    displayName: name,
    guestId,
  });

  if (error) {
    setGoSaveStatus(`Global save failed: ${error}`, "error");
    setStatus(`Global save failed: ${error}`);
    await refreshLeaderboard();
    return;
  }
  if (globalCreatedAt !== undefined && lastPlayedEntry) {
    lastPlayedEntry = { ...lastPlayedEntry, globalCreatedAt };
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
 * Auto-saves a signed-in run to local + global boards.
 *
 * @param pending - Score + replay payload.
 */
async function autoSaveAccountScore(pending: PendingScore): Promise<void> {
  await autoSaveScore(pending, sanitizeName(profile?.displayName ?? "AAA"));
}

/**
 * Auto-saves a guest run to local + global boards under their chosen name.
 *
 * @param pending - Score + replay payload.
 */
async function autoSaveGuestScore(pending: PendingScore): Promise<void> {
  await autoSaveScore(pending, sanitizeName(settings.playerName), settings.guestId);
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
 * Shows a 3-2-1-GO countdown (matching multiplayer's look/audio) before the
 * tick loop starts, so a Solo/vs-AI match doesn't just snap into motion.
 */
function runLocalCountdown(): void {
  clearLocalCountdown();
  countingDown = true;
  sounds.playMatchCountdown();
  soloCountdownOverlayEl.hidden = false;
  const steps = ["3", "2", "1", "GO"];
  let i = 0;
  soloCountdownEl.textContent = steps[0];
  countdownTimer = setInterval(() => {
    i += 1;
    if (i >= steps.length) {
      clearLocalCountdown();
      return;
    }
    soloCountdownEl.textContent = steps[i];
  }, 1000);
}

/**
 * Cancels/hides the local pre-game countdown, letting the tick loop run.
 */
function clearLocalCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countingDown = false;
  soloCountdownOverlayEl.hidden = true;
  soloCountdownEl.textContent = "";
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
  if (guestGateRequired()) {
    setStatus("Choose a name before playing");
    guestGateOpen = true;
    syncGuestGate();
    guestGateNameEl.focus();
    return;
  }
  if (screen === "profile" || screen === "help" || screen === "multiplayer") {
    showGameShell();
  }
  hideGameOverOverlay();
  persistFromMenu();
  sounds.resume();
  paused = false;
  adminCandidates = null;
  lastPlayedEntry = null;
  // A prior multiplayer match can leave inMpRoom stuck true after game-over
  // (mpPlaying already flips false there, so the mpPlaying/spectating guard
  // above never catches it) — clear it so the Scores panel isn't hidden in
  // favor of the (now-stale) multiplayer standings sidebar.
  inMpRoom = false;
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
  runLocalCountdown();
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

  const isVersusAi = final.players.length > 1;
  const shortStatus = isVersusAi ? `Net ${score}` : `Score ${score}`;
  const displayName = signedInEmail
    ? sanitizeName(profile?.displayName ?? "AAA")
    : sanitizeName(settings.playerName);

  const renderSummary = (): void => {
    if (!isVersusAi) {
      goScoreEl.textContent = formatGameOverScore(final);
      return;
    }
    const winnerIndex =
      final.players[0].alive === final.players[1].alive
        ? null
        : final.players[0].alive
          ? 0
          : 1;
    const names: [string, string] = [displayName, "AI"];
    renderMpGameOver(
      final,
      names,
      0,
      winnerIndex,
      null,
      mpResultText(names, 0, winnerIndex),
      false,
    );
  };

  if (signedInEmail && profile?.usernameSet) {
    showGameOverOverlay(pending);
    renderSummary();
    void autoSaveAccountScore(pending);
  } else if (!signedInEmail) {
    showGameOverOverlay(pending);
    renderSummary();
    void autoSaveGuestScore(pending);
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
  if (!paused) {
    // Reveal the board (pellet already placed) instead of the admin-mode candidate labels.
    adminCandidates = null;
  }
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

  if (event.key === "Enter") {
    const readyOverlay = document.querySelector<HTMLElement>("#mp-ready-overlay");
    const readyToggle = document.querySelector<HTMLInputElement>("#mp-ready-toggle");
    if (readyOverlay && !readyOverlay.hidden && readyToggle && !readyToggle.disabled) {
      event.preventDefault();
      readyToggle.checked = !readyToggle.checked;
      readyToggle.dispatchEvent(new Event("change"));
      return;
    }
    if (screen !== "playing") {
      event.preventDefault();
      startGame();
    }
    return;
  }

  if (event.key === " ") {
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

  if (event.key === "a" || event.key === "A") {
    if (event.repeat || mpPlaying || spectating) {
      return;
    }
    event.preventDefault();
    adminMode = !adminMode;
    if (!adminMode && adminCandidates) {
      // Nothing left to review — resume instead of leaving the game stuck paused.
      adminCandidates = null;
      paused = false;
    }
    setStatus(adminMode ? "Admin mode on" : "Admin mode off");
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
      if (!spectating) {
        predictedQueue = queueLocalDirection(predictedDirection, predictedQueue, dir);
      }
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

  if (screen === "playing" && game && !paused && !mpPlaying && !countingDown) {
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
      if (adminMode) {
        const candidates = extractYellowCandidates(state.events);
        if (candidates) {
          adminCandidates = candidates;
          paused = true;
          accumulator = 0;
          break;
        }
      }
      if (state.status === "gameover") {
        onGameOver(state, game);
        break;
      }
    }
  }

  if (screen === "playing" && mpPlaying && !spectating && !paused && state) {
    accumulator += dt;
    const step = 1 / TICKS_PER_SECOND;
    while (accumulator >= step) {
      const predicted = advancePredicted(
        { body: predictedBody, direction: predictedDirection, queue: predictedQueue },
        state.width,
        state.height,
      );
      predictedBody = predicted.body;
      predictedDirection = predicted.direction;
      predictedQueue = predicted.queue;
      accumulator -= step;
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
  const renderState = state ? withPredictedSelf(state) : state;
  const dimOpponent =
    mpPlaying &&
    !spectating &&
    screen === "playing" &&
    !paused &&
    performance.now() - lastMpStateAt > MP_OPPONENT_STALE_MS;
  renderer.draw(screen === "menu" ? drawState : renderState, overlay, stageBudget(), {
    opponentLabel: aiBrain ? "AI" : "Opp",
    fair: mpPlaying || spectating,
    dimOpponent,
    adminCandidates: adminCandidates ?? undefined,
    titleScreen: screen === "menu",
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

guestGateFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    // sanitizeName() falls back to "AAA" for an empty input (useful for
    // display fallbacks elsewhere) — check the raw trimmed value first so a
    // blank submit is rejected instead of silently becoming "AAA".
    const raw = guestGateNameEl.value.replace(/\s+/g, " ").trim();
    if (!raw) {
      setProfileMsg(guestGateMsgEl, "Choose a name before playing", "error");
      return;
    }
    const name = sanitizeName(raw);
    guestGateNameEl.value = name;
    const submitBtn = guestGateFormEl.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
    }
    setProfileMsg(guestGateMsgEl, "Checking name…", "ok");
    try {
      if (await isDisplayNameReserved(name)) {
        setProfileMsg(
          guestGateMsgEl,
          "That name is taken by a verified player — choose another",
          "error",
        );
        return;
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
    settings.playerName = name;
    settings.hasChosenName = true;
    saveSettings(settings);
    guestGateOpen = false;
    syncGuestGate();
    syncPlayButton();
    void refreshAuthUi();
  })();
});

guestChangeNameEl.addEventListener("click", () => {
  guestGateOpen = true;
  syncGuestGate();
  guestGateNameEl.focus();
  guestGateNameEl.select();
});

periodSelect.addEventListener("change", () => {
  void refreshLeaderboard();
});

scopeSelect.addEventListener("change", () => {
  persistFromMenu();
  void refreshLeaderboard();
});

lbHideGuestsEl.addEventListener("change", () => {
  settings.hideGuestScores = lbHideGuestsEl.checked;
  saveSettings(settings);
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
