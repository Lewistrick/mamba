/**
 * Deterministic headless Mamba game engine.
 */

import { createRng, randomInt } from "./rng.ts";
import {
  MEDIUM_SIZE,
  START_LENGTH,
  YELLOW_REACTION_MAX,
  YELLOW_REACTION_MIN,
  FIELD_SIZES,
  type Direction,
  type FieldSizeId,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Point,
  type YellowPellet,
} from "./types.ts";

const OPPOSITE: Record<Direction, Direction> = {
  Up: "Down",
  Down: "Up",
  Left: "Right",
  Right: "Left",
};

const DELTA: Record<Direction, Point> = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
};

const DIRECTIONS: Direction[] = ["Up", "Down", "Left", "Right"];

/**
 * Converts a point to a stable string key.
 *
 * @param p - Grid point.
 * @returns Key string.
 */
function key(p: Point): string {
  return `${p.x},${p.y}`;
}

/**
 * Parses a key back into a point.
 *
 * @param k - Key from {@link key}.
 * @returns Grid point.
 */
function parseKey(k: string): Point {
  const [x, y] = k.split(",").map(Number);
  return { x, y };
}

/**
 * Manhattan distance between two points.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns Manhattan distance.
 */
function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Blue pellet score for the current level (Wikipedia cap: 10).
 *
 * @param level - Current level (1-based).
 * @returns Points awarded for a blue pellet.
 */
export function bluePelletValue(level: number): number {
  return Math.min(level, 10);
}

/**
 * Green pellet score for the current level (Wikipedia cap: 100).
 *
 * @param level - Current level (1-based).
 * @returns Points awarded for a green pellet.
 */
export function greenPelletValue(level: number): number {
  return Math.min(level * 10, 100);
}

/**
 * Headless Mamba simulation. Seed + inputs yield identical scores/states.
 */
export class Game {
  readonly width: number;
  readonly height: number;
  readonly seed: number;

  private readonly rng: () => number;
  private snake: Point[] = [];
  private direction: Direction = "Right";
  private inputQueue: Direction[] = [];
  private walls = new Set<string>();
  private bluePellets = new Set<string>();
  private greenPellets = new Set<string>();
  private yellowPellet: YellowPellet | null = null;
  private score = 0;
  private level = 1;
  private pelletsEatenThisLife = 0;
  private moltThreshold = 0;
  private status: GameStatus = "playing";
  private tickCount = 0;
  private events: GameEvent[] = [];
  private replayHeadings: Direction[] = [];

  /**
   * Creates and initializes a new game.
   *
   * @param config - Field size and seed.
   */
  constructor(config: GameConfig) {
    this.width = config.width;
    this.height = config.height;
    this.seed = config.seed;
    this.rng = createRng(config.seed);
    this.resetSnake(config.startLength ?? START_LENGTH);
    this.moltThreshold = randomInt(this.rng, 12, 22);
    this.spawnInitialBlues();
  }

  /**
   * Creates a medium-field game with a random or provided seed.
   *
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A new medium-field game.
   */
  static medium(seed: number = Date.now() >>> 0): Game {
    return new Game({ ...MEDIUM_SIZE, seed });
  }

  /**
   * Creates a game for a named field size.
   *
   * @param sizeId - Small, medium, or large.
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A new game instance.
   */
  static withSize(sizeId: FieldSizeId, seed: number = Date.now() >>> 0): Game {
    return new Game({ ...FIELD_SIZES[sizeId], seed });
  }

  /**
   * Queues up to two upcoming direction changes (for quick cornering).
   * Ignores 180° reverses relative to the current heading or last queued turn.
   *
   * @param dir - Requested direction.
   */
  queueDirection(dir: Direction): void {
    if (this.status !== "playing") {
      return;
    }

    const baseline =
      this.inputQueue.length > 0
        ? this.inputQueue[this.inputQueue.length - 1]
        : this.direction;

    if (dir === baseline || dir === OPPOSITE[baseline]) {
      return;
    }

    if (this.inputQueue.length < 2) {
      this.inputQueue.push(dir);
      return;
    }

    // Replace the second buffered turn so the latest intent wins.
    this.inputQueue[1] = dir;
  }

  /**
   * Advances the simulation by one tick.
   *
   * @returns Current immutable state snapshot.
   */
  tick(): GameState {
    this.events = [];

    if (this.status !== "playing") {
      return this.getState();
    }

    this.tickCount += 1;

    if (this.inputQueue.length > 0) {
      const nextDir = this.inputQueue.shift()!;
      if (nextDir !== OPPOSITE[this.direction]) {
        this.direction = nextDir;
      }
    }

    this.replayHeadings.push(this.direction);
    return this.advanceAfterHeading();
  }

  /**
   * Advances one tick with an absolute heading (used for replay verification).
   *
   * @param heading - Direction for this tick.
   * @returns Current immutable state snapshot.
   */
  replayStep(heading: Direction): GameState {
    this.events = [];
    if (this.status !== "playing") {
      return this.getState();
    }
    this.tickCount += 1;
    this.inputQueue = [];
    this.direction = heading;
    this.replayHeadings.push(this.direction);
    return this.advanceAfterHeading();
  }

