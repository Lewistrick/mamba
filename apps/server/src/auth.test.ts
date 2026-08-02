/**
 * Unit tests for authenticateGuest (sanitize + reserved-name enforcement).
 */

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateGuest } from "./auth.ts";

/**
 * Minimal fake Supabase client covering only the query chain
 * isReservedDisplayName uses (profiles.select.eq.ilike.limit.maybeSingle).
 *
 * @param reserved - Display names already locked to a verified account.
 * @returns Fake client.
 */
function fakeSupabase(reserved: string[]): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          ilike: (_col: string, pattern: string) => ({
            limit: () => ({
              maybeSingle: async () => {
                const target = pattern.toLowerCase();
                const match = reserved.some((r) => r.toLowerCase() === target);
                return { data: match ? { id: "reserved-user" } : null, error: null };
              },
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const VALID_GUEST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("authenticateGuest", () => {
  it("rejects a malformed guest id", async () => {
    const result = await authenticateGuest(fakeSupabase([]), "not-a-uuid!", "Guest");
    expect(result).toEqual({ error: "Invalid guest id" });
  });

  it("rejects an empty or whitespace-only name", async () => {
    const result = await authenticateGuest(fakeSupabase([]), VALID_GUEST_ID, "   ");
    expect(result).toEqual({ error: "Choose a name before playing" });
  });

  it("sanitizes the display name (collapse whitespace, trim, cap length)", async () => {
    const result = await authenticateGuest(
      fakeSupabase([]),
      VALID_GUEST_ID,
      "  Really   Long   Guest Name  ",
    );
    expect("user" in result && result.user.displayName).toBe("Really Long ");
  });

  it("rejects a name locked to a verified account, case-insensitively", async () => {
    const result = await authenticateGuest(
      fakeSupabase(["Lewistrick"]),
      VALID_GUEST_ID,
      "lewistrick",
    );
    expect(result).toEqual({
      error: "That name is taken by a verified player — choose another",
    });
  });

  it("succeeds with an unreserved name", async () => {
    const result = await authenticateGuest(fakeSupabase(["Lewistrick"]), VALID_GUEST_ID, "Guest1");
    expect(result).toEqual({
      user: { userId: VALID_GUEST_ID, displayName: "Guest1", verified: false },
    });
  });
});
