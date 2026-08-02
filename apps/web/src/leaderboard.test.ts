/**
 * Unit tests for local leaderboard ranking and period windows.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  getBoard,
  MAX_ENTRIES,
  neighborRanks,
  periodStart,
  qualifiesForBoard,
  sanitizeName,
  submitScore,
  type ScoreEntry,
} from "./leaderboard.ts";

const memory = new Map<string, string>();

afterEach(() => {
  memory.clear();
});

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
  },
  configurable: true,
});

/**
 * Builds a score row for tests.
 */
function entry(partial: Partial<ScoreEntry> & Pick<ScoreEntry, "score" | "createdAt">): ScoreEntry {
  return {
    name: "AAA",
    level: 1,
    sizeId: "medium",
    mode: "solo",
    ...partial,
  };
}

describe("sanitizeName", () => {
  it("trims and caps length", () => {
    expect(sanitizeName("  Neo  ")).toBe("Neo");
    expect(sanitizeName("ABCDEFGHIJKLMNOP")).toBe("ABCDEFGHIJKL");
  });

  it("falls back when empty", () => {
    expect(sanitizeName("   ")).toBe("AAA");
  });
});

describe("periodStart", () => {
  it("returns 0 for all-time", () => {
    expect(periodStart("all", Date.parse("2026-07-26T15:00:00"))).toBe(0);
  });

  it("uses a rolling 24h window for daily, not calendar-day start", () => {
    const now = Date.parse("2026-07-26T15:30:00");
    expect(periodStart("daily", now)).toBe(now - 24 * 60 * 60 * 1000);
  });

  it("uses a rolling 7-day window for weekly, not calendar-week start", () => {
    const now = Date.parse("2026-07-26T12:00:00");
    expect(periodStart("weekly", now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });
});

describe("getBoard / submitScore", () => {
  it(`ranks by score descending and caps at ${MAX_ENTRIES}`, () => {
    const total = MAX_ENTRIES + 2;
    for (let i = 1; i <= total; i += 1) {
      submitScore(entry({ score: i * 10, createdAt: i, name: `P${i}` }));
    }
    const board = getBoard("medium", "solo", "all");
    expect(board).toHaveLength(MAX_ENTRIES);
    expect(board[0].score).toBe(total * 10);
    expect(board[MAX_ENTRIES - 1].score).toBe((total - MAX_ENTRIES + 1) * 10);
  });

  it("filters daily scores by a rolling 24h window", () => {
    const now = Date.parse("2026-07-26T10:00:00");
    const withinLast24h = Date.parse("2026-07-26T02:00:00"); // 8h ago
    const overADayAgo = Date.parse("2026-07-24T23:00:00"); // ~35h ago
    submitScore(entry({ score: 50, createdAt: overADayAgo, name: "OLD" }));
    submitScore(entry({ score: 40, createdAt: withinLast24h, name: "NEW" }));

    const daily = getBoard("medium", "solo", "daily", now);
    expect(daily).toHaveLength(1);
    expect(daily[0].name).toBe("NEW");
  });

  it("qualifies when board is not full or score beats last place", () => {
    expect(qualifiesForBoard(-12, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(0, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(1, "small", "solo")).toBe(true);
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      submitScore(entry({ score: 100 - i, createdAt: i, sizeId: "small" }));
    }
    expect(qualifiesForBoard(100 - MAX_ENTRIES, "small", "solo")).toBe(false);
    expect(qualifiesForBoard(100, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(-1, "small", "solo")).toBe(false);
  });
});

describe("neighborRanks", () => {
  it("returns nothing when the rank is already within the top N", () => {
    expect(neighborRanks(5, 10, 50)).toEqual([]);
    expect(neighborRanks(10, 10, 50)).toEqual([]);
  });

  it("returns rank-1, rank, rank+1 when past the top N", () => {
    expect(neighborRanks(15, 10, 50)).toEqual([14, 15, 16]);
  });

  it("drops the neighbor already covered by the top N (rank = N+1)", () => {
    expect(neighborRanks(11, 10, 50)).toEqual([11, 12]);
  });

  it("clamps at the bottom of the board (rank = total)", () => {
    expect(neighborRanks(50, 10, 50)).toEqual([49, 50]);
  });

  it("clamps when rank+1 and the board's end coincide", () => {
    expect(neighborRanks(49, 10, 50)).toEqual([48, 49, 50]);
  });

  it("handles a tiny/empty board where every rank is past N", () => {
    expect(neighborRanks(1, 0, 1)).toEqual([1]);
    // rank 1 is already covered by the top-1 board, so only rank 2 is extra.
    expect(neighborRanks(2, 1, 2)).toEqual([2]);
  });
});
