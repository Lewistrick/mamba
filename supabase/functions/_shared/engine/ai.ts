/**
 * Deterministic AI policies for human-vs-AI games (player index 1).
 */

import { dijkstraDistance } from "./pathfinding.ts";
import { createRng, randomInt } from "./rng.ts";
import type {
  AiDifficulty,
  Direction,
  GameState,
  Point,
  SnakePlayerState,
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

const DIRS: Direction[] = ["Up", "Down", "Left", "Right"];

const MEDIUM_REACTION_MAX = 3;
const MEDIUM_STICKY_REPATH = 8;
const MEDIUM_SWITCH_RATIO = 1.35;
/** Hard only aborts a chase into pockets smaller than this. */
const HARD_MIN_CHASE_SPACE = 3;

/**
 * Builds a blocked-cell set for pathfinding from the AI's perspective.
 *
 * @param state - Current game state.
 * @param selfIndex - AI player index.
 * @returns Occupied keys (walls + bodies).
 */
function blockedCells(state: GameState, selfIndex: number): Set<string> {
  const blocked = new Set<string>();
  for (const wall of state.walls) {
    blocked.add(`${wall.x},${wall.y}`);
  }
  for (let i = 0; i < state.players.length; i += 1) {
    const body = state.players[i].body;
    const limit =
      i === selfIndex ? Math.max(0, body.length - 1) : body.length;
    for (let s = 0; s < limit; s += 1) {
      blocked.add(`${body[s].x},${body[s].y}`);
    }
  }
  return blocked;
}

/**
 * Lists pellet targets the AI may chase.
 *
 * @param state - Game state.
 * @param includeYellow - Whether yellow is allowed.
 * @returns Target points with optional value hint.
 */
function pelletTargets(
  state: GameState,
  includeYellow: boolean,
): { pos: Point; value: number }[] {
  const targets: { pos: Point; value: number }[] = [];
  for (const p of state.bluePellets) {
    targets.push({ pos: p, value: state.players[1]?.blueValue ?? 1 });
  }
  for (const p of state.greenPellets) {
    targets.push({ pos: p, value: state.players[1]?.greenValue ?? 10 });
  }
  if (includeYellow && state.yellowPellet) {
    targets.push({
      pos: state.yellowPellet.pos,
      value: state.yellowPellet.value,
    });
  }
  return targets;
}

/**
 * Counts orthogonal neighbors that are in-bounds and not walls.
 *
 * @param state - Game state.
 * @param pos - Cell to inspect.
 * @returns Open side count (0–4).
 */
function openNonWallSides(state: GameState, pos: Point): number {
  const walls = new Set(state.walls.map((w) => `${w.x},${w.y}`));
  let open = 0;
  for (const dir of DIRS) {
    const n = { x: pos.x + DELTA[dir].x, y: pos.y + DELTA[dir].y };
    if (n.x < 0 || n.y < 0 || n.x >= state.width || n.y >= state.height) {
      continue;
    }
    if (!walls.has(`${n.x},${n.y}`)) {
      open += 1;
    }
  }
  return open;
}

/**
 * True when a green pellet sits in a wall pocket (dead-end / fully enclosed).
 *
 * Greens with fewer than two open sides leave no room to escape after eating.
 *
 * @param state - Game state.
 * @param pos - Candidate pellet cell.
 * @returns Whether hard AI should ignore this green.
 */
function isEnclosedGreen(state: GameState, pos: Point): boolean {
  const isGreen = state.greenPellets.some((p) => p.x === pos.x && p.y === pos.y);
  if (!isGreen) {
    return false;
  }
  return openNonWallSides(state, pos) < 2;
}

/**
 * First step of a shortest path toward a goal, or null if unreachable.
 *
 * @param state - Game state.
 * @param self - AI snake.
 * @param goal - Target cell.
 * @param blocked - Impassable cells.
 * @returns Direction to step, or null.
 */
function stepToward(
  state: GameState,
  self: SnakePlayerState,
  goal: Point,
  blocked: Set<string>,
): Direction | null {
  const head = self.body[0];
  let best: Direction | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const dir of DIRS) {
    if (dir === OPPOSITE[self.direction]) {
      continue;
    }
    const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
    if (
      next.x < 0 ||
      next.y < 0 ||
      next.x >= state.width ||
      next.y >= state.height
    ) {
      continue;
    }
    if (blocked.has(`${next.x},${next.y}`)) {
      continue;
    }
    const dist = dijkstraDistance(state.width, state.height, next, goal, blocked);
    if (dist === null) {
      continue;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = dir;
    }
  }
  return best;
}

