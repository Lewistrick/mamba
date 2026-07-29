# Phase 6 — Online 1v1 (implemented)

## Rules

- Signed-in users with a locked username only
- Room codes: 6-char alphanumeric (no `0/O/1/I`)
- **Public** rooms: listed in lobby; `spectatable: true` (spectating UI is Phase 7)
- **Private** rooms: code only; not spectatable
- Server-authoritative Hono WebSocket ticks at 10 TPS; clients send directions only
- Shared board (same engine as vs AI): time bonus `+level`/s per living snake; sole survivor gets win bonus `100×level`; **head-on → no win bonus**
- Winner = highest **total score** (not net); local/global boards store **net** (`you − opponent`) with `mode: mp`
- When the second player joins: board opens, join sound, Ready toggles; both Ready → 3× beep (0.5s + 0.5s silence) then boop (1s, perfect fourth up), then ticks start
- **Elo** on `profiles.elo`: initial **1000**, K=**32**; expected score `1 / (1 + 10^((Rb−Ra)/400))`; update `R + K*(S−E)` with S = 1 / 0.5 / 0 for win / draw / loss; server applies after each match (service role); shown on Profile and game-over overlay

## Packages

- [`apps/server`](../../apps/server) — rooms, auth, ticks, Elo + optional global score insert
- [`apps/server/src/elo.ts`](../../apps/server/src/elo.ts) — rating math
- [`apps/web/src/mpClient.ts`](../../apps/web/src/mpClient.ts) / [`mpLobby.ts`](../../apps/web/src/mpLobby.ts) — lobby + match UI

## Local dev

```bash
# terminal 1 — copy apps/server/.env.example → apps/server/.env
npm run dev:server

# terminal 2 — apps/web/.env.local needs VITE_WS_URL=ws://localhost:8787
npm run dev
```

## Database

Run migration `supabase/migrations/20260729120000_profiles_elo.sql` (or re-run `supabase/setup.sql` sections) so `profiles.elo` exists.

## Deploy

- `docker compose` builds `web` + `server` (`mamba-ws` on `host-edge`)
- Caddy: proxy `/mamba/ws` → `mamba-ws:8787` with WebSocket support
- Server env: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (preferred) or anon key