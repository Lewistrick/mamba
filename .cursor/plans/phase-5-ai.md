# Phase 5 — AI opponent (done)

## Rules

- Shared board: two snakes, shared pellets / walls / yellow
- Run ends when **either** human or AI dies (head-on → both die)
- Leaderboard score = **net** (`player − AI`); negatives are kept; win bonus `100×level` if AI dies first
- Modes: `solo` | `ai:easy` | `ai:medium` | `ai:hard`

## Difficulties

| Id | Behavior |
|----|----------|
| easy | Sticky pellet target, mostly straight, rare turns, survival glance |
| medium | Greedy nearest pellet + yellow when reachable; 2-tick reaction delay |
| hard | Greedy pellet chase (points first); only aborts into tiny dead-ends |

AI lives in [`packages/engine/src/ai.ts`](../../packages/engine/src/ai.ts) (`AiBrain`), seeded from the game seed.

## Engine

- `Game.versusAi(sizeId, seed)` — two players
- `queueDirection(playerIndex, dir)` / solo `queueDirection(dir)`
- Simultaneous move + collision resolution
- Replay: `headings` + `headingsAi`; `verifyReplay` checks **net** score for `ai:*`

## Client

- Menu: Solo / vs AI + Easy/Medium/Hard
- Cyan AI snake; HUD: You → AI → Time → Net (plus level)
- Scores list follows menu mode/size; period filter only (all-time / weekly / daily)
- Pause (`P`) freezes AI ticks too

## Deploy note

After pulling: `npm run sync:engine` then `npx supabase functions deploy verify-score`.
