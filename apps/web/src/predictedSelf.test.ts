/**
 * Unit tests for local (non-authoritative) snake prediction.
 */
import { describe, expect, it } from "vitest";
import type { PredictedSnake } from "./predictedSelf.ts";
import { advancePredicted, queueLocalDirection } from "./predictedSelf.ts";

describe("queueLocalDirection", () => {
  it("ignores a direction equal to the current heading", () => {
    expect(queueLocalDirection("Right", [], "Right")).toEqual([]);
  });

  it("ignores the reverse of the current heading", () => {
    expect(queueLocalDirection("Right", [], "Left")).toEqual([]);
  });

  it("queues a legal turn", () => {
    expect(queueLocalDirection("Right", [], "Up")).toEqual(["Up"]);
  });

  it("queues a second legal turn relative to the first", () => {
    expect(queueLocalDirection("Right", ["Up"], "Left")).toEqual(["Up", "Left"]);
  });

  it("ignores a reverse of the most recently queued turn, not just the current heading", () => {
    // Baseline for legality is the *last queued* direction (Up), so Down (its reverse) is illegal
    // even though it's not the reverse of the current heading (Right).
    expect(queueLocalDirection("Right", ["Up"], "Down")).toEqual(["Up"]);
  });

  it("overwrites the 2nd queued slot once two turns are already pending", () => {
    expect(queueLocalDirection("Right", ["Up", "Left"], "Down")).toEqual(["Up", "Down"]);
  });

  it("does not mutate the input queue", () => {
    const queue = ["Up"];
    queueLocalDirection("Right", queue, "Left");
    expect(queue).toEqual(["Up"]);
  });
});

describe("advancePredicted", () => {
  const snake = (body: { x: number; y: number }[], direction: PredictedSnake["direction"], queue: PredictedSnake["queue"] = []): PredictedSnake => ({
    body,
    direction,
    queue,
  });

  it("moves the head one cell in the current direction and drops the tail", () => {
    const next = advancePredicted(
      snake(
        [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
          { x: 3, y: 5 },
        ],
        "Right",
      ),
      20,
      11,
    );
    expect(next.body).toEqual([
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    expect(next.body.length).toBe(3);
  });

  it("consumes one queued turn and applies it", () => {
    const next = advancePredicted(snake([{ x: 5, y: 5 }], "Right", ["Up"]), 20, 11);
    expect(next.direction).toBe("Up");
    expect(next.body[0]).toEqual({ x: 5, y: 4 });
    expect(next.queue).toEqual([]);
  });

  it("consumes but ignores a queued reversal of the current direction", () => {
    const next = advancePredicted(snake([{ x: 5, y: 5 }], "Right", ["Left"]), 20, 11);
    expect(next.direction).toBe("Right");
    expect(next.body[0]).toEqual({ x: 6, y: 5 });
    expect(next.queue).toEqual([]);
  });

  it("clamps the head at the field bounds instead of moving out of bounds", () => {
    const next = advancePredicted(snake([{ x: 0, y: 5 }], "Left"), 20, 11);
    expect(next.body[0]).toEqual({ x: 0, y: 5 });
  });

  it("is a no-op on an empty body", () => {
    const empty = snake([], "Right");
    expect(advancePredicted(empty, 20, 11)).toBe(empty);
  });

  it("does not mutate the input snake", () => {
    const body = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
    const original = snake(body, "Right");
    advancePredicted(original, 20, 11);
    expect(original.body).toEqual(body);
  });
});
