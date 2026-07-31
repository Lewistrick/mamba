/**
 * Multiplayer lobby + match UI helpers wired from main.ts.
 */

import type { Direction, FieldSizeId, GameState } from "@mamba/engine";
import { versusNetScore } from "@mamba/engine";
import { getSession } from "./supabase.ts";
import {
  MpClient,
  mpWsUrl,
  remapStateForYou,
  type PublicRoomInfo,
  type RoomLastGame,
  type RoomSnapshot,
  type RoomVisibility,
} from "./mpClient.ts";
import { submitScore } from "./leaderboard.ts";

/** Reconnect attempts before giving up (with backoff, comfortably outlasts the server's 15s grace period). */
const RECONNECT_MAX_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 4000;
/** How long to wait for a "reconnected" message after auth succeeds before assuming the server's grace period already expired. */
const RECONNECT_CONFIRM_TIMEOUT_MS = 3000;

/**
 * Hides the multiplayer lobby after a match ends so GAME OVER can show alone
 * on the game shell (avoids stacking lobby + overlay side by side).
 *
 * @param mpPage - `#mp-page` root element.
 */
export function hideLobbyForMatchOver(mpPage: HTMLElement): void {
  mpPage.hidden = true;
}

/** Callbacks into the main shell. */
export interface MpUiHooks {
  setStatus: (text: string) => void;
  hideOverlays: () => void;
  showGameShell: () => void;
  playJoinSuccess: () => void;
  playMatchCountdown: () => void;
  onPregame: (
    state: GameState,
    youIndex: number,
    names: [string, string],
    ready: [boolean, boolean],
  ) => void;
  onCountdown: (state: GameState, youIndex: number, names: [string, string]) => void;
  onMatchState: (state: GameState, youIndex: number, names: [string, string]) => void;
  onMatchOver: (
    state: GameState,
    youIndex: number,
    names: [string, string],
    winnerIndex: number | null,
    elo: {
      you: { before: number; after: number; delta: number };
      opponent: { before: number; after: number; delta: number };
    } | null,
  ) => void;
  onMatchPlaying: (playing: boolean) => void;
  hideReadyOverlay: () => void;
  /**
   * Shows the game shell in a "waiting for opponent" state right after
   * creating a room. `code` is null for the initial (pre-server-ack) call.
   */
  onWaitingForOpponent: (code: string | null, sizeId: FieldSizeId) => void;
  onSpectateState: (
    state: GameState,
    names: [string, string],
    status: RoomSnapshot["status"],
  ) => void;
  /**
   * Spectating a room with no live game yet — either it hasn't started
   * ("waiting") or the last match just ended and a rematch hasn't started
   * ("finished"). Not called once real match content has been shown, so it
   * won't clobber the spectate_game_over table.
   */
  onSpectateWaiting: (
    sizeId: FieldSizeId,
    names: [string, string],
    status: "waiting" | "finished",
  ) => void;
  onSpectateGameOver: (
    state: GameState,
    names: [string, string],
    winnerIndex: number | null,
  ) => void;
  onSpectateEnded: (reason: string) => void;
  /** Player names + games-won tally for the standings panel (server-tracked). */
  onStandings: (names: [string, string], wins: [number, number]) => void;
  /** Most recent finished game for the standings panel, or null to show "no games yet". */
  onLastGame: (lastGame: RoomLastGame | null) => void;
  /**
   * Spectator join-queue status line for the standings panel, or null to
   * hide it (toggle off, or not queued).
   */
  onQueueInfo: (text: string | null) => void;
  /** Fresh room entry (create/join/watch) — optimistic clear before the server confirms. */
  onEnterRoom: () => void;
}

/**
 * Owns lobby DOM + WS for multiplayer.
 */
