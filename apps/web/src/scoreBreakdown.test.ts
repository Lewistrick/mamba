/**
 * Unit tests for game-over score breakdown formatting.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "@mamba/engine";
import { gameOverScoreLines } from "./scoreBreakdown.ts";

function baseState(partial: Partial<GameState>): GameState {
  return {
    width: 20,
    height: 11,
    players: [
      {
        body: [],
        direction: "Right",
        score: 0,
        survivalScore: 0,
        winBonus: 0,
        level: 1,
        pelletsEatenThisLife: 0,
        moltThreshold: 12,
        alive: false,
        blueValue: 1,
        greenValue: 10,
      },
    ],
    snake: [],
    direction: "Right",
    walls: [],
    bluePellets: [],
    greenPellets: [],
    yellowPellet: null,
    score: 0,
    survivalScore: 0,
    winBonus: 0,
    level: 1,
    pelletsEatenThisLife: 0,
    moltThreshold: 12,
    netScore: 0,
    status: "gameover",
    tick: 1,
    blueValue: 1,
    greenValue: 10,
    events: [],
    ...partial,
  };
}

describe("gameOverScoreLines", () => {
  it("formats versus breakdown with aligned values", () => {
    const lines = gameOverScoreLines(
      baseState({
        players: [
          {
            body: [],
            direction: "Right",
            score: 235,
            survivalScore: 19,
            winBonus: 200,
            level: 2,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: true,
            blueValue: 2,
            greenValue: 20,
          },
          {
            body: [],
            direction: "Left",
            score: 29,
            survivalScore: 19,
            winBonus: 0,
            level: 2,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: false,
            blueValue: 2,
            greenValue: 20,
          },
        ],
        score: 235,
        survivalScore: 19,
        winBonus: 200,
        netScore: 206,
      }),
    );
    expect(lines).toEqual([
      "Your score  235",
      "AI score    -29",
      "Time bonus   19",
      "Win bonus   200",
      "--------------- +",
      "Net score   206",
    ]);
  });

  it("formats solo as a single score line", () => {
    expect(gameOverScoreLines(baseState({ score: 42, netScore: 42 }))).toEqual([
      "Score  42",
    ]);
  });
});
