/**
 * Unit tests for RoomManager lobby rules.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "@mamba/engine";
import { RoomManager, type Seat } from "./rooms.ts";

function seat(id: string, name: string): Seat {
  return {
    user: { userId: id, displayName: name },
    send: () => undefined,
  };
}

function fakePlayer() {
  return {
    body: [],
    direction: "Right" as const,
    score: 0,
    survivalScore: 0,
    winBonus: 0,
    level: 1,
    pelletsEatenThisLife: 0,
    moltThreshold: 12,
    alive: false,
    blueValue: 1,
    greenValue: 10,
  };
}

function fakeState(): GameState {
  return {
    width: 10,
    height: 10,
    players: [fakePlayer(), fakePlayer()],
    snake: [],
    direction: "Right",
    walls: [],
    bluePellets: [],
    greenPellets: [],
    yellowPellets: [],
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

  it("lists only public rooms", () => {
    const mgr = new RoomManager();
    mgr.create(seat("a", "Alice"), "small", "public");
    mgr.create(seat("b", "Bob"), "large", "private");
    const list = mgr.listPublic();
    expect(list).toHaveLength(1);
    expect(list[0].hostName).toBe("Alice");
  });

  it("still lists a finished public room (watch-only, waiting for rematch)", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    created.room.status = "finished";
    const list = mgr.listPublic();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("finished");
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

  it("toggles freeze for the requesting seated player only while playing", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.join(seat("b", "Bob"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();

    // Not "playing" yet (still "readying") — no-op.
    mgr.toggleFreezeForUser("b");
    expect(created.room.game?.isFrozen(1)).toBe(false);

    created.room.status = "playing";
    mgr.toggleFreezeForUser("b");
    expect(created.room.game?.isFrozen(1)).toBe(true);
    expect(created.room.game?.isFrozen(0)).toBe(false);
    mgr.toggleFreezeForUser("b");
    expect(created.room.game?.isFrozen(1)).toBe(false);
  });

  it("keeps the wins tally across a same-pair rematch", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.join(seat("b", "Bob"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();
    mgr.recordResult(created.room, 0, fakeState(), ["Alice", "Bob"]);
    expect(created.room.wins).toEqual([1, 0]);
    created.room.status = "finished";
    created.room.game = null;
    mgr.requestRematch(created.room, 0);
    mgr.requestRematch(created.room, 1);
    expect(created.room.status).toBe("readying");
    expect(created.room.wins).toEqual([1, 0]);
    expect(created.room.lastGame).not.toBeNull();
    expect(mgr.snapshot(created.room).wins).toEqual([1, 0]);
  });

  it("resets the wins tally when a departed player is replaced", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.join(seat("b", "Bob"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();
    mgr.recordResult(created.room, 0, fakeState(), ["Alice", "Bob"]);
    expect(created.room.wins).toEqual([1, 0]);

    mgr.leave("b");
    expect(created.room.status).toBe("waiting");
    expect(mgr.join(seat("c", "Carol"), created.room.code).ok).toBe(true);
    expect(mgr.enterPregame(created.room)).toBeNull();

    expect(created.room.wins).toEqual([0, 0]);
    expect(created.room.lastGame).toBeNull();
  });

  it("rejects spectating a private room", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "private");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.addSpectator(created.room, seat("c", "Carol"))).toBe(
      "This room cannot be spectated",
    );
  });

  it("rejects a seated player spectating their own room", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.addSpectator(created.room, seat("a", "Alice"))).toBe(
      "You are playing in this room",
    );
  });

  it("queues and unqueues a spectator", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(mgr.queueJoin(created.room, "c")).toBe("Not spectating this room");
    expect(mgr.addSpectator(created.room, seat("c", "Carol"))).toBeNull();
    expect(mgr.queueJoin(created.room, "c")).toBeNull();
    expect(created.room.joinQueue).toHaveLength(1);
    expect(mgr.queueJoin(created.room, "c")).toBeNull();
    expect(created.room.joinQueue).toHaveLength(1);
    mgr.leaveQueue(created.room, "c");
    expect(created.room.joinQueue).toHaveLength(0);
  });

  it("removes a spectator from every room on disconnect", () => {
    const mgr = new RoomManager();
    const r1 = mgr.create(seat("a", "Alice"), "medium", "public");
    const r2 = mgr.create(seat("b", "Bob"), "medium", "public");
    if (!r1.ok || !r2.ok) {
      return;
    }
    mgr.addSpectator(r1.room, seat("c", "Carol"));
    mgr.addSpectator(r2.room, seat("c", "Carol"));
    mgr.queueJoin(r1.room, "c");
    mgr.removeSpectatorEverywhere("c");
    expect(r1.room.spectators).toHaveLength(0);
    expect(r1.room.joinQueue).toHaveLength(0);
    expect(r2.room.spectators).toHaveLength(0);
  });

  it("hands a vacated seat to the queued spectator instead of forfeiting", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const room = created.room;
    expect(mgr.join(seat("b", "Bob"), room.code).ok).toBe(true);
    expect(mgr.enterPregame(room)).toBeNull();
    expect(mgr.addSpectator(room, seat("c", "Carol"))).toBeNull();
    expect(mgr.queueJoin(room, "c")).toBeNull();

    const gameOverCalls: unknown[] = [];
    const affected = mgr.leave("a", () => gameOverCalls.push(true));

    expect(affected).toEqual([room.code]);
    expect(gameOverCalls).toHaveLength(0);
    expect(room.status).toBe("waiting");
    expect(room.seats[0]?.user.userId).toBe("c");
    expect(room.seats[1]?.user.userId).toBe("b");
    expect(room.spectators).toHaveLength(0);
    expect(room.joinQueue).toHaveLength(0);
    expect(mgr.get(room.code)).toBe(room);
  });

  it("still forfeits mid-match when no spectator is queued", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const room = created.room;
    expect(mgr.join(seat("b", "Bob"), room.code).ok).toBe(true);
    expect(mgr.enterPregame(room)).toBeNull();
    expect(mgr.setReady(room, 0, true)).toBeNull();
    expect(mgr.setReady(room, 1, true)).toBeNull();
    expect(mgr.beginCountdown(room)).toBeNull();
    expect(
      mgr.startMatch(
        room,
        () => undefined,
        () => undefined,
      ),
    ).toBeNull();

    const gameOverCalls: unknown[] = [];
    mgr.leave("a", () => gameOverCalls.push(true));

    expect(gameOverCalls).toHaveLength(1);
    // Room persists — survivor is promoted to host and waits for a new joiner
    // (matches the "opponent left after the match" behavior for any finished room).
    expect(mgr.get(room.code)).toBe(room);
    expect(room.status).toBe("waiting");
    expect(room.seats[0]?.user.userId).toBe("b");
    expect(room.seats[1]).toBeNull();
  });

  it("notifies spectators when a room closes", () => {
    const mgr = new RoomManager();
    const created = mgr.create(seat("a", "Alice"), "medium", "public");
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const room = created.room;
    const received: string[] = [];
    room.spectators.push({
      user: { userId: "c", displayName: "Carol" },
      send: (data) => received.push(data),
    });
    mgr.leave("a");
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toMatchObject({ type: "spectate_ended" });
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
