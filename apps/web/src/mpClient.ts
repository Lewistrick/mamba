/**
 * Multiplayer WebSocket client.
 */

import type { Direction, FieldSizeId, GameState } from "@mamba/engine";
import { versusNetScore } from "@mamba/engine";

/** Room visibility. */
export type RoomVisibility = "public" | "private";

/** Room lifecycle status. */
export type RoomStatus = "waiting" | "readying" | "countdown" | "playing" | "finished";

/** Room snapshot from the server. */
export interface RoomSnapshot {
  code: string;
  sizeId: FieldSizeId;
  visibility: RoomVisibility;
  spectatable: boolean;
  status: RoomStatus;
  players: {
    userId: string;
    displayName: string;
    index: number;
    ready: boolean;
    rematchWanted?: boolean;
    /** True while this seat's socket is down but still within the reconnect grace period. */
    disconnected?: boolean;
    /** True for a signed-in account with a locked username; false for a guest. */
    verified?: boolean;
  }[];
  hostUserId: string;
  /** Spectators currently queued to take the next vacated seat. */
  joinQueueLength: number;
  /** This client's own 0-based position in the join queue, or null if not queued. */
  yourQueuePosition: number | null;
  /** Games won per current seat index, for this seat pairing only. */
  wins: [number, number];
  /** Most recent finished game for the current seat pairing, or null. */
  lastGame: RoomLastGame | null;
  /** Verified-players-only room; a guest can watch but not join/queue into it. */
  ranked?: boolean;
}

/** Most recent finished game in a room, kept until the seat pairing changes. */
export interface RoomLastGame {
  state: GameState;
  names: [string, string];
  winnerIndex: number | null;
}

/** Public lobby row. */
export interface PublicRoomInfo {
  code: string;
  sizeId: FieldSizeId;
  hostName: string;
  playerCount: number;
  /** "waiting" rooms can be joined; any other (non-finished) status can only be watched. */
  status: RoomStatus;
  /** Verified-players-only room; a guest can watch but not join. */
  ranked: boolean;
}

/** Server → client messages. */
export type MpServerMessage =
  | { type: "auth_ok"; userId: string; displayName: string; verified: boolean }
  | {
      /** Sent right after auth_ok when this connection is re-attaching to a seat it disconnected from mid-match, instead of a fresh join. */
      type: "reconnected";
      youIndex: number;
      room: RoomSnapshot;
    }
  | { type: "error"; message: string }
  | { type: "room"; room: RoomSnapshot }
  | { type: "public_rooms"; rooms: PublicRoomInfo[] }
  | {
      type: "pregame";
      youIndex: number;
      state: GameState;
      names: [string, string];
      ready: [boolean, boolean];
    }
  | {
      type: "countdown";
      youIndex: number;
      state: GameState;
      names: [string, string];
    }
  | {
      type: "state";
      tick: number;
      youIndex: number;
      state: GameState;
      names: [string, string];
    }
  | {
      type: "game_over";
      youIndex: number;
      state: GameState;
      names: [string, string];
      winnerIndex: number | null;
      elo: {
        you: { before: number; after: number; delta: number };
        opponent: { before: number; after: number; delta: number };
      } | null;
    }
  | {
      /** Read-only board push while spectating; absolute seats, no youIndex. */
      type: "spectate_state";
      tick: number;
      status: RoomStatus;
      state: GameState;
      names: [string, string];
    }
  | {
      type: "spectate_game_over";
      state: GameState;
      names: [string, string];
      winnerIndex: number | null;
    }
  | { type: "spectate_ended"; reason: string }
  | { type: "queue_ack"; queued: boolean };

type Handler = (msg: MpServerMessage) => void;

/**
 * Thin WS wrapper for the multiplayer protocol.
 */
