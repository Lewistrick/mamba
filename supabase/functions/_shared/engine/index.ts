/**
 * Public exports for the Mamba game engine.
 */

export { Game, bluePelletValue, greenPelletValue } from "./game.ts";
export {
  MAX_REPLAY_TICKS,
  verifyReplay,
  type ReplayPayload,
  type VerifyResult,
} from "./replay.ts";
export { createRng, randomInt } from "./rng.ts";
export {
  FIELD_SIZES,
  MEDIUM_SIZE,
  START_LENGTH,
  YELLOW_REACTION_MAX,
  YELLOW_REACTION_MIN,
  type Direction,
  type FieldSize,
  type FieldSizeId,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Point,
  type YellowPellet,
} from "./types.ts";
