/**
 * Elo formula tests.
 */

import { describe, expect, it } from "vitest";
import {
  ELO_K,
  INITIAL_ELO,
  expectedScore,
  nextRating,
  updateMatchElo,
} from "./elo.ts";

describe("expectedScore", () => {
  it("is 0.5 for equal ratings", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it("favours the higher-rated player", () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
  });

  it("sums to 1 for a pair", () => {
    const ea = expectedScore(1100, 900);
    const eb = expectedScore(900, 1100);
    expect(ea + eb).toBeCloseTo(1, 10);
  });
});

describe("nextRating", () => {
  it("gains rating on an upset win", () => {
    const ea = expectedScore(1000, 1200);
    const after = nextRating(1000, ea, 1);
    expect(after).toBeGreaterThan(1000);
    expect(after - 1000).toBe(Math.round(ELO_K * (1 - ea)));
  });

  it("loses less when losing as underdog", () => {
    const eaLow = expectedScore(1000, 1200);
    const eaHigh = expectedScore(1200, 1000);
    const lossAsUnderdog = nextRating(1000, eaLow, 0);
    const lossAsFavorite = nextRating(1200, eaHigh, 0);
    expect(1000 - lossAsUnderdog).toBeLessThan(1200 - lossAsFavorite);
  });
});

describe("updateMatchElo", () => {
  it("uses INITIAL_ELO as the documented start", () => {
    expect(INITIAL_ELO).toBe(1000);
  });

  it("moves ratings on a win", () => {
    const result = updateMatchElo(1000, 1000, 0);
    expect(result.a.delta).toBe(16);
    expect(result.b.delta).toBe(-16);
    expect(result.a.after).toBe(1016);
    expect(result.b.after).toBe(984);
  });

  it("is zero-sum on a draw between equals", () => {
    const result = updateMatchElo(1000, 1000, null);
    expect(result.a.delta).toBe(0);
    expect(result.b.delta).toBe(0);
  });

  it("awards the underdog on a draw", () => {
    const result = updateMatchElo(1000, 1200, null);
    expect(result.a.delta).toBeGreaterThan(0);
    expect(result.b.delta).toBeLessThan(0);
    expect(result.a.delta + result.b.delta).toBe(0);
  });

  it("handles player 1 win", () => {
    const result = updateMatchElo(1000, 1000, 1);
    expect(result.b.after).toBe(1016);
    expect(result.a.after).toBe(984);
  });
});
