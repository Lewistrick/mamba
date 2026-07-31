/**
 * Lightweight, non-authoritative local prediction for the player's own snake
 * in online multiplayer — pure positional movement only (no pellets,
 * collisions, or scoring, which stay 100% server-authoritative). Lets a
 * keypress move the local snake immediately instead of waiting on a full
 * server round trip; the predicted state is discarded and replaced the
 * instant an authoritative `state` message arrives.
 */
import type { Direction, Point } from "@mamba/engine";
import { DIRECTION_DELTA, OPPOSITE_DIRECTION } from "@mamba/engine";

/** Predicted snake body + movement state. */
export interface PredictedSnake {
  body: Point[];
  direction: Direction;
  queue: Direction[];
}

/**
 * Queues a locally-requested turn, mirroring the engine's
 * `Game.queueDirection` rule: a direction equal to (or the reverse of) the
 * most recently queued/current heading is ignored; otherwise it's appended,
 * up to 2 pending turns, with the 2nd slot overwritten by newer requests.
 *
 * @param currentDirection - Snake's current heading.
 * @param queue - Currently queued (not yet applied) turns.
 * @param requested - Newly requested direction.
 * @returns Updated queue (new array; input is not mutated).
 */
export function queueLocalDirection(
  currentDirection: Direction,
  queue: Direction[],
  requested: Direction,
): Direction[] {
  const baseline = queue.length > 0 ? queue[queue.length - 1] : currentDirection;
  if (requested === baseline || requested === OPPOSITE_DIRECTION[baseline]) {
    return queue;
  }
  if (queue.length < 2) {
    return [...queue, requested];
  }
  return [queue[0], requested];
}

/**
 * Advances a predicted snake by one tick: consumes one queued turn (if any,
 * mirroring `Game.tick()`'s reject-if-reversed rule), then moves the head one
 * cell and drops the tail — no growth, no collision/death detection, no
 * pellet awareness. The head is clamped to the field bounds purely so a
 * near-wall death doesn't render outside the playfield; it never decides
 * that the snake died.
 *
 * @param snake - Current predicted body/direction/queue.
 * @param width - Field width in cells.
 * @param height - Field height in cells.
 * @returns Next predicted snake state (new objects; input is not mutated).
 */
export function advancePredicted(snake: PredictedSnake, width: number, height: number): PredictedSnake {
  const { body, direction, queue } = snake;
  if (body.length === 0) {
    return snake;
  }

  let nextDirection = direction;
  let nextQueue = queue;
  if (queue.length > 0) {
    const [nextDir, ...rest] = queue;
    nextQueue = rest;
    if (nextDir !== OPPOSITE_DIRECTION[direction]) {
      nextDirection = nextDir;
    }
  }

  const delta = DIRECTION_DELTA[nextDirection];
  const head = body[0];
  const nextHead: Point = {
    x: clamp(head.x + delta.x, 0, width - 1),
    y: clamp(head.y + delta.y, 0, height - 1),
  };
  const nextBody = [nextHead, ...body.slice(0, -1)];

  return { body: nextBody, direction: nextDirection, queue: nextQueue };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