export class MpLobbyController {
  private client: MpClient | null = null;
  private unsub: (() => void) | null = null;
  private unsubClose: (() => void) | null = null;
  private room: RoomSnapshot | null = null;
  private openPromise: Promise<void> | null = null;
  private pregameShown = false;
  private countdownUiTimer: ReturnType<typeof setInterval> | null = null;
  /** Next pregame is a rematch — skip the “opponent joined” sound. */
  private expectRematchPregame = false;
  private spectating = false;
  private queued = false;
  /** True from room creation until an opponent seats (pregame) or we leave. */
  private awaitingOpponent = false;
  /**
   * True once real match content (a live board or a finished result) has
   * been shown this spectate session — gates onSpectateWaiting so a
   * redundant "room" broadcast doesn't clobber it.
   */
  private hasLiveContent = false;
  /**
   * True once at least one real "state" (tick) message has arrived for the
   * current match, until game_over/a fresh pregame/leaving. `room.status`
   * isn't reliable for this — the server only re-broadcasts a "room"
   * snapshot on lobby-ish events (ready toggles, join, etc.), not on every
   * tick, so it goes stale at "countdown" for the whole match. This is what
   * actually answers "was the socket mid-match when it dropped".
   */
  private matchTicking = false;
  /** True while auto-retrying a mid-match connection drop. */
  private reconnecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param root - #mp-page element.
   * @param hooks - Shell callbacks.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: MpUiHooks,
  ) {
    this.root.querySelector("#btn-mp-create")?.addEventListener("click", () => {
      void this.createRoom();
    });
    this.root.querySelector("#btn-mp-join")?.addEventListener("click", () => {
      void this.joinRoom();
    });
    this.root.querySelector("#btn-mp-watch")?.addEventListener("click", () => {
      void this.watchByCode();
    });
    this.root.querySelector("#btn-mp-refresh")?.addEventListener("click", () => {
      void this.ensureConnected().then(() => this.client?.listPublic());
    });
    this.root.querySelector("#btn-mp-back")?.addEventListener("click", () => {
      this.close();
      this.hooks.showGameShell();
    });

    const readyToggle = document.querySelector<HTMLInputElement>("#mp-ready-toggle");
    readyToggle?.addEventListener("change", () => {
      this.client?.setReady(Boolean(readyToggle.checked));
    });

    const queueToggle = document.querySelector<HTMLInputElement>("#mp-queue-toggle");
    queueToggle?.addEventListener("change", () => {
      if (queueToggle.checked) {
        this.client?.queueJoin();
      } else {
        this.client?.leaveQueue();
      }
    });
  }

  /**
   * Whether a live MP match is in progress.
   */
  get inMatch(): boolean {
    return this.room?.status === "playing";
  }

  /**
   * True when the last MP match finished and the socket is still in that room.
   */
  get canRematch(): boolean {
    return this.room?.status === "finished" && Boolean(this.client?.connected);
  }

  /**
   * Votes to return to the Ready phase after a finished multiplayer match.
   *
   * @returns True when the rematch request was sent (caller should not start solo).
   */
  requestPlayAgain(): boolean {
    if (!this.canRematch || !this.client) {
      return false;
    }
    this.expectRematchPregame = true;
    this.client.playAgain();
    this.hooks.setStatus("Play again 1/2 — waiting…");
    return true;
  }

  /**
   * Whether this client is currently a read-only spectator.
   */
  get isSpectating(): boolean {
    return this.spectating;
  }

  /**
   * Opens the lobby (connects if signed in).
   */
  async open(): Promise<void> {
    this.root.hidden = false;
    try {
      await this.ensureConnected();
    } catch {
      // Status text already set in connectFresh / create handlers.
    }
  }

  /**
   * Connects and waits for server auth_ok (shared across concurrent callers).
   */
  private async ensureConnected(): Promise<void> {
    if (this.client?.connected) {
      return;
    }
    if (this.openPromise) {
      await this.openPromise;
      return;
    }
    this.openPromise = this.connectFresh();
    try {
      await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  /**
   * Builds a new socket and authenticates.
   */
  private async connectFresh(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    const url = mpWsUrl();
    if (!url) {
      if (status) {
        status.textContent = "Set VITE_WS_URL to enable multiplayer";
      }
      return;
    }
    const session = await getSession();
    if (!session?.access_token) {
      if (status) {
        status.textContent = "Sign in with a username to play online 1v1";
      }
      return;
    }
    if (status) {
      status.textContent = "Connecting…";
    }
    try {
      this.client?.close();
      this.client = new MpClient(url);
      this.unsub?.();
      this.unsub = this.client.onMessage((msg) => this.onMessage(msg));
      this.unsubClose?.();
      this.unsubClose = this.client.onClose(() => this.onSocketClosed());
      await this.client.connect(session.access_token);
    } catch (err) {
      this.client = null;
      if (status) {
        status.textContent = err instanceof Error ? err.message : "Connection failed";
      }
      throw err;
    }
  }

  /**
   * Leaves room and closes the socket.
   */
  close(): void {
    this.openPromise = null;
    this.clearCountdownUi();
    this.clearReconnectState();
    this.matchTicking = false;
    this.pregameShown = false;
    this.spectating = false;
    this.resetQueueToggle();
    this.awaitingOpponent = false;
    this.hideSpectateOverlay();
    this.hooks.hideReadyOverlay();
    this.client?.leave();
    this.client?.close();
    this.client = null;
    this.unsub?.();
    this.unsub = null;
    this.unsubClose?.();
    this.unsubClose = null;
    this.room = null;
    this.hooks.onMatchPlaying(false);
    this.root.hidden = true;
    const codeEl = this.root.querySelector<HTMLElement>("#mp-code");
    if (codeEl) {
      codeEl.hidden = true;
    }
    const hint = this.root.querySelector<HTMLElement>("#mp-match-hint");
    const lobby = this.root.querySelector<HTMLElement>("#mp-lobby");
    if (hint) {
      hint.hidden = true;
    }
    if (lobby) {
      lobby.hidden = false;
    }
  }

  /**
   * Cancels any in-progress reconnect attempt/timers without touching room
   * state — used both by a successful reconnect and by close().
   */
  private clearReconnectState(): void {
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.reconnectConfirmTimer) {
      clearTimeout(this.reconnectConfirmTimer);
      this.reconnectConfirmTimer = null;
    }
  }

  /**
   * Fired when the socket drops without close() having been called. Only
   * mid-match drops get the auto-reconnect treatment — anything else (still
   * in the lobby, readying, etc.) falls through to the existing "connection
   * closed" error handling, since no match progress is at risk there.
   */
  private onSocketClosed(): void {
    if (!this.matchTicking || this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempt = 0;
    this.hooks.setStatus("Connection lost — reconnecting…");
    this.attemptReconnect();
  }

  /**
   * One reconnect attempt: re-authenticates, then waits briefly for the
   * server's "reconnected" confirmation (handled in onMessage). Retries with
   * capped backoff on failure to even connect; gives up after
   * {@link RECONNECT_MAX_ATTEMPTS} or if the confirmation never arrives
   * (the server's grace period already expired).
   */
  private attemptReconnect(): void {
    if (!this.reconnecting) {
      return;
    }
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > RECONNECT_MAX_ATTEMPTS) {
      this.giveUpReconnecting();
      return;
    }
    this.ensureConnected()
      .then(() => {
        if (!this.reconnecting) {
          return;
        }
        if (!this.client?.connected) {
          // connectFresh() no-op'd (e.g. session momentarily unavailable)
          // rather than actually connecting — treat like any other failure.
          this.scheduleReconnectRetry();
          return;
        }
        // auth succeeded — if the server still holds a disconnected seat for
        // us, "reconnected" arrives right behind auth_ok and is handled in
        // onMessage. If not (grace period already expired), nothing further
        // arrives, so give up once this window passes.
        this.reconnectConfirmTimer = setTimeout(() => {
          this.reconnectConfirmTimer = null;
          if (this.reconnecting) {
            this.giveUpReconnecting();
          }
        }, RECONNECT_CONFIRM_TIMEOUT_MS);
      })
      .catch(() => {
        this.scheduleReconnectRetry();
      });
  }

  /**
   * Schedules the next {@link attemptReconnect} call with capped exponential
   * backoff, unless reconnecting was cancelled in the meantime.
   */
  private scheduleReconnectRetry(): void {
    if (!this.reconnecting) {
      return;
    }
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempt - 1),
    );
    this.reconnectTimer = setTimeout(() => this.attemptReconnect(), delay);
  }

  /**
   * Reconnect budget exhausted, or the server confirmed the grace period
   * already lapsed — the match is gone. Return cleanly to the lobby instead
   * of leaving the UI stuck on "reconnecting…" forever.
   */
  private giveUpReconnecting(): void {
    this.close();
    this.hooks.setStatus("Your match ended while you were disconnected.");
    this.hooks.showGameShell();
  }

  /**
   * Sends a direction during a match.
   *
   * @param dir - Direction.
   */
  sendInput(dir: Direction): void {
    this.client?.sendInput(dir);
  }

  /**
   * Manual testing only: toggles freezing the local player's own snake.
   */
  toggleFreeze(): void {
    this.client?.toggleFreeze();
  }

  private selectedSize(): FieldSizeId {
    const el = this.root.querySelector<HTMLInputElement>(
      'input[name="mp-size"]:checked',
    );
    const v = el?.value;
    return v === "small" || v === "large" ? v : "medium";
  }

  private selectedVisibility(): RoomVisibility {
    const el = this.root.querySelector<HTMLInputElement>(
      'input[name="mp-visibility"]:checked',
    );
    return el?.value === "private" ? "private" : "public";
  }

  private async createRoom(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    try {
      await this.ensureConnected();
      if (!this.client?.connected) {
        return;
      }
      const sizeId = this.selectedSize();
      this.client.createRoom(sizeId, this.selectedVisibility());
      this.pregameShown = false;
      this.spectating = false;
      this.resetQueueToggle();
      this.awaitingOpponent = true;
      this.hooks.onEnterRoom();
      this.hideSpectateOverlay();
      this.hooks.hideReadyOverlay();
      this.hooks.onWaitingForOpponent(null, sizeId);
      this.setMatchUi(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create room";
      if (status) {
        status.textContent = message;
      }
      this.hooks.setStatus(message);
    }
  }

  private async joinRoom(): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    try {
      await this.ensureConnected();
      if (!this.client?.connected) {
        return;
      }
      const input = this.root.querySelector<HTMLInputElement>("#mp-join-code");
      const code = input?.value.trim() ?? "";
      this.hooks.onEnterRoom();
      this.client.joinRoom(code);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not join room";
      if (status) {
        status.textContent = message;
      }
      this.hooks.setStatus(message);
    }
  }

  /**
   * Watches a room by its code (from the "Join with code" field).
   */
  private async watchByCode(): Promise<void> {
    const input = this.root.querySelector<HTMLInputElement>("#mp-join-code");
    const code = input?.value.trim() ?? "";
    await this.watch(code);
  }

  /**
   * Starts read-only spectating of a public room.
   *
   * @param code - Room code.
   */
  async watch(code: string): Promise<void> {
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    try {
      await this.ensureConnected();
      if (!this.client?.connected) {
        return;
      }
      this.pregameShown = false;
      this.awaitingOpponent = false;
      this.resetQueueToggle();
      this.spectating = true;
      this.hasLiveContent = false;
      this.hooks.onEnterRoom();
      this.client.spectate(code);
    } catch (err) {
      this.spectating = false;
      const message = err instanceof Error ? err.message : "Could not watch room";
      if (status) {
        status.textContent = message;
      }
      this.hooks.setStatus(message);
    }
  }

  private hideSpectateOverlay(): void {
    const overlay = document.querySelector<HTMLElement>("#mp-spectate-overlay");
    if (overlay) {
      overlay.hidden = true;
    }
  }

  /**
   * Clears the join-queue toggle — used when leaving spectate mode entirely
   * (not on game-over, where the queue preference should persist into the
   * next match).
   */
  private resetQueueToggle(): void {
    this.queued = false;
    const toggle = document.querySelector<HTMLInputElement>("#mp-queue-toggle");
    if (toggle) {
      toggle.checked = false;
    }
    this.hooks.onQueueInfo(null);
  }

  /**
   * Updates the join-queue status line for the standings panel.
   */
  private syncQueueInfo(): void {
    if (!this.queued) {
      this.hooks.onQueueInfo(null);
      return;
    }
    const pos = this.room?.yourQueuePosition ?? null;
    if (pos === null) {
      this.hooks.onQueueInfo(null);
      return;
    }
    this.hooks.onQueueInfo(
      pos === 0
        ? "You'll join if either player leaves."
        : `${pos} spectator${pos === 1 ? "" : "s"} ahead of you.`,
    );
  }

  /**
   * Updates the spectate overlay copy while watching a match.
   *
   * @param names - Absolute seat names.
   * @param status - Room status driving the headline.
   */
  private syncSpectateOverlay(
    names: [string, string],
    status: RoomSnapshot["status"],
  ): void {
    const overlay = document.querySelector<HTMLElement>("#mp-spectate-overlay");
    const title = document.querySelector<HTMLElement>("#mp-spectate-title");
    if (!overlay) {
      return;
    }
    overlay.hidden = false;
    if (title) {
      const phase =
        status === "readying"
          ? "Readying up"
          : status === "countdown"
            ? "Starting"
            : "Watching";
      title.textContent = `${phase}: ${names[0] || "?"} vs ${names[1] || "?"}`;
    }
  }

  private onMessage(
    msg: import("./mpClient.ts").MpServerMessage,
  ): void {
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    switch (msg.type) {
      case "auth_ok":
        if (status) {
          status.textContent = `Signed in as ${msg.displayName}`;
        }
        this.client?.listPublic();
        break;
      case "reconnected": {
        this.clearReconnectState();
        this.room = msg.room;
        this.spectating = false;
        this.awaitingOpponent = false;
        // Resume, not a fresh entry — skip the "opponent joined" sound/flow.
        this.pregameShown = true;
        this.expectRematchPregame = false;
        this.renderRoom(msg.room);
        this.hooks.setStatus("Reconnected");
        this.setMatchUi(true);
        // The very next message is the authoritative catch-up (state), which
        // flows through the existing "state" handler below unchanged.
        this.client?.resendLastInput();
        break;
      }
      case "error":
        if (status) {
          status.textContent = msg.message;
        }
        this.hooks.setStatus(msg.message);
        if (this.spectating && !this.room) {
          // Spectate request failed before any room was confirmed.
          this.spectating = false;
        }
        break;
      case "room":
        this.room = msg.room;
        this.renderRoom(msg.room);
        {
          const bySeat = (i: number): string =>
            msg.room.players.find((p) => p.index === i)?.displayName ?? "";
          this.hooks.onStandings([bySeat(0), bySeat(1)], msg.room.wins);
          this.hooks.onLastGame(msg.room.lastGame);
        }
        if (msg.room.status === "playing") {
          // A player only ever learns their *opponent* is disconnected this
          // way — while your own seat is down you're not connected to
          // receive this broadcast at all, so no need to distinguish seats.
          const opponentDisconnected = msg.room.players.some((p) => p.disconnected);
          this.hooks.setStatus(opponentDisconnected ? "Opponent disconnected — reconnecting…" : "");
        }
        if (msg.room.status === "finished") {
          this.updateRematchStatus(msg.room);
        }
        if (msg.room.status === "waiting" && this.pregameShown) {
          // Opponent left before the match started — go back to "waiting for
          // opponent" instead of revealing the room browser next to the game
          // shell (that stacked the two screens side by side).
          this.pregameShown = false;
          this.awaitingOpponent = true;
          this.clearCountdownUi();
          this.hooks.hideReadyOverlay();
          this.hooks.onWaitingForOpponent(msg.room.code, msg.room.sizeId);
          this.setMatchUi(true);
        } else if (
          msg.room.status === "waiting" &&
          this.awaitingOpponent &&
          !this.spectating
        ) {
          // Room actually created (or code confirmed) — refresh the code now known.
          this.hooks.onWaitingForOpponent(msg.room.code, msg.room.sizeId);
        } else if (
          this.spectating &&
          !this.hasLiveContent &&
          (msg.room.status === "waiting" || msg.room.status === "finished")
        ) {
          // No live game to show yet — never started, or the match just
          // ended and no real content has been shown this session (once it
          // has, spectate_game_over owns the display; this won't clobber it).
          const bySeat = (i: number): string =>
            msg.room.players.find((p) => p.index === i)?.displayName ?? "";
          this.hooks.onSpectateWaiting(
            msg.room.sizeId,
            [bySeat(0), bySeat(1)],
            msg.room.status,
          );
          this.setMatchUi(true);
        }
        this.syncQueueInfo();
        break;
      case "public_rooms":
        this.renderPublic(msg.rooms);
        break;
      case "pregame": {
        // Arriving here always means we're seated (including just-promoted
        // spectators) — drop any spectator UI left over from watching.
        this.matchTicking = false;
        this.spectating = false;
        this.resetQueueToggle();
        this.awaitingOpponent = false;
        this.hideSpectateOverlay();
        const view = remapStateForYou(msg.state, msg.youIndex);
        if (!this.pregameShown) {
          this.pregameShown = true;
          if (!this.expectRematchPregame) {
            this.hooks.playJoinSuccess();
          }
        }
        this.expectRematchPregame = false;
        this.hooks.onPregame(view, msg.youIndex, msg.names, msg.ready);
        this.setMatchUi(true);
        this.syncReadyOverlay(msg.names, msg.youIndex, msg.ready, false);
        break;
      }
      case "countdown": {
        this.matchTicking = false;
        const view = remapStateForYou(msg.state, msg.youIndex);
        this.hooks.onCountdown(view, msg.youIndex, msg.names);
        this.hooks.playMatchCountdown();
        this.setMatchUi(true);
        this.syncReadyOverlay(msg.names, msg.youIndex, [true, true], true);
        this.runCountdownUi();
        break;
      }
      case "state": {
        this.matchTicking = true;
        const view = remapStateForYou(msg.state, msg.youIndex);
        this.clearCountdownUi();
        this.hooks.hideReadyOverlay();
        this.hooks.onMatchState(view, msg.youIndex, msg.names);
        this.setMatchUi(true);
        break;
      }
      case "game_over": {
        this.matchTicking = false;
        const view = remapStateForYou(msg.state, msg.youIndex);
        this.pregameShown = false;
        this.expectRematchPregame = false;
        this.clearCountdownUi();
        this.hooks.hideReadyOverlay();
        this.setMatchUi(false);
        // Keep lobby closed while GAME OVER shows on the game shell.
        hideLobbyForMatchOver(this.root);
        this.hooks.onMatchOver(
          view,
          msg.youIndex,
          msg.names,
          msg.winnerIndex,
          msg.elo ?? null,
        );
        const you = msg.state.players[msg.youIndex];
        const opp = msg.state.players[1 - msg.youIndex];
        if (you && opp) {
          submitScore({
            name: msg.names[msg.youIndex] || "You",
            score: versusNetScore(you, opp, true),
            level: you.level,
            sizeId: this.room?.sizeId ?? "medium",
            mode: "mp",
            createdAt: Date.now(),
          });
        }
        break;
      }
      case "spectate_state": {
        this.spectating = true;
        this.hasLiveContent = true;
        this.setMatchUi(true);
        this.syncSpectateOverlay(msg.names, msg.status);
        this.hooks.onSpectateState(msg.state, msg.names, msg.status);
        break;
      }
      case "spectate_game_over": {
        this.hasLiveContent = true;
        this.hideSpectateOverlay();
        this.hooks.onSpectateGameOver(msg.state, msg.names, msg.winnerIndex);
        break;
      }
      case "spectate_ended": {
        this.spectating = false;
        this.resetQueueToggle();
        this.hideSpectateOverlay();
        this.setMatchUi(false);
        this.root.hidden = false;
        this.hooks.onSpectateEnded(msg.reason);
        this.client?.listPublic();
        break;
      }
      case "queue_ack": {
        this.queued = msg.queued;
        const toggle = document.querySelector<HTMLInputElement>("#mp-queue-toggle");
        if (toggle) {
          toggle.checked = msg.queued;
        }
        this.syncQueueInfo();
        break;
      }
      default:
        break;
    }
  }

  /**
   * Updates the ready overlay copy and checkbox.
   *
   * @param names - Absolute seat names.
   * @param youIndex - Local seat.
   * @param ready - Ready flags.
   * @param counting - Countdown in progress.
   */
  private syncReadyOverlay(
    names: [string, string],
    youIndex: number,
    ready: [boolean, boolean],
    counting: boolean,
  ): void {
    const overlay = document.querySelector<HTMLElement>("#mp-ready-overlay");
    const joined = document.querySelector<HTMLElement>("#mp-ready-joined");
    const codeEl = document.querySelector<HTMLElement>("#mp-ready-code");
    const peer = document.querySelector<HTMLElement>("#mp-ready-peer");
    const toggle = document.querySelector<HTMLInputElement>("#mp-ready-toggle");
    const label = document.querySelector<HTMLElement>(".mp-ready-label");
    const countdown = document.querySelector<HTMLElement>("#mp-countdown");
    if (!overlay) {
      return;
    }
    overlay.hidden = false;
    // Both seats are filled now — the "share this code" step is done.
    if (codeEl) {
      codeEl.hidden = true;
    }
    const oppName = names[1 - youIndex] || "Opponent";
    if (joined) {
      joined.textContent = `${oppName} joined the room`;
    }
    if (peer) {
      const oppReady = ready[1 - youIndex];
      peer.textContent = counting
        ? "Get ready…"
        : oppReady
          ? `${oppName} is ready`
          : `Waiting for ${oppName}…`;
    }
    if (toggle && label) {
      label.hidden = counting;
      toggle.disabled = counting;
      toggle.checked = ready[youIndex];
    }
    if (countdown) {
      countdown.hidden = !counting;
    }
  }

  /**
   * Shows 3–2–1–GO synced with the countdown audio.
   */
  private runCountdownUi(): void {
    this.clearCountdownUi();
    const el = document.querySelector<HTMLElement>("#mp-countdown");
    if (!el) {
      return;
    }
    const steps = ["3", "2", "1", "GO"];
    let i = 0;
    el.hidden = false;
    el.textContent = steps[0];
    this.countdownUiTimer = setInterval(() => {
      i += 1;
      if (i >= steps.length) {
        this.clearCountdownUi();
        return;
      }
      el.textContent = steps[i];
    }, 1000);
  }

  private clearCountdownUi(): void {
    if (this.countdownUiTimer) {
      clearInterval(this.countdownUiTimer);
      this.countdownUiTimer = null;
    }
    const el = document.querySelector<HTMLElement>("#mp-countdown");
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
  }

  private setMatchUi(playing: boolean): void {
    this.hooks.onMatchPlaying(playing);
    const hint = this.root.querySelector<HTMLElement>("#mp-match-hint");
    const lobby = this.root.querySelector<HTMLElement>("#mp-lobby");
    if (hint) {
      hint.hidden = !playing;
    }
    if (lobby) {
      lobby.hidden = playing;
    }
    if (playing) {
      this.hooks.hideOverlays();
      this.root.hidden = true;
      this.hooks.showGameShell();
    }
  }

  private renderRoom(room: RoomSnapshot): void {
    const codeEl = this.root.querySelector<HTMLElement>("#mp-code");
    const status = this.root.querySelector<HTMLElement>("#mp-status");
    if (codeEl) {
      codeEl.hidden = false;
      codeEl.textContent = `Room code: ${room.code} (${room.visibility}) — ${room.players.length}/2`;
    }
    if (status) {
      const names = room.players.map((p) => p.displayName).join(" vs ");
      if (room.status === "waiting") {
        status.textContent = `Waiting for opponent… ${names || "you"}`;
      } else if (room.status === "readying") {
        status.textContent = `Ready up — ${names}`;
      } else if (room.status === "countdown") {
        status.textContent = `Starting — ${names}`;
      } else if (room.status === "finished") {
        const rematchCount = room.players.filter((p) => p.rematchWanted).length;
        status.textContent =
          rematchCount === 0
            ? `Match over — ${names}`
            : `Play again ${rematchCount}/2 — ${names}`;
      } else {
        status.textContent = `Room ${room.code}: ${names}`;
      }
    }
  }

  /**
   * Updates the game-shell status while waiting for a rematch vote.
   *
   * @param room - Finished room snapshot.
   */
  private updateRematchStatus(room: RoomSnapshot): void {
    const rematchCount = room.players.filter((p) => p.rematchWanted).length;
    if (rematchCount === 0) {
      return;
    }
    if (rematchCount < 2) {
      this.hooks.setStatus(`Play again ${rematchCount}/2 — waiting…`);
    }
  }

  private renderPublic(rooms: PublicRoomInfo[]): void {
    const list = this.root.querySelector<HTMLElement>("#mp-public-list");
    const empty = this.root.querySelector<HTMLElement>("#mp-public-empty");
    if (!list || !empty) {
      return;
    }
    list.replaceChildren();
    empty.hidden = rooms.length > 0;
    for (const r of rooms) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${r.code} · ${r.sizeId} · ${r.hostName} (${r.playerCount}/2)${
        r.status === "waiting" ? "" : ` · ${r.status}`
      }`;
      li.append(label);
      if (r.status === "waiting") {
        const joinBtn = document.createElement("button");
        joinBtn.type = "button";
        joinBtn.className = "mp-room-btn";
        joinBtn.textContent = "Join";
        joinBtn.addEventListener("click", () => {
          this.client?.joinRoom(r.code);
        });
        li.append(joinBtn);
      }
      const watchBtn = document.createElement("button");
      watchBtn.type = "button";
      watchBtn.className = "mp-room-btn";
      watchBtn.textContent = "Watch";
      watchBtn.addEventListener("click", () => {
        void this.watch(r.code);
      });
      li.append(watchBtn);
      list.append(li);
    }
  }
}

/**
 * "You win" / "Draw" / "{name} wins" summary line for the MP game-over screen.
 *
 * @param names - Absolute seat display names.
 * @param youIndex - Local seat.
 * @param winnerIndex - Absolute winner seat or null (draw).
 * @returns Result line.
 */
export function mpResultText(
  names: [string, string],
  youIndex: number,
  winnerIndex: number | null,
): string {
  if (winnerIndex === null) {
    return "Draw";
  }
  if (winnerIndex === youIndex) {
    return "You win";
  }
  return `${names[winnerIndex] || "Opponent"} wins`;
}

/**
 * "Draw" / "{name} wins" summary line for a spectator (no "you" perspective).
 *
 * @param names - Absolute seat display names.
 * @param winnerIndex - Absolute winner seat or null (draw).
 * @returns Result line.
 */
export function mpSpectateResultText(
  names: [string, string],
  winnerIndex: number | null,
): string {
  if (winnerIndex === null) {
    return "Draw";
  }
  return `${names[winnerIndex] || "Player " + (winnerIndex + 1)} wins`;
}

/**
 * "Elo 1200 → 1215 (+15)" summary line for the MP game-over screen.
 *
 * @param elo - Elo change for the local player.
 * @returns Formatted line, or null when no Elo change applies.
 */
export function mpEloText(
  elo: { before: number; after: number; delta: number } | null,
): string | null {
  if (elo == null) {
    return null;
  }
  return `Elo ${elo.before} → ${elo.after} (${elo.delta >= 0 ? "+" : ""}${elo.delta})`;
}