export class MpClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Set<Handler>();
  private readonly closeHandlers = new Set<() => void>();
  private authed = false;
  private isVerified = false;
  /** Set by close() right before it tears down the socket, so the close event can tell an intentional close apart from a genuine drop. */
  private intentionalClose = false;
  /** Most recently requested direction, kept even while the socket is down so it can be re-sent on reconnect. */
  private lastDir: Direction | null = null;

  /**
   * @param url - WebSocket URL (e.g. ws://localhost:8787/ws).
   */
  constructor(private readonly url: string) {}

  /**
   * Subscribes to server messages.
   *
   * @param handler - Callback.
   * @returns Unsubscribe.
   */
  onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Subscribes to a genuine mid-session connection drop — the socket was
   * authenticated and closed without close() being called first. Distinct
   * from a connect()-time failure, which rejects the connect() promise
   * instead of firing this.
   *
   * @param handler - Callback.
   * @returns Unsubscribe.
   */
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  /**
   * True when the socket is open and the server accepted auth.
   */
  get connected(): boolean {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * True once the server confirmed this connection is a verified (signed-in)
   * account, as opposed to a guest.
   */
  get verified(): boolean {
    return this.isVerified;
  }

  /**
   * Opens the socket and waits until the server confirms auth.
   *
   * @param auth - A signed-in Supabase session, or a guest identity
   * (persisted id + chosen name).
   */
  async connect(
    auth:
      | { kind: "account"; accessToken: string }
      | { kind: "guest"; guestId: string; displayName: string },
  ): Promise<void> {
    this.close();
    this.intentionalClose = false;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let settled = false;

      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.authed = false;
        reject(new Error(message));
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.authed = true;
        resolve();
      };

      ws.addEventListener("open", () => {
        if (auth.kind === "account") {
          this.send({ type: "auth", accessToken: auth.accessToken });
        } else {
          this.send({
            type: "guest_auth",
            guestId: auth.guestId,
            displayName: auth.displayName,
          });
        }
      });
      ws.addEventListener("error", () => {
        fail("Could not connect to multiplayer server");
      });
      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as MpServerMessage;
          if (msg.type === "auth_ok") {
            this.isVerified = msg.verified;
            succeed();
          } else if (msg.type === "error" && !this.authed && !settled) {
            fail(msg.message);
          }
          for (const h of this.handlers) {
            h(msg);
          }
        } catch {
          /* ignore */
        }
      });
      ws.addEventListener("close", () => {
        const wasAuthed = this.authed;
        const wasIntentional = this.intentionalClose;
        this.ws = null;
        this.authed = false;
        fail("Multiplayer connection closed");
        if (wasAuthed && !wasIntentional) {
          for (const h of [...this.closeHandlers]) {
            h();
          }
        }
      });
    });
  }

  /**
   * Closes the connection.
   */
  close(): void {
    this.intentionalClose = true;
    this.authed = false;
    this.isVerified = false;
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Creates a room.
   *
   * @param sizeId - Board size.
   * @param visibility - Public or private.
   * @param ranked - Verified-players-only room; ignored unless this client is verified.
   */
  createRoom(sizeId: FieldSizeId, visibility: RoomVisibility, ranked = false): void {
    this.send({ type: "create_room", sizeId, visibility, ranked });
  }

  /**
   * Joins by code.
   *
   * @param code - Room code.
   */
  joinRoom(code: string): void {
    this.send({ type: "join_room", code });
  }

  /**
   * Requests the public room list.
   */
  listPublic(): void {
    this.send({ type: "list_public" });
  }

  /**
   * Leaves the current room.
   */
  leave(): void {
    this.send({ type: "leave" });
  }

  /**
   * Toggles ready during the pregame phase.
   *
   * @param ready - Desired ready state.
   */
  setReady(ready: boolean): void {
    this.send({ type: "set_ready", ready });
  }

  /**
   * Votes to rematch after a finished match (both players must vote).
   */
  playAgain(): void {
    this.send({ type: "play_again" });
  }

  /**
   * Sends a movement input.
   *
   * @param dir - Direction.
   */
  sendInput(dir: Direction): void {
    this.lastDir = dir;
    this.send({ type: "input", dir });
  }

  /**
   * Re-sends the most recently requested direction, if any — used right
   * after reconnecting, since a direction requested while the socket was
   * down never reached the server.
   */
  resendLastInput(): void {
    if (this.lastDir) {
      this.send({ type: "input", dir: this.lastDir });
    }
  }

  /**
   * Starts read-only spectating of a public room.
   *
   * @param code - Room code.
   */
  spectate(code: string): void {
    this.send({ type: "spectate", code });
  }

  /**
   * Stops spectating (also leaves the join queue server-side).
   */
  stopSpectate(): void {
    this.send({ type: "stop_spectate" });
  }

  /**
   * Joins the queue to take the next seat vacated in the spectated room.
   */
  queueJoin(): void {
    this.send({ type: "queue_join" });
  }

  /**
   * Leaves the join queue; keeps spectating.
   */
  leaveQueue(): void {
    this.send({ type: "leave_queue" });
  }

  /**
   * Manual testing only: toggles freezing the sender's own snake in place.
   */
  toggleFreeze(): void {
    this.send({ type: "toggle_freeze" });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * Remaps engine state so local player is always index 0 for HUD/renderer.
 *
 * @param state - Server state.
 * @param youIndex - Local seat.
 * @returns View state.
 */
export function remapStateForYou(state: GameState, youIndex: number): GameState {
  if (youIndex === 0 || state.players.length < 2) {
    return state;
  }
  const you = state.players[1];
  const opp = state.players[0];
  return {
    ...state,
    players: [you, opp],
    snake: you.body,
    direction: you.direction,
    score: you.score,
    survivalScore: you.survivalScore,
    winBonus: you.winBonus,
    level: you.level,
    netScore: versusNetScore(you, opp, true),
  };
}

/**
 * Resolves the WebSocket URL from Vite env.
 *
 * @returns URL or null if unset.
 */
export function mpWsUrl(): string | null {
  const raw = import.meta.env.VITE_WS_URL as string | undefined;
  if (!raw?.trim()) {
    return null;
  }
  return raw.replace(/\/$/, "") + (raw.includes("/ws") ? "" : "/ws");
}
