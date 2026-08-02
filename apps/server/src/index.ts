/**
 * Mamba multiplayer WebSocket server (Hono).
 */

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Direction, FieldSizeId, GameState } from "@mamba/engine";
import { versusNetScore } from "@mamba/engine";
import { Hono } from "hono";
import {
  authenticateGuest,
  authenticatePlayer,
  createSupabaseAdmin,
  fetchElos,
  insertMpScores,
  persistElos,
  type MpUser,
} from "./auth.ts";
import { updateMatchElo, type EloMatchResult } from "./elo.ts";
import { loadDotEnv } from "./loadEnv.ts";
import type { ClientMessage, RoomVisibility, ServerMessage } from "./protocol.ts";
import { COUNTDOWN_SEQUENCE_MS } from "./protocol.ts";
import { RoomManager, type Room, type Seat } from "./rooms.ts";

loadDotEnv();

const PORT = Number(process.env.PORT ?? 8787);
const supabase = createSupabaseAdmin();
const rooms = new RoomManager();
/** How long a mid-match disconnect is tolerated before forfeiting. */
const GRACE_PERIOD_MS = 15_000;

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/health", (c) => c.json({ ok: true }));

/**
 * Sends a JSON server message.
 *
 * @param send - Raw sender.
 * @param msg - Message.
 */
function sendMsg(send: (data: string) => void, msg: ServerMessage): void {
  send(JSON.stringify(msg));
}

/**
 * Broadcasts a room snapshot to all seated players.
 *
 * @param room - Room.
 */
function broadcastRoom(room: Room): void {
  for (const seat of room.seats) {
    if (!seat) {
      continue;
    }
    sendMsg(seat.send, { type: "room", room: rooms.snapshot(room, seat.user.userId) });
  }
  for (const spec of room.spectators) {
    sendMsg(spec.send, { type: "room", room: rooms.snapshot(room, spec.user.userId) });
  }
}

/**
 * Broadcasts the current absolute board to spectators only.
 *
 * @param room - Room with a live game (any pregame/countdown/playing phase).
 */
function broadcastSpectateState(room: Room): void {
  if (!room.game || room.spectators.length === 0) {
    return;
  }
  const names = rooms.names(room);
  const state = room.game.getState();
  for (const spec of room.spectators) {
    sendMsg(spec.send, {
      type: "spectate_state",
      tick: room.tick,
      status: room.status,
      state,
      names,
    });
  }
}

/**
 * Broadcasts game state to both players.
 *
 * @param room - Playing room.
 * @param state - Engine state.
 */
function broadcastState(room: Room, state: GameState): void {
  const names = rooms.names(room);
  for (let i = 0; i < room.seats.length; i += 1) {
    const seat = room.seats[i];
    if (!seat) {
      continue;
    }
    sendMsg(seat.send, {
      type: "state",
      tick: room.tick,
      youIndex: i,
      state,
      names,
    });
  }
  broadcastSpectateState(room);
}

/**
 * Sends the current board to a single seat right after they reconnect.
 * `reattachSeat` (see rooms.ts) only ever succeeds while `room.status ===
 * "playing"` — any other status means the disconnected flag was already
 * cleared (grace expiry, a natural game-over, etc.) — so this only needs to
 * cover the live-match case.
 *
 * @param room - Room being caught up.
 * @param index - Reconnecting seat.
 * @param seat - Their fresh socket.
 */
function sendCatchUp(room: Room, index: number, seat: Seat): void {
  if (!room.game || room.status !== "playing") {
    return;
  }
  sendMsg(seat.send, {
    type: "state",
    tick: room.tick,
    youIndex: index,
    state: room.game.getState(),
    names: rooms.names(room),
  });
}

/**
 * Fully removes a user from any room/spectating — forfeits if mid-match.
 * The non-reconnectable path, shared by the explicit "leave" message, a
 * disconnect outside active gameplay, and grace-period expiry.
 *
 * @param userId - Who's leaving.
 */
function forceLeave(userId: string): void {
  const codes = rooms.leave(userId, handleGameOver);
  rooms.removeSpectatorEverywhere(userId);
  for (const code of codes) {
    const left = rooms.get(code);
    if (left) {
      maybeEnterPregame(left);
    }
  }
}

/**
 * Handles game over: Elo update, notify clients, insert global scores once.
 *
 * @param room - Finished room.
 * @param state - Final state.
 */
function handleGameOver(room: Room, state: GameState): void {
  void handleGameOverAsync(room, state);
}