/**
 * True if stepping in `dir` is immediately lethal.
 *
 * @param state - Game state.
 * @param self - AI snake.
 * @param dir - Candidate direction.
 * @param blocked - Impassable cells.
 * @returns Whether the move dies next tick.
 */
function isImmediateDeath(
  state: GameState,
  self: SnakePlayerState,
  dir: Direction,
  blocked: Set<string>,
): boolean {
  const head = self.body[0];
  const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
  if (
    next.x < 0 ||
    next.y < 0 ||
    next.x >= state.width ||
    next.y >= state.height
  ) {
    return true;
  }
  return blocked.has(`${next.x},${next.y}`);
}

/**
 * Picks any safe non-reverse direction, preferring more free space.
 *
 * @param state - Game state.
 * @param self - AI snake.
 * @param blocked - Impassable cells.
 * @param rng - RNG.
 * @returns A safe direction.
 */
function safeFallback(
  state: GameState,
  self: SnakePlayerState,
  blocked: Set<string>,
  rng: () => number,
): Direction {
  const ordered = [self.direction, ...DIRS.filter((d) => d !== self.direction)];
  const safe = ordered.filter(
    (d) => d !== OPPOSITE[self.direction] && !isImmediateDeath(state, self, d, blocked),
  );
  if (safe.length === 0) {
    return self.direction;
  }

  let best = safe[0];
  let bestSpace = -1;
  for (const dir of safe) {
    const space = spaceAfterMove(state, self, dir, blocked);
    if (space > bestSpace) {
      bestSpace = space;
      best = dir;
    } else if (space === bestSpace && dir === self.direction) {
      best = dir;
    }
  }
  // Tiny noise among equal space.
  const tied = safe.filter((d) => spaceAfterMove(state, self, d, blocked) === bestSpace);
  if (tied.length > 1) {
    return tied[randomInt(rng, 0, tied.length - 1)];
  }
  return best;
}

/**
 * Reachable free cells after taking one step in `dir` (tail treated as vacating).
 *
 * @param state - Game state.
 * @param self - Moving snake.
 * @param dir - Candidate direction.
 * @param blocked - Base impassable set.
 * @returns Flood-fill count, or -1 if the step dies.
 */
function spaceAfterMove(
  state: GameState,
  self: SnakePlayerState,
  dir: Direction,
  blocked: Set<string>,
): number {
  if (isImmediateDeath(state, self, dir, blocked)) {
    return -1;
  }
  const head = self.body[0];
  const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
  const nextBlocked = new Set(blocked);
  nextBlocked.add(`${head.x},${head.y}`);
  // Approximate non-grow: current tail vacates.
  if (self.body.length > 1) {
    const tail = self.body[self.body.length - 1];
    nextBlocked.delete(`${tail.x},${tail.y}`);
  }
  return floodSpace(state, next, nextBlocked, 120);
}

/**
 * Minimum open space medium AI insists on before chasing a pellet turn.
 *
 * @param self - AI snake.
 * @returns Cell count threshold.
 */
function mediumMinSpace(self: SnakePlayerState): number {
  return Math.max(14, self.body.length + 6);
}

