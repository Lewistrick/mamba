/**
 * Unit tests for scoring, molting, green chains, and yellow TTL.
 */

import { describe, expect, it } from "vitest";
import { bluePelletValue, Game, greenPelletValue } from "./game.ts";
import { dijkstraDistance } from "./pathfinding.ts";
import { createRng, randomInt } from "./rng.ts";
import type { Direction, Point } from "./types.ts";

/**
 * Forces the engine into a controllable layout for white-box tests.
 *
 * @param game - Game instance.
 * @param patch - Partial internal fields to overwrite (player 0 + shared board).
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
    players: Array<{
      body: Point[];
      direction: Direction;
      score: number;
      level: number;
      pelletsEatenThisLife: number;
      moltThreshold: number;
      alive: boolean;
    }>;
    walls: Set<string>;
    bluePellets: Set<string>;
    greenPellets: Set<string>;
  };
  const p0 = g.players[0];

  if (patch.snake) {
    p0.body = patch.snake.map((p) => ({ ...p }));
  }
  if (patch.direction) {
    p0.direction = patch.direction;
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
    p0.level = patch.level;
  }
  if (patch.pelletsEatenThisLife !== undefined) {
    p0.pelletsEatenThisLife = patch.pelletsEatenThisLife;
  }
  if (patch.moltThreshold !== undefined) {
    p0.moltThreshold = patch.moltThreshold;
  }
  if (patch.score !== undefined) {
    p0.score = patch.score;
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
    expect(state.yellowPellets.length).toBeGreaterThan(0);
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

  it("spawns versus yellow closer to the molting snake", () => {
    const game = Game.versusAi("small", 99);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        level: number;
        pelletsEatenThisLife: number;
        moltThreshold: number;
        inputQueue: unknown[];
        alive: boolean;
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
      yellowPellets: unknown[];
      spawnYellow: (level: number, molterIndex: number) => void;
      rng: () => number;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    g.yellowPellets = [];
    g.players[0].body = [
      { x: 2, y: 5 },
      { x: 1, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 4 },
      { x: 0, y: 3 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    g.players[0].alive = true;
    g.players[1].body = [
      { x: 16, y: 5 },
      { x: 17, y: 5 },
      { x: 18, y: 5 },
      { x: 19, y: 5 },
      { x: 19, y: 4 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;
    g.players[1].alive = true;

    g.spawnYellow(2, 0);
    const yellow = game.getState().yellowPellets[0];
    expect(yellow).toBeDefined();
    const blocked = new Set<string>();
    for (const p of g.players) {
      for (const s of p.body) {
        blocked.add(`${s.x},${s.y}`);
      }
    }
    const d0 = dijkstraDistance(
      20,
      11,
      g.players[0].body[0],
      yellow!.pos,
      blocked,
    );
    const d1 = dijkstraDistance(
      20,
      11,
      g.players[1].body[0],
      yellow!.pos,
      blocked,
    );
    expect(d0).not.toBeNull();
    expect(d1).not.toBeNull();
    // Biased toward molter (P0): opponent path should be longer.
    expect(d1!).toBeGreaterThan(d0!);
    expect(d1! - d0!).toBeGreaterThanOrEqual(5);
    expect(d1! - d0!).toBeLessThanOrEqual(10);
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
      yellowPellets: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      }[];
    };
    g.yellowPellets = [
      {
        pos: { x: 6, y: 5 },
        value: 40,
        ttl: 20,
        graceTicksRemaining: 0,
      },
    ];

    game.tick();
    const state = game.getState();
    expect(state.score).toBe(40);
    expect(state.yellowPellets).toHaveLength(0);
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
      yellowPellets: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      }[];
    };
    g.yellowPellets = [
      {
        pos: { x: 20, y: 10 },
        value: 40,
        ttl: 2,
        graceTicksRemaining: 0,
      },
    ];

    game.tick();
    expect(game.getState().yellowPellets[0]?.ttl).toBe(1);
    game.tick();
    expect(game.getState().yellowPellets).toHaveLength(0);
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
      yellowPellets: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      }[];
    };
    g.yellowPellets = [
      {
        pos: { x: 15, y: 5 },
        value: 40,
        ttl: null,
        graceTicksRemaining: 5,
      },
    ];

    for (let i = 0; i < 4; i += 1) {
      game.tick();
      const yellow = game.getState().yellowPellets[0];
      expect(yellow).toBeDefined();
      expect(yellow?.ttl).toBeNull();
      expect(yellow?.graceTicksRemaining).toBe(4 - i);
    }

    // 5th tick: grace ends; Dijkstra uses head before this tick's move ((9,5) after 4 Rights).
    game.tick();
    const settled = game.getState().yellowPellets[0];
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
      yellowPellets: {
        pos: Point;
        value: number;
        ttl: number | null;
        graceTicksRemaining: number;
      }[];
      width: number;
      height: number;
    };
    g.yellowPellets = [
      {
        pos: { x: 3, y: 1 },
        value: 40,
        ttl: null,
        graceTicksRemaining: 1,
      },
    ];

    // Facing the border: no move progress, grace ends, Dijkstra fails.
    game.tick();
    const settled = game.getState().yellowPellets[0];
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

  it("ends versus when snakes collide head-on", () => {
    const game = Game.versusAi("small", 99);
    const g = game as unknown as {
      players: Array<{
        body: Point[];
        direction: Direction;
        alive: boolean;
        inputQueue: Direction[];
        moltThreshold: number;
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    g.players[1].body = [
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
      { x: 10, y: 5 },
      { x: 11, y: 5 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;

    const state = game.tick();
    expect(state.status).toBe("gameover");
    expect(state.players[0].alive).toBe(false);
    expect(state.players[1].alive).toBe(false);
  });

  it("reports net as pellets_you − pellets_AI + time + win", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      players: Array<{
        score: number;
        survivalScore: number;
        winBonus: number;
      }>;
    };
    g.players[0].score = 80;
    g.players[0].survivalScore = 20;
    g.players[0].winBonus = 0;
    g.players[1].score = 30;
    g.players[1].survivalScore = 10;
    g.players[1].winBonus = 0;
    // pellets 60 − 20 + time 20 + win 0 = 60
    expect(game.netScore()).toBe(60);
    expect(game.getState().netScore).toBe(60);
  });

  it("awards win bonus when the AI dies and the player survives", () => {
    const game = Game.versusAi("medium", 3);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        score: number;
        level: number;
        winBonus: number;
        moltThreshold: number;
        inputQueue: unknown[];
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[0].score = 10;
    g.players[0].level = 3;
    g.players[0].winBonus = 0;
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    // AI drives into the left border.
    g.players[1].body = [
      { x: 0, y: 8 },
      { x: 1, y: 8 },
      { x: 2, y: 8 },
      { x: 3, y: 8 },
      { x: 4, y: 8 },
    ];
    g.players[1].direction = "Left";
    g.players[1].score = 7;
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;

    const state = game.tick();
    expect(state.status).toBe("gameover");
    expect(state.players[0].alive).toBe(true);
    expect(state.players[1].alive).toBe(false);
    expect(state.winBonus).toBe(300);
    expect(state.players[0].winBonus).toBe(300);
    expect(state.score).toBe(310);
    expect(state.netScore).toBe(303);
  });

  it("does not award win bonus on a head-on collision", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        score: number;
        level: number;
        winBonus: number;
        moltThreshold: number;
        inputQueue: unknown[];
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[0].level = 2;
    g.players[0].score = 0;
    g.players[0].winBonus = 0;
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    g.players[1].body = [
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
      { x: 10, y: 5 },
      { x: 11, y: 5 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;

    const state = game.tick();
    expect(state.status).toBe("gameover");
    expect(state.players[0].alive).toBe(false);
    expect(state.players[1].alive).toBe(false);
    expect(state.winBonus).toBe(0);
    expect(state.score).toBe(0);
  });

  it("awards survival points in versus only", () => {
    const solo = Game.withSize("medium", 7);
    patchGame(solo, {
      snake: [
        { x: 5, y: 10 },
        { x: 4, y: 10 },
        { x: 3, y: 10 },
        { x: 2, y: 10 },
        { x: 1, y: 10 },
      ],
      direction: "Right",
      bluePellets: [],
      greenPellets: [],
      walls: [],
      level: 4,
      score: 0,
      moltThreshold: 99,
    });
    let soloState = solo.getState();
    for (let i = 0; i < 10; i += 1) {
      soloState = solo.tick();
    }
    expect(soloState.survivalScore).toBe(0);
    expect(soloState.score).toBe(0);

    const versus = Game.versusAi("medium", 11);
    const g = versus as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        score: number;
        level: number;
        survivalScore: number;
        moltThreshold: number;
        inputQueue: unknown[];
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    for (const p of g.players) {
      p.moltThreshold = 99;
      p.score = 0;
      p.survivalScore = 0;
      p.level = 4;
      p.inputQueue = [];
    }
    // Keep both snakes moving into open space on medium field.
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[1].body = [
      { x: 30, y: 15 },
      { x: 31, y: 15 },
      { x: 32, y: 15 },
      { x: 33, y: 15 },
      { x: 34, y: 15 },
    ];
    g.players[1].direction = "Left";

    let state = versus.getState();
    for (let i = 0; i < 10; i += 1) {
      state = versus.tick();
    }
    expect(state.status).toBe("playing");
    expect(state.players[0].survivalScore).toBe(4);
    expect(state.players[0].score).toBe(4);
    expect(state.players[1].survivalScore).toBe(4);
    expect(state.players[1].score).toBe(4);
  });
});

describe("fair (real multiplayer)", () => {
  it("gives Game.versusHuman a fixed molt threshold of 20", () => {
    const game = Game.versusHuman("small", 1);
    const state = game.getState();
    expect(state.players[0].moltThreshold).toBe(20);
    expect(state.players[1].moltThreshold).toBe(20);
  });

  it("keeps Game.versusAi's random 12-22 molt threshold", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = Game.versusAi("small", seed).getState();
      expect(state.players[0].moltThreshold).toBeGreaterThanOrEqual(12);
      expect(state.players[0].moltThreshold).toBeLessThanOrEqual(22);
    }
  });

  it("resets the molt threshold to 20 after a fair molt", () => {
    const game = Game.versusHuman("small", 1);
    const g = game as unknown as {
      players: Array<{
        level: number;
        pelletsEatenThisLife: number;
        moltThreshold: number;
      }>;
      molt: (playerIndex: number) => void;
    };
    g.players[0].pelletsEatenThisLife = 20;
    g.molt(0);
    expect(g.players[0].moltThreshold).toBe(20);
  });

  it("spawns the lime pellet worth exactly sqrt(level) * 20 when fair", () => {
    const game = Game.versusHuman("small", 1);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        alive: boolean;
      }>;
      yellowPellets: unknown[];
      spawnYellow: (level: number, molterIndex: number) => void;
    };
    g.yellowPellets = [];
    g.spawnYellow(9, 0);
    const yellow = game.getState().yellowPellets[0];
    expect(yellow).toBeDefined();
    expect(yellow!.value).toBe(Math.floor(Math.sqrt(9) * 20));
  });

  it("keeps Game.versusAi's random 20-50 lime multiplier", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      yellowPellets: unknown[];
      spawnYellow: (level: number, molterIndex: number) => void;
    };
    g.yellowPellets = [];
    g.spawnYellow(9, 0);
    const yellow = game.getState().yellowPellets[0];
    expect(yellow).toBeDefined();
    expect(yellow!.value).toBeGreaterThanOrEqual(Math.floor(Math.sqrt(9) * 20));
    expect(yellow!.value).toBeLessThanOrEqual(Math.floor(Math.sqrt(9) * 50));
  });

  it("spawns an additional yellow pellet when a molt happens during another's grace period", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      yellowPellets: unknown[];
      spawnYellow: (level: number, molterIndex: number) => void;
    };
    g.yellowPellets = [];
    g.spawnYellow(1, 0);
    expect(game.getState().yellowPellets).toHaveLength(1);

    // Second molt happens while the first pellet's grace period is still active.
    g.spawnYellow(1, 1);
    const pellets = game.getState().yellowPellets;
    expect(pellets).toHaveLength(2);
    expect(pellets[0].pos).not.toEqual(pellets[1].pos);
  });

  it("allows blue/green pellets within Manhattan distance 5 of a player's head", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      players: Array<{ body: { x: number; y: number }[] }>;
      bluePellets: Set<string>;
      spawnPellet: () => void;
    };
    const head = g.players[0].body[0];

    let sawClose = false;
    for (let i = 0; i < 100; i += 1) {
      g.bluePellets.clear();
      g.spawnPellet();
      for (const k of g.bluePellets) {
        const [x, y] = k.split(",").map(Number);
        const distance = Math.abs(x - head.x) + Math.abs(y - head.y);
        if (distance <= 5) {
          sawClose = true;
        }
      }
    }
    expect(sawClose).toBe(true);
  });

  it("still keeps yellow pellets more than Manhattan distance 5 from either head", () => {
    const game = Game.versusAi("small", 99);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        level: number;
        pelletsEatenThisLife: number;
        moltThreshold: number;
        inputQueue: unknown[];
        alive: boolean;
      }>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      walls: Set<string>;
      yellowPellets: unknown[];
      spawnYellow: (level: number, molterIndex: number) => void;
    };
    g.bluePellets = new Set();
    g.greenPellets = new Set();
    g.walls = new Set();
    g.yellowPellets = [];
    g.players[0].body = [
      { x: 2, y: 5 },
      { x: 1, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 4 },
      { x: 0, y: 3 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    g.players[0].alive = true;
    g.players[1].body = [
      { x: 16, y: 5 },
      { x: 17, y: 5 },
      { x: 18, y: 5 },
      { x: 19, y: 5 },
      { x: 19, y: 4 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;
    g.players[1].alive = true;

    g.spawnYellow(2, 0);
    const yellow = game.getState().yellowPellets[0] as { pos: { x: number; y: number } } | undefined;
    expect(yellow).toBeDefined();
    for (const player of g.players) {
      const head = player.body[0];
      const distance = Math.abs(yellow!.pos.x - head.x) + Math.abs(yellow!.pos.y - head.y);
      expect(distance).toBeGreaterThan(5);
    }
  });

  it("does not deduct the opponent's pellets from net score when fair", () => {
    const game = Game.versusHuman("small", 1);
    const g = game as unknown as {
      players: Array<{ score: number; survivalScore: number; winBonus: number }>;
    };
    g.players[0].score = 50;
    g.players[1].score = 1000;
    expect(game.netScore()).toBe(50);
  });

  it("still deducts the opponent's pellets from net score vs AI", () => {
    const game = Game.versusAi("small", 1);
    const g = game as unknown as {
      players: Array<{ score: number; survivalScore: number; winBonus: number }>;
    };
    g.players[0].score = 50;
    g.players[1].score = 30;
    expect(game.netScore()).toBe(20);
  });
});

describe("freeze (manual multiplayer testing)", () => {
  it("keeps a frozen snake's body unchanged while the opponent keeps moving", () => {
    const game = Game.versusHuman("small", 1);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        alive: boolean;
        inputQueue: unknown[];
      }>;
    };
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    g.players[1].body = [
      { x: 10, y: 8 },
      { x: 11, y: 8 },
      { x: 12, y: 8 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];

    expect(game.isFrozen(0)).toBe(false);
    game.setFrozen(0, true);
    expect(game.isFrozen(0)).toBe(true);

    const before = JSON.stringify(g.players[0].body);
    for (let i = 0; i < 3; i += 1) {
      game.tick();
    }
    expect(JSON.stringify(g.players[0].body)).toBe(before);
    expect(g.players[1].body[0]).not.toEqual({ x: 10, y: 8 });
    expect(g.players[0].alive).toBe(true);
  });

  it("still blocks the opponent, including the frozen snake's tail", () => {
    const game = Game.versusHuman("small", 2);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        alive: boolean;
        inputQueue: unknown[];
      }>;
    };
    // Frozen snake occupies x=5..7 at y=5. A normally-moving snake's tail
    // would vacate x=7 this tick, but a frozen one never moves, so the
    // mover approaching from the right should die running into it.
    g.players[0].body = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    game.setFrozen(0, true);

    g.players[1].body = [
      { x: 8, y: 5 },
      { x: 9, y: 5 },
      { x: 10, y: 5 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];

    game.tick();
    expect(g.players[1].alive).toBe(false);
    expect(g.players[0].alive).toBe(true);
  });
});
