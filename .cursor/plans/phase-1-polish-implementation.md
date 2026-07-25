# Phase 1 polish — implementation plan (completed)

## Goals

1. Redesign snake to “original remake” preset, then refine head/tail styling.
2. Fix canvas text glitches (HUD / overlay / footer).
3. Spawn **two** pellets when green or yellow is eaten (blue still spawns one).

## Snake visuals ([`apps/web/src/renderer.ts`](apps/web/src/renderer.ts))

| Part | Implementation |
|------|----------------|
| Body | Solid yellow tiles with 1px gap (`fillBlock`) |
| Head | Transparent fill, yellow border (`strokeRect`), yellow pixel eyes + mouth |
| Tail | Transparent cell (no fill), yellow geometric double-chevron pointing away from body |

Head face shifts slightly with `direction`. Tail chevrons are path fills, not font glyphs.

## Text / canvas clarity

Root cause: CSS-stretched canvas + `image-rendering: pixelated` nearest-neighbor scaled fonts.

Fixes applied:

- Removed `image-rendering: pixelated` from [`apps/web/src/style.css`](apps/web/src/style.css)
- DPR-aware backing store (`devicePixelRatio`, `setTransform`)
- Resize only when field size / DPR changes (not every frame)
- Integer text coordinates for HUD/overlay/footer
- Canvas CSS size set from JS; `max-width: 98vw` for small viewports

## Engine spawn rules ([`packages/engine/src/game.ts`](packages/engine/src/game.ts))

In `tryEatAt`:

- Blue → `spawnPellet()` once
- Green → `spawnPellet()` twice
- Yellow → `spawnPellet()` twice

Tests in [`packages/engine/src/game.test.ts`](packages/engine/src/game.test.ts) cover green/yellow double spawn.

## Earlier Phase 1 foundations (reference)

- Deterministic engine: seed + inputs → same state/score
- Medium field `40×22`, start length 5, molt, yellow TTL, green wall chains
- Score caps: blue `min(level, 10)`, green `min(level × 10, 100)`
- Input buffer of up to 2 directions for sharp corners
- Wall hatch clipped per cell

## Verification

```bash
npm test
npm run build -w @mamba/web
npm run dev
```