  /**
   * Returns the absolute per-tick headings recorded for anti-cheat replay.
   *
   * @returns Copy of the heading log.
   */
  getReplayHeadings(): Direction[] {
    return [...this.replayHeadings];
  }

  /**
   * Movement + eat + molt after the heading for this tick is finalized.
   *
   * @returns State snapshot.
   */
  private advanceAfterHeading(): GameState {
    this.decayYellow();

    const head = this.snake[0];
    const delta = DELTA[this.direction];
    const next: Point = { x: head.x + delta.x, y: head.y + delta.y };
    const willGrow = this.pelletAt(next) !== null;

    if (
      !this.inBounds(next) ||
      this.walls.has(key(next)) ||
      this.hitsSnake(next, willGrow)
    ) {
      this.status = "gameover";
      this.events.push({ type: "die" });
      return this.getState();
    }

    this.snake.unshift(next);
    const ate = this.tryEatAt(next);

    if (!ate) {
      this.snake.pop();
    }

    if (ate && this.pelletsEatenThisLife >= this.moltThreshold) {
      this.molt();
    }

    return this.getState();
  }

  /**
   * Returns an immutable snapshot of the current state.
   *
   * @returns Game state for rendering or verification.
   */
  getState(): GameState {
    return {
      width: this.width,
      height: this.height,
      snake: this.snake.map((p) => ({ ...p })),
      direction: this.direction,
      walls: [...this.walls].map(parseKey),
      bluePellets: [...this.bluePellets].map(parseKey),
      greenPellets: [...this.greenPellets].map(parseKey),
      yellowPellet: this.yellowPellet
        ? {
            pos: { ...this.yellowPellet.pos },
            value: this.yellowPellet.value,
            ttl: this.yellowPellet.ttl,
          }
        : null,
      score: this.score,
      level: this.level,
      pelletsEatenThisLife: this.pelletsEatenThisLife,
      moltThreshold: this.moltThreshold,
      status: this.status,
      tick: this.tickCount,
      blueValue: bluePelletValue(this.level),
      greenValue: greenPelletValue(this.level),
      events: [...this.events],
    };
  }

  /**
   * Places the snake horizontally in the center, facing right.
   *
   * @param length - Number of segments.
   */
  private resetSnake(length: number): void {
    const cy = Math.floor(this.height / 2);
    const cx = Math.floor(this.width / 2);
    this.snake = [];
    for (let i = 0; i < length; i += 1) {
      this.snake.push({ x: cx - i, y: cy });
    }
    this.direction = "Right";
    this.inputQueue = [];
    this.replayHeadings = [];
  }

  /**
   * Spawns the initial random blue pellet count on empty cells.
   */
  private spawnInitialBlues(): void {
    const count = randomInt(this.rng, 5, 12);
    for (let i = 0; i < count; i += 1) {
      this.placeBlueOnEmpty();
    }
  }

  /**
   * Decrements yellow TTL and removes it when expired.
   */
  private decayYellow(): void {
    if (this.yellowPellet === null) {
      return;
    }
    this.yellowPellet = {
      ...this.yellowPellet,
      ttl: this.yellowPellet.ttl - 1,
    };
    if (this.yellowPellet.ttl <= 0) {
      this.yellowPellet = null;
    }
  }

  /**
   * Identifies which pellet occupies a cell, if any.
   *
   * @param pos - Cell to inspect.
   * @returns Pellet kind, or null.
   */
  private pelletAt(pos: Point): "blue" | "green" | "yellow" | null {
    const k = key(pos);
    if (this.bluePellets.has(k)) {
      return "blue";
    }
    if (this.greenPellets.has(k)) {
      return "green";
    }
    if (
      this.yellowPellet !== null &&
      this.yellowPellet.pos.x === pos.x &&
      this.yellowPellet.pos.y === pos.y
    ) {
      return "yellow";
    }
    return null;
  }

  /**
   * Attempts to eat a pellet at the given cell.
   *
   * @param pos - Cell under the new head.
   * @returns True if a pellet was eaten.
   */
  private tryEatAt(pos: Point): boolean {
    const kind = this.pelletAt(pos);
    if (kind === null) {
      return false;
    }

    if (kind === "blue") {
      this.bluePellets.delete(key(pos));
      this.score += bluePelletValue(this.level);
      this.pelletsEatenThisLife += 1;
      this.events.push({ type: "eat_blue" });
      this.spawnPellet();
      return true;
    }

    if (kind === "green") {
      this.greenPellets.delete(key(pos));
      this.score += greenPelletValue(this.level);
      this.pelletsEatenThisLife += 1;
      this.events.push({ type: "eat_green" });
      this.spawnPellet();
      this.spawnPellet();
      return true;
    }

    this.score += this.yellowPellet!.value;
    this.yellowPellet = null;
    this.events.push({ type: "eat_yellow" });
    this.spawnPellet();
    this.spawnPellet();
    return true;
  }

