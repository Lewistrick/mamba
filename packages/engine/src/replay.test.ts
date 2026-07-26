/**
 * Tests for deterministic replay verification.
 */

import { describe, expect, it } from "vitest";
import { Game } from "./game.ts";
import { verifyReplay } from "./replay.ts";
import type { Direction } from "./types.ts";

describe("verifyReplay", () => {
  it("accepts a matching seed + heading log", () => {
    const seed = 424242;
    const game = Game.withSize("medium", seed);
    const inputs: Direction[] = ["Up", "Up", "Left", "Left", "Down", "Right", "Right"];
    for (const dir of inputs) {
      game.queueDirection(dir);
      game.tick();
    }
    for (let i = 0; i < 40; i += 1) {
      game.tick();
    }
    // Force a wall death by running until game over or timeout.
    let guard = 0;
    while (game.getState().status === "playing" && guard < 5000) {
      game.tick();
      guard += 1;
    }
    const final = game.getState();
    expect(final.status).toBe("gameover");

    const result = verifyReplay({
      seed,
      sizeId: "medium",
      mode: "solo",
      headings: game.getReplayHeadings(),
      claimedScore: final.score,
      claimedLevel: final.level,
    });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(final.score);
    expect(result.level).toBe(final.level);
  });

  it("rejects a forged score", () => {
    const seed = 7;
    const game = Game.withSize("small", seed);
    for (let i = 0; i < 20; i += 1) {
      game.tick();
    }
    while (game.getState().status === "playing") {
      game.tick();
    }
    const final = game.getState();
    const result = verifyReplay({
      seed,
      sizeId: "small",
      mode: "solo",
      headings: game.getReplayHeadings(),
      claimedScore: final.score + 9999,
      claimedLevel: final.level,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("score_mismatch");
  });
});
