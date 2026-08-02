/**
 * Local leaderboards: size × period × mode, persisted in localStorage.
 */

import type { FieldSizeId } from "@mamba/engine";

const STORAGE_KEY = "mamba.scores.v1";
const MAX_ENTRIES = 20;

/** Time window for a leaderboard view. */
export type LeaderboardPeriod = "all" | "weekly" | "daily";

/**
 * Game mode for a score row. `solo` is Phase 3; AI/MP reuse this later.
 */
export type GameMode = "solo" | `ai:${string}` | "mp";

/** One submitted high-score row. */
export interface ScoreEntry {
  name: string;
  score: number;
  level: number;
  sizeId: FieldSizeId;
  mode: GameMode;
  /** Epoch milliseconds when the run ended. */
  createdAt: number;
  /** Global rows only: true for a verified (signed-in) player, false for a guest. */
  verified?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the rolling-window start for the given period.
 *
 * @param period - all / weekly / daily.
 * @param now - Reference instant (ms).
 * @returns Inclusive lower bound for `createdAt`: `now` minus 24h (daily) or
 * 7 days (weekly), or 0 for all-time — not calendar-day/week boundaries.
 */
export function periodStart(period: LeaderboardPeriod, now: number = Date.now()): number {
  if (period === "all") {
    return 0;
  }
  if (period === "daily") {
    return now - DAY_MS;
  }
  return now - 7 * DAY_MS;
}

/**
 * Sanitizes a player name for storage/display.
 *
 * @param raw - User input.
 * @returns Trimmed name, max 12 chars, or "AAA" if empty.
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 12);
  return cleaned.length > 0 ? cleaned : "AAA";
}

/**
 * Loads all stored score rows.
 *
 * @returns Score entries (may be empty).
 */
export function loadAllScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isScoreEntry);
  } catch {
    return [];
  }
}

/**
 * Returns the ranked board for a size/mode/period (highest score first).
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param period - Time window.
 * @param now - Reference instant for period bounds.
 * @param all - Optional preloaded scores (for tests).
 * @param limit - Max rows to return (default {@link MAX_ENTRIES}); pass
 * `Infinity` for the full ranked list, e.g. to look up a rank beyond the
 * displayed board.
 * @returns Up to `limit` rows.
 */
export function getBoard(
  sizeId: FieldSizeId,
  mode: GameMode,
  period: LeaderboardPeriod,
  now: number = Date.now(),
  all: ScoreEntry[] = loadAllScores(),
  limit: number = MAX_ENTRIES,
): ScoreEntry[] {
  const start = periodStart(period, now);
  return all
    .filter(
      (entry) =>
        entry.sizeId === sizeId &&
        entry.mode === mode &&
        entry.createdAt >= start,
    )
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.createdAt - b.createdAt;
    })
    .slice(0, limit);
}

/**
 * Ranks that fall outside a displayed top-N board but should still be shown
 * alongside a highlighted row — {@link rank} itself plus its immediate
 * neighbors (rank − 1, rank + 1), clamped to the board's bounds and with
 * anything already covered by the top N filtered out.
 *
 * Returns `[]` when `rank` is already within the top N (nothing extra to
 * show) — callers should treat that as "highlight in place, no separate
 * section" rather than "no rank to highlight".
 *
 * @param rank - 1-based rank of the row of interest.
 * @param displayedCount - How many rows the top board already shows (N).
 * @param total - Total rows in the full ranked list.
 * @returns Extra ranks to show, ascending, always including `rank` itself
 * when non-empty (so callers can source that row's data appropriately).
 */
export function neighborRanks(
  rank: number,
  displayedCount: number,
  total: number,
): number[] {
  if (rank <= displayedCount) {
    return [];
  }
  return [rank - 1, rank, rank + 1].filter(
    (r) => r >= 1 && r <= total && r > displayedCount,
  );
}

/**
 * Whether a score would place on the all-time board for size/mode.
 *
 * @param score - Candidate score.
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param all - Optional preloaded scores.
 * @returns True if the score belongs in the top {@link MAX_ENTRIES}.
 */
export function qualifiesForBoard(
  score: number,
  sizeId: FieldSizeId,
  mode: GameMode,
  all: ScoreEntry[] = loadAllScores(),
): boolean {
  const board = getBoard(sizeId, mode, "all", Date.now(), all);
  if (board.length < MAX_ENTRIES) {
    return true;
  }
  return score > board[board.length - 1].score;
}

/**
 * Inserts a score into storage and returns the updated all-time board + rank.
 *
 * @param entry - Score to insert (name should already be sanitized).
 * @returns 1-based rank on the all-time board for that size/mode, or null if not placed.
 */
export function submitScore(entry: ScoreEntry): {
  rank: number | null;
  board: ScoreEntry[];
} {
  const all = loadAllScores();
  all.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  const board = getBoard(entry.sizeId, entry.mode, "all", Date.now(), all);
  const rankIndex = board.findIndex(
    (row) =>
      row.createdAt === entry.createdAt &&
      row.score === entry.score &&
      row.name === entry.name,
  );
  return {
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    board,
  };
}

/**
 * Type guard for persisted score rows.
 *
 * @param value - Unknown JSON value.
 * @returns True if the value is a valid {@link ScoreEntry}.
 */
function isScoreEntry(value: unknown): value is ScoreEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Partial<ScoreEntry>;
  return (
    typeof row.name === "string" &&
    typeof row.score === "number" &&
    typeof row.level === "number" &&
    (row.sizeId === "small" || row.sizeId === "medium" || row.sizeId === "large") &&
    typeof row.mode === "string" &&
    typeof row.createdAt === "number"
  );
}

export { MAX_ENTRIES };
