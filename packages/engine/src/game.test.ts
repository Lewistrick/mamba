/**
 * Unit tests for scoring, molting, green chains, and yellow TTL.
 */

import { describe, expect, it } from "vitest";
import { bluePelletValue, Game, greenPelletValue } from "./game.ts";
import { createRng, randomInt } from "./rng.ts";
import type { Direction, Point } from "./types.ts";

/**
 * Forces the engine into a controllable layout for white-box tests.
 *
 * @param game - Game instance.
 * @param patch - Partial internal fields to overwrite.
 */
function patchGame(
  game: Game,
  patch: {
    snake?: Point[];
    direction?: Direction;
    walls?: Point[];
    bluePellets?: Point[];
    greenPellets?: Point[];
    level?: number;
    pelletsEatenThisLife?: number;
    moltThreshold?: number;
    score?: number;
  },
): void {
  const g = game as unknown as {
    snake: Point[];
    direction: Direction;
    walls: Set<string>;
    bluePellets: Set<string>;
    greenPellets: Set<string>;
    level: number;
    pelletsEatenThisLife: number;
    moltThreshold: number;
    score: number;
  };

  if (patch.snake) {
    g.snake = patch.snake.map((p) => ({ ...p }));
  }
  if (patch.direction) {
    g.direction = patch.direction;
  }
  if (patch.walls) {
    g.walls = new Set(patch.walls.map((p) => `${p.x},${p.y}`));
  }
  if (patch.bluePellets) {
    g.bluePellets = new Set(patch.bluePellets.map((p) => `${p.x},${p.y}`));
  }
  if (patch.greenPellets) {
    g.greenPellets = new Set(patch.greenPellets.map((p) => `${p.x},${p.y}`));
  }
  if (patch.level !== undefined) {
    g.level = patch.level;
  }
  if (patch.pelletsEatenThisLife !== undefined) {
    g.pelletsEatenThisLife = patch.pelletsEatenThisLife;
  }
  if (patch.moltThreshold !== undefined) {
    g.moltThreshold = patch.moltThreshold;
  }
  if (patch.score !== undefined) {
    g.score = patch.score;
  }
}

describe("score caps", () => {
  it("caps blue pellets at 10", () => {
    expect(bluePelletValue(1)).toBe(1);
    expect(bluePelletValue(10)).toBe(10);
    expect(bluePelletValue(11)).toBe(10);
    expect(bluePelletValue(99)).toBe(10);
  });

  it("caps green pellets at 100", () => {
    expect(greenPelletValue(1)).toBe(10);
    expect(greenPelletValue(10)).toBe(100);
    expect(greenPelletValue(11)).toBe(100);
  });
});

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("randomInt stays inclusive", () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i += 1) {
      const n = randomInt(rng, 5, 12);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(12);
    }
  });
});

