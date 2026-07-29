# Phase 4 — Supabase auth, global boards, replay anti-cheat (done)

## Auth

- Auth: **email + password** (magic link optional); guest play remains default
- **Confirm email** off by default on free tier (~2 built-in emails/hour); optional later: Proton/custom SMTP then re-enable
- Signed-in users must set a **locked username** before Play (gate treats missing profile as needing a username; upsert creates the row)
- Account required to submit global scores (spectating unlock is Phase 7)

## Anti-cheat

- Client records per-tick absolute headings + seed + size
- `verifyReplay()` in `@mamba/engine` re-simulates the run
- Edge Function `verify-score` checks JWT, rate-limits (30/hour), verifies, inserts with service role
- Clients cannot insert into `scores` directly (RLS)

## Setup

1. Create a Supabase project
2. Run [`supabase/setup.sql`](../supabase/setup.sql) in the SQL Editor (preferred one-shot)
3. `npm run sync:engine` then `npx supabase functions deploy verify-score` (after `supabase login` / `link`)
4. Copy `apps/web/.env.example` → `apps/web/.env.local` with URL + anon key
5. Set Auth redirect URL to your site origin (e.g. `http://localhost:5173`)
6. **Authentication → Providers → Email**: disable Confirm email (unless custom SMTP is configured)

Without env vars, the game still works fully offline (local boards only).
