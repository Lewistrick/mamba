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
  }[];
  hostUserId: string;
  /** Spectators currently queued to take the next vacated seat. */
  joinQueueLength: number;
  /** This client's own 0-based position in the join queue, or null if not queued. */
  yourQueuePosition: number | null;
}

/** Public lobby row. */
export interface PublicRoomInfo {
  code: string;
  sizeId: FieldSizeId;
  hostName: string;
  playerCount: number;
  /** "waiting" rooms can be joined; any other (non-finished) status can only be watched. */
  status: RoomStatus;
}

/** Server → client messages. */
export type MpServerMessage =
  | { type: "auth_ok"; userId: string; displayName: string }
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
  private authed = false;

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
   * True when the socket is open and the server accepted auth.
   */
  get connected(): boolean {
    return this.authed && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Opens the socket and waits until the server confirms auth.
   *
   * @param accessToken - Supabase JWT.
   */
  async connect(accessToken: string): Promise<void> {
    this.close();
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
        this.send({ type: "auth", accessToken });
      });
      ws.addEventListener("error", () => {
        fail("Could not connect to multiplayer server");
      });
      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as MpServerMessage;
          if (msg.type === "auth_ok") {
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
        this.ws = null;
        this.authed = false;
        fail("Multiplayer connection closed");
      });
    });
  }

  /**
   * Closes the connection.
   */
  close(): void {
    this.authed = false;
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Creates a room.
   *
   * @param sizeId - Board size.
   * @param visibility - Public or private.
   */
  createRoom(sizeId: FieldSizeId, visibility: RoomVisibility): void {
    this.send({ type: "create_room", sizeId, visibility });
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
    this.send({ type: "input", dir });
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
