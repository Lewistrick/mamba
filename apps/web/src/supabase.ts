/**
 * Supabase browser client (optional until env is configured).
 */

import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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
export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  if (!supabase) {
    return { error: "Supabase is not configured" };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  return { error: error?.message ?? null };
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
    .select("id, display_name, username_set")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    // Older DBs without username_set still return display_name.
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
    };
  }
  return {
    id: data.id as string,
    displayName: String(data.display_name ?? "AAA"),
    usernameSet: Boolean(data.username_set),
  };
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
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name, username_set: true })
    .eq("id", user.id)
    .eq("username_set", false);
  return { error: error?.message ?? null };
}
