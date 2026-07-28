/**
 * Unit tests for local leaderboard ranking and period windows.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  getBoard,
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

  it("uses local midnight for daily", () => {
    const now = Date.parse("2026-07-26T15:30:00");
    const start = periodStart("daily", now);
    const d = new Date(start);
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(26);
  });

  it("uses Monday local midnight for weekly", () => {
    // Sunday 2026-07-26 → week starts Monday 2026-07-20
    const now = Date.parse("2026-07-26T12:00:00");
    const start = periodStart("weekly", now);
    const d = new Date(start);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(20);
  });
});

describe("getBoard / submitScore", () => {
  it("ranks by score descending and caps at 10", () => {
    for (let i = 1; i <= 12; i += 1) {
      submitScore(entry({ score: i * 10, createdAt: i, name: `P${i}` }));
    }
    const board = getBoard("medium", "solo", "all");
    expect(board).toHaveLength(10);
    expect(board[0].score).toBe(120);
    expect(board[9].score).toBe(30);
  });

  it("filters daily scores by createdAt", () => {
    const day = Date.parse("2026-07-26T10:00:00");
    const earlier = Date.parse("2026-07-25T23:00:00");
    submitScore(entry({ score: 50, createdAt: earlier, name: "OLD" }));
    submitScore(entry({ score: 40, createdAt: day, name: "NEW" }));

    const daily = getBoard("medium", "solo", "daily", day);
    expect(daily).toHaveLength(1);
    expect(daily[0].name).toBe("NEW");
  });

  it("qualifies when board is not full or score beats last place", () => {
    expect(qualifiesForBoard(-12, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(0, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(1, "small", "solo")).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      submitScore(entry({ score: 100 - i, createdAt: i, sizeId: "small" }));
    }
    expect(qualifiesForBoard(50, "small", "solo")).toBe(false);
    expect(qualifiesForBoard(100, "small", "solo")).toBe(true);
    expect(qualifiesForBoard(-1, "small", "solo")).toBe(false);
  });
});
