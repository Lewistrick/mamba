/**
 * Deterministic headless Mamba game engine (solo or human vs AI).
 */

import { createRng, randomInt } from "./rng.ts";
import { dijkstraDistance, dijkstraDistancesFrom } from "./pathfinding.ts";
import { versusNetScore } from "./scoring.ts";
import {
  MEDIUM_SIZE,
  START_LENGTH,
  TICKS_PER_SECOND,
  YELLOW_FALLBACK_MIN_SECONDS,
  YELLOW_GRACE_TICKS,
  FIELD_SIZES,
  type Direction,
  type FieldSizeId,
  type GameConfig,
  type GameEvent,
  type GameState,
  type GameStatus,
  type Point,
  type SnakePlayerState,
  type YellowPellet,
} from "./types.ts";

export { pelletScore, versusHudNetScore, versusNetScore } from "./scoring.ts";

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

/** Fixed molt threshold for fair (real multiplayer) games — see {@link GameConfig.fair}. */
const FAIR_MOLT_THRESHOLD = 20;

/** Fixed lime-pellet value multiplier for fair (real multiplayer) games. */
const FAIR_YELLOW_MULTIPLIER = 20;

/** Mutable per-snake simulation state. */
interface PlayerInternal {
  body: Point[];
  direction: Direction;
  inputQueue: Direction[];
  score: number;
  survivalScore: number;
  winBonus: number;
  level: number;
  pelletsEatenThisLife: number;
  moltThreshold: number;
  alive: boolean;
  replayHeadings: Direction[];
}

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
 * TTL used when Dijkstra cannot reach the yellow pellet.
 *
 * @param head - Snake head.
 * @param pellet - Yellow pellet position.
 * @returns Lifetime in ticks.
 */
