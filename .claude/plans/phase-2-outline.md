# Phase 2 outline — field sizes, menus, sound

**Status:** implemented (see code + full plan).

## Decisions (answered)

1. Sizes confirmed: Small `11×20`, Medium `22×40`, Large `33×60` (height × width).
2. Menus: HTML/CSS beside the canvas (stacks on narrow viewports).
3. Live rescale: cell size computed from `#stage` budget each frame.
4. Speed: constant (10 TPS), no per-level acceleration.
5. Sound: Web Audio beeps
   - Blue: A 880 Hz → B ~988 Hz
   - Green: G# ~1661 Hz → B = 2× blue B ~1976 Hz
   - Yellow: A 440 Hz → F ~698 Hz
   - Plus short molt / death cues; mute toggle persisted
6. Remember board size in `localStorage`; always changeable via menu (applies on Play/Restart).

## Touch points

- `packages/engine` — `FIELD_SIZES`, `Game.withSize`, tick `events`
- `apps/web` — HTML menu, `settings.ts`, `audio.ts`, dynamic cell fit in `renderer.ts`
