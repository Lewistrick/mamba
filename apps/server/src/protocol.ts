/**
 * WebSocket JSON protocol for multiplayer.
 */

import type { Direction, FieldSizeId, GameState } from "@mamba/engine";

/** Room visibility. */
export type RoomVisibility = "public" | "private";

/** Lobby / match lifecycle. */
export type RoomStatus =
  | "waiting"
  | "readying"
  | "countdown"
  | "playing"
  | "finished";

/** Seat in a room. */
export interface RoomPlayerInfo {
  userId: string;
  displayName: string;
  index: number;
  ready: boolean;
}

/** Public listing row. */
export interface PublicRoomInfo {
  code: string;
  sizeId: FieldSizeId;
  hostName: string;
  playerCount: number;
}

/** Snapshot sent to clients. */
export interface RoomSnapshot {
  code: string;
  sizeId: FieldSizeId;
  visibility: RoomVisibility;
  spectatable: boolean;
  status: RoomStatus;
  players: RoomPlayerInfo[];
  hostUserId: string;
}

/** Client → server. */
export type ClientMessage =
  | { type: "auth"; accessToken: string }
  | { type: "create_room"; sizeId: FieldSizeId; visibility: RoomVisibility }
  | { type: "join_room"; code: string }
  | { type: "list_public" }
  | { type: "leave" }
  | { type: "set_ready"; ready: boolean }
  | { type: "input"; dir: Direction };

/** Server → client. */
export type ServerMessage =
  | { type: "auth_ok"; userId: string; displayName: string }
  | { type: "error"; message: string }
  | { type: "room"; room: RoomSnapshot }
  | { type: "public_rooms"; rooms: PublicRoomInfo[] }
  | {
      /** Both seated; board shown, waiting on Ready toggles. */
      type: "pregame";
      youIndex: number;
      state: GameState;
      names: [string, string];
      ready: [boolean, boolean];
    }
  | {
      /** Both ready — play local countdown audio; ticks begin after SEQUENCE_MS. */
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
      /** Elo before/after for this client and opponent (null if update failed). */
      elo: {
        you: { before: number; after: number; delta: number };
        opponent: { before: number; after: number; delta: number };
      } | null;
    };

/** Wall-clock length of client countdown audio (3×(0.5+0.5) + 1.0). */
export const COUNTDOWN_SEQUENCE_MS = 4000;
