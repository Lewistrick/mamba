/**
 * Shared types for the Mamba game engine.
 */

/** Cardinal movement directions. */
export type Direction = "Up" | "Down" | "Left" | "Right";

/** Lifecycle status of a run. */
export type GameStatus = "playing" | "gameover";

/** Grid coordinate. */
export interface Point {
  x: number;
  y: number;
}

/** Timed yellow bonus pellet. */
export interface YellowPellet {
  pos: Point;
  value: number;
  ttl: number;
}

/** Configuration for starting a game. */
export interface GameConfig {
  /** Playfield width in cells. */
  width: number;
  /** Playfield height in cells. */
  height: number;
  /** Seed for deterministic RNG. */
  seed: number;
  /** Starting snake length (default 5). */
  startLength?: number;
}

/** Immutable snapshot of engine state for rendering / networking. */
export interface GameState {
  width: number;
  height: number;
  snake: readonly Point[];
  direction: Direction;
  walls: readonly Point[];
  bluePellets: readonly Point[];
  greenPellets: readonly Point[];
  yellowPellet: YellowPellet | null;
  score: number;
  level: number;
  pelletsEatenThisLife: number;
  moltThreshold: number;
  status: GameStatus;
  tick: number;
  /** Current blue pellet score award (capped). */
  blueValue: number;
  /** Current green pellet score award (capped). */
  greenValue: number;
}

/** Medium field size from the original game. */
export const MEDIUM_SIZE = { width: 40, height: 22 } as const;

/** Starting snake length. */
export const START_LENGTH = 5;

/** Yellow TTL reaction factor range (ticks per Manhattan cell). */
export const YELLOW_REACTION_MIN = 2;
export const YELLOW_REACTION_MAX = 5;
