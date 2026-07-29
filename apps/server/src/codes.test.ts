/**
 * Unit tests for room codes.
 */

import { describe, expect, it } from "vitest";
import { generateRoomCode, normalizeRoomCode } from "./codes.ts";

describe("generateRoomCode", () => {
  it("returns a 6-char code from the safe alphabet", () => {
    const code = generateRoomCode(6, () => 0);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
});

describe("normalizeRoomCode", () => {
  it("accepts valid codes", () => {
    expect(normalizeRoomCode("abc123")).toBe("ABC123");
  });

  it("rejects bad length", () => {
    expect(normalizeRoomCode("ABC12")).toBeNull();
  });
});
