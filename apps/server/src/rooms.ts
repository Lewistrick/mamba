/**
 * In-memory multiplayer rooms and match lifecycle.
 */

import {
  Game,
  TICKS_PER_SECOND,
  type Direction,
  type FieldSizeId,
  type GameState,
} from "@mamba/engine";
import { generateRoomCode, normalizeRoomCode } from "./codes.ts";
import type { MpUser } from "./auth.ts";
import type {
  PublicRoomInfo,
  RoomPlayerInfo,
  RoomSnapshot,
  RoomStatus,
  RoomVisibility,
} from "./protocol.ts";

/** Connected seat. */
export interface Seat {
  user: MpUser;
  send: (data: string) => void;
}

/** One matchmaking room. */
export interface Room {
  code: string;
  sizeId: FieldSizeId;
  visibility: RoomVisibility;
  spectatable: boolean;
  status: RoomStatus;
  hostUserId: string;
  seats: (Seat | null)[];
  game: Game | null;
  tick: number;
  timer: ReturnType<typeof setInterval> | null;
  scoresSaved: boolean;
  eloApplied: boolean;
}

/** Result of creating a room. */
export type CreateResult =
  | { ok: true; room: Room }
  | { ok: false; error: string };

/** Result of joining a room. */
export type JoinResult =
  | { ok: true; room: Room; index: number }
  | { ok: false; error: string };

