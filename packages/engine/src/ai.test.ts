/**
 * Unit tests for AI policy determinism.
 */

import { describe, expect, it } from "vitest";
import { AiBrain } from "./ai.ts";
import { Game } from "./game.ts";

describe("AiBrain", () => {
  it("is deterministic for the same seed and difficulty", () => {
    const a = new AiBrain("medium", 1234);
    const b = new AiBrain("medium", 1234);
    const game = Game.versusAi("small", 1234);
    const dirsA: string[] = [];
    const dirsB: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const state = game.getState();
      if (state.status !== "playing") {
        break;
      }
      const da = a.decide(state);
      const db = b.decide(state);
      dirsA.push(da);
      dirsB.push(db);
      game.queueDirection(0, state.players[0].direction);
      game.queueDirection(1, da);
      game.tick();
    }
    expect(dirsA).toEqual(dirsB);
  });

  it("emits only cardinal directions", () => {
    const brain = new AiBrain("hard", 9);
    const game = Game.versusAi("medium", 9);
    for (let i = 0; i < 20; i += 1) {
      const state = game.getState();
      if (state.status !== "playing") {
        break;
      }
      const dir = brain.decide(state);
      expect(["Up", "Down", "Left", "Right"]).toContain(dir);
      game.queueDirection(1, dir);
      game.tick();
    }
  });

  it("hard AI does not chase greens enclosed by walls", () => {
    const brain = new AiBrain("hard", 42);
    const game = Game.versusAi("medium", 42);
    const g = game as unknown as {
      players: Array<{
        body: { x: number; y: number }[];
        direction: string;
        inputQueue: unknown[];
        moltThreshold: number;
      }>;
      walls: Set<string>;
      bluePellets: Set<string>;
      greenPellets: Set<string>;
      yellowPellets: unknown[];
    };

    // Dead-end green at (10,10): walls on N/S/W, open only to the east.
    g.walls = new Set([
      "10,9",
      "10,11",
      "9,10",
      "9,9",
      "9,11",
      "11,9",
      "11,11",
    ]);
    g.greenPellets = new Set(["10,10"]);
    g.bluePellets = new Set(["25,5"]);
    g.yellowPellets = [];
    g.players[0].body = [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 0, y: 4 },
    ];
    g.players[0].direction = "Right";
    g.players[0].inputQueue = [];
    g.players[0].moltThreshold = 99;
    // AI approaches from the east toward the green niche.
    g.players[1].body = [
      { x: 14, y: 10 },
      { x: 15, y: 10 },
      { x: 16, y: 10 },
      { x: 17, y: 10 },
      { x: 18, y: 10 },
    ];
    g.players[1].direction = "Left";
    g.players[1].inputQueue = [];
    g.players[1].moltThreshold = 99;

    const dir = brain.decide(game.getState());
    // Must not step left into the enclosed green; prefer other safe play.
    expect(dir).not.toBe("Left");
  });
});
