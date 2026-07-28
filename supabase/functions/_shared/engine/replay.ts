/**
 * Replay verification for anti-cheat score submissions.
 */

import { Game } from "./game.ts";
import { FIELD_SIZES, type Direction, type FieldSizeId } from "./types.ts";

/** Maximum ticks accepted in a verified replay. */
export const MAX_REPLAY_TICKS = 100_000;

/** Payload recorded by the client and re-simulated on the server. */
export interface ReplayPayload {
  seed: number;
  sizeId: FieldSizeId;
  mode: string;
  /**
   * Absolute heading applied each tick for player 0.
   * For solo this is the only stream; for `ai:*` pair with {@link headingsAi}.
   */
  headings: Direction[];
  /** Absolute headings for player 1 (AI); required when mode starts with `ai:`. */
  headingsAi?: Direction[];
  /** Claimed score: solo score, or net (P0 − P1) for AI modes. */
  claimedScore: number;
  /** Claimed player-0 level (solo / human). */
  claimedLevel: number;
}

/** Result of re-simulating a replay. */
export interface VerifyResult {
  ok: boolean;
  score: number;
  level: number;
  ticks: number;
  reason?: string;
}

const DIRECTIONS = new Set<Direction>(["Up", "Down", "Left", "Right"]);

/**
 * Re-simulates a run from seed + per-tick headings and checks claimed score/level.
 *
 * @param payload - Client submission.
 * @returns Verification outcome.
 */
export function verifyReplay(payload: ReplayPayload): VerifyResult {
  if (!FIELD_SIZES[payload.sizeId]) {
    return { ok: false, score: 0, level: 0, ticks: 0, reason: "invalid_size" };
  }
  if (!Number.isInteger(payload.seed) || payload.seed < 0) {
    return { ok: false, score: 0, level: 0, ticks: 0, reason: "invalid_seed" };
  }
  if (!Array.isArray(payload.headings) || payload.headings.length === 0) {
    return { ok: false, score: 0, level: 0, ticks: 0, reason: "empty_replay" };
  }
  if (payload.headings.length > MAX_REPLAY_TICKS) {
    return { ok: false, score: 0, level: 0, ticks: 0, reason: "replay_too_long" };
  }
  for (const heading of payload.headings) {
    if (!DIRECTIONS.has(heading)) {
      return { ok: false, score: 0, level: 0, ticks: 0, reason: "invalid_heading" };
    }
  }

  const versus = payload.mode.startsWith("ai:");
  if (versus) {
    if (!Array.isArray(payload.headingsAi) || payload.headingsAi.length === 0) {
      return { ok: false, score: 0, level: 0, ticks: 0, reason: "empty_ai_replay" };
    }
    if (payload.headingsAi.length !== payload.headings.length) {
      return { ok: false, score: 0, level: 0, ticks: 0, reason: "ai_replay_length_mismatch" };
    }
    for (const heading of payload.headingsAi) {
      if (!DIRECTIONS.has(heading)) {
        return { ok: false, score: 0, level: 0, ticks: 0, reason: "invalid_ai_heading" };
      }
    }
  }

  const game = versus
    ? Game.versusAi(payload.sizeId, payload.seed)
    : new Game({ ...FIELD_SIZES[payload.sizeId], seed: payload.seed });

  let state = game.getState();
  for (let i = 0; i < payload.headings.length; i += 1) {
    if (state.status !== "playing") {
      return {
        ok: false,
        score: versus ? state.netScore : state.score,
        level: state.level,
        ticks: state.tick,
        reason: "extra_inputs_after_gameover",
      };
    }
    if (versus) {
      state = game.replayStep([payload.headings[i], payload.headingsAi![i]]);
    } else {
      state = game.replayStep(payload.headings[i]);
    }
  }

  if (state.status !== "gameover") {
    return {
      ok: false,
      score: versus ? state.netScore : state.score,
      level: state.level,
      ticks: state.tick,
      reason: "run_not_finished",
    };
  }

  const finalScore = versus ? state.netScore : state.score;
  if (finalScore !== payload.claimedScore || state.level !== payload.claimedLevel) {
    return {
      ok: false,
      score: finalScore,
      level: state.level,
      ticks: state.tick,
      reason: "score_mismatch",
    };
  }

  return {
    ok: true,
    score: finalScore,
    level: state.level,
    ticks: state.tick,
  };
}
