# Phase 4 — Supabase auth, global boards, replay anti-cheat (done)

## Auth

- Email **magic link** via Supabase Auth (guest play remains default)
- Account required to submit global scores (spectating unlock is Phase 7)

## Anti-cheat

- Client records per-tick absolute headings + seed + size
- `verifyReplay()` in `@mamba/engine` re-simulates the run
- Edge Function `verify-score` checks JWT, rate-limits (30/hour), verifies, inserts with service role
- Clients cannot insert into `scores` directly (RLS)

## Setup

1. Create a Supabase project
2. `npx supabase db push` (or run `supabase/migrations/20260726150000_profiles_scores.sql`)
3. `npm run sync:engine` then `npx supabase functions deploy verify-score`
4. Copy `apps/web/.env.example` → `apps/web/.env.local` with URL + anon key
5. Set Auth redirect URL to your site origin (e.g. `http://localhost:5173`)

Without env vars, the game still works fully offline (local boards only).
