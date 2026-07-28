/**
 * Unit tests for grid Dijkstra pathfinding.
 */

import { describe, expect, it } from "vitest";
import { dijkstraDistance, dijkstraDistancesFrom } from "./pathfinding.ts";

describe("dijkstraDistance", () => {
  it("returns 0 when start equals goal", () => {
    expect(
      dijkstraDistance(5, 5, { x: 1, y: 1 }, { x: 1, y: 1 }, new Set()),
    ).toBe(0);
  });

  it("returns Manhattan distance on an empty grid", () => {
    expect(
      dijkstraDistance(10, 10, { x: 0, y: 0 }, { x: 3, y: 4 }, new Set()),
    ).toBe(7);
  });

  it("routes around blocked cells", () => {
    const blocked = new Set(["1,0", "1,1"]);
    // Must go down around the wall column: 6 steps on a 3×3 grid.
    expect(
      dijkstraDistance(3, 3, { x: 0, y: 0 }, { x: 2, y: 0 }, blocked),
    ).toBe(6);
  });

  it("returns null when the goal is unreachable", () => {
    const blocked = new Set(["1,0", "1,1", "1,2"]);
    expect(
      dijkstraDistance(3, 3, { x: 0, y: 1 }, { x: 2, y: 1 }, blocked),
    ).toBeNull();
  });

  it("allows entering the goal even if listed as blocked", () => {
    const blocked = new Set(["2,0"]);
    expect(
      dijkstraDistance(3, 1, { x: 0, y: 0 }, { x: 2, y: 0 }, blocked),
    ).toBe(2);
  });
});

describe("dijkstraDistancesFrom", () => {
  it("maps distances from the start across an empty grid", () => {
    const dist = dijkstraDistancesFrom(4, 1, { x: 0, y: 0 }, new Set());
    expect(dist.get("0,0")).toBe(0);
    expect(dist.get("3,0")).toBe(3);
  });

  it("does not enter blocked cells", () => {
    const dist = dijkstraDistancesFrom(
      3,
      1,
      { x: 0, y: 0 },
      new Set(["1,0"]),
    );
    expect(dist.get("0,0")).toBe(0);
    expect(dist.has("1,0")).toBe(false);
    expect(dist.has("2,0")).toBe(false);
  });
});
