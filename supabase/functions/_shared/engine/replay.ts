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
  /** Absolute heading applied at the start of each tick (after input). */
  headings: Direction[];
  claimedScore: number;
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

  const game = new Game({ ...FIELD_SIZES[payload.sizeId], seed: payload.seed });
  let state = game.getState();
  for (const heading of payload.headings) {
    if (state.status !== "playing") {
      return {
        ok: false,
        score: state.score,
        level: state.level,
        ticks: state.tick,
        reason: "extra_inputs_after_gameover",
      };
    }
    state = game.replayStep(heading);
  }

  if (state.status !== "gameover") {
    return {
      ok: false,
      score: state.score,
      level: state.level,
      ticks: state.tick,
      reason: "run_not_finished",
    };
  }
  if (state.score !== payload.claimedScore || state.level !== payload.claimedLevel) {
    return {
      ok: false,
      score: state.score,
      level: state.level,
      ticks: state.tick,
      reason: "score_mismatch",
    };
  }

  return {
    ok: true,
    score: state.score,
    level: state.level,
    ticks: state.tick,
  };
}
