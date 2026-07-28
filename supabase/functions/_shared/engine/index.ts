/**
 * Public exports for the Mamba game engine.
 */

export { Game, bluePelletValue, greenPelletValue } from "./game.ts";
export { AiBrain } from "./ai.ts";
export {
  MAX_REPLAY_TICKS,
  verifyReplay,
  type ReplayPayload,
  type VerifyResult,
} from "./replay.ts";
export { createRng, randomInt } from "./rng.ts";
export {
  AI_DIFFICULTIES,
  FIELD_SIZES,
  MEDIUM_SIZE,
  START_LENGTH,
  TICKS_PER_SECOND,
  YELLOW_FALLBACK_MIN_SECONDS,
  YELLOW_GRACE_TICKS,
  type AiDifficulty,
  type Direction,
  type FieldSize,
  type FieldSizeId,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Point,
  type SnakePlayerState,
  type YellowPellet,
} from "./types.ts";
export { dijkstraDistance } from "./pathfinding.ts";
