/**
 * WebSocket JSON protocol for multiplayer.
 */

import type { Direction, FieldSizeId, GameState } from "@mamba/engine";

/** Room visibility. */
export type RoomVisibility = "public" | "private";

/** Lobby / match lifecycle. */
export type RoomStatus = "waiting" | "playing" | "finished";

/** Seat in a room. */
export interface RoomPlayerInfo {
  userId: string;
  displayName: string;
  index: number;
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
  | { type: "input"; dir: Direction };

/** Server → client. */
export type ServerMessage =
  | { type: "auth_ok"; userId: string; displayName: string }
  | { type: "error"; message: string }
  | { type: "room"; room: RoomSnapshot }
  | { type: "public_rooms"; rooms: PublicRoomInfo[] }
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
    };