/**
 * Counts reachable free cells with a bounded BFS flood fill.
 *
 * @param state - Game state.
 * @param start - Origin.
 * @param blocked - Impassable cells.
 * @param limit - Max cells to visit.
 * @returns Reachable count.
 */
function floodSpace(
  state: GameState,
  start: Point,
  blocked: Set<string>,
  limit: number,
): number {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: Point[] = [start];
  let count = 0;
  while (queue.length > 0 && count < limit) {
    const cur = queue.shift()!;
    count += 1;
    for (const dir of DIRS) {
      const n = { x: cur.x + DELTA[dir].x, y: cur.y + DELTA[dir].y };
      const k = `${n.x},${n.y}`;
      if (n.x < 0 || n.y < 0 || n.x >= state.width || n.y >= state.height) {
        continue;
      }
      if (blocked.has(k) || seen.has(k)) {
        continue;
      }
      seen.add(k);
      queue.push(n);
    }
  }
  return count;
}

/**
 * Stateful AI that emits one direction per tick for player 1.
 */
export class AiBrain {
  readonly difficulty: AiDifficulty;
  private readonly rng: () => number;
  private stickyTarget: Point | null = null;
  private ticksSinceRepath = 0;
  private pendingDir: Direction | null = null;
  private reactionLeft = 0;

  /**
   * @param difficulty - Easy / medium / hard.
   * @param seed - Game seed mixed into AI RNG.
   */
  constructor(difficulty: AiDifficulty, seed: number) {
    this.difficulty = difficulty;
    const mix =
      (seed >>> 0) ^
      (difficulty === "easy" ? 0x11111111 : difficulty === "medium" ? 0x22222222 : 0x33333333);
    this.rng = createRng(mix >>> 0);
  }

  /**
   * Chooses the AI heading for this tick.
   *
   * @param state - Current engine snapshot (must include player 1).
   * @returns Direction to queue for player 1.
   */
  decide(state: GameState): Direction {
    const self = state.players[1];
    if (!self?.alive) {
      return "Right";
    }
    const blocked = blockedCells(state, 1);
    switch (this.difficulty) {
      case "easy":
        return this.decideEasy(state, self, blocked);
      case "medium":
        return this.decideMedium(state, self, blocked);
      case "hard":
        return this.decideHard(state, self, blocked);
    }
  }

  /**
   * Easy: sticky pellet target, infrequent turns, survival glance.
   */
  private decideEasy(
    state: GameState,
    self: SnakePlayerState,
    blocked: Set<string>,
  ): Direction {
    this.ticksSinceRepath += 1;
    const targets = pelletTargets(state, false);
    const head = self.body[0];

    const stickyAlive =
      this.stickyTarget !== null &&
      targets.some(
        (t) => t.pos.x === this.stickyTarget!.x && t.pos.y === this.stickyTarget!.y,
      );

    if (!stickyAlive || this.ticksSinceRepath >= 12) {
      this.ticksSinceRepath = 0;
      let best: Point | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const t of targets) {
        const d = dijkstraDistance(state.width, state.height, head, t.pos, blocked);
        if (d !== null && d < bestDist) {
          bestDist = d;
          best = t.pos;
        }
      }
      this.stickyTarget = best;
    }

    if (isImmediateDeath(state, self, self.direction, blocked)) {
      return safeFallback(state, self, blocked, this.rng);
    }

    if (this.stickyTarget) {
      const step = stepToward(state, self, this.stickyTarget, blocked);
      if (step && step !== self.direction) {
        // Prefer continuing straight most of the time.
        if (this.rng() < 0.7 && !isImmediateDeath(state, self, self.direction, blocked)) {
          return self.direction;
        }
        return step;
      }
    }

