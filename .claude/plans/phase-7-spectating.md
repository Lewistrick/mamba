# Phase 7 — Spectating (implemented)

## Rules

- Read-only viewers of **public** rooms only (`room.visibility === "public"` / `room.spectatable`); private rooms stay code-only, never listed, never spectatable — unchanged from Phase 6
- Spectating requires sign-in — reuses the existing `auth` WS handshake; no anonymous viewers
- No cap on spectators per room for the MVP (revisit if it becomes a problem)
- A spectator never affects match state, score submission, or Elo *unless* they've opted into the join queue (below)
- Late join: connecting mid-match sends one full snapshot (current `GameState` + room status + names) immediately, then regular ticks as they happen
- The public room list now includes rooms in **any** non-finished status, not just `waiting`, so in-progress matches are discoverable to watch (they just can't be *joined* as a player)

## Join queue (fills a vacated seat instead of forfeiting)

- While spectating, a viewer can toggle **"Join if a seat opens"**. Toggling on adds them to `room.joinQueue` (FIFO); toggling off removes them; stopping spectating removes them too
- Scope: applies from **pregame onward** — a departure during readying, countdown, *or* playing pulls from the queue. A departure while the room is still `waiting` (only one seat ever filled) is unaffected — normal `join_room` handles that
- On a qualifying departure with someone queued: the vacated seat is handed to the first queued spectator and **the match restarts from a fresh pregame** (new seed, new `Game`, ready flags reset) — it does **not** inherit the departing player's snake/score/level. This reuses the exact `enterPregame` → `readying` → ready-toggle → `countdown` → `playing` flow Phase 6 already has; no new state machine
- If no one is queued, behavior is unchanged from Phase 6: forfeit and end the match
- Elo/score need **no special-casing** — since the match restarts clean, the existing "compute at game-over from whoever's in each seat" logic already does the right thing. This was a deliberate scope decision (see decision log) to avoid partial-match bookkeeping

## Protocol additions ([`apps/server/src/protocol.ts`](../../apps/server/src/protocol.ts))

- `ClientMessage`: `{ type: "spectate"; code: string }`, `{ type: "stop_spectate" }`, `{ type: "queue_join" }`, `{ type: "leave_queue" }`
- `RoomSnapshot` gains `joinQueueLength: number`; `PublicRoomInfo` gains `status: RoomStatus` (so the lobby can tell joinable `waiting` rooms from watch-only ones)
- `ServerMessage` additions — parallel to the player-facing variants but without `youIndex` (there is no "you"):
  - `{ type: "spectate_state"; tick; status; state; names }` — covers pregame/countdown/playing in one shape (carries `status` directly rather than making the client correlate with a separate room message)
  - `{ type: "spectate_game_over"; state; names; winnerIndex }` — no Elo block; that stays private to the two players
  - `{ type: "spectate_ended"; reason }` — room closed with no queued replacement
  - `{ type: "queue_ack"; queued }` — direct reply confirming a queue toggle
- The existing `"room"` message (no `youIndex` to begin with) is reused as-is for spectators — no `spectate_room` variant needed

## Server ([`apps/server/src/rooms.ts`](../../apps/server/src/rooms.ts), [`apps/server/src/index.ts`](../../apps/server/src/index.ts))

- `Room` gains `spectators: Seat[]` and `joinQueue: Seat[]`
- `RoomManager`: `addSpectator` (rejects if not spectatable or if the caller is a seated player), `removeSpectator`, `removeSpectatorEverywhere` (disconnect cleanup), `queueJoin`/`leaveQueue`, `findSpectator`, `findByCode`, private `shiftQueue`/`notifySpectatorsEnded`
- `leave()` now checks the queue *before* its old forfeit/reset logic whenever the room is past `waiting`: if someone's queued, it clears the timer/game, resets to `waiting` with the queued spectator seated, and `continue`s — skipping the close/host-promote branches entirely, since the room is still full. The caller then runs the *same* `maybeEnterPregame()` used for a normal second join, which is what actually creates the fresh game and broadcasts pregame
- `index.ts`'s `"leave"` case and `onClose()` now call `maybeEnterPregame(left)` instead of `broadcastRoom(left)` — that function already no-ops to a plain broadcast when the precondition (waiting + both seats) isn't met, so this is a safe swap covering every existing case plus the new replacement one
- `broadcastRoom`, `broadcastPregame`/`broadcastCountdown`/`broadcastState` (via a shared `broadcastSpectateState`), and `handleGameOverAsync` all fan their spectator-facing equivalent out to `room.spectators`

## Client

No new file — `spectate`/`stopSpectate`/`queueJoin`/`leaveQueue` and the `spectate_*`/`queue_ack` message types were added directly to **`mpClient.ts`**, and the read-only view + queue toggle live in **`mpLobby.ts`** alongside the normal match flow, instead of a separate `spectatorClient.ts`. Reason: a promotion from spectator → seated player reuses the *same* WebSocket connection (the server just moves their `Seat` from `spectators` to `seats`), so the client needs to fluidly switch from handling `spectate_*` messages to handling `pregame`/`countdown`/`state`/`game_over` on one socket — a separate client class would need a reconnect handshake that doesn't otherwise exist.

- Public room rows (`mpLobby.ts` `renderPublic`) show **Join** only when `status === "waiting"`, and always show **Watch**; the "Join with code" section got a "Watch instead" button for entering a code directly
- A small overlay (`#mp-spectate-overlay` in `index.html`, styled like the existing ready overlay) shows while spectating: match title, the join-queue checkbox, and queue length
- Rendering reuses the normal `"playing"` screen/canvas pipeline in `main.ts` with a new `spectating` flag (mirrors `mpPlaying`): `state` is set directly from `spectate_state` (absolute seat order, no `remapStateForYou`), local ticking/input/pause are all skipped since `game` stays `null`
- Receiving a `pregame` message always means "you're seated" (including a first-time promotion), so that handler unconditionally clears `spectating` and hides the spectate overlay — no explicit "you've been promoted" message was needed
- The existing Play/Leave button doubles as "Stop watching" while spectating, exactly like it already doubles as "Leave match" for `mpPlaying` — kept one exit control instead of adding a second

## Known trade-offs (accepted for MVP, not fixed here)

- The HUD still labels seats "You" / "Opp" even while spectating (cosmetic only — scores/board are correct); a proper spectator HUD label would need a renderer option
- A spectator's queue entry isn't consulted if the room falls all the way back to plain `waiting` (empty, pre-pregame) — a random new `join_room` could still fill that seat first. Only affects the readying/countdown-with-empty-queue edge case

## Deploy note

No new infra: same `/ws` endpoint and Caddy route as Phase 6 ([`deploy-vps-and-local.md`](deploy-vps-and-local.md) A4). No schema/migration changes — spectating and queue state aren't persisted.
