/**
 * Supabase browser client (optional until env is configured).
 */

import type { FieldSizeId } from "@mamba/engine";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Auth email redirect target (origin + Vite base, e.g. `https://host/mamba/`).
 *
 * @returns Absolute URL for `emailRedirectTo`.
 */
function authRedirectTo(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/**
 * True when the URL looks like a real Supabase project (not a placeholder).
 *
 * @param value - Candidate URL.
 * @returns Whether the URL is usable.
 */
function isConfiguredSupabaseUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  if (/YOUR_PROJECT|example\.supabase|placeholder/i.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

const url = isConfiguredSupabaseUrl(rawUrl) ? rawUrl : undefined;
const anonKey =
  rawAnonKey && !/YOUR_ANON_KEY|CHANGEME|placeholder/i.test(rawAnonKey)
    ? rawAnonKey
    : undefined;

/** True when Vite env has Supabase credentials. */
export const supabaseConfigured = Boolean(url && anonKey);

/** Shared browser client, or null when not configured. */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null;

/**
 * Returns the current session if Supabase is configured.
 *
 * @returns Session or null.
 */
export async function getSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Returns the current user if signed in.
 *
 * @returns User or null.
 */
export async function getUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Sends a magic-link sign-in email.
 *
 * @param email - Recipient address.
 */
export async function signInWithMagicLink(email: string): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: authRedirectTo(),
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Signs in with email + password.
 *
 * @param email - Account email.
 * @param password - Account password.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return { error: error?.message ?? null };
}

/**
 * Creates an account with email + password.
 *
 * @param email - Account email.
 * @param password - Account password.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<{ error: string | null; needsEmailConfirm: boolean }> {
  if (!supabase) {
    return { error: "Supabase is not configured", needsEmailConfirm: false };
  }
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: authRedirectTo(),
    },
  });
  if (error) {
    return { error: error.message, needsEmailConfirm: false };
  }
  // When confirmations are enabled, session is null until the user verifies.
  return { error: null, needsEmailConfirm: !data.session };
}

/**
 * Signs the current user out.
 */
export async function signOut(): Promise<void> {
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut();
}

/** Profile row used for the locked account username. */
export interface Profile {
  id: string;
  displayName: string;
  usernameSet: boolean;
  /** Online 1v1 Elo (defaults to 1000). */
  elo: number;
}

/**
 * Loads the signed-in user's profile.
 *
 * @returns Profile or null if missing / signed out.
 */
export async function fetchProfile(): Promise<Profile | null> {
  if (!supabase) {
    return null;
  }
  const user = await getUser();
  if (!user) {
    return null;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, username_set, elo")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    // Older DBs without username_set / elo still return display_name.
    const fallback = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (fallback.error || !fallback.data) {
      return null;
    }
    const name = String(fallback.data.display_name ?? "");
    return {
      id: fallback.data.id as string,
      displayName: name || "AAA",
      usernameSet: Boolean(name && name !== "AAA"),
      elo: 1000,
    };
  }
  const eloRaw = Number((data as { elo?: unknown }).elo);
  return {
    id: data.id as string,
    displayName: String(data.display_name ?? "AAA"),
    usernameSet: Boolean(data.username_set),
    elo: Number.isFinite(eloRaw) ? eloRaw : 1000,
  };
}

/**
 * Checks whether a name is locked to a verified account, so a guest can't
 * choose (or keep) a name that would collide with one. Mirrors the same
 * check the server runs on guest MP auth / global score submission.
 *
 * @param name - Candidate display name (not yet sanitized).
 * @returns True if a verified account already owns this name.
 */
export async function isDisplayNameReserved(name: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }
  const escaped = name.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username_set", true)
    .ilike("display_name", escaped)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("isDisplayNameReserved", error.message);
    return false;
  }
  return data != null;
}

/**
 * Sets the account username once (rejected by the app if already set).
 *
 * @param displayName - Chosen name.
 * @returns Error message or null.
 */
export async function setAccountUsername(displayName: string): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  const user = await getUser();
  if (!user) {
    return { error: "Not signed in" };
  }
  const name = displayName.replace(/\s+/g, " ").trim().slice(0, 12);
  if (!name) {
    return { error: "Name required" };
  }

  const existing = await fetchProfile();
  if (existing?.usernameSet) {
    return { error: "Username already set" };
  }

  // Upsert so accounts created before the profiles table/trigger still work.
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: name,
      username_set: true,
    },
    { onConflict: "id" },
  );
  if (error) {
    if (/schema cache|profiles/i.test(error.message) || error.code === "PGRST205") {
      return {
        error: "Profiles table missing — run supabase/setup.sql in the Supabase SQL editor",
      };
    }
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Updates the account username (allowed after the initial lock).
 *
 * @param displayName - New display name.
 * @returns Error message or null.
 */
export async function updateAccountUsername(
  displayName: string,
): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  const user = await getUser();
  if (!user) {
    return { error: "Not signed in" };
  }
  const name = displayName.replace(/\s+/g, " ").trim().slice(0, 12);
  if (!name) {
    return { error: "Name required" };
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: name,
      username_set: true,
    },
    { onConflict: "id" },
  );
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Updates the signed-in user's password.
 *
 * @param password - New password (min 6 chars).
 * @returns Error message or null.
 */
export async function updateAccountPassword(
  password: string,
): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }
  const { error } = await supabase.auth.updateUser({ password });
  return { error: error?.message ?? null };
}

/** One verified score row belonging to the current user. */
export interface MyScoreRow {
  score: number;
  level: number;
  sizeId: FieldSizeId;
  mode: string;
  createdAt: number;
}

/**
 * Loads all verified scores for the signed-in user (for Profile stats).
 *
 * @returns Score rows newest-last (ascending created_at), or empty if signed out.
 */
export async function fetchMyScores(): Promise<MyScoreRow[]> {
  if (!supabase) {
    return [];
  }
  const user = await getUser();
  if (!user) {
    return [];
  }
  const { data, error } = await supabase
    .from("scores")
    .select("score, level, size_id, mode, created_at")
    .eq("user_id", user.id)
    .eq("verified", true)
    .order("created_at", { ascending: true });
  if (error || !data) {
    console.error("fetchMyScores", error);
    return [];
  }
  return data.map((row) => ({
    score: row.score as number,
    level: row.level as number,
    sizeId: row.size_id as FieldSizeId,
    mode: String(row.mode ?? "solo"),
    createdAt: Date.parse(row.created_at as string),
  }));
}
