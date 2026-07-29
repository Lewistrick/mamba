# Phase 7 — Spectating (planned)

## Rules

- Read-only viewers of **public** rooms only (`room.visibility === "public"` / `room.spectatable`); private rooms stay code-only, never listed, never spectatable — unchanged from Phase 6
- Spectating requires sign-in — reuses the existing `auth` WS handshake; no anonymous viewers
- No cap on spectators per room for the MVP (revisit if it becomes a problem)
- A spectator never affects match state, room lifecycle, score submission, or Elo
- Late join: connecting mid-match sends one full snapshot (current `GameState` + room status + names) immediately, then regular ticks as they happen

## Protocol additions ([`apps/server/src/protocol.ts`](../../apps/server/src/protocol.ts))

- `ClientMessage`: `{ type: "spectate"; code: string }`, `{ type: "stop_spectate" }`
- `ServerMessage`: parallel set to the player-facing variants, but without `youIndex` (there is no "you"):
  - `{ type: "spectate_room"; room: RoomSnapshot }`
  - `{ type: "spectate_state"; tick: number; state: GameState; names: [string, string] }` — covers pregame/countdown/playing; client reads `room.status` from the last `spectate_room` to decide which overlay to show
  - `{ type: "spectate_game_over"; state: GameState; names: [string, string]; winnerIndex: number | null }` — no Elo block; that stays private to the two players
  - `{ type: "spectate_ended"; reason: string }` — room closed, or a player left before the match started

Kept as a separate union instead of reusing `pregame` / `countdown` / `state` / `game_over` with a fake `youIndex`, so none of the existing player-facing logic in `index.ts` or [`mpLobby.ts`](../../apps/web/src/mpLobby.ts) has to change.

## Server ([`apps/server/src/rooms.ts`](../../apps/server/src/rooms.ts), [`apps/server/src/index.ts`](../../apps/server/src/index.ts))

- `Room.spectators: Seat[]` — new field alongside `seats`
- `RoomManager.addSpectator(room, seat)` — rejects with an error if `!room.spectatable`; idempotent per `userId` (re-spectating just replaces the `send` fn, e.g. on reconnect)
- `RoomManager.removeSpectator(room, userId)`
- `RoomManager.spectatorSnapshot(room)` — builds the one-shot late-join payload from `room.game?.getState()`, `room.status`, `room.tick`, `rooms.names(room)`
- Extend `broadcastRoom` / `broadcastPregame` / `broadcastCountdown` / `broadcastState` / `handleGameOverAsync` in `index.ts` to also fan the `spectate_*` equivalents out to `room.spectators`
- `RoomManager.leave()` keeps counting only `seats` for close/promote logic — spectators never block or trigger room teardown; on teardown, send `spectate_ended` to any remaining spectators first
- New `spectate` / `stop_spectate` cases in the `onMessage` switch in `index.ts`; `onClose` also calls `removeSpectator` for the disconnecting user

## Client ([`apps/web/src/spectatorClient.ts`](../../apps/web/src/spectatorClient.ts) — new, mirrors [`mpClient.ts`](../../apps/web/src/mpClient.ts))

- Same connect/auth/`onMessage`/`close` shape as `MpClient`, but sends `spectate` / `stop_spectate` and listens for `spectate_*` messages only
- Lobby UI (`mpLobby.ts`, `renderPublic`): each public room row gets a **Watch** button next to Join
- Watching opens the existing canvas/renderer path in read-only mode: no input handling, no Ready toggle, no pause
- Rendering: spectators see the board in absolute seat order — draw `state.players[0]` / `[1]` in fixed colors and label with `names[0]` / `names[1]` directly, skipping `remapStateForYou` (that helper exists only to put the local player first and doesn't apply here)
- Leaving just closes the spectator socket; the match is unaffected

## Open questions to confirm before implementing

1. Surface a live spectator count to players (`RoomSnapshot.spectatorCount`)? Nice-to-have, not required for read-only viewing.
2. Anything special when a spectated room's match ends and a new one starts in the same room (rematch)? Default: treat it like any other `spectate_room`/`spectate_state` update — no re-subscribe needed.

## Deploy note

No new infra: same `/ws` endpoint and Caddy route as Phase 6 ([`deploy-vps-and-local.md`](deploy-vps-and-local.md) A4). No schema/migration changes — spectating state isn't persisted.
