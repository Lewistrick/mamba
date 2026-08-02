/**
 * Global (Supabase) leaderboard fetch + verified score submit.
 */

import type { FieldSizeId } from "@mamba/engine";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { GameMode, LeaderboardPeriod, ScoreEntry } from "./leaderboard.ts";
import { periodStart } from "./leaderboard.ts";
import { supabase } from "./supabase.ts";

const MAX_ENTRIES = 10;

/**
 * Loads the top verified global scores for a board.
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param period - Time window (UTC instant compared to created_at).
 * @param verifiedOnly - When true, excludes guest (unverified) rows.
 * @returns Score rows for the UI.
 */
export async function fetchGlobalBoard(
  sizeId: FieldSizeId,
  mode: GameMode,
  period: LeaderboardPeriod,
  verifiedOnly = false,
): Promise<ScoreEntry[]> {
  if (!supabase) {
    return [];
  }

  const startMs = periodStart(period);
  let query = supabase
    .from("scores")
    .select("display_name, score, level, size_id, mode, created_at, user_id")
    .eq("size_id", sizeId)
    .eq("mode", mode)
    .eq("verified", true)
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_ENTRIES);

  if (period !== "all") {
    query = query.gte("created_at", new Date(startMs).toISOString());
  }
  if (verifiedOnly) {
    query = query.not("user_id", "is", null);
  }

  const { data, error } = await query;
  if (error || !data) {
    console.error("fetchGlobalBoard", error);
    return [];
  }

  return data.map((row) => ({
    name: row.display_name as string,
    score: row.score as number,
    level: row.level as number,
    sizeId: row.size_id as FieldSizeId,
    mode: row.mode as GameMode,
    createdAt: Date.parse(row.created_at as string),
    verified: row.user_id != null,
  }));
}

/**
 * Loads a contiguous rank window of global scores (1-based, inclusive) —
 * e.g. the rows just above/below a score that fell outside the displayed
 * top N. Ranks aren't carried per-row: since the query uses the same
 * ordering as {@link fetchGlobalStanding}, the caller derives each row's
 * rank from its position (`max(1, fromRank) + index`).
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param period - Time window.
 * @param fromRank - First rank to include (1-based, inclusive; clamped to 1).
 * @param toRank - Last rank to include (1-based, inclusive).
 * @param verifiedOnly - When true, excludes guest (unverified) rows.
 * @returns Rows in rank order starting at `max(1, fromRank)`.
 */
export async function fetchGlobalBoardWindow(
  sizeId: FieldSizeId,
  mode: GameMode,
  period: LeaderboardPeriod,
  fromRank: number,
  toRank: number,
  verifiedOnly = false,
): Promise<ScoreEntry[]> {
  if (!supabase) {
    return [];
  }
  const from = Math.max(0, fromRank - 1);
  const to = Math.max(from, toRank - 1);

  const startMs = periodStart(period);
  let query = supabase
    .from("scores")
    .select("display_name, score, level, size_id, mode, created_at, user_id")
    .eq("size_id", sizeId)
    .eq("mode", mode)
    .eq("verified", true)
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .range(from, to);

  if (period !== "all") {
    query = query.gte("created_at", new Date(startMs).toISOString());
  }
  if (verifiedOnly) {
    query = query.not("user_id", "is", null);
  }

  const { data, error } = await query;
  if (error || !data) {
    console.error("fetchGlobalBoardWindow", error);
    return [];
  }

  return data.map((row) => ({
    name: row.display_name as string,
    score: row.score as number,
    level: row.level as number,
    sizeId: row.size_id as FieldSizeId,
    mode: row.mode as GameMode,
    createdAt: Date.parse(row.created_at as string),
    verified: row.user_id != null,
  }));
}

/** Global standing for a submitted score in a time window. */
export interface GlobalStanding {
  /** 1-based rank (higher score = better). */
  rank: number;
  /** Total verified scores in the window for this size/mode. */
  total: number;
}

/**
 * Shared count-query base for standing lookups: verified rows matching
 * size/mode/period (+ optional verified-only filter), row count only.
 */
function standingBaseQuery(
  sizeId: FieldSizeId,
  mode: GameMode,
  period: LeaderboardPeriod,
  verifiedOnly: boolean,
) {
  const startMs = periodStart(period);
  let query = supabase!
    .from("scores")
    .select("id", { count: "exact", head: true })
    .eq("size_id", sizeId)
    .eq("mode", mode)
    .eq("verified", true);
  if (period !== "all") {
    query = query.gte("created_at", new Date(startMs).toISOString());
  }
  if (verifiedOnly) {
    query = query.not("user_id", "is", null);
  }
  return query;
}

