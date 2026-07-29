# Phase 3 — Local leaderboards (done)

## Defaults chosen

- Top **10** per size × period × mode
- Mode **`solo`** (schema accepts `ai:*` / `mp` later)
- Periods use **local timezone** (daily midnight, weekly Monday start)
- One stored row per run (timestamp); boards are filtered views
- Name max 12 chars; remembered in settings; prompt only when score qualifies for all-time top 10

## Files

- [`apps/web/src/leaderboard.ts`](apps/web/src/leaderboard.ts) — storage + ranking
- [`apps/web/src/leaderboard.test.ts`](apps/web/src/leaderboard.test.ts)
- [`apps/web/src/main.ts`](apps/web/src/main.ts) / [`apps/web/index.html`](apps/web/index.html) — UI
