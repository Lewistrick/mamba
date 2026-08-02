/**
 * Supabase JWT + profile checks for multiplayer.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { INITIAL_ELO, type EloChange } from "./elo.ts";

/** Authenticated multiplayer identity. */
export interface MpUser {
  userId: string;
  displayName: string;
  /** True for a signed-in account with a locked username; false for a guest. */
  verified: boolean;
}

/** Max display name length (mirrors the client's sanitizeName). */
const MAX_NAME_LENGTH = 12;

/**
 * Sanitizes a display name: collapse whitespace, trim, cap length.
 *
 * @param raw - User-supplied name.
 * @returns Cleaned name (may be empty).
 */
function sanitizeDisplayName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Checks whether a name is locked to a verified account, so guests can't
 * impersonate/steal it.
 *
 * @param supabase - Admin client.
 * @param name - Candidate display name (already sanitized).
 * @returns True if a verified account already owns this name.
 */
async function isReservedDisplayName(
  supabase: SupabaseClient,
  name: string,
): Promise<boolean> {
  const escaped = name.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username_set", true)
    .ilike("display_name", escaped)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("isReservedDisplayName", error.message);
    return false;
  }
  return data != null;
}

/**
 * Creates a Supabase client for the game server.
 *
 * Loads credentials from process env (use `tsx --env-file=.env` locally).
 *
 * @returns Client or null if env is missing.
 */
export function createSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) {
    return null;
  }
  if (/YOUR_PROJECT|YOUR_ANON_KEY|YOUR_SERVICE_ROLE_KEY|placeholder/i.test(`${url}${key}`)) {
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
      verified: true,
    },
  };
}

/**
 * Builds a guest identity from a persisted client-side guest id + chosen name.
 *
 * @param supabase - Admin client.
 * @param guestId - Guest's persistent UUID (also used as the room-seat key).
 * @param rawDisplayName - Guest's chosen name, not yet sanitized.
 * @returns Identity or an error message.
 */
export async function authenticateGuest(
  supabase: SupabaseClient,
  guestId: string,
  rawDisplayName: string,
): Promise<{ user: MpUser } | { error: string }> {
  if (!/^[0-9a-f-]{8,36}$/i.test(guestId)) {
    return { error: "Invalid guest id" };
  }
  const displayName = sanitizeDisplayName(rawDisplayName);
  if (!displayName) {
    return { error: "Choose a name before playing" };
  }
  if (await isReservedDisplayName(supabase, displayName)) {
    return { error: "That name is taken by a verified player — choose another" };
  }
  return {
    user: {
      userId: guestId,
      displayName,
      verified: false,
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
    userId: string | null;
    guestId: string | null;
    displayName: string;
    score: number;
    level: number;
    sizeId: string;
  }[],
): Promise<void> {
  for (const row of rows) {
    const { error } = await supabase.from("scores").insert({
      user_id: row.userId,
      guest_id: row.guestId,
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
