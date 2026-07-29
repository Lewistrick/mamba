/**
 * Unit tests for profile stats helpers.
 */

import { describe, expect, it } from "vitest";
import {
  buildStatRows,
  rollingAverage,
  scoreXPositions,
  sortStatRows,
  type StatRow,
} from "./profileStats.ts";
import type { MyScoreRow } from "./supabase.ts";

describe("rollingAverage", () => {
  it("computes a trailing window average", () => {
    expect(rollingAverage([10, 20, 30], 2)).toEqual([10, 15, 25]);
  });
});

describe("scoreXPositions", () => {
  const times = [0, 10, 100];
  const plotW = 100;

  it("spaces games evenly in game mode", () => {
    expect(scoreXPositions(times, "game", plotW)).toEqual([0, 50, 100]);
  });

  it("places by date proportionally in date mode", () => {
    expect(scoreXPositions(times, "date", plotW)).toEqual([0, 10, 100]);
  });

  it("centers a single point", () => {
    expect(scoreXPositions([42], "game", plotW)).toEqual([50]);
    expect(scoreXPositions([42], "date", plotW)).toEqual([50]);
  });
});

describe("buildStatRows", () => {
  it("groups by size and mode and skips empty buckets", () => {
    const scores: MyScoreRow[] = [
      {
        score: 10,
        level: 1,
        sizeId: "medium",
        mode: "solo",
        createdAt: 1,
      },
      {
        score: 20,
        level: 1,
        sizeId: "medium",
        mode: "solo",
        createdAt: 2,
      },
      {
        score: 5,
        level: 1,
        sizeId: "small",
        mode: "ai:hard",
        createdAt: 3,
      },
    ];
    const rows = buildStatRows(scores);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sizeId: "small", mode: "ai:hard", plays: 1 });
    expect(rows[1]).toMatchObject({ sizeId: "medium", mode: "solo", plays: 2 });
  });
});

describe("sortStatRows", () => {
  const rows: StatRow[] = [
    {
      sizeId: "medium",
      mode: "solo",
      label: "Medium · Solo",
      plays: 2,
      scores: [],
    },
    {
      sizeId: "small",
      mode: "ai:hard",
      label: "Small · AI Hard",
      plays: 5,
      scores: [],
    },
    {
      sizeId: "large",
      mode: "ai:easy",
      label: "Large · AI Easy",
      plays: 1,
      scores: [],
    },
  ];

  it("sorts by size ascending", () => {
    const sorted = sortStatRows(rows, { key: "size", dir: "asc" });
    expect(sorted.map((r) => r.sizeId)).toEqual(["small", "medium", "large"]);
  });

  it("sorts by mode descending", () => {
    const sorted = sortStatRows(rows, { key: "mode", dir: "desc" });
    expect(sorted.map((r) => r.mode)).toEqual(["ai:hard", "ai:easy", "solo"]);
  });

  it("sorts by plays descending", () => {
    const sorted = sortStatRows(rows, { key: "plays", dir: "desc" });
    expect(sorted.map((r) => r.plays)).toEqual([5, 2, 1]);
  });
});
