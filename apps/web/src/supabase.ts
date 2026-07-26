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
