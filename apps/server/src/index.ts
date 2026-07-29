/**
 * Mamba multiplayer WebSocket server (Hono).
 */

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Direction, FieldSizeId, GameState } from "@mamba/engine";
import { Hono } from "hono";
import {
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
import { RoomManager, type Room, type Seat } from "./rooms.ts";

loadDotEnv();

const PORT = Number(process.env.PORT ?? 8787);
const supabase = createSupabaseAdmin();
const rooms = new RoomManager();

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
  const snap = rooms.snapshot(room);
  for (const seat of room.seats) {
    if (!seat) {
      continue;
    }
    sendMsg(seat.send, { type: "room", room: snap });
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
  // Capture before any await — leave() may clear seats after finishMatch returns.
  const seats = [...room.seats] as (Seat | null)[];
  let eloResult: EloMatchResult | null = null;

  const seat0 = seats[0];
  const seat1 = seats[1];
  if (!room.eloApplied && supabase && seat0 && seat1) {
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
      const opponentScore = state.players[1 - i]?.score ?? 0;
      rows.push({
        userId: seat.user.userId,
        displayName: seat.user.displayName,
        score: player.score - opponentScore,
        level: player.level,
        sizeId: room.sizeId,
      });
    }
    void insertMpScores(supabase, rows);
  }
}

/**
 * Starts the match if both seats are filled.
 *
 * @param room - Room.
 */
function maybeStart(room: Room): void {
  if (room.status !== "waiting" || !room.seats[0] || !room.seats[1]) {
    broadcastRoom(room);
    return;
  }
  broadcastRoom(room);
  const err = rooms.startMatch(room, broadcastState, handleGameOver);
  if (err) {
    for (const seat of room.seats) {
      if (seat) {
        sendMsg(seat.send, { type: "error", message: err });
      }
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
            reply({
              type: "auth_ok",
              userId: user.userId,
              displayName: user.displayName,
            });
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
              const created = rooms.create(seat, sizeId, visibility);
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
              maybeStart(joined.room);
              break;
            }
            case "list_public": {
              reply({ type: "public_rooms", rooms: rooms.listPublic() });
              break;
            }
            case "leave": {
              rooms.leave(user.userId, handleGameOver);
              break;
            }
            case "input": {
              rooms.queueInputForUser(user.userId, msg.dir as Direction);
              break;
            }
            default:
              reply({ type: "error", message: "Unknown message" });
          }
        })();
      },
      onClose() {
        if (user) {
          rooms.leave(user.userId, handleGameOver);
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