/**
 * Async game-over side effects (Elo + scores + notify).
 *
 * @param room - Finished room.
 * @param state - Final state.
 */
async function handleGameOverAsync(room: Room, state: GameState): Promise<void> {
  const names = rooms.names(room);
  const winnerIndex = RoomManager.winnerIndex(state);
  rooms.recordResult(room, winnerIndex, state, names);
  // Clients cache the last "room" snapshot to gate the rematch button — without
  // this, room.status stays at its pre-match value ("countdown") forever, so
  // canRematch never flips true and "Play again" falls through to a local game.
  // Now also carries the fresh wins tally + last-game result (recordResult above).
  broadcastRoom(room);
  for (const spec of room.spectators) {
    sendMsg(spec.send, { type: "spectate_game_over", state, names, winnerIndex });
  }
  // Capture before any await — leave() may clear seats after finishMatch returns.
  const seats = [...room.seats] as (Seat | null)[];
  let eloResult: EloMatchResult | null = null;

  const seat0 = seats[0];
  const seat1 = seats[1];
  if (
    !room.eloApplied &&
    supabase &&
    seat0 &&
    seat1 &&
    seat0.user.verified &&
    seat1.user.verified
  ) {
    room.eloApplied = true;
    const [ratingA, ratingB] = await fetchElos(
      supabase,
      seat0.user.userId,
      seat1.user.userId,
    );
    eloResult = updateMatchElo(ratingA, ratingB, winnerIndex);
    await persistElos(
      supabase,
      seat0.user.userId,
      seat1.user.userId,
      eloResult.a,
      eloResult.b,
    );
  }

  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (!seat) {
      continue;
    }
    const you = i === 0 ? eloResult?.a : eloResult?.b;
    const opponent = i === 0 ? eloResult?.b : eloResult?.a;
    sendMsg(seat.send, {
      type: "game_over",
      youIndex: i,
      state,
      names,
      winnerIndex,
      elo:
        you && opponent
          ? {
              you: {
                before: you.before,
                after: you.after,
                delta: you.delta,
              },
              opponent: {
                before: opponent.before,
                after: opponent.after,
                delta: opponent.delta,
              },
            }
          : null,
    });
  }

  if (!room.scoresSaved && supabase) {
    room.scoresSaved = true;
    const rows = [];
    for (let i = 0; i < 2; i += 1) {
      const seat = seats[i];
      const player = state.players[i];
      if (!seat || !player) {
        continue;
      }
      const opponent = state.players[1 - i];
      if (!seat || !player || !opponent) {
        continue;
      }
      rows.push({
        userId: seat.user.verified ? seat.user.userId : null,
        guestId: seat.user.verified ? null : seat.user.userId,
        displayName: seat.user.displayName,
        score: versusNetScore(player, opponent, true),
        level: player.level,
        sizeId: room.sizeId,
      });
    }
    void insertMpScores(supabase, rows);
  }
}

/**
 * Broadcasts pregame board + ready flags to both players.
 *
 * @param room - Readying room.
 */
function broadcastPregame(room: Room): void {
  if (!room.game) {
    return;
  }
  const names = rooms.names(room);
  const state = room.game.getState();
  for (let i = 0; i < room.seats.length; i += 1) {
    const seat = room.seats[i];
    if (!seat) {
      continue;
    }
    sendMsg(seat.send, {
      type: "pregame",
      youIndex: i,
      state,
      names,
      ready: [...room.ready] as [boolean, boolean],
    });
  }
  broadcastSpectateState(room);
}

/**
 * Broadcasts countdown start to both players.
 *
 * @param room - Countdown room.
 */
function broadcastCountdown(room: Room): void {
  if (!room.game) {
    return;
  }
  const names = rooms.names(room);
  const state = room.game.getState();
  for (let i = 0; i < room.seats.length; i += 1) {
    const seat = room.seats[i];
    if (!seat) {
      continue;
    }
    sendMsg(seat.send, {
      type: "countdown",
      youIndex: i,
      state,
      names,
    });
  }
  broadcastSpectateState(room);
}

/**
 * When both seats are filled: prepare board and wait for Ready toggles.
 *
 * @param room - Room.
 */
function maybeEnterPregame(room: Room): void {
  if (room.status !== "waiting" || !room.seats[0] || !room.seats[1]) {
    broadcastRoom(room);
    return;
  }
  const err = rooms.enterPregame(room);
  broadcastRoom(room);
  if (err) {
    for (const seat of room.seats) {
      if (seat) {
        sendMsg(seat.send, { type: "error", message: err });
      }
    }
    return;
  }
  broadcastPregame(room);
}

