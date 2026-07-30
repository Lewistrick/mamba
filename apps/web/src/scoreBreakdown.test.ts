/**
 * Unit tests for game-over score breakdown formatting.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "@mamba/engine";
import { gameOverScoreLines, mpScoreTable } from "./scoreBreakdown.ts";

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
  it("formats versus breakdown with pellet scores summing to net", () => {
    // you total 235 = pellets 16 + time 19 + win 200
    // opp total 29 = pellets 10 + time 19
    // net = 16 - 10 + 19 + 200 = 225
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
        netScore: 225,
      }),
    );
    expect(lines).toEqual([
      "Your score   16",
      "AI score    -10",
      "Time bonus   19",
      "Win bonus   200",
      "--------------- +",
      "Net score   225",
    ]);
  });

  it("matches pellet − AI pellet + time + win", () => {
    // Pellets 2450, AI pellets 2241, time 611, win 800 → net 1620
    const lines = gameOverScoreLines(
      baseState({
        players: [
          {
            body: [],
            direction: "Right",
            score: 2450 + 611 + 800,
            survivalScore: 611,
            winBonus: 800,
            level: 8,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: true,
            blueValue: 8,
            greenValue: 80,
          },
          {
            body: [],
            direction: "Left",
            score: 2241,
            survivalScore: 0,
            winBonus: 0,
            level: 5,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: false,
            blueValue: 5,
            greenValue: 50,
          },
        ],
        score: 2450 + 611 + 800,
        survivalScore: 611,
        winBonus: 800,
        netScore: 1620,
      }),
    );
    expect(lines[0]).toContain("2450");
    expect(lines[1]).toContain("-2241");
    expect(lines[5]).toContain("1620");
  });

  it("shows opponent pellets without a minus sign when fair (real multiplayer)", () => {
    // Fair net score doesn't deduct opponent pellets: net = 16 + 19 + 200 = 235
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
            moltThreshold: 20,
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
            moltThreshold: 20,
            alive: false,
            blueValue: 2,
            greenValue: 20,
          },
        ],
        score: 235,
        survivalScore: 19,
        winBonus: 200,
        netScore: 235,
      }),
      { opponentLabel: "Opp", fair: true },
    );
    expect(lines).toEqual([
      "Your score   16",
      "Opp score    10",
      "Time bonus   19",
      "Win bonus   200",
      "--------------- +",
      "Net score   235",
    ]);
  });

  it("formats solo as a single score line", () => {
    expect(gameOverScoreLines(baseState({ score: 42, netScore: 42 }))).toEqual([
      "Score  42",
    ]);
  });
});

describe("mpScoreTable", () => {
  it("builds fair per-player rows without deducting the opponent's score", () => {
    // you: pellets 16 + time 19 + win 200 = 235; opp: pellets 10 + time 19 = 29
    const table = mpScoreTable(
      baseState({
        players: [
          {
            body: [],
            direction: "Right",
            score: 235,
            survivalScore: 19,
            winBonus: 200,
            level: 3,
            pelletsEatenThisLife: 0,
            moltThreshold: 20,
            alive: true,
            blueValue: 3,
            greenValue: 30,
          },
          {
            body: [],
            direction: "Left",
            score: 29,
            survivalScore: 19,
            winBonus: 0,
            level: 2,
            pelletsEatenThisLife: 0,
            moltThreshold: 20,
            alive: false,
            blueValue: 2,
            greenValue: 20,
          },
        ],
        score: 235,
        survivalScore: 19,
        winBonus: 200,
        netScore: 235,
      }),
      ["Alice", "Bob"],
      0,
    );
    expect(table.youName).toBe("Alice");
    expect(table.oppName).toBe("Bob");
    expect(table.rows).toEqual([
      { label: "Level", you: 3, opp: 2 },
      { label: "Score", you: 16, opp: 10 },
      { label: "Time bonus", you: 19, opp: 19 },
      { label: "Win bonus", you: 200, opp: 0 },
      { label: "Net score", you: 235, opp: 29 },
    ]);
  });

  it("maps names by absolute seat index and falls back when empty", () => {
    const table = mpScoreTable(
      baseState({
        players: [
          {
            body: [],
            direction: "Right",
            score: 10,
            survivalScore: 0,
            winBonus: 0,
            level: 1,
            pelletsEatenThisLife: 0,
            moltThreshold: 20,
            alive: true,
            blueValue: 1,
            greenValue: 10,
          },
          {
            body: [],
            direction: "Left",
            score: 5,
            survivalScore: 0,
            winBonus: 0,
            level: 1,
            pelletsEatenThisLife: 0,
            moltThreshold: 20,
            alive: false,
            blueValue: 1,
            greenValue: 10,
          },
        ],
        netScore: 10,
      }),
      ["", "Bob"],
      1,
    );
    expect(table.youName).toBe("Bob");
    expect(table.oppName).toBe("Opponent");
  });
});
