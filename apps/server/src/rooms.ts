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
  RoomLastGame,
  RoomPlayerInfo,
  RoomSnapshot,
  RoomStatus,
  RoomVisibility,
  ServerMessage,
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
  ready: [boolean, boolean];
  /** Post-match rematch votes (cleared when returning to readying). */
  rematch: [boolean, boolean];
  game: Game | null;
  tick: number;
  timer: ReturnType<typeof setInterval> | null;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  scoresSaved: boolean;
  eloApplied: boolean;
  /** Per-seat: true while that player's socket is down but within the reconnect grace period. */
  disconnected: [boolean, boolean];
  /** Pending forfeit-on-expiry timer per seat, or null if not disconnected. */
  disconnectTimer: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  /** Read-only viewers of a public room. */
  spectators: Seat[];
  /** Spectators who asked to take the next vacated seat, in arrival order. */
  joinQueue: Seat[];
  /** Games won per current seat index — reset when the seat pairing changes. */
  wins: [number, number];
  /** Most recent finished game for the current seat pairing, or null. */
  lastGame: RoomLastGame | null;
  /** Sorted userId pair `wins`/`lastGame` apply to, or null before any pairing. */
  pairing: string | null;
  /** Verified-players-only room; a guest can watch but not join/queue into it. */
  ranked: boolean;
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
   * @param ranked - Verified-players-only room; forced false unless the host is verified.
   * @returns New room or error.
   */
  create(
    host: Seat,
    sizeId: FieldSizeId,
    visibility: RoomVisibility,
    ranked = false,
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
      ready: [false, false],
      rematch: [false, false],
      game: null,
      tick: 0,
      timer: null,
      countdownTimer: null,
      scoresSaved: false,
      eloApplied: false,
      disconnected: [false, false],
      disconnectTimer: [null, null],
      spectators: [],
      joinQueue: [],
      wins: [0, 0],
      lastGame: null,
      pairing: null,
      ranked: ranked && host.user.verified,
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
    if (room.ranked && !guest.user.verified) {
      return { ok: false, error: "This room is for verified players only" };
    }
    room.seats[1] = guest;
    return { ok: true, room, index: 1 };
  }

  /**
   * Finds the room and seat index for a user.
   *
   * @param userId - Player id.
   * @returns Room + index, or null.
   */
  findSeat(
    userId: string,
  ): { room: Room; index: number } | null {
    for (const room of this.rooms.values()) {
      const index = room.seats.findIndex((s) => s?.user.userId === userId);
      if (index >= 0) {
        return { room, index };
      }
    }
    return null;
  }

  /**
   * Finds the room a user is spectating.
   *
   * @param userId - Viewer id.
   * @returns Room + spectator seat, or null.
   */
  findSpectator(userId: string): { room: Room; seat: Seat } | null {
    for (const room of this.rooms.values()) {
      const seat = room.spectators.find((s) => s.user.userId === userId);
      if (seat) {
        return { room, seat };
      }
    }
    return null;
  }

  /**
   * Finds a room by a raw (possibly loosely formatted) code.
   *
   * @param rawCode - User-entered or listed code.
   * @returns Room or undefined.
   */
  findByCode(rawCode: string): Room | undefined {
    const code = normalizeRoomCode(rawCode);
    return code ? this.rooms.get(code) : undefined;
  }

  /**
   * Adds a user as a read-only spectator of a public room; idempotent.
   *
   * @param room - Room to watch.
   * @param seat - Viewer (send fn + identity).
   * @returns Error message or null.
   */
  addSpectator(room: Room, seat: Seat): string | null {
    if (!room.spectatable) {
      return "This room cannot be spectated";
    }
    if (room.seats.some((s) => s?.user.userId === seat.user.userId)) {
      return "You are playing in this room";
    }
    const existing = room.spectators.findIndex(
      (s) => s.user.userId === seat.user.userId,
    );
    if (existing >= 0) {
      room.spectators[existing] = seat;
    } else {
      room.spectators.push(seat);
    }
    return null;
  }

  /**
   * Removes a user from spectating (and from the join queue) a room.
   *
   * @param room - Room.
   * @param userId - Viewer id.
   */
  removeSpectator(room: Room, userId: string): void {
    room.spectators = room.spectators.filter((s) => s.user.userId !== userId);
    room.joinQueue = room.joinQueue.filter((s) => s.user.userId !== userId);
  }

  /**
   * Removes a user from spectating/queueing across every room (disconnect cleanup).
   *
   * @param userId - Viewer id.
   */
  removeSpectatorEverywhere(userId: string): void {
    for (const room of this.rooms.values()) {
      this.removeSpectator(room, userId);
    }
  }

  /**
   * Queues a spectator to take the next seat vacated in this room.
   *
   * @param room - Room being spectated.
   * @param userId - Viewer id (must already be spectating).
   * @returns Error message or null.
   */
  queueJoin(room: Room, userId: string): string | null {
    const seat = room.spectators.find((s) => s.user.userId === userId);
    if (!seat) {
      return "Not spectating this room";
    }
    if (room.ranked && !seat.user.verified) {
      return "This room is for verified players only";
    }
    if (!room.joinQueue.some((s) => s.user.userId === userId)) {
      room.joinQueue.push(seat);
    }
    return null;
  }

  /**
   * Removes a user from the join queue; they keep spectating.
   *
   * @param room - Room.
   * @param userId - Viewer id.
   */
  leaveQueue(room: Room, userId: string): void {
    room.joinQueue = room.joinQueue.filter((s) => s.user.userId !== userId);
  }

  /**
   * Pops the next queued spectator, removing them from the spectator list too.
   *
   * @param room - Room.
   * @returns The next seat to promote, or null if the queue is empty.
   */
  private shiftQueue(room: Room): Seat | null {
    const next = room.joinQueue.shift();
    if (!next) {
      return null;
    }
    room.spectators = room.spectators.filter(
      (s) => s.user.userId !== next.user.userId,
    );
    return next;
  }

  /**
   * Tells every current spectator a room is gone.
   *
   * @param room - Room about to be removed.
   * @param reason - Shown to spectators.
   */
  private notifySpectatorsEnded(room: Room, reason: string): void {
    const msg: ServerMessage = { type: "spectate_ended", reason };
    for (const spec of room.spectators) {
      spec.send(JSON.stringify(msg));
    }
  }

  /**
   * Lists public rooms — "waiting" ones can be joined, others only watched.
   *
   * @returns Listing rows.
   */
  listPublic(): PublicRoomInfo[] {
    const out: PublicRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== "public") {
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
        status: room.status,
        ranked: room.ranked,
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
   * @param forUserId - Recipient's user id, to fill in their own queue
   * position. Omit for snapshots not tied to one recipient (e.g. logging).
   * @returns Snapshot.
   */
  snapshot(room: Room, forUserId?: string): RoomSnapshot {
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
        ready: room.ready[i] ?? false,
        rematchWanted: room.rematch[i] ?? false,
        disconnected: room.disconnected[i] ?? false,
        verified: seat.user.verified,
      });
    }
    const queuePos = forUserId
      ? room.joinQueue.findIndex((s) => s.user.userId === forUserId)
      : -1;
    return {
      code: room.code,
      sizeId: room.sizeId,
      visibility: room.visibility,
      spectatable: room.spectatable,
      status: room.status,
      players,
      hostUserId: room.hostUserId,
      joinQueueLength: room.joinQueue.length,
      yourQueuePosition: queuePos >= 0 ? queuePos : null,
      wins: [...room.wins] as [number, number],
      lastGame: room.lastGame,
      ranked: room.ranked,
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
   * Creates the shared board when both seats are filled (no ticks yet).
   *
   * @param room - Waiting room with two seats.
   * @returns Error message or null.
   */
  enterPregame(room: Room): string | null {
    if (room.status !== "waiting") {
      return "Room already started";
    }
    if (!room.seats[0] || !room.seats[1]) {
      return "Need two players";
    }
    this.clearCountdown(room);
    const seed = (Math.random() * 0xffffffff) >>> 0;
    room.game = Game.versusHuman(room.sizeId, seed);
    room.status = "readying";
    room.ready = [false, false];
    room.rematch = [false, false];
    room.tick = 0;
    room.scoresSaved = false;
    room.eloApplied = false;
    this.clearDisconnectState(room);
    const pairing = [room.seats[0].user.userId, room.seats[1].user.userId]
      .sort()
      .join(",");
    if (pairing !== room.pairing) {
      // A departed player was replaced by someone new — a rematch between
      // the same two keeps the same pairing and the running tally.
      room.wins = [0, 0];
      room.lastGame = null;
    }
    room.pairing = pairing;
    return null;
  }

  /**
   * Records a finished game's result on the room (wins tally + last-game
   * snapshot), for players/spectators who join later.
   *
   * @param room - Finished room.
   * @param winnerIndex - Absolute winner seat, or null for a draw.
   * @param state - Final engine state.
   * @param names - Absolute seat display names.
   */
  recordResult(
    room: Room,
    winnerIndex: number | null,
    state: GameState,
    names: [string, string],
  ): void {
    if (winnerIndex !== null) {
      room.wins[winnerIndex] += 1;
    }
    room.lastGame = { state, names, winnerIndex };
  }

  /**
   * Records a rematch vote after a finished match; when both seats vote,
   * resets the room into the Ready (pregame) phase.
   *
   * @param room - Finished room with two seats.
   * @param playerIndex - Seat that clicked Play again.
   * @returns `"readying"` when both voted, `"waiting"` when still one vote short, or an error string.
   */
  requestRematch(
    room: Room,
    playerIndex: number,
  ): "readying" | "waiting" | string {
    if (room.status !== "finished") {
      return "Match is not finished";
    }
    if (playerIndex !== 0 && playerIndex !== 1) {
      return "Invalid seat";
    }
    if (!room.seats[0] || !room.seats[1]) {
      return "Opponent left the room";
    }
    if (!room.seats[playerIndex]) {
      return "Not seated";
    }
    room.rematch[playerIndex] = true;
    if (!room.rematch[0] || !room.rematch[1]) {
      return "waiting";
    }
    const err = this.resetToPregame(room);
    return err ?? "readying";
  }

  /**
   * Rebuilds a fresh versus board and returns to the readying phase.
   *
   * @param room - Finished room with both seats filled.
   * @returns Error message or null.
   */
  resetToPregame(room: Room): string | null {
    if (room.status !== "finished") {
      return "Match is not finished";
    }
    if (!room.seats[0] || !room.seats[1]) {
      return "Need two players";
    }
    this.clearCountdown(room);
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    const seed = (Math.random() * 0xffffffff) >>> 0;
    room.game = Game.versusHuman(room.sizeId, seed);
    room.status = "readying";
    room.ready = [false, false];
    room.rematch = [false, false];
    room.tick = 0;
    room.scoresSaved = false;
    room.eloApplied = false;
    this.clearDisconnectState(room);
    return null;
  }

  /**
   * Sets a player's ready flag during the readying phase.
   *
   * @param room - Room in readying.
   * @param playerIndex - Seat index.
   * @param ready - Desired ready state.
   * @returns Error or null.
   */
  setReady(room: Room, playerIndex: number, ready: boolean): string | null {
    if (room.status !== "readying") {
      return "Ready can only be set before the countdown";
    }
    if (playerIndex !== 0 && playerIndex !== 1) {
      return "Invalid seat";
    }
    if (!room.seats[playerIndex]) {
      return "Not seated";
    }
    room.ready[playerIndex] = ready;
    return null;
  }

  /**
   * True when both seated players are ready.
   *
   * @param room - Room.
   */
  bothReady(room: Room): boolean {
    return Boolean(room.seats[0] && room.seats[1] && room.ready[0] && room.ready[1]);
  }

  /**
   * Marks countdown phase (ticks not started yet).
   *
   * @param room - Readying room with both ready.
   * @returns Error or null.
   */
  beginCountdown(room: Room): string | null {
    if (room.status === "countdown") {
      return null;
    }
    if (room.status !== "readying" || !this.bothReady(room)) {
      return "Both players must be ready";
    }
    if (!room.game) {
      return "No game prepared";
    }
    room.status = "countdown";
    return null;
  }

  /**
   * Starts the tick loop after countdown (game already created in pregame).
   *
   * @param room - Countdown room.
   * @param onTick - Called each simulation tick with state.
   * @param onGameOver - Called when the run ends.
   * @returns Error message or null.
   */
  startMatch(
    room: Room,
    onTick: (room: Room, state: GameState) => void,
    onGameOver: (room: Room, state: GameState) => void,
  ): string | null {
    if (room.status !== "countdown") {
      return "Countdown has not finished";
    }
    if (!room.seats[0] || !room.seats[1] || !room.game) {
      return "Need two players and a prepared board";
    }
    this.clearCountdown(room);
    room.status = "playing";
    room.tick = 0;

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
   * Clears a pending countdown timeout.
   *
   * @param room - Room.
   */
  clearCountdown(room: Room): void {
    if (room.countdownTimer) {
      clearTimeout(room.countdownTimer);
      room.countdownTimer = null;
    }
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
    this.clearCountdown(room);
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    room.status = "finished";
    room.rematch = [false, false];
    // The match can end here while a disconnected seat's grace timer is
    // still pending (e.g. their snake died on its own, mid-disconnect, from
    // continuing straight) — clear it so it can't also fire a stale forfeit
    // against an already-finished match.
    this.clearDisconnectState(room);
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
   * Toggles the freeze state for whichever seated player this user is, in
   * whatever room they're currently playing. Manual testing only — lets a
   * player pause their own snake in place while the opponent keeps playing.
   *
   * @param userId - Player id.
   */
  toggleFreezeForUser(userId: string): void {
    for (const room of this.rooms.values()) {
      if (room.status !== "playing" || !room.game) {
        continue;
      }
      const idx = room.seats.findIndex((s) => s?.user.userId === userId);
      if (idx >= 0) {
        room.game.setFrozen(idx, !room.game.isFrozen(idx));
        return;
      }
    }
  }

  /**
   * Clears any pending grace-period timer and resets both seats' disconnect
   * flags. Safe to call even when nothing is pending.
   *
   * @param room - Room.
   */
  private clearDisconnectState(room: Room): void {
    for (let i = 0; i < 2; i += 1) {
      const timer = room.disconnectTimer[i];
      if (timer) {
        clearTimeout(timer);
      }
    }
    room.disconnected = [false, false];
    room.disconnectTimer = [null, null];
  }

  /**
   * Marks a seated player disconnected instead of removing them outright,
   * and starts a grace-period timer. Only acts while the match is actually
   * playing — a disconnect during readying/countdown/etc. is handled by the
   * caller falling straight through to {@link leave} instead, since no match
   * progress is at stake yet. Deliberately leaves `seats`/`game`/`timer`
   * untouched: the tick loop keeps running exactly as before, so whatever
   * happens during the gap (the disconnected snake continuing straight, and
   * possibly dying) is simply what a reconnecting client will see once
   * caught up — nothing needs to be replayed.
   *
   * @param userId - Player whose socket just closed.
   * @param gracePeriodMs - How long to wait before treating this as a real leave.
   * @param onExpired - Called with `userId` if they haven't reconnected in time.
   * @returns True if a grace timer was started (i.e. this was a mid-match disconnect).
   */
  disconnectSeat(
    userId: string,
    gracePeriodMs: number,
    onExpired: (userId: string) => void,
  ): boolean {
    const seated = this.findSeat(userId);
    if (!seated || seated.room.status !== "playing") {
      return false;
    }
    const { room, index } = seated;
    const timer = room.disconnectTimer[index];
    if (timer) {
      clearTimeout(timer);
    }
    room.disconnected[index] = true;
    room.disconnectTimer[index] = setTimeout(() => {
      room.disconnectTimer[index] = null;
      if (room.disconnected[index]) {
        onExpired(userId);
      }
    }, gracePeriodMs);
    return true;
  }

  /**
   * Re-attaches a fresh socket to a seat that was marked disconnected,
   * cancelling its grace-period timer.
   *
   * @param userId - Reconnecting player.
   * @param seat - Their new socket + identity.
   * @returns The room + seat index, or null if there was nothing to reattach to.
   */
  reattachSeat(userId: string, seat: Seat): { room: Room; index: number } | null {
    const seated = this.findSeat(userId);
    if (!seated || !seated.room.disconnected[seated.index]) {
      return null;
    }
    const { room, index } = seated;
    const timer = room.disconnectTimer[index];
    if (timer) {
      clearTimeout(timer);
    }
    room.disconnected[index] = false;
    room.disconnectTimer[index] = null;
    room.seats[index] = seat;
    return { room, index };
  }

  /**
   * Removes a user from any room; closes empty rooms; ends match if mid-game.
   *
   * If a queued spectator is waiting and the room has already reached
   * pregame (readying/countdown/playing) — or finished and is between
   * matches, waiting on rematch votes — the vacated seat is handed to them
   * and the match restarts from a fresh pregame instead of forfeiting or
   * (for a finished room) just reopening for a random new joiner. Rematch
   * voting itself never touches this: as long as both seated players stay
   * and vote rather than leaving, the queue is never consulted.
   *
   * @param userId - Who left.
   * @param onGameOver - If leaving mid-match with no replacement available.
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

      const pastLobby =
        room.status === "readying" ||
        room.status === "countdown" ||
        room.status === "playing" ||
        room.status === "finished";
      const replacement = pastLobby ? this.shiftQueue(room) : null;

      if (replacement) {
        this.clearCountdown(room);
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        room.game = null;
        room.status = "waiting";
        room.ready = [false, false];
        room.rematch = [false, false];
        room.seats[idx] = replacement;
        // Room stays full (2 seats) — skip the close/promote checks below;
        // the caller re-enters pregame for the fresh pairing.
        continue;
      }

      if (room.status === "playing" && room.game) {
        const state = room.game.forfeit(idx);
        // Keep seats filled so score/Elo callbacks can see both players.
        this.finishMatch(room, state, onGameOver ?? (() => undefined));
      } else if (room.status === "readying" || room.status === "countdown") {
        this.clearCountdown(room);
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        room.game = null;
        room.status = "waiting";
        room.ready = [false, false];
        room.rematch = [false, false];
      }

      room.seats[idx] = null;

      const remaining = room.seats.filter(Boolean).length;
      if (remaining === 0) {
        this.clearCountdown(room);
        if (room.timer) {
          clearInterval(room.timer);
        }
        this.notifySpectatorsEnded(room, "Room closed");
        this.rooms.delete(room.code);
      } else if (room.status === "finished") {
        // Opponent left after the match — survivor waits alone for a new joiner.
        this.clearCountdown(room);
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        room.game = null;
        room.status = "waiting";
        room.ready = [false, false];
        room.rematch = [false, false];
        if (room.seats[0] === null && room.seats[1]) {
          room.seats[0] = room.seats[1];
          room.seats[1] = null;
          room.hostUserId = room.seats[0]!.user.userId;
        }
      } else if (room.status === "waiting" && idx === 0) {
        // Host left while waiting — close room.
        this.notifySpectatorsEnded(room, "Room closed");
        this.rooms.delete(room.code);
      } else if (room.status === "waiting" && room.seats[0] === null && room.seats[1]) {
        // Promote guest to host seat.
        room.seats[0] = room.seats[1];
        room.seats[1] = null;
        room.hostUserId = room.seats[0]!.user.userId;
        room.ready = [false, false];
        room.rematch = [false, false];
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
