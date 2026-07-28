/**
 * Global (Supabase) leaderboard fetch + verified score submit.
 */

import type { FieldSizeId } from "@mamba/engine";
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
 * @returns Score rows for the UI.
 */
export async function fetchGlobalBoard(
  sizeId: FieldSizeId,
  mode: GameMode,
  period: LeaderboardPeriod,
): Promise<ScoreEntry[]> {
  if (!supabase) {
    return [];
  }

  const startMs = periodStart(period);
  let query = supabase
    .from("scores")
    .select("display_name, score, level, size_id, mode, created_at")
    .eq("size_id", sizeId)
    .eq("mode", mode)
    .eq("verified", true)
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_ENTRIES);

  if (period !== "all") {
    query = query.gte("created_at", new Date(startMs).toISOString());
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
 * Computes global rank for a score in a period (daily or all-time).
 *
 * @param sizeId - Board size.
 * @param mode - Game mode.
 * @param score - Submitted net/solo score.
 * @param period - `daily` or `all`.
 * @returns Standing, or null if Supabase is unavailable / query failed.
 */
export async function fetchGlobalStanding(
  sizeId: FieldSizeId,
  mode: GameMode,
  score: number,
  period: "daily" | "all",
): Promise<GlobalStanding | null> {
  if (!supabase) {
    return null;
  }

  const startMs = periodStart(period);
  const base = () => {
    let query = supabase!
      .from("scores")
      .select("id", { count: "exact", head: true })
      .eq("size_id", sizeId)
      .eq("mode", mode)
      .eq("verified", true);
    if (period !== "all") {
      query = query.gte("created_at", new Date(startMs).toISOString());
    }
    return query;
  };

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
}

/**
 * Submits a replay to the verify-score function for global publication.
 *
 * @param body - Replay + claimed score.
 * @returns Error message or null on success.
 */
export async function submitGlobalScore(body: GlobalSubmitBody): Promise<{
  error: string | null;
}> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { error: "Sign in to submit global scores" };
  }

  const { data, error } = await supabase.functions.invoke("verify-score", {
    body,
  });

  if (error) {
    return { error: error.message };
  }
  if (data && typeof data === "object" && "error" in data) {
    return { error: String((data as { error: string }).error) };
  }
  return { error: null };
}
