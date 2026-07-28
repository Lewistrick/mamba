/**
 * Unit tests for profile stats helpers.
 */

import { describe, expect, it } from "vitest";
import { buildStatRows, rollingAverage } from "./profileStats.ts";
import type { MyScoreRow } from "./supabase.ts";

describe("rollingAverage", () => {
  it("computes a trailing window average", () => {
    expect(rollingAverage([10, 20, 30], 2)).toEqual([10, 15, 25]);
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