/**
 * After a ready change: rebroadcast, or start countdown when both are ready.
 *
 * @param room - Readying room.
 */
function afterReadyChange(room: Room): void {
  broadcastRoom(room);
  broadcastPregame(room);
  if (!rooms.bothReady(room)) {
    return;
  }
  if (room.status === "countdown" && room.countdownTimer) {
    return;
  }
  const err = rooms.beginCountdown(room);
  if (err) {
    for (const seat of room.seats) {
      if (seat) {
        sendMsg(seat.send, { type: "error", message: err });
      }
    }
    return;
  }
  if (room.countdownTimer) {
    return;
  }
  broadcastRoom(room);
  broadcastCountdown(room);
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    if (room.status !== "countdown") {
      return;
    }
    const startErr = rooms.startMatch(room, broadcastState, handleGameOver);
    if (startErr) {
      for (const seat of room.seats) {
        if (seat) {
          sendMsg(seat.send, { type: "error", message: startErr });
        }
      }
    }
  }, COUNTDOWN_SEQUENCE_MS);
}

/**
 * Finishes an auth/guest_auth handshake: replies auth_ok, then re-attaches
 * to a seat this identity disconnected from mid-match, if any.
 *
 * @param user - Newly authenticated identity.
 * @param sendFn - Raw sender for this socket, or null if the socket hasn't opened yet.
 * @param reply - Typed reply helper for the triggering message.
 */
function completeAuth(
  user: MpUser,
  sendFn: ((data: string) => void) | null,
  reply: (m: ServerMessage) => void,
): void {
  reply({
    type: "auth_ok",
    userId: user.userId,
    displayName: user.displayName,
    verified: user.verified,
  });
  if (!sendFn) {
    return;
  }
  const seated = rooms.findSeat(user.userId);
  if (seated && seated.room.disconnected[seated.index]) {
    const seat: Seat = { user, send: sendFn };
    const reattached = rooms.reattachSeat(user.userId, seat);
    if (reattached) {
      reply({
        type: "reconnected",
        youIndex: reattached.index,
        room: rooms.snapshot(reattached.room, user.userId),
      });
      broadcastRoom(reattached.room);
      sendCatchUp(reattached.room, reattached.index, seat);
    }
  }
}

