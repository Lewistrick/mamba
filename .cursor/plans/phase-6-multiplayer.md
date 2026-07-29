# Phase 6 — Online 1v1 (implemented)

## Rules

- Signed-in users with a locked username only
- Room codes: 6-char alphanumeric (no `0/O/1/I`)
- **Public** rooms: listed in lobby; `spectatable: true` (spectating UI is Phase 7)
- **Private** rooms: code only; not spectatable
- Server-authoritative Hono WebSocket ticks at 10 TPS; clients send directions only
- Shared board (same engine as vs AI): time bonus `+level`/s per living snake; sole survivor gets win bonus `100×level`; **head-on → no win bonus**
- Winner = highest **total score** (not net); local/global boards store **net** (`you − opponent`) with `mode: mp`

## Packages

- [`apps/server`](../../apps/server) — rooms, auth, ticks, optional global score insert
- [`apps/web/src/mpClient.ts`](../../apps/web/src/mpClient.ts) / [`mpLobby.ts`](../../apps/web/src/mpLobby.ts) — lobby + match UI

## Local dev

```bash
# terminal 1 — copy apps/server/.env.example → apps/server/.env
npm run dev:server

# terminal 2 — apps/web/.env.local needs VITE_WS_URL=ws://localhost:8787
npm run dev
```

## Deploy

- `docker compose` builds `web` + `server` (`mamba-ws` on `host-edge`)
- Caddy: proxy `/mamba/ws` → `mamba-ws:8787` with WebSocket support
- Server env: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (preferred) or anon key
