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

/** Per-snake snapshot for solo or versus play. */
export interface SnakePlayerState {
  body: readonly Point[];
  direction: Direction;
  score: number;
  /** Points earned from surviving (+level each second). Versus / AI only. */
  survivalScore: number;
  /** Bonus for being the sole survivor (`100 × level`). Versus only; else 0. */
  winBonus: number;
  level: number;
  pelletsEatenThisLife: number;
  moltThreshold: number;
  alive: boolean;
  blueValue: number;
  greenValue: number;
}

/** AI difficulty identifiers used in `ai:{id}` leaderboard modes. */
export type AiDifficulty = "easy" | "medium" | "hard";

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
  /** 1 = solo, 2 = human vs AI (default 1). */
  playerCount?: 1 | 2;
}

/** Immutable snapshot of engine state for rendering / networking. */
export interface GameState {
  width: number;
  height: number;
  /** All snakes (length 1 solo, 2 versus). */
  players: readonly SnakePlayerState[];
  /** Player 0 body (solo / human). */
  snake: readonly Point[];
  /** Player 0 heading. */
  direction: Direction;
  walls: readonly Point[];
  bluePellets: readonly Point[];
  greenPellets: readonly Point[];
  yellowPellet: YellowPellet | null;
  /** Player 0 score. */
  score: number;
  /** Player 0 survival bonus total (+level each second). Versus / AI only. */
  survivalScore: number;
  /** Player 0 win bonus for beating the AI (`100 × level`). */
  winBonus: number;
  /** Player 0 level. */
  level: number;
  pelletsEatenThisLife: number;
  moltThreshold: number;
  /** Versus: pellets_you − pellets_opp + your time + your win; solo: score. */
  netScore: number;
  status: GameStatus;
  tick: number;
  /** Blue pellet award for player 0's level. */
  blueValue: number;
  /** Green pellet award for player 0's level. */
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
  | { type: "eat_blue"; player: number }
  | { type: "eat_green"; player: number }
  | { type: "eat_yellow"; player: number }
  | { type: "molt"; player: number }
  | { type: "die"; player: number };

/** Ticks to wait after molt before assigning yellow TTL via Dijkstra. */
export const YELLOW_GRACE_TICKS = 5;

/** Simulation rate used when converting yellow fallback seconds to ticks. */
export const TICKS_PER_SECOND = 10;

/**
 * Minimum unreachable-yellow fallback lifetime in seconds
 * (`max(2 × Manhattan, this)` → ticks).
 */
export const YELLOW_FALLBACK_MIN_SECONDS = 60;

/** Supported AI difficulties. */
export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "medium", "hard"];