function unreachableYellowTtl(head: Point, pellet: Point): number {
  const manhattanTicks = 2 * manhattan(head, pellet);
  const minTicks = YELLOW_FALLBACK_MIN_SECONDS * TICKS_PER_SECOND;
  return Math.max(manhattanTicks, minTicks);
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
  readonly playerCount: 1 | 2;
  private readonly fair: boolean;

  private readonly rng: () => number;
  private readonly players: PlayerInternal[] = [];
  private walls = new Set<string>();
  private bluePellets = new Set<string>();
  private greenPellets = new Set<string>();
  private yellowPellet: YellowPellet | null = null;
  private status: GameStatus = "playing";
  private tickCount = 0;
  private events: GameEvent[] = [];

  /**
   * Creates and initializes a new game.
   *
   * @param config - Field size, seed, and player count.
   */
  constructor(config: GameConfig) {
    this.width = config.width;
    this.height = config.height;
    this.seed = config.seed;
    this.playerCount = config.playerCount === 2 ? 2 : 1;
    this.fair = config.fair ?? false;
    this.rng = createRng(config.seed);
    const length = config.startLength ?? START_LENGTH;
    this.initPlayers(length);
    this.spawnInitialBlues();
  }

  /**
   * Creates a medium-field solo game.
   *
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A new medium-field game.
   */
  static medium(seed: number = Date.now() >>> 0): Game {
    return new Game({ ...MEDIUM_SIZE, seed });
  }

  /**
   * Creates a solo game for a named field size.
   *
   * @param sizeId - Small, medium, or large.
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A new game instance.
   */
  static withSize(sizeId: FieldSizeId, seed: number = Date.now() >>> 0): Game {
    return new Game({ ...FIELD_SIZES[sizeId], seed, playerCount: 1 });
  }

  /**
   * Creates a human-vs-human game for a named field size. Runs with `fair`
   * rules (fixed molt threshold, fixed lime value, no opponent deduction) so
   * real matches are decided by skill rather than RNG.
   *
   * @param sizeId - Small, medium, or large.
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A two-player game instance.
   */
  static versusHuman(sizeId: FieldSizeId, seed: number = Date.now() >>> 0): Game {
    return new Game({ ...FIELD_SIZES[sizeId], seed, playerCount: 2, fair: true });
  }

  /**
   * Creates a human-vs-AI game for a named field size. Keeps the original
   * RNG-driven rules (unlike {@link Game.versusHuman}).
   *
   * @param sizeId - Small, medium, or large.
   * @param seed - Optional seed; defaults to a time-based value.
   * @returns A two-player game instance.
   */
  static versusAi(sizeId: FieldSizeId, seed: number = Date.now() >>> 0): Game {
    return new Game({ ...FIELD_SIZES[sizeId], seed, playerCount: 2, fair: false });
  }

  /**
   * Queues a direction for player 0 (solo / human).
   *
   * @param dir - Requested direction.
   */
  queueDirection(dir: Direction): void;
  /**
   * Queues a direction for a specific player.
   *
   * @param playerIndex - 0 = human, 1 = AI.
   * @param dir - Requested direction.
   */
  queueDirection(playerIndex: number, dir: Direction): void;
  queueDirection(playerIndexOrDir: number | Direction, maybeDir?: Direction): void {
    if (this.status !== "playing") {
      return;
    }
    let playerIndex: number;
    let dir: Direction;
    if (typeof playerIndexOrDir === "number") {
      playerIndex = playerIndexOrDir;
      dir = maybeDir!;
    } else {
      playerIndex = 0;
      dir = playerIndexOrDir;
    }
    const player = this.players[playerIndex];
    if (!player?.alive) {
      return;
    }

    const baseline =
      player.inputQueue.length > 0
        ? player.inputQueue[player.inputQueue.length - 1]
        : player.direction;

    if (dir === baseline || dir === OPPOSITE[baseline]) {
      return;
    }

    if (player.inputQueue.length < 2) {
      player.inputQueue.push(dir);
      return;
    }

    player.inputQueue[1] = dir;
  }

  /**
   * Advances the simulation by one tick (applies queued turns, then moves).
   *
   * @returns Current immutable state snapshot.
   */
  tick(): GameState {
    this.events = [];

    if (this.status !== "playing") {
      return this.getState();
    }

    this.tickCount += 1;

    for (const player of this.players) {
      if (!player.alive) {
        continue;
      }
      if (player.inputQueue.length > 0) {
        const nextDir = player.inputQueue.shift()!;
        if (nextDir !== OPPOSITE[player.direction]) {
          player.direction = nextDir;
        }
      }
      player.replayHeadings.push(player.direction);
    }

    return this.advanceSimultaneous();
  }

  /**
   * Advances one tick with absolute heading(s) (replay verification).
   *
   * @param headingOrHeadings - Solo heading, or one heading per living player slot.
   * @returns Current immutable state snapshot.
   */
  replayStep(headingOrHeadings: Direction | Direction[]): GameState {
    this.events = [];
    if (this.status !== "playing") {
      return this.getState();
    }
    this.tickCount += 1;

    const headings = Array.isArray(headingOrHeadings)
      ? headingOrHeadings
      : [headingOrHeadings];

    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i];
      player.inputQueue = [];
      if (!player.alive) {
        continue;
      }
      const heading = headings[i] ?? player.direction;
      player.direction = heading;
      player.replayHeadings.push(player.direction);
    }

    return this.advanceSimultaneous();
  }

  /**
   * Returns player 0's absolute per-tick headings (solo / human).
   *
   * @returns Copy of the heading log.
   */
  getReplayHeadings(): Direction[] {
    return [...this.players[0].replayHeadings];
  }

  /**
   * Returns per-player absolute heading logs.
   *
   * @returns One array per player.
   */
  getReplayHeadingsByPlayer(): Direction[][] {
    return this.players.map((p) => [...p.replayHeadings]);
  }

  /**
   * Net score for leaderboards: pellets_you − pellets_opp + your time + your win.
   *
   * @returns Net score.
   */
  netScore(): number {
    if (this.players.length < 2) {
      return this.players[0].score;
    }
    return versusNetScore(this.players[0], this.players[1], this.fair);
  }

  /**
   * Returns an immutable snapshot of the current state.
   *
   * @returns Game state for rendering or verification.
   */
  getState(): GameState {
    const snapshotPlayers = this.players.map((p) => this.toPlayerState(p));
    const p0 = snapshotPlayers[0];
    return {
      width: this.width,
      height: this.height,
      players: snapshotPlayers,
      snake: p0.body,
      direction: p0.direction,
      walls: [...this.walls].map(parseKey),
      bluePellets: [...this.bluePellets].map(parseKey),
      greenPellets: [...this.greenPellets].map(parseKey),
      yellowPellet: this.yellowPellet
        ? {
            pos: { ...this.yellowPellet.pos },
            value: this.yellowPellet.value,
            ttl: this.yellowPellet.ttl,
            graceTicksRemaining: this.yellowPellet.graceTicksRemaining,
          }
        : null,
      score: p0.score,
      survivalScore: p0.survivalScore,
      winBonus: p0.winBonus,
      level: p0.level,
      pelletsEatenThisLife: p0.pelletsEatenThisLife,
      moltThreshold: p0.moltThreshold,
      netScore: this.netScore(),
      status: this.status,
      tick: this.tickCount,
      blueValue: p0.blueValue,
      greenValue: p0.greenValue,
      events: [...this.events],
    };
  }

  /**
   * Places snakes for solo (center) or versus (left / right).
   *
   * @param length - Starting length.
   */
  private initPlayers(length: number): void {
    const cy = Math.floor(this.height / 2);
    if (this.playerCount === 1) {
      const cx = Math.floor(this.width / 2);
      this.players.push(this.makePlayer(length, cx, cy, "Right", -1));
      return;
    }

    const leftCx = Math.max(length, Math.floor(this.width * 0.25));
    const rightCx = Math.min(this.width - length - 1, Math.floor(this.width * 0.75));
    this.players.push(this.makePlayer(length, leftCx, cy, "Right", -1));
    this.players.push(this.makePlayer(length, rightCx, cy, "Left", 1));
  }

  /**
   * Builds a player with a horizontal body.
   *
   * @param length - Segment count.
   * @param headX - Head x.
   * @param headY - Head y.
   * @param direction - Facing.
   * @param tailStepX - Body extension step (−1 left of head when facing right).
   * @returns Player internal state.
   */
  private makePlayer(
    length: number,
    headX: number,
    headY: number,
    direction: Direction,
    tailStepX: number,
  ): PlayerInternal {
    const body: Point[] = [];
    for (let i = 0; i < length; i += 1) {
      body.push({ x: headX + i * tailStepX, y: headY });
    }
    return {
      body,
      direction,
      inputQueue: [],
      score: 0,
      survivalScore: 0,
      winBonus: 0,
      level: 1,
      pelletsEatenThisLife: 0,
      moltThreshold: this.fair ? FAIR_MOLT_THRESHOLD : randomInt(this.rng, 12, 22),
      alive: true,
      replayHeadings: [],
    };
  }

  /**
   * Maps internal player state to an immutable snapshot.
   *
   * @param player - Internal player.
   * @returns Snapshot row.
   */
  private toPlayerState(player: PlayerInternal): SnakePlayerState {
    return {
      body: player.body.map((p) => ({ ...p })),
      direction: player.direction,
      score: player.score,
      survivalScore: player.survivalScore,
      winBonus: player.winBonus,
      level: player.level,
      pelletsEatenThisLife: player.pelletsEatenThisLife,
      moltThreshold: player.moltThreshold,
      alive: player.alive,
      blueValue: bluePelletValue(player.level),
      greenValue: greenPelletValue(player.level),
    };
  }

  /**
   * Simultaneous move + eat + molt for all living snakes.
   *
   * @returns State snapshot.
   */
  private advanceSimultaneous(): GameState {
    this.decayYellow();
    this.applySurvivalBonus();

    const livingIndexes = this.players
      .map((p, i) => (p.alive ? i : -1))
      .filter((i) => i >= 0);

    const nextHeads = new Map<number, Point>();
    const willGrow = new Map<number, boolean>();

    for (const i of livingIndexes) {
      const player = this.players[i];
      const delta = DELTA[player.direction];
      const next: Point = {
        x: player.body[0].x + delta.x,
        y: player.body[0].y + delta.y,
      };
      nextHeads.set(i, next);
      willGrow.set(i, this.pelletAt(next) !== null);
    }

    // Head-on / same-cell collisions.
    for (let a = 0; a < livingIndexes.length; a += 1) {
      for (let b = a + 1; b < livingIndexes.length; b += 1) {
        const ia = livingIndexes[a];
        const ib = livingIndexes[b];
        const ha = nextHeads.get(ia)!;
        const hb = nextHeads.get(ib)!;
        const swap =
          ha.x === this.players[ib].body[0].x &&
          ha.y === this.players[ib].body[0].y &&
          hb.x === this.players[ia].body[0].x &&
          hb.y === this.players[ia].body[0].y;
        if ((ha.x === hb.x && ha.y === hb.y) || swap) {
          this.killPlayer(ia);
          this.killPlayer(ib);
        }
      }
    }

    for (const i of livingIndexes) {
      if (!this.players[i].alive) {
        continue;
      }
      const next = nextHeads.get(i)!;
      const grow = willGrow.get(i)!;
      if (
        !this.inBounds(next) ||
        this.walls.has(key(next)) ||
        this.hitsAnySnake(next, i, grow)
      ) {
        this.killPlayer(i);
      }
    }

    if (this.status === "gameover") {
      this.maybeAwardWinBonus();
      return this.getState();
    }

    // Claim pellets: lower index wins ties.
    const pelletClaims = new Map<string, number>();
    for (const i of livingIndexes) {
      if (!this.players[i].alive) {
        continue;
      }
      const next = nextHeads.get(i)!;
      if (this.pelletAt(next) === null) {
        continue;
      }
      const k = key(next);
      if (!pelletClaims.has(k)) {
        pelletClaims.set(k, i);
      }
    }

    const molted: number[] = [];
    for (const i of livingIndexes) {
      if (!this.players[i].alive) {
        continue;
      }
      const player = this.players[i];
      const next = nextHeads.get(i)!;
      const claimOwner = pelletClaims.get(key(next));
      const ate = claimOwner === i;

      player.body.unshift(next);
      if (ate) {
        this.tryEatAt(i, next);
        if (player.pelletsEatenThisLife >= player.moltThreshold) {
          molted.push(i);
        }
      } else {
        player.body.pop();
      }
    }

    for (const i of molted) {
      if (this.players[i].alive) {
        this.molt(i);
      }
    }

    return this.getState();
  }

  /**
   * Each real-time second (10 ticks), living snakes gain `level` points.
   * Versus / AI only — solo does not award a time bonus.
   */
  private applySurvivalBonus(): void {
    if (this.playerCount < 2) {
      return;
    }
    if (this.tickCount === 0 || this.tickCount % TICKS_PER_SECOND !== 0) {
      return;
    }
    for (const player of this.players) {
      if (!player.alive) {
        continue;
      }
      player.score += player.level;
      player.survivalScore += player.level;
    }
  }

  /**
   * Marks a player dead and ends the run (either death ends versus/solo).
   * Win bonus is applied once after all deaths in the tick (see maybeAwardWinBonus).
   *
   * @param playerIndex - Who died.
   */
  private killPlayer(playerIndex: number): void {
    const player = this.players[playerIndex];
    if (!player.alive) {
      return;
    }
    player.alive = false;
    this.events.push({ type: "die", player: playerIndex });
    this.status = "gameover";
  }

  /**
   * Ends the run because a player disconnected / forfeited.
   *
   * @param playerIndex - Who left.
   * @returns Final state (sole survivor gets win bonus).
   */
  forfeit(playerIndex: number): GameState {
    this.events = [];
    this.killPlayer(playerIndex);
    this.maybeAwardWinBonus();
    return this.getState();
  }

  /**
   * Awards `100 × level` to the sole survivor in a 2-player game.
   * Head-on (both dead) grants no win bonus.
   */
  private maybeAwardWinBonus(): void {
    if (this.playerCount < 2) {
      return;
    }
    const survivors = this.players.filter((p) => p.alive);
    if (survivors.length !== 1) {
      return;
    }
    const winner = survivors[0];
    if (winner.winBonus > 0) {
      return;
    }
    const bonus = 100 * winner.level;
    winner.score += bonus;
    winner.winBonus += bonus;
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
   * Advances yellow grace / TTL using the closest living snake head.
   */
  private decayYellow(): void {
    if (this.yellowPellet === null) {
      return;
    }

    if (this.yellowPellet.graceTicksRemaining > 0) {
      const graceTicksRemaining = this.yellowPellet.graceTicksRemaining - 1;
      if (graceTicksRemaining > 0) {
        this.yellowPellet = { ...this.yellowPellet, graceTicksRemaining };
        return;
      }

      const blocked = new Set<string>(this.walls);
      for (const player of this.players) {
        if (!player.alive) {
          continue;
        }
        for (const segment of player.body) {
          blocked.add(key(segment));
        }
      }

      const headDistances: { head: Point; distance: number }[] = [];
      for (const player of this.players) {
        if (!player.alive) {
          continue;
        }
        const head = player.body[0];
        const distance = dijkstraDistance(
          this.width,
          this.height,
          head,
          this.yellowPellet.pos,
          blocked,
        );
        if (distance !== null) {
          headDistances.push({ head, distance });
        }
      }

      let ttl: number;
      if (
        this.playerCount === 2 &&
        headDistances.length === 2
      ) {
        // Fair timer: enough ticks for the farther snake (spawn aims for equal dists).
        ttl = Math.max(headDistances[0].distance, headDistances[1].distance) +
          YELLOW_GRACE_TICKS;
      } else if (headDistances.length > 0) {
        const best = headDistances.reduce((a, b) =>
          a.distance < b.distance ? a : b,
        );
        ttl =
          best.distance > 0
            ? best.distance + YELLOW_GRACE_TICKS
            : unreachableYellowTtl(best.head, this.yellowPellet.pos);
      } else {
        ttl = unreachableYellowTtl(
          this.players[0].body[0],
          this.yellowPellet.pos,
        );
      }
      this.yellowPellet = {
        ...this.yellowPellet,
        graceTicksRemaining: 0,
        ttl,
      };
      return;
    }

    if (this.yellowPellet.ttl === null) {
      this.yellowPellet = null;
      return;
    }

    const ttl = this.yellowPellet.ttl - 1;
    if (ttl <= 0) {
      this.yellowPellet = null;
      return;
    }
    this.yellowPellet = { ...this.yellowPellet, ttl };
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
   * Attempts to eat a pellet for a player at the given cell.
   *
   * @param playerIndex - Eating player.
   * @param pos - Cell under the new head.
   * @returns True if a pellet was eaten.
   */
  private tryEatAt(playerIndex: number, pos: Point): boolean {
    const kind = this.pelletAt(pos);
    if (kind === null) {
      return false;
    }
    const player = this.players[playerIndex];

    if (kind === "blue") {
      this.bluePellets.delete(key(pos));
      player.score += bluePelletValue(player.level);
      player.pelletsEatenThisLife += 1;
      this.events.push({ type: "eat_blue", player: playerIndex });
      this.spawnPellet();
      return true;
    }

    if (kind === "green") {
      this.greenPellets.delete(key(pos));
      player.score += greenPelletValue(player.level);
      player.pelletsEatenThisLife += 1;
      this.events.push({ type: "eat_green", player: playerIndex });
      this.spawnPellet();
      this.spawnPellet();
      return true;
    }

    player.score += this.yellowPellet!.value;
    this.yellowPellet = null;
    this.events.push({ type: "eat_yellow", player: playerIndex });
    this.spawnPellet();
    this.spawnPellet();
    return true;
  }

  /**
   * Molts a snake: older segments become walls; keep the newest 5.
   *
   * @param playerIndex - Molting player.
   */
  private molt(playerIndex: number): void {
    const player = this.players[playerIndex];
    const keep = START_LENGTH;
    if (player.body.length > keep) {
      const shed = player.body.slice(keep);
      for (const segment of shed) {
        this.walls.add(key(segment));
      }
      player.body = player.body.slice(0, keep);
    }

    player.level += 1;
    player.pelletsEatenThisLife = 0;
    player.moltThreshold = this.fair
      ? FAIR_MOLT_THRESHOLD
      : randomInt(this.rng, 12, 22);
    this.events.push({ type: "molt", player: playerIndex });
    this.spawnYellow(player.level, playerIndex);
  }

  /**
   * Spawns a yellow bonus pellet if none is active.
   *
   * @param level - Level of the molting snake (for value).
   * @param molterIndex - Who molted (versus: bias spawn toward this snake).
   */
  private spawnYellow(level: number, molterIndex = 0): void {
    if (this.yellowPellet !== null) {
      return;
    }
    const pos =
      this.playerCount === 2
        ? this.pickBiasedYellowCell(molterIndex)
        : this.pickEmptyCell();
    if (pos === null) {
      return;
    }

    const multiplier = this.fair
      ? FAIR_YELLOW_MULTIPLIER
      : randomInt(this.rng, 20, 50);
    const value = Math.floor(Math.sqrt(level) * multiplier);

    this.yellowPellet = {
      pos,
      value,
      ttl: null,
      graceTicksRemaining: YELLOW_GRACE_TICKS,
    };
  }

  /**
   * Picks an empty cell ~N Dijkstra ticks closer to the molting snake than the
   * opponent (N random in 5–10 inclusive). Falls back to minimizing
   * `| (dOpp − dMolter) − N |`, then {@link pickEmptyCell}.
   *
   * @param molterIndex - Seat that just molted.
   * @returns Biased empty cell, or null if the field is full.
   */
  private pickBiasedYellowCell(molterIndex: number): Point | null {
    const molter = this.players[molterIndex];
    const other = this.players[1 - molterIndex];
    if (!molter?.alive || !other?.alive) {
      return this.pickEmptyCell();
    }

    const blocked = new Set<string>(this.walls);
    for (const player of this.players) {
      if (!player.alive) {
        continue;
      }
      for (const segment of player.body) {
        blocked.add(key(segment));
      }
    }

    const distMolter = dijkstraDistancesFrom(
      this.width,
      this.height,
      molter.body[0],
      blocked,
    );
    const distOther = dijkstraDistancesFrom(
      this.width,
      this.height,
      other.body[0],
      blocked,
    );

    const bias = randomInt(this.rng, 5, 10);
    let bestBiasError = Number.POSITIVE_INFINITY;
    let bestMolterDist = Number.POSITIVE_INFINITY;
    const tied: Point[] = [];

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
        const dM = distMolter.get(k);
        const dO = distOther.get(k);
        if (dM === undefined || dO === undefined || dM === 0 || dO === 0) {
          continue;
        }
        // Prefer cells closer to the molter by ~bias ticks: dO − dM ≈ bias.
        const biasError = Math.abs(dO - dM - bias);
        if (
          biasError < bestBiasError ||
          (biasError === bestBiasError && dM < bestMolterDist)
        ) {
          bestBiasError = biasError;
          bestMolterDist = dM;
          tied.length = 0;
          tied.push(p);
        } else if (biasError === bestBiasError && dM === bestMolterDist) {
          tied.push(p);
        }
      }
    }

    if (tied.length === 0) {
      return this.pickEmptyCell();
    }
    return tied[randomInt(this.rng, 0, tied.length - 1)];
  }

  /**
   * Spawns a replacement pellet after eating.
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
   * Collision against any snake body, accounting for vacating tails.
   *
   * @param p - Proposed head.
   * @param selfIndex - Moving player.
   * @param selfWillGrow - Whether self grows this tick.
   * @returns True if blocked.
   */
  private hitsAnySnake(p: Point, selfIndex: number, selfWillGrow: boolean): boolean {
    for (let i = 0; i < this.players.length; i += 1) {
      const other = this.players[i];
      if (!other.alive && i !== selfIndex) {
        // Dead bodies still occupy until game ends; treat as solid.
      }
      const body = other.body;
      const grow = i === selfIndex ? selfWillGrow : false;
      // Other snakes: if they also move this tick, their tail vacates only if they don't grow.
      // Approximate with current body; simultaneous tails handled via head-on check separately.
      let limit = body.length;
      if (i === selfIndex) {
        limit = grow ? body.length : body.length - 1;
      } else if (other.alive) {
        // Other living snake will move: tail vacates unless they grow into a pellet.
        const otherNext = {
          x: body[0].x + DELTA[other.direction].x,
          y: body[0].y + DELTA[other.direction].y,
        };
        const otherGrows = this.pelletAt(otherNext) !== null;
        limit = otherGrows ? body.length : body.length - 1;
      }
      for (let s = 0; s < limit; s += 1) {
        if (body[s].x === p.x && body[s].y === p.y) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Checks whether any snake currently occupies a cell.
   *
   * @param p - Point to test.
   * @returns True if occupied.
   */
  private isSnakeOccupied(p: Point): boolean {
    return this.players.some((player) =>
      player.body.some((segment) => segment.x === p.x && segment.y === p.y),
    );
  }
}
