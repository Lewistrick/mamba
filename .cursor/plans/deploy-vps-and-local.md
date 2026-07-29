# Deploy Mamba (VPS + Supabase) and run locally

Every step names **where** (machine / UI), **what file** (if any), and **what command or action**.

Public site: `https://lewistrick.com/mamba/`  
Auth / DB / `verify-score`: cloud Supabase  
VPS: Docker Compose on network `host-edge` (`mamba` + `mamba-ws`), Caddy in `/home/weekmenu/apps/proxy`

---

## Part A — Deploy to production

### A0. Laptop — push code first

| | |
|--|--|
| **Where** | Your laptop (repo clone) |
| **Why** | The VPS can only `git pull` what is on the remote |

1. Confirm Supabase API values are real (not `YOUR_PROJECT`):
   - **Where:** browser → [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Project Settings → API**
   - Copy: Project URL, `anon` `public`, `service_role` `secret`
2. Commit and push Phase 6 / Elo (if not already on the remote):

```bash
# Where: laptop, inside the mamba git repo
git status
git add -A
git commit -m "Your message"
git push
```

---

### A1. Supabase — Elo schema (required for ratings)

| | |
|--|--|
| **Where** | Browser → Supabase → **SQL Editor → New query** |
| **File to paste** | Repo file `supabase/migrations/20260729120000_profiles_elo.sql` (open locally or on GitHub) |
| **Action** | Paste the full SQL → click **Run** |

Optional check (same SQL Editor):

```sql
select elo from public.profiles limit 1;
```

**Skip** full `supabase/setup.sql` if profiles/scores/auth already work in production.

**Auth URLs** (only if not already set):

| | |
|--|--|
| **Where** | Supabase → **Authentication → URL Configuration** |
| **Set** | Site URL = `https://lewistrick.com/mamba/` |
| **Add redirect** | `https://lewistrick.com/mamba/` |

**Email confirm** (usual for this project):

| | |
|--|--|
| **Where** | Supabase → **Authentication → Providers → Email** |
| **Action** | Email enabled; **Confirm email** disabled (unless custom SMTP is set up) |

Elo does **not** require redeploying the `verify-score` edge function.

---

### A2. VPS — pull and root `.env`

> Office networks often block outbound SSH (port 22) while HTTPS still works. If `Test-NetConnection YOUR_VPS -Port 22` fails, use phone hotspot, home network, or the hoster’s web console.

| | |
|--|--|
| **Where** | SSH (or web console) on the VPS |
| **Directory** | Your mamba clone path (example: whatever you used before) |

```bash
# Where: VPS shell, mamba repo root
cd /path/to/mamba
git pull
```

Env file for Docker Compose:

| | |
|--|--|
| **Where** | VPS |
| **File** | **Repo root** `.env` (not `apps/web/.env.local`) |
| **Template** | Copy from `.env.docker.example` if `.env` is missing |

```bash
# Where: VPS, mamba repo root
cp .env.docker.example .env
nano .env
```

Edit root `.env` so it has **real** values (from Supabase → Project Settings → API):

```env
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
VITE_WS_URL=wss://lewistrick.com/mamba/ws
```

Notes:

- Compose maps `SUPABASE_URL` / `SUPABASE_ANON_KEY` into the **web image** as `VITE_*` at **build** time.
- `SUPABASE_SERVICE_ROLE_KEY` is for the **server** container (MP scores + Elo). Prefer service role.
- Changing `.env` without rebuilding does **not** update an already-built web image.

Confirm the edge network exists:

```bash
# Where: VPS shell
docker network ls | grep host-edge
```

If missing, start the proxy stack that owns it (usually):

```bash
# Where: VPS
cd /home/weekmenu/apps/proxy
docker compose up -d
```

---

### A3. VPS — rebuild containers

```bash
# Where: VPS, mamba repo root (where docker-compose.yml lives)
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 server
```

Smoke tests on the VPS:

```bash
# Where: VPS shell
curl -s http://127.0.0.1:34364/mamba/ | head
curl -s http://127.0.0.1:8787/health
# expect: {"ok":true}
```

---

### A4. VPS — Caddy WebSocket route

HTTP `/mamba*` → container alias `mamba:80` should already work.  
Online multiplayer also needs `/mamba/ws` → `mamba-ws:8787`.

| | |
|--|--|
| **Where** | VPS |
| **File** | Caddyfile used by `/home/weekmenu/apps/proxy` (edit that Caddyfile) |
| **Rule** | Match `/mamba/ws` **before** the general `/mamba` handle |

Example snippet (adapt to your existing site block):

```caddy
handle /mamba/ws* {
	reverse_proxy mamba-ws:8787
}

handle /mamba* {
	reverse_proxy mamba:80
}
```

Reload Caddy:

```bash
# Where: VPS
cd /home/weekmenu/apps/proxy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

### A5. Browser — verify production

| | |
|--|--|
| **Where** | Any browser |
| **URL** | https://lewistrick.com/mamba/ (hard refresh) |

Checklist:

1. Sign in → **Profile** shows **Elo 1000** (or your rating).
2. **Multiplayer** → create/join with two accounts → finish a match.
3. Game-over overlay shows Elo change (e.g. `Elo 1000 → 1016 (+16)`).
4. Profile Elo updates after refresh.

---

### Deploy order (cheat sheet)

| Step | Where | Action |
|------|--------|--------|
| A0 | Laptop | Push code; confirm API keys in Supabase dashboard |
| A1 | Supabase SQL Editor | Run Elo migration SQL |
| A2 | VPS | `git pull`; edit root `.env` |
| A3 | VPS | `docker compose up -d --build` |
| A4 | VPS proxy | Caddy `/mamba/ws` → `mamba-ws`; reload |
| A5 | Browser | Login, Elo, one MP match |

---

## Part B — Run locally (dev)

Use this on your laptop for day-to-day development. Base path is `/` (not `/mamba/`). Docker/Caddy are not required.

### B1. Install once

```bash
# Where: laptop, mamba repo root
npm install
```

### B2. Supabase (same cloud project is fine)

| | |
|--|--|
| **Where** | Browser → Supabase SQL Editor |
| **Action** | Ensure Elo migration from A1 has been run (same project) |

Auth redirects for local Vite:

| | |
|--|--|
| **Where** | Supabase → **Authentication → URL Configuration → Redirect URLs** |
| **Add** | `http://localhost:5173` |

### B3. Web client env

| | |
|--|--|
| **Where** | Laptop |
| **File** | `apps/web/.env.local` (create from `apps/web/.env.example`) |

```bash
# Where: laptop, mamba repo root
cp apps/web/.env.example apps/web/.env.local
# Then edit apps/web/.env.local
```

Contents:

```env
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_WS_URL=ws://localhost:8787
```

Restart Vite after editing. Without a real URL+anon (not `YOUR_PROJECT`), the menu **Account** sign-in form stays hidden and Multiplayer cannot work.

### B4. Multiplayer server env

| | |
|--|--|
| **Where** | Laptop |
| **File** | `apps/server/.env` (create from `apps/server/.env.example`) |

```bash
# Where: laptop, mamba repo root
cp apps/server/.env.example apps/server/.env
# Then edit apps/server/.env
```

Contents:

```env
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
PORT=8787
```

`npm run dev:server` loads `apps/server/.env` at startup (cwd = `apps/server`). Restart the server after creating/editing that file. Docker Compose does **not** use this file; it injects env from the repo-root `.env`.

You need **both** `SUPABASE_URL` and a key (`SUPABASE_SERVICE_ROLE_KEY` preferred, or `SUPABASE_ANON_KEY`). Placeholders like `YOUR_PROJECT` are rejected.

### B5. Start processes (two terminals)

```bash
# Where: laptop, mamba repo root — terminal 1
npm run dev:server
```

```bash
# Where: laptop, mamba repo root — terminal 2
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

- Solo / vs AI / Profile / global boards: web + Supabase only.
- **Multiplayer**: both terminals must be running; sign in with a username set.

### B6. Optional local checks

```bash
# Where: laptop, mamba repo root
npm test
curl -s http://127.0.0.1:8787/health
```

---

## Env file map (do not mix these up)

| File | Used by | When |
|------|---------|------|
| Repo root `.env` | `docker compose` on VPS | Production build/runtime |
| `apps/web/.env.local` | Vite (`npm run dev`) | Local web |
| `apps/server/.env` | `npm run dev:server` | Local MP server |

Same Supabase project keys can be reused; names differ (`VITE_*` only for the browser build).