describe("Game", () => {
  it("starts with length 5 on a medium field", () => {
    const game = Game.medium(42);
    const state = game.getState();
    expect(state.width).toBe(40);
    expect(state.height).toBe(22);
    expect(state.snake).toHaveLength(5);
    expect(state.bluePellets.length).toBeGreaterThanOrEqual(5);
    expect(state.bluePellets.length).toBeLessThanOrEqual(12);
    expect(state.moltThreshold).toBeGreaterThanOrEqual(12);
    expect(state.moltThreshold).toBeLessThanOrEqual(22);
    expect(state.status).toBe("playing");
  });

  it("is deterministic for the same seed and inputs", () => {
    const run = () => {
      const game = Game.medium(999);
      const inputs: Direction[] = ["Up", "Up", "Left", "Left", "Down", "Down", "Right"];
      for (const dir of inputs) {
        game.queueDirection(dir);
        game.tick();
      }
      for (let i = 0; i < 30; i += 1) {
        game.tick();
      }
      return game.getState();
    };

    const a = run();
    const b = run();
    expect(a.score).toBe(b.score);
    expect(a.snake).toEqual(b.snake);
    expect(a.bluePellets).toEqual(b.bluePellets);
    expect(a.tick).toBe(b.tick);
  });

  it("grows and scores when eating a blue pellet", () => {
    const game = Game.medium(1);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [{ x: 6, y: 5 }],
      walls: [],
      greenPellets: [],
      level: 3,
      score: 0,
      pelletsEatenThisLife: 0,
      moltThreshold: 99,
    });

    const before = game.getState().snake.length;
    game.tick();
    const after = game.getState();
    expect(after.snake.length).toBe(before + 1);
    expect(after.score).toBe(3);
    expect(after.pelletsEatenThisLife).toBe(1);
  });

  it("molts into walls and keeps the newest 5 segments", () => {
    const game = Game.medium(2);
    const snake: Point[] = [];
    for (let i = 0; i < 8; i += 1) {
      snake.push({ x: 10 - i, y: 5 });
    }

    patchGame(game, {
      snake,
      direction: "Right",
      bluePellets: [{ x: 11, y: 5 }],
      walls: [],
      greenPellets: [],
      level: 1,
      score: 0,
      pelletsEatenThisLife: 11,
      moltThreshold: 12,
    });

    game.tick();
    const state = game.getState();
    expect(state.snake).toHaveLength(5);
    expect(state.level).toBe(2);
    expect(state.walls.length).toBeGreaterThanOrEqual(3);
    expect(state.yellowPellet).not.toBeNull();
    expect(state.pelletsEatenThisLife).toBe(0);
  });

  it("awards capped green pellet score and spawns two pellets", () => {
    const game = Game.medium(3);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [{ x: 6, y: 5 }],
      walls: [],
      level: 15,
      score: 0,
      pelletsEatenThisLife: 0,
      moltThreshold: 99,
    });

    game.tick();
    const state = game.getState();
    expect(state.score).toBe(100);
    // Green removed; two replacement spawns (blue and/or green-from-wall).
    expect(state.greenPellets.some((p) => p.x === 6 && p.y === 5)).toBe(false);
    expect(state.bluePellets.length + state.greenPellets.length).toBe(2);
  });

  it("spawns two pellets when eating yellow", () => {
    const game = Game.medium(8);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [],
      level: 2,
      score: 0,
      pelletsEatenThisLife: 0,
      moltThreshold: 99,
    });

    const g = game as unknown as {
      yellowPellet: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      } | null;
    };
    g.yellowPellet = {
      pos: { x: 6, y: 5 },
      value: 40,
      ttl: 20,
      graceTicksRemaining: 0,
    };

    game.tick();
    const state = game.getState();
    expect(state.score).toBe(40);
    expect(state.yellowPellet).toBeNull();
    expect(state.bluePellets.length + state.greenPellets.length).toBe(2);
  });

  it("expires yellow pellets after TTL ticks", () => {
    const game = Game.medium(4);
    patchGame(game, {
      snake: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
        { x: 0, y: 4 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [],
      moltThreshold: 99,
    });

    const g = game as unknown as {
      yellowPellet: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      } | null;
    };
    g.yellowPellet = {
      pos: { x: 20, y: 10 },
      value: 40,
      ttl: 2,
      graceTicksRemaining: 0,
    };

    game.tick();
    expect(game.getState().yellowPellet?.ttl).toBe(1);
    game.tick();
    expect(game.getState().yellowPellet).toBeNull();
  });

  it("assigns yellow TTL via Dijkstra after grace ticks", () => {
    const game = Game.medium(41);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [],
      moltThreshold: 99,
    });

    const g = game as unknown as {
      yellowPellet: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      } | null;
    };
    g.yellowPellet = {
      pos: { x: 15, y: 5 },
      value: 40,
      ttl: null,
      graceTicksRemaining: 5,
    };

    for (let i = 0; i < 4; i += 1) {
      game.tick();
      const yellow = game.getState().yellowPellet;
      expect(yellow).not.toBeNull();
      expect(yellow?.ttl).toBeNull();
      expect(yellow?.graceTicksRemaining).toBe(4 - i);
    }

    // 5th tick: grace ends; Dijkstra uses head before this tick's move ((9,5) after 4 Rights).
    game.tick();
    const settled = game.getState().yellowPellet;
    expect(settled?.graceTicksRemaining).toBe(0);
    // Head before 5th move is at (9,5); pellet at (15,5) → Dijkstra 6 + 5 grace buffer.
    expect(settled?.ttl).toBe(11);
  });

  it("uses Manhattan fallback TTL when yellow is unreachable", () => {
    const game = Game.medium(42);
    patchGame(game, {
      snake: [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
        { x: 0, y: 4 },
      ],
      direction: "Left",
      bluePellets: [],
      greenPellets: [],
      // Wall column seals the right side of the small corridor.
      walls: [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
        { x: 1, y: 4 },
        { x: 1, y: 5 },
      ],
      moltThreshold: 99,
    });

    const g = game as unknown as {
      yellowPellet: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      } | null;
      width: number;
      height: number;
    };
    g.yellowPellet = {
      pos: { x: 3, y: 1 },
      value: 40,
      ttl: null,
      graceTicksRemaining: 1,
    };

    // Facing the border: no move progress, grace ends, Dijkstra fails.
    game.tick();
    const settled = game.getState().yellowPellet;
    expect(settled?.graceTicksRemaining).toBe(0);
    // max(2 * Manhattan(0,1 → 3,1)=3 → 6, 60s * 10tps = 600) = 600
    expect(settled?.ttl).toBe(600);
  });

  it("converts a wall spawn into a green pellet", () => {
    const game = Game.medium(5);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [{ x: 6, y: 5 }],
      greenPellets: [],
      walls: [{ x: 8, y: 8 }],
      level: 2,
      score: 0,
      pelletsEatenThisLife: 0,
      moltThreshold: 99,
    });

    // Force spawnPellet to pick the wall cell by stubbing pickSpawnCell.
    const g = game as unknown as {
      pickSpawnCell: () => Point | null;
      spawnPellet: () => void;
    };
    g.pickSpawnCell = () => ({ x: 8, y: 8 });

    game.tick();
    const state = game.getState();
    expect(state.walls.some((p) => p.x === 8 && p.y === 8)).toBe(false);
    expect(state.greenPellets.some((p) => p.x === 8 && p.y === 8)).toBe(true);
  });

  it("ends the game when hitting a wall", () => {
    const game = Game.medium(6);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [{ x: 6, y: 5 }],
      moltThreshold: 99,
    });

    game.tick();
    expect(game.getState().status).toBe("gameover");
  });

  it("buffers two turns so a sharp corner works within one tick gap", () => {
    const game = Game.medium(7);
    patchGame(game, {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
        { x: 1, y: 5 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [],
      moltThreshold: 99,
    });

    // Going right: queue up then left before the next tick.
    game.queueDirection("Up");
    game.queueDirection("Left");

    const afterFirst = game.tick();
    expect(afterFirst.direction).toBe("Up");
    expect(afterFirst.snake[0]).toEqual({ x: 5, y: 4 });

    const afterSecond = game.tick();
    expect(afterSecond.direction).toBe("Left");
    expect(afterSecond.snake[0]).toEqual({ x: 4, y: 4 });
  });
});