app.get(
  "/ws",
  upgradeWebSocket(() => {
    let user: MpUser | null = null;
    let sendFn: ((data: string) => void) | null = null;

    return {
      onOpen(_event, ws) {
        sendFn = (data) => {
          try {
            ws.send(data);
          } catch {
            /* closed */
          }
        };
      },
      onMessage(event, ws) {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw) as ClientMessage;
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        const reply = (m: ServerMessage): void => {
          try {
            ws.send(JSON.stringify(m));
          } catch {
            /* closed */
          }
        };

        void (async () => {
          if (msg.type === "auth") {
            if (!supabase) {
              reply({
                type: "error",
                message: "Server missing SUPABASE_URL / key env",
              });
              return;
            }
            const result = await authenticatePlayer(supabase, msg.accessToken);
            if ("error" in result) {
              reply({ type: "error", message: result.error });
              return;
            }
            user = result.user;
            completeAuth(user, sendFn, reply);
            return;
          }

          if (msg.type === "guest_auth") {
            if (!supabase) {
              reply({
                type: "error",
                message: "Server missing SUPABASE_URL / key env",
              });
              return;
            }
            const result = await authenticateGuest(
              supabase,
              msg.guestId,
              msg.displayName,
            );
            if ("error" in result) {
              reply({ type: "error", message: result.error });
              return;
            }
            user = result.user;
            completeAuth(user, sendFn, reply);
            return;
          }

          if (!user || !sendFn) {
            reply({ type: "error", message: "Authenticate first" });
            return;
          }

          const seat: Seat = { user, send: sendFn };

          switch (msg.type) {
            case "create_room": {
              rooms.leave(user.userId, handleGameOver);
              const visibility: RoomVisibility =
                msg.visibility === "private" ? "private" : "public";
              const sizeId = msg.sizeId as FieldSizeId;
              const created = rooms.create(
                seat,
                sizeId,
                visibility,
                Boolean(msg.ranked),
              );
              if (!created.ok) {
                reply({ type: "error", message: created.error });
                return;
              }
              broadcastRoom(created.room);
              break;
            }
            case "join_room": {
              rooms.leave(user.userId, handleGameOver);
              const joined = rooms.join(seat, msg.code);
              if (!joined.ok) {
                reply({ type: "error", message: joined.error });
                return;
              }
              maybeEnterPregame(joined.room);
              break;
            }
            case "set_ready": {
              const seated = rooms.findSeat(user.userId);
              if (!seated) {
                reply({ type: "error", message: "Not in a room" });
                return;
              }
              const err = rooms.setReady(
                seated.room,
                seated.index,
                Boolean(msg.ready),
              );
              if (err) {
                reply({ type: "error", message: err });
                return;
              }
              afterReadyChange(seated.room);
              break;
            }
            case "play_again": {
              const seated = rooms.findSeat(user.userId);
              if (!seated) {
                reply({ type: "error", message: "Not in a room" });
                return;
              }
              const result = rooms.requestRematch(seated.room, seated.index);
              if (result !== "waiting" && result !== "readying") {
                reply({ type: "error", message: result });
                return;
              }
              broadcastRoom(seated.room);
              if (result === "readying") {
                broadcastPregame(seated.room);
              }
              break;
            }
            case "list_public": {
              reply({ type: "public_rooms", rooms: rooms.listPublic() });
              break;
            }
            case "leave": {
              forceLeave(user.userId);
              break;
            }
            case "input": {
              rooms.queueInputForUser(user.userId, msg.dir as Direction);
              break;
            }
            case "toggle_freeze": {
              rooms.toggleFreezeForUser(user.userId);
              break;
            }
            case "spectate": {
              const room = rooms.findByCode(msg.code);
              if (!room) {
                reply({ type: "error", message: "Room not found" });
                return;
              }
              const err = rooms.addSpectator(room, seat);
              if (err) {
                reply({ type: "error", message: err });
                return;
              }
              reply({ type: "room", room: rooms.snapshot(room, seat.user.userId) });
              if (room.game) {
                reply({
                  type: "spectate_state",
                  tick: room.tick,
                  status: room.status,
                  state: room.game.getState(),
                  names: rooms.names(room),
                });
              }
              break;
            }
            case "stop_spectate": {
              const found = rooms.findSpectator(user.userId);
              if (found) {
                rooms.removeSpectator(found.room, user.userId);
              }
              break;
            }
            case "queue_join": {
              const found = rooms.findSpectator(user.userId);
              if (!found) {
                reply({ type: "error", message: "Not spectating a room" });
                return;
              }
              const err = rooms.queueJoin(found.room, user.userId);
              if (err) {
                reply({ type: "error", message: err });
                return;
              }
              reply({ type: "queue_ack", queued: true });
              broadcastRoom(found.room);
              break;
            }
            case "leave_queue": {
              const found = rooms.findSpectator(user.userId);
              if (found) {
                rooms.leaveQueue(found.room, user.userId);
                broadcastRoom(found.room);
              }
              reply({ type: "queue_ack", queued: false });
              break;
            }
            default:
              reply({ type: "error", message: "Unknown message" });
          }
        })();
      },
      onClose() {
        if (!user) {
          return;
        }
        const seated = rooms.findSeat(user.userId);
        if (seated && seated.room.status === "playing") {
          // Mid-match: give them a grace period to reconnect instead of an
          // instant forfeit. The tick loop keeps running unchanged, so
          // whatever happens during the gap is simply what a reconnecting
          // client will see once caught up.
          rooms.disconnectSeat(user.userId, GRACE_PERIOD_MS, forceLeave);
          broadcastRoom(seated.room);
          return;
        }
        // Not mid-match (or not seated at all) — nothing to protect.
        // Readying/countdown gets an explicit heads-up for the remaining
        // player, since today they'd otherwise just silently see "waiting
        // for opponent" again with no explanation.
        const cancelledOpponent =
          seated && (seated.room.status === "readying" || seated.room.status === "countdown")
            ? seated.room.seats[1 - seated.index]
            : null;
        forceLeave(user.userId);
        if (cancelledOpponent) {
          sendMsg(cancelledOpponent.send, {
            type: "error",
            message: "Connection failure — the match was cancelled.",
          });
        }
      },
    };
  }),
);

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Mamba MP server on :${PORT} (ws path /ws)`);
  if (!supabase) {
    console.warn(
      "Supabase client not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON) in apps/server/.env for local `npm run dev:server`",
    );
  }
});
injectWebSocket(server);
