/**
 * Grid pathfinding helpers for the Mamba engine.
 */

import type { Point } from "./types.ts";

const NEIGHBORS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

/**
 * Shortest 4-connected path length from `start` to `goal` with unit edge weights
 * (Dijkstra / BFS equivalent on an unweighted grid).
 *
 * Blocked cells are impassable except that `goal` is always reachable as a destination.
 *
 * @param width - Field width.
 * @param height - Field height.
 * @param start - Path start (snake head).
 * @param goal - Path goal (yellow pellet).
 * @param blocked - Set of `"x,y"` keys that cannot be entered.
 * @returns Distance in cells, or `null` if unreachable.
 */
export function dijkstraDistance(
  width: number,
  height: number,
  start: Point,
  goal: Point,
  blocked: ReadonlySet<string>,
): number | null {
  const startKey = `${start.x},${start.y}`;
  const goalKey = `${goal.x},${goal.y}`;
  if (startKey === goalKey) {
    return 0;
  }

  const dist = new Map<string, number>();
  const heap: { key: string; d: number }[] = [];

  const push = (key: string, d: number): void => {
    heap.push({ key, d });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].d <= heap[i].d) {
        break;
      }
      const tmp = heap[parent];
      heap[parent] = heap[i];
      heap[i] = tmp;
      i = parent;
    }
  };

  const pop = (): { key: string; d: number } | undefined => {
    const top = heap[0];
    if (top === undefined) {
      return undefined;
    }
    const last = heap.pop()!;
    if (heap.length === 0) {
      return top;
    }
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left].d < heap[smallest].d) {
        smallest = left;
      }
      if (right < heap.length && heap[right].d < heap[smallest].d) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      const tmp = heap[i];
      heap[i] = heap[smallest];
      heap[smallest] = tmp;
      i = smallest;
    }
    return top;
  };

  dist.set(startKey, 0);
  push(startKey, 0);

  while (heap.length > 0) {
    const current = pop()!;
    if (current.d !== dist.get(current.key)) {
      continue;
    }
    if (current.key === goalKey) {
      return current.d;
    }

    const [cx, cy] = current.key.split(",").map(Number);
    for (const delta of NEIGHBORS) {
      const nx = cx + delta.x;
      const ny = cy + delta.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nKey = `${nx},${ny}`;
      if (nKey !== goalKey && blocked.has(nKey)) {
        continue;
      }
      const nextDist = current.d + 1;
      const prev = dist.get(nKey);
      if (prev !== undefined && prev <= nextDist) {
        continue;
      }
      dist.set(nKey, nextDist);
      push(nKey, nextDist);
    }
  }

  return null;
}
