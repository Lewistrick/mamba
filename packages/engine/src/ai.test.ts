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
});
