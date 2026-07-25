/**
 * Public exports for the Mamba game engine.
 */

export { Game, bluePelletValue, greenPelletValue } from "./game.ts";
export { createRng, randomInt } from "./rng.ts";
export {
  MEDIUM_SIZE,
  START_LENGTH,
  YELLOW_REACTION_MAX,
  YELLOW_REACTION_MIN,
  type Direction,
  type GameConfig,
  type GameState,
  type GameStatus,
  type Point,
  type YellowPellet,
} from "./types.ts";