  /**
   * Molts the snake: older segments become walls; keep the newest 5.
   * Advances the level and spawns a yellow bonus pellet.
   */
  private molt(): void {
    const keep = START_LENGTH;
    if (this.snake.length > keep) {
      const shed = this.snake.slice(keep);
      for (const segment of shed) {
        this.walls.add(key(segment));
      }
      this.snake = this.snake.slice(0, keep);
    }

    this.level += 1;
    this.pelletsEatenThisLife = 0;
    this.moltThreshold = randomInt(this.rng, 12, 22);
    this.events.push({ type: "molt" });
    this.spawnYellow();
  }

  /**
   * Spawns a yellow bonus pellet with value and TTL from level rules.
   */
  private spawnYellow(): void {
    const pos = this.pickEmptyCell();
    if (pos === null) {
      return;
    }

    const multiplier = randomInt(this.rng, 20, 50);
    const value = Math.floor(Math.sqrt(this.level) * multiplier);
    const reaction = randomInt(this.rng, YELLOW_REACTION_MIN, YELLOW_REACTION_MAX);
    const ttl = Math.max(1, manhattan(this.snake[0], pos) * reaction);

    this.yellowPellet = { pos, value, ttl };
  }

  /**
   * Spawns a replacement pellet after eating blue.
   * Empty cell → blue; wall cell → green (with optional chain).
   */
  private spawnPellet(): void {
    const cell = this.pickSpawnCell();
    if (cell === null) {
      return;
    }

    const k = key(cell);
    if (this.walls.has(k)) {
      this.convertWallToGreen(cell);
      return;
    }

    this.bluePellets.add(k);
  }

  /**
   * Places a blue pellet on a random empty cell, or no-ops if full.
   */
  private placeBlueOnEmpty(): void {
    const pos = this.pickEmptyCell();
    if (pos !== null) {
      this.bluePellets.add(key(pos));
    }
  }

  /**
   * Converts a wall cell into a green pellet; 10% chance of a directional chain.
   *
   * @param origin - Wall cell that received the spawn.
   */
  private convertWallToGreen(origin: Point): void {
    const originKey = key(origin);
    this.walls.delete(originKey);
    this.greenPellets.add(originKey);

    if (this.rng() >= 0.1) {
      return;
    }

    const dir = DIRECTIONS[randomInt(this.rng, 0, DIRECTIONS.length - 1)];
    const delta = DELTA[dir];
    let cursor: Point = { x: origin.x + delta.x, y: origin.y + delta.y };

    while (this.inBounds(cursor) && this.walls.has(key(cursor))) {
      const k = key(cursor);
      this.walls.delete(k);
      this.greenPellets.add(k);
      cursor = { x: cursor.x + delta.x, y: cursor.y + delta.y };
    }
  }

  /**
   * Picks any occupied-or-empty cell for pellet spawn (empty or wall).
   *
   * @returns A random non-snake, non-pellet cell, or null if none.
   */
  private pickSpawnCell(): Point | null {
    const candidates: Point[] = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const p = { x, y };
        const k = key(p);
        if (this.isSnakeOccupied(p)) {
          continue;
        }
        if (this.bluePellets.has(k) || this.greenPellets.has(k)) {
          continue;
        }
        if (
          this.yellowPellet !== null &&
          this.yellowPellet.pos.x === x &&
          this.yellowPellet.pos.y === y
        ) {
          continue;
        }
        // Walls and empty cells are both valid spawn targets.
        candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    return candidates[randomInt(this.rng, 0, candidates.length - 1)];
  }

  /**
   * Picks a random empty (non-wall, non-snake, non-pellet) cell.
   *
   * @returns An empty cell, or null if the field is full.
   */
  private pickEmptyCell(): Point | null {
    const candidates: Point[] = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const p = { x, y };
        const k = key(p);
        if (this.walls.has(k) || this.isSnakeOccupied(p)) {
          continue;
        }
        if (this.bluePellets.has(k) || this.greenPellets.has(k)) {
          continue;
        }
        if (
          this.yellowPellet !== null &&
          this.yellowPellet.pos.x === x &&
          this.yellowPellet.pos.y === y
        ) {
          continue;
        }
        candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      return null;
    }
    return candidates[randomInt(this.rng, 0, candidates.length - 1)];
  }

  /**
   * Checks whether a point lies inside the playfield.
   *
   * @param p - Point to test.
   * @returns True if inside bounds.
   */
  private inBounds(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  /**
   * Checks self-collision. When not growing, the tail cell is vacating and safe.
   *
   * @param p - Proposed head position.
   * @param willGrow - Whether the snake will grow this tick.
   * @returns True if the move hits the snake.
   */
  private hitsSnake(p: Point, willGrow: boolean): boolean {
    const limit = willGrow ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < limit; i += 1) {
      const segment = this.snake[i];
      if (segment.x === p.x && segment.y === p.y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether the snake currently occupies a cell.
   *
   * @param p - Point to test.
   * @returns True if occupied by the snake.
   */
  private isSnakeOccupied(p: Point): boolean {
    return this.snake.some((segment) => segment.x === p.x && segment.y === p.y);
  }
}
