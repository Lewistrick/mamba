/**
 * Unit tests for RoomManager lobby rules.
 */

import { describe, expect, it } from "vitest";
import { RoomManager, type Seat } from "./rooms.ts";

function seat(id: string, name: string): Seat {
  return {
    user: { userId: id, displayName: name },
    send: () => undefined,
  };
}

describe("RoomManager", () => {
  it("creates a private non-spectatable room", () => {
    const mgr = new RoomManager();
    const result = mgr.create(seat("a", "Alice"), "medium", "private");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.room.visibility).toBe("private");
    expect(result.room.spectatable).toBe(false);
    expect(result.room.code).toHaveLength(6);
  });

  it("lists only public waiting rooms", () => {
    const mgr = new RoomManager();
    mgr.create(seat("a", "Alice"), "small", "public");
    mgr.create(seat("b", "Bob"), "large", "private");
    const list = mgr.listPublic();
    expect(list).toHaveLength(1);
    expect(list[0].hostName).toBe("Alice");
  });

  it("rejects a third joiner", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const join1 = mgr.join(seat("b", "Bob"), created.room.code);
    expect(join1.ok).toBe(true);
    const join2 = mgr.join(seat("c", "Carol"), created.room.code);
    expect(join2.ok).toBe(false);
  });

  it("enters pregame and waits for both ready", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.join(seat("b", "Bob"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();
    expect(created.room.status).toBe("readying");
    expect(created.room.game).not.toBeNull();
    expect(mgr.setReady(created.room, 0, true)).toBeNull();
    expect(mgr.bothReady(created.room)).toBe(false);
    expect(mgr.setReady(created.room, 1, true)).toBeNull();
    expect(mgr.bothReady(created.room)).toBe(true);
    expect(mgr.beginCountdown(created.room)).toBeNull();
    expect(created.room.status).toBe("countdown");
  });

  it("returns to readying after both rematch votes", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.join(seat("b", "Bob"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();
    created.room.status = "finished";
    created.room.game = null;
    expect(mgr.requestRematch(created.room, 0)).toBe("waiting");
    expect(created.room.status).toBe("finished");
    expect(mgr.requestRematch(created.room, 1)).toBe("readying");
    expect(created.room.status).toBe("readying");
    expect(created.room.ready).toEqual([false, false]);
    expect(created.room.rematch).toEqual([false, false]);
    expect(created.room.game).not.toBeNull();
    const snap = mgr.snapshot(created.room);
    expect(snap.players.every((p) => p.rematchWanted === false)).toBe(true);
  });

  it("picks the higher score as winner", () => {
    expect(
      RoomManager.winnerIndex({
        players: [
          {
            body: [],
            direction: "Right",
            score: 10,
            survivalScore: 0,
            winBonus: 0,
            level: 1,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: false,
            blueValue: 1,
            greenValue: 10,
          },
          {
            body: [],
            direction: "Left",
            score: 20,
            survivalScore: 0,
            winBonus: 0,
            level: 1,
            pelletsEatenThisLife: 0,
            moltThreshold: 12,
            alive: true,
            blueValue: 1,
            greenValue: 10,
          },
        ],
      } as never),
    ).toBe(1);
  });
});
