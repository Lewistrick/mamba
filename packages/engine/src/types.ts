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
  /**
   * Remaining lifetime in ticks after grace ends.
   * `null` while the Dijkstra TTL has not been assigned yet.
   */
  ttl: number | null;
  /** Ticks remaining before Dijkstra assigns `ttl`. */
  graceTicksRemaining: number;
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
  /** Events that occurred on the tick that produced this snapshot. */
  events: readonly GameEvent[];
}

/** Field size identifiers. */
export type FieldSizeId = "small" | "medium" | "large";

/** Playfield dimensions (height × width as used in product copy). */
export interface FieldSize {
  width: number;
  height: number;
}

/**
 * Available field sizes. Keys match UI labels; values are width × height cells.
 * Product notation Small 11×20 means height 11, width 20.
 */
export const FIELD_SIZES: Record<FieldSizeId, FieldSize> = {
  small: { width: 20, height: 11 },
  medium: { width: 40, height: 22 },
  large: { width: 60, height: 33 },
};

/** Medium field size from the original game. */
export const MEDIUM_SIZE = FIELD_SIZES.medium;

/** Starting snake length. */
export const START_LENGTH = 5;

/** Events emitted during a single tick (for sound / VFX). */
export type GameEvent =
  | { type: "eat_blue" }
  | { type: "eat_green" }
  | { type: "eat_yellow" }
  | { type: "molt" }
  | { type: "die" };

/** Ticks to wait after molt before assigning yellow TTL via Dijkstra. */
export const YELLOW_GRACE_TICKS = 5;

/** Simulation rate used when converting yellow fallback seconds to ticks. */
export const TICKS_PER_SECOND = 10;

/**
 * Minimum unreachable-yellow fallback lifetime in seconds
 * (`max(2 × Manhattan, this)` → ticks).
 */
export const YELLOW_FALLBACK_MIN_SECONDS = 60;
