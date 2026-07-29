/**
 * Supabase JWT + profile checks for multiplayer.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { INITIAL_ELO, type EloChange } from "./elo.ts";

/** Authenticated multiplayer identity. */
export interface MpUser {
  userId: string;
  displayName: string;
}

/**
 * Creates a Supabase client for the game server.
 *
 * @returns Client or null if env is missing.
 */
export function createSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

/**
 * Validates an access token and loads a locked username.
 *
 * @param supabase - Supabase client.
 * @param accessToken - User JWT.
 * @returns Identity or an error message.
 */
export async function authenticatePlayer(
  supabase: SupabaseClient,
  accessToken: string,
): Promise<{ user: MpUser } | { error: string }> {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return { error: "Invalid or expired session — sign in again" };
  }
  const userId = data.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, username_set")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    return { error: profileError.message };
  }
  if (!profile?.username_set || !profile.display_name) {
    return { error: "Choose a username before multiplayer" };
  }
  return {
    user: {
      userId,
      displayName: String(profile.display_name).slice(0, 12),
    },
  };
}

/**
 * Inserts verified global multiplayer scores (server-authoritative).
 *
 * @param supabase - Admin client.
 * @param rows - Per-player nets to insert.
 */
export async function insertMpScores(
  supabase: SupabaseClient,
  rows: {
    userId: string;
    displayName: string;
    score: number;
    level: number;
    sizeId: string;
  }[],
): Promise<void> {
  for (const row of rows) {
    const { error } = await supabase.from("scores").insert({
      user_id: row.userId,
      display_name: row.displayName,
      score: row.score,
      level: row.level,
      size_id: row.sizeId,
      mode: "mp",
      seed: 0,
      headings: [],
      verified: true,
    });
    if (error) {
      console.error("insertMpScores", error.message);
    }
  }
}

/**
 * Loads Elo ratings for two users (defaults to INITIAL_ELO).
 *
 * @param supabase - Admin client.
 * @param userIdA - Seat 0.
 * @param userIdB - Seat 1.
 * @returns Ratings for A and B.
 */
export async function fetchElos(
  supabase: SupabaseClient,
  userIdA: string,
  userIdB: string,
): Promise<[number, number]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, elo")
    .in("id", [userIdA, userIdB]);
  if (error) {
    console.error("fetchElos", error.message);
    return [INITIAL_ELO, INITIAL_ELO];
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const elo = Number(row.elo);
    map.set(String(row.id), Number.isFinite(elo) ? elo : INITIAL_ELO);
  }
  return [map.get(userIdA) ?? INITIAL_ELO, map.get(userIdB) ?? INITIAL_ELO];
}

/**
 * Persists updated Elo ratings after a match.
 *
 * @param supabase - Admin client.
 * @param userIdA - Seat 0.
 * @param userIdB - Seat 1.
 * @param a - Seat 0 change.
 * @param b - Seat 1 change.
 */
export async function persistElos(
  supabase: SupabaseClient,
  userIdA: string,
  userIdB: string,
  a: EloChange,
  b: EloChange,
): Promise<void> {
  for (const [userId, after] of [
    [userIdA, a.after],
    [userIdB, b.after],
  ] as const) {
    const { error } = await supabase
      .from("profiles")
      .update({ elo: after })
      .eq("id", userId);
    if (error) {
      console.error("persistElos", error.message);
    }
  }
}