/**
 * Manages rooms keyed by code.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  /**
   * Creates a waiting room for the host.
   *
   * @param host - Host seat.
   * @param sizeId - Board size.
   * @param visibility - Public or private.
   * @returns New room or error.
   */
  create(
    host: Seat,
    sizeId: FieldSizeId,
    visibility: RoomVisibility,
  ): CreateResult {
    if (!["small", "medium", "large"].includes(sizeId)) {
      return { ok: false, error: "Invalid board size" };
    }
    let code = generateRoomCode();
    for (let i = 0; i < 20 && this.rooms.has(code); i += 1) {
      code = generateRoomCode();
    }
    if (this.rooms.has(code)) {
      return { ok: false, error: "Could not allocate a room code" };
    }
    const room: Room = {
      code,
      sizeId,
      visibility,
      spectatable: visibility === "public",
      status: "waiting",
      hostUserId: host.user.userId,
      seats: [host, null],
      game: null,
      tick: 0,
      timer: null,
      scoresSaved: false,
      eloApplied: false,
    };
    this.rooms.set(code, room);
    return { ok: true, room };
  }

  /**
   * Joins an existing waiting room as player 1.
   *
   * @param guest - Joining seat.
   * @param rawCode - Room code.
   * @returns Room or error.
   */
  join(guest: Seat, rawCode: string): JoinResult {
    const code = normalizeRoomCode(rawCode);
    if (!code) {
      return { ok: false, error: "Invalid room code" };
    }
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: "Room not found" };
    }
    if (room.status !== "waiting") {
      return { ok: false, error: "Room already started" };
    }
    if (room.seats[0]?.user.userId === guest.user.userId) {
      return { ok: false, error: "Already in this room" };
    }
    if (room.seats[1]) {
      return { ok: false, error: "Room is full" };
    }
    room.seats[1] = guest;
    return { ok: true, room, index: 1 };
  }

  /**
   * Lists public waiting rooms.
   *
   * @returns Listing rows.
   */
  listPublic(): PublicRoomInfo[] {
    const out: PublicRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== "public" || room.status !== "waiting") {
        continue;
      }
      const host = room.seats[0];
      if (!host) {
        continue;
      }
      out.push({
        code: room.code,
        sizeId: room.sizeId,
        hostName: host.user.displayName,
        playerCount: room.seats.filter(Boolean).length,
      });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Finds a room by code.
   *
   * @param code - Normalized code.
   * @returns Room or undefined.
   */
  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /**
   * Builds a client room snapshot.
   *
   * @param room - Room.
   * @returns Snapshot.
   */
  snapshot(room: Room): RoomSnapshot {
    const players: RoomPlayerInfo[] = [];
    for (let i = 0; i < room.seats.length; i += 1) {
      const seat = room.seats[i];
      if (!seat) {
        continue;
      }
      players.push({
        userId: seat.user.userId,
        displayName: seat.user.displayName,
        index: i,
      });
    }
    return {
      code: room.code,
      sizeId: room.sizeId,
      visibility: room.visibility,
      spectatable: room.spectatable,
      status: room.status,
      players,
      hostUserId: room.hostUserId,
    };
  }

  /**
   * Display names for both seats (empty string if missing).
   *
   * @param room - Room.
   * @returns Name pair.
   */
  names(room: Room): [string, string] {
    return [
      room.seats[0]?.user.displayName ?? "",
      room.seats[1]?.user.displayName ?? "",
    ];
  }

  /**
   * Starts the match when two players are seated.
   *
   * @param room - Waiting room with two seats.
   * @param onTick - Called each simulation tick with state.
   * @param onGameOver - Called when the run ends.
   * @returns Error message or null.
   */
  startMatch(
    room: Room,
    onTick: (room: Room, state: GameState) => void,
    onGameOver: (room: Room, state: GameState) => void,
  ): string | null {
    if (room.status !== "waiting") {
      return "Room already started";
    }
    if (!room.seats[0] || !room.seats[1]) {
      return "Need two players";
    }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    room.game = Game.versusHuman(room.sizeId, seed);
    room.status = "playing";
    room.tick = 0;
    room.scoresSaved = false;

    const stepMs = 1000 / TICKS_PER_SECOND;
    room.timer = setInterval(() => {
      if (!room.game || room.status !== "playing") {
        return;
      }
      const state = room.game.tick();
      room.tick += 1;
      onTick(room, state);
      if (state.status === "gameover") {
        this.finishMatch(room, state, onGameOver);
      }
    }, stepMs);

    onTick(room, room.game.getState());
    return null;
  }

  /**
   * Stops the tick loop and marks finished.
   *
   * @param room - Room.
   * @param state - Final state.
   * @param onGameOver - Callback.
   */
  finishMatch(
    room: Room,
    state: GameState,
    onGameOver: (room: Room, state: GameState) => void,
  ): void {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    room.status = "finished";
    onGameOver(room, state);
  }

  /**
   * Queues a direction for a seated player.
   *
   * @param room - Playing room.
   * @param playerIndex - 0 or 1.
   * @param dir - Direction.
   */
  queueInput(room: Room, playerIndex: number, dir: Direction): void {
    if (room.status !== "playing" || !room.game) {
      return;
    }
    room.game.queueDirection(playerIndex, dir);
  }

  /**
   * Queues input for whichever playing room contains the user.
   *
   * @param userId - Player id.
   * @param dir - Direction.
   */
  queueInputForUser(userId: string, dir: Direction): void {
    for (const room of this.rooms.values()) {
      if (room.status !== "playing") {
        continue;
      }
      const idx = room.seats.findIndex((s) => s?.user.userId === userId);
      if (idx >= 0) {
        this.queueInput(room, idx, dir);
        return;
      }
    }
  }

  /**
   * Removes a user from any room; closes empty rooms; ends match if mid-game.
   *
   * @param userId - Who left.
   * @param onGameOver - If leaving mid-match.
   * @returns Affected room codes.
   */
  leave(
    userId: string,
    onGameOver?: (room: Room, state: GameState) => void,
  ): string[] {
    const affected: string[] = [];
    for (const room of [...this.rooms.values()]) {
      const idx = room.seats.findIndex((s) => s?.user.userId === userId);
      if (idx < 0) {
        continue;
      }
      affected.push(room.code);

      if (room.status === "playing" && room.game) {
        const state = room.game.forfeit(idx);
        // Keep seats filled so score/Elo callbacks can see both players.
        this.finishMatch(room, state, onGameOver ?? (() => undefined));
      }

      room.seats[idx] = null;

      const remaining = room.seats.filter(Boolean).length;
      if (remaining === 0 || room.status === "finished") {
        if (room.timer) {
          clearInterval(room.timer);
        }
        this.rooms.delete(room.code);
      } else if (room.status === "waiting" && idx === 0) {
        // Host left while waiting — close room.
        this.rooms.delete(room.code);
      } else if (room.status === "waiting" && room.seats[0] === null && room.seats[1]) {
        // Should not happen (host is seat 0); close.
        this.rooms.delete(room.code);
      }
    }
    return affected;
  }

  /**
   * Winner index by highest score; null on tie or both dead with equal scores.
   *
   * @param state - Final state.
   * @returns 0, 1, or null.
   */
  static winnerIndex(state: GameState): number | null {
    if (state.players.length < 2) {
      return 0;
    }
    const a = state.players[0].score;
    const b = state.players[1].score;
    if (a === b) {
      return null;
    }
    return a > b ? 0 : 1;
  }
}
