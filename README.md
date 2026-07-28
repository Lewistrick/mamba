# MAMBA

A TypeScript + HTML5 Canvas remake of **Mamba**, the 1989 MS-DOS snake game by Bert Uffen (Amsterdam).

Unlike classic Snake, your mamba **molts**: after eating enough pellets it sheds most of its body into a permanent red wall, keeps the newest five segments, and a timed yellow bonus pellet appears. Pellets that would spawn on a wall become valuable green pellets instead.

## Current (Phase 5)

- Deterministic headless engine with **replay verification** (solo + AI)
- Field sizes S/M/L, HTML menu, live rescale, sound (S), pause (P)
- **Solo** or **vs AI** (easy / medium / hard) on a shared board; scoreboard uses **net** (you − AI)
- **Local + global leaderboards** (size × mode × period); account auth via email/password
- Preferences in `localStorage`; guest play always works offline

See [`.cursor/plans/mamba-full-implementation-plan.md`](.cursor/plans/mamba-full-implementation-plan.md) and [`.cursor/plans/phase-5-ai.md`](.cursor/plans/phase-5-ai.md).

## Rules (Phase 1)

| Rule | Detail |
|------|--------|
| Field | Small 11×20 / Medium 22×40 / Large 33×60 (height × width) |
| Start | Snake length 5 |
| Move | One cell per tick; head advances, tail removed unless you just ate |
| Blue pellets | Initial count `5–12`; eat → length +1, score `min(level, 10)`, spawn **one** replacement |
| Molt | After `12–22` blue/green pellets this life → older body becomes wall, keep 5 segments, level +1 |
| Yellow pellet | Spawns on molt (lime); after 5 ticks TTL = Dijkstra + 5 (walls + body blocked), or `max(2 × Manhattan, 60s)` if unreachable; countdown in seconds (1 decimal under 10s; red under 3s); worth `⌊√level × random(20–50)⌋`; eat → spawn **two** pellets |
| Green pellet | When a spawn lands on a wall; worth `min(level × 10, 100)`; 10% chance adjacent walls in one direction also turn green; eat → spawn **two** pellets |
| Death | Hit border, self, red wall, or the other snake (vs AI) |
| vs AI | Shared board; either death ends the run; saved score = your score − AI score |

Score caps follow the Wikipedia description of the original: blue max **10**, green max **100**.

## Setup

```bash
npm install
npm test
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

**Controls:** arrow keys to steer · Enter / Space to start or restart · S to toggle sound · P to pause.

Pick **Solo** or **vs AI** (and a difficulty) in the menu before Play.

## Supabase (global scores)

Optional. Without config, everything works offline.

1. Create a project at [supabase.com](https://supabase.com)
2. Apply the database schema: open **SQL Editor**, paste [`supabase/setup.sql`](supabase/setup.sql), run it once
3. From the repo root: `npm run sync:engine`, then `npx supabase login`, `npx supabase link --project-ref <your-ref>`, and `npx supabase functions deploy verify-score`
4. Copy [`apps/web/.env.example`](apps/web/.env.example) to `apps/web/.env.local` and set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
5. Add `http://localhost:5173` to Auth redirect URLs
6. Under **Authentication → Providers → Email**, keep Email enabled and **disable Confirm email** (free built-in mailer is limited to ~2 emails/hour; password signup then works immediately)

Auth is **email + password** (magic link is optional). After sign-in, choose a **username once** before Play; that name is locked for global scores. Raw `{score}` posts are rejected — the server re-simulates your replay via `verify-score`.

**Optional later:** custom SMTP (e.g. Proton Mail SMTP with a custom domain) under **Authentication → SMTP**, raise rate limits, then re-enable Confirm email if you want verified addresses.

## Monorepo layout

```
apps/web/           Vite + Canvas client
packages/engine/    Pure TypeScript game rules (no DOM)
```

The engine is seeded and deterministic: the same seed and input sequence always produce the same score and state (needed later for anti-cheat and multiplayer).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the web client |
| `npm test` | Run engine + web unit tests |
| `npm run build` | Typecheck engine + build the web client |

## Credits

Original game © 1989 Bert Uffen, Amsterdam.