    return self.direction;
  }

  /**
   * Medium: greedy pellet chase with sticky target + randomized reaction.
   */
  private decideMedium(
    state: GameState,
    self: SnakePlayerState,
    blocked: Set<string>,
  ): Direction {
    if (this.reactionLeft > 0 && this.pendingDir) {
      this.reactionLeft -= 1;
      if (this.reactionLeft === 0) {
        const dir = this.pendingDir;
        this.pendingDir = null;
        if (!isImmediateDeath(state, self, dir, blocked)) {
          return dir;
        }
      } else if (!isImmediateDeath(state, self, self.direction, blocked)) {
        return self.direction;
      }
    }

    const head = self.body[0];
    const targets = pelletTargets(state, true);

    const scoreTarget = (t: { pos: Point; value: number }): number | null => {
      const dist = dijkstraDistance(state.width, state.height, head, t.pos, blocked);
      if (dist === null || dist <= 0) {
        return null;
      }
      const yellow = state.yellowPellet;
      const isYellow =
        yellow !== null && t.pos.x === yellow.pos.x && t.pos.y === yellow.pos.y;
      if (isYellow && yellow.ttl !== null && dist > yellow.ttl) {
        return null;
      }
      return t.value / dist;
    };

    this.ticksSinceRepath += 1;
    const stickyAlive =
      this.stickyTarget !== null &&
      targets.some(
        (t) => t.pos.x === this.stickyTarget!.x && t.pos.y === this.stickyTarget!.y,
      );

    let stickyScore =
      stickyAlive && this.stickyTarget
        ? scoreTarget({
            pos: this.stickyTarget,
            value:
              targets.find(
                (t) =>
                  t.pos.x === this.stickyTarget!.x && t.pos.y === this.stickyTarget!.y,
              )?.value ?? 1,
          })
        : null;

    let best: { pos: Point; value: number; score: number } | null = null;
    for (const t of targets) {
      const score = scoreTarget(t);
      if (score === null) {
        continue;
      }
      if (!best || score > best.score) {
        best = { ...t, score };
      }
    }

    if (
      !stickyAlive ||
      stickyScore === null ||
      this.ticksSinceRepath >= MEDIUM_STICKY_REPATH ||
      (best !== null && best.score > stickyScore * MEDIUM_SWITCH_RATIO)
    ) {
      this.ticksSinceRepath = 0;
      this.stickyTarget = best?.pos ?? null;
      stickyScore = best?.score ?? null;
      // Drop a pending turn if the target changed mid-reaction.
      this.pendingDir = null;
      this.reactionLeft = 0;
    }

    if (isImmediateDeath(state, self, self.direction, blocked)) {
      return safeFallback(state, self, blocked, this.rng);
    }

    if (!this.stickyTarget) {
      return safeFallback(state, self, blocked, this.rng);
    }

    const minSpace = mediumMinSpace(self);
    const straightSpace = spaceAfterMove(state, self, self.direction, blocked);
    const step = stepToward(state, self, this.stickyTarget, blocked);

    let chosen: Direction;
    if (step) {
      const chaseSpace = spaceAfterMove(state, self, step, blocked);
      // Refuse pellet turns that close us into a pocket.
      if (
        chaseSpace < minSpace ||
        (straightSpace >= 0 && chaseSpace + 4 < straightSpace)
      ) {
        this.stickyTarget = null;
        this.ticksSinceRepath = MEDIUM_STICKY_REPATH;
        chosen = safeFallback(state, self, blocked, this.rng);
      } else {
        chosen = step;
      }
    } else {
      this.stickyTarget = null;
      chosen = safeFallback(state, self, blocked, this.rng);
    }

    // Prefer the roomiest safe heading if chase still looks tight.
    const chosenSpace = spaceAfterMove(state, self, chosen, blocked);
    if (chosenSpace < minSpace) {
      chosen = safeFallback(state, self, blocked, this.rng);
    }

    if (chosen === self.direction) {
      return chosen;
    }

    // 0 = instant turn (quick sequences); otherwise 1–MEDIUM_REACTION_MAX ticks.
    const delay = randomInt(this.rng, 0, MEDIUM_REACTION_MAX);
    if (delay === 0) {
      return chosen;
    }
    this.pendingDir = chosen;
    this.reactionLeft = delay;
    return self.direction;
  }

  /**
   * Hard: greedy pellet chase (points first); light survival only to avoid instant death.
   */
  private decideHard(
    state: GameState,
    self: SnakePlayerState,
    blocked: Set<string>,
  ): Direction {
    const head = self.body[0];
    const human = state.players[0];
    const targets = pelletTargets(state, true);

    const scoreTarget = (t: { pos: Point; value: number }): number | null => {
      if (isEnclosedGreen(state, t.pos)) {
        return null;
      }
      const dist = dijkstraDistance(state.width, state.height, head, t.pos, blocked);
      if (dist === null || dist <= 0) {
        return null;
      }
      const yellow = state.yellowPellet;
      const isYellow =
        yellow !== null && t.pos.x === yellow.pos.x && t.pos.y === yellow.pos.y;
      if (isYellow && yellow.ttl !== null && dist > yellow.ttl) {
        return null;
      }
      let score = (t.value * 4) / dist;
      if (human?.alive) {
        const humanDist =
          Math.abs(human.body[0].x - t.pos.x) + Math.abs(human.body[0].y - t.pos.y);
        if (dist < humanDist) {
          score += 8;
        } else if (dist > humanDist + 1) {
          score -= 2;
        }
      }
      return score;
    };

    this.ticksSinceRepath += 1;
    const stickyAlive =
      this.stickyTarget !== null &&
      targets.some(
        (t) => t.pos.x === this.stickyTarget!.x && t.pos.y === this.stickyTarget!.y,
      );

    let stickyScore =
      stickyAlive && this.stickyTarget
        ? scoreTarget({
            pos: this.stickyTarget,
            value:
              targets.find(
                (t) =>
                  t.pos.x === this.stickyTarget!.x && t.pos.y === this.stickyTarget!.y,
              )?.value ?? 1,
          })
        : null;

    let best: { pos: Point; value: number; score: number } | null = null;
    for (const t of targets) {
      const score = scoreTarget(t);
      if (score === null) {
        continue;
      }
      if (!best || score > best.score) {
        best = { ...t, score };
      }
    }

    // Switch target more eagerly than medium (greed over stickiness).
    if (
      !stickyAlive ||
      stickyScore === null ||
      this.ticksSinceRepath >= 5 ||
      (best !== null && best.score > (stickyScore ?? 0) * 1.15)
    ) {
      this.ticksSinceRepath = 0;
      this.stickyTarget = best?.pos ?? null;
    }

    if (isImmediateDeath(state, self, self.direction, blocked)) {
      return safeFallback(state, self, blocked, this.rng);
    }

    if (this.stickyTarget) {
      const step = stepToward(state, self, this.stickyTarget, blocked);
      if (step && !isImmediateDeath(state, self, step, blocked)) {
        // Points first: chase unless the step is an obvious dead-end.
        const chaseSpace = spaceAfterMove(state, self, step, blocked);
        if (chaseSpace >= HARD_MIN_CHASE_SPACE) {
          return step;
        }
      }
    }

    // Among safe dirs, pick the one that most reduces distance to best pellet.
    if (best) {
      let bestDir: Direction | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const dir of DIRS) {
        if (dir === OPPOSITE[self.direction]) {
          continue;
        }
        if (isImmediateDeath(state, self, dir, blocked)) {
          continue;
        }
        const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
        const dist = dijkstraDistance(
          state.width,
          state.height,
          next,
          best.pos,
          blocked,
        );
        if (dist !== null && dist < bestDist) {
          bestDist = dist;
          bestDir = dir;
        }
      }
      if (bestDir) {
        return bestDir;
      }
    }

    return safeFallback(state, self, blocked, this.rng);
  }
}
