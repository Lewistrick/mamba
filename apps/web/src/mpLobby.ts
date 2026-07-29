/**
 * Multiplayer lobby + match UI helpers wired from main.ts.
 */

import type { Direction, FieldSizeId, GameState } from "@mamba/engine";
import { getSession } from "./supabase.ts";
import {
  MpClient,
  mpWsUrl,
  remapStateForYou,
  type PublicRoomInfo,
  type RoomSnapshot,
  type RoomVisibility,
} from "./mpClient.ts";
import { submitScore } from "./leaderboard.ts";
import { gameOverScoreLines } from "./scoreBreakdown.ts";

/** Callbacks into the main shell. */
export interface MpUiHooks {
  setStatus: (text: string) => void;
  hideOverlays: () => void;
  showGameShell: () => void;
  onMatchState: (state: GameState, youIndex: number, names: [string, string]) => void;
  onMatchOver: (
    state: GameState,
    youIndex: number,
    names: [string, string],
    winnerIndex: number | null,
  ) => void;
  onMatchPlaying: (playing: boolean) => void;
}

/**
 * Owns lobby DOM + WS for multiplayer.
 */
export class MpLobbyController {
  private client: MpClient | null = null;
  private unsub: (() => void) | null = null;
  private room: RoomSnapshot | null = null;

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
    this.root.querySelector("#btn-mp-refresh")?.addEventListener("click", () => {
      this.client?.listPublic();
    });
    this.root.querySelector("#btn-mp-back")?.addEventListener("click", () => {
      this.close();
      this.hooks.showGameShell();
    });
  }

  /**
   * Whether a live MP match is in progress.
   */
  get inMatch(): boolean {
    return this.room?.status === "playing";
  }

  /**
   * Opens the lobby (connects if signed in).
   */
  async open(): Promise<void> {
    this.root.hidden = false;
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
      await this.client.connect(session.access_token);
    } catch (err) {
      if (status) {
        status.textContent = err instanceof Error ? err.message : "Connection failed";
      }
    }
  }

  /**
   * Leaves room and closes the socket.
   */
  close(): void {
    this.client?.leave();
    this.client?.close();
    this.client = null;
    this.unsub?.();
    this.unsub = null;
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
   * Sends a direction during a match.
   *
   * @param dir - Direction.
   */
  sendInput(dir: Direction): void {
    this.client?.sendInput(dir);
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
    if (!this.client?.connected) {
      await this.open();
    }
    this.client?.createRoom(this.selectedSize(), this.selectedVisibility());
  }

  private async joinRoom(): Promise<void> {
    if (!this.client?.connected) {
      await this.open();
    }
    const input = this.root.querySelector<HTMLInputElement>("#mp-join-code");
    const code = input?.value.trim() ?? "";
    this.client?.joinRoom(code);
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
      case "error":
        if (status) {
          status.textContent = msg.message;
        }
        this.hooks.setStatus(msg.message);
        break;
      case "room":
        this.room = msg.room;
        this.renderRoom(msg.room);
        break;
      case "public_rooms":
        this.renderPublic(msg.rooms);
        break;
      case "state": {
        const view = remapStateForYou(msg.state, msg.youIndex);
        this.hooks.onMatchState(view, msg.youIndex, msg.names);
        this.setMatchUi(true);
        break;
      }
      case "game_over": {
        const view = remapStateForYou(msg.state, msg.youIndex);
        this.hooks.onMatchOver(view, msg.youIndex, msg.names, msg.winnerIndex);
        this.setMatchUi(false);
        // Local leaderboard net for this player
        const you = msg.state.players[msg.youIndex];
        const opp = msg.state.players[1 - msg.youIndex];
        if (you && opp) {
          submitScore({
            name: msg.names[msg.youIndex] || "You",
            score: you.score - opp.score,
            level: you.level,
            sizeId: this.room?.sizeId ?? "medium",
            mode: "mp",
            createdAt: Date.now(),
          });
        }
        break;
      }
      default:
        break;
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
      // Show game shell under the mp page? Match uses main canvas — hide mp page chrome
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
      status.textContent =
        room.status === "waiting"
          ? `Waiting for opponent… ${names || "you"}`
          : `Room ${room.code}: ${names}`;
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-btn";
      btn.textContent = `${r.code} · ${r.sizeId} · ${r.hostName} (${r.playerCount}/2)`;
      btn.addEventListener("click", () => {
        this.client?.joinRoom(r.code);
      });
      li.append(btn);
      list.append(li);
    }
  }
}

/**
 * Formats an MP game-over summary including winner.
 *
 * @param state - Remapped local view state.
 * @param names - Seat names.
 * @param youIndex - Local seat.
 * @param winnerIndex - Absolute winner seat or null.
 * @returns Overlay text.
 */
export function mpGameOverText(
  state: GameState,
  names: [string, string],
  youIndex: number,
  winnerIndex: number | null,
): string {
  const lines = gameOverScoreLines(state, { opponentLabel: "Opp" });
  let result: string;
  if (winnerIndex === null) {
    result = "Draw";
  } else if (winnerIndex === youIndex) {
    result = "You win";
  } else {
    result = `${names[winnerIndex] || "Opponent"} wins`;
  }
  return `${result}\n${lines.join("\n")}`;
}