/**
 * Computes global rank for a score in a period (daily or all-time). Ties
 * share a rank (counts strictly-better rows only) — good enough for a
 * "you're #18" summary, but not precise enough to single out one row among
 * several tied scores (see {@link fetchGlobalStandingExact} for that).
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param score - Submitted net/solo score.
 * @param period - Time window.
 * @param verifiedOnly - When true, excludes guest (unverified) rows.
 * @returns Standing, or null if Supabase is unavailable / query failed.
 */
export async function fetchGlobalStanding(
  sizeId: FieldSizeId,
  mode: GameMode,
  score: number,
  period: LeaderboardPeriod,
  verifiedOnly = false,
): Promise<GlobalStanding | null> {
  if (!supabase) {
    return null;
  }

  const base = () => standingBaseQuery(sizeId, mode, period, verifiedOnly);
  const [{ count: totalRaw, error: totalError }, { count: betterRaw, error: betterError }] =
    await Promise.all([base(), base().gt("score", score)]);

  if (totalError || betterError) {
    console.error("fetchGlobalStanding", totalError ?? betterError);
    return null;
  }

  const total = Math.max(1, totalRaw ?? 0);
  const better = betterRaw ?? 0;
  return { rank: better + 1, total };
}

/**
 * Computes the exact rank of one specific row, tie-broken by `created_at`
 * ascending — matching the board's own ordering — so it can single out one
 * row among several tied scores (needed to highlight the right one when
 * more than one score in the window ties with the player's own).
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param score - The row's score.
 * @param createdAtMs - The row's server-assigned `created_at` (epoch ms),
 * as returned by {@link submitGlobalScore}.
 * @param period - Time window.
 * @param verifiedOnly - When true, excludes guest (unverified) rows.
 * @returns Standing, or null if Supabase is unavailable / query failed.
 */
export async function fetchGlobalStandingExact(
  sizeId: FieldSizeId,
  mode: GameMode,
  score: number,
  createdAtMs: number,
  period: LeaderboardPeriod,
  verifiedOnly = false,
): Promise<GlobalStanding | null> {
  if (!supabase) {
    return null;
  }

  const createdAtIso = new Date(createdAtMs).toISOString();
  const base = () => standingBaseQuery(sizeId, mode, period, verifiedOnly);
  const [{ count: totalRaw, error: totalError }, { count: betterRaw, error: betterError }] =
    await Promise.all([
      base(),
      base().or(`score.gt.${score},and(score.eq.${score},created_at.lt.${createdAtIso})`),
    ]);

  if (totalError || betterError) {
    console.error("fetchGlobalStandingExact", totalError ?? betterError);
    return null;
  }

  const total = Math.max(1, totalRaw ?? 0);
  const better = betterRaw ?? 0;
  return { rank: better + 1, total };
}

/** Body posted to the verify-score Edge Function. */
export interface GlobalSubmitBody {
  seed: number;
  sizeId: FieldSizeId;
  mode: GameMode;
  headings: string[];
  headingsAi?: string[];
  claimedScore: number;
  claimedLevel: number;
  displayName: string;
  /** Persisted guest id — omit when submitting under a signed-in session. */
  guestId?: string;
}

/**
 * Submits a replay to the verify-score function for global publication.
 * Signed-in submits authenticate via the current session; guest submits
 * carry `guestId` in the body instead.
 *
 * @param body - Replay + claimed score.
 * @returns Error message or null on success, plus the row's server-assigned
 * `created_at` (epoch ms) on success — needed to later single this exact
 * row out from others tied on score (see {@link fetchGlobalStandingExact}).
 */
export async function submitGlobalScore(body: GlobalSubmitBody): Promise<{
  error: string | null;
  createdAt?: number;
}> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token && !body.guestId) {
    return { error: "Sign in or choose a name to submit global scores" };
  }

  const { data, error } = await supabase.functions.invoke("verify-score", {
    body,
  });

  if (error) {
    // The client library discards the response body on non-2xx status
    // codes, surfacing only a generic "non-2xx status code" message — pull
    // the actual { error: "..." } reason back out of the raw response.
    if (error instanceof FunctionsHttpError) {
      try {
        const responseBody = (await error.context.json()) as { error?: string };
        if (responseBody?.error) {
          return { error: responseBody.error };
        }
      } catch {
        // Fall through to the generic message below.
      }
    }
    return { error: error.message };
  }
  if (data && typeof data === "object" && "error" in data) {
    return { error: String((data as { error: string }).error) };
  }
  const createdAtRaw = (data as { score?: { created_at?: string } } | null)?.score?.created_at;
  const createdAt = createdAtRaw ? Date.parse(createdAtRaw) : undefined;
  return { error: null, createdAt };
}
