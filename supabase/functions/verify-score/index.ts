/**
 * Verifies a Mamba replay and inserts a global score row.
 *
 * Auth: Bearer user JWT required.
 * Inserts use the service-role key (never exposed to the client).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyReplay } from "../_shared/engine/replay.ts";

const MAX_SUBMITS_PER_HOUR = 30;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * JSON response helper.
 *
 * @param body - Response body.
 * @param status - HTTP status.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  let body: {
    seed?: number;
    sizeId?: string;
    mode?: string;
    headings?: string[];
    headingsAi?: string[];
    claimedScore?: number;
    claimedLevel?: number;
    displayName?: string;
    guestId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Verified path: a real Supabase user JWT. Falls back to a guest identity
  // (persisted client-side UUID + chosen name, no account) rather than
  // 401ing outright — accounts are a trust badge here, not a play gate.
  let actor: { verified: true; userId: string } | { verified: false; guestId: string };
  const authHeader = req.headers.get("Authorization");
  let verifiedUserId: string | null = null;
  if (authHeader) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    verifiedUserId = user?.id ?? null;
  }
  if (verifiedUserId) {
    actor = { verified: true, userId: verifiedUserId };
  } else {
    const guestId = String(body.guestId ?? "");
    if (!/^[0-9a-f-]{8,36}$/i.test(guestId)) {
      return json({ error: "unauthorized" }, 401);
    }
    actor = { verified: false, guestId };
  }

  const displayName = actor.verified
    ? String(body.displayName ?? "AAA").replace(/\s+/g, " ").trim().slice(0, 12) || "AAA"
    : String(body.displayName ?? "").replace(/\s+/g, " ").trim().slice(0, 12);
  if (!actor.verified && !displayName) {
    return json({ error: "name_required" }, 400);
  }

  const payload = {
    seed: Number(body.seed),
    sizeId: body.sizeId as "small" | "medium" | "large",
    mode: String(body.mode ?? "solo"),
    headings: body.headings as ("Up" | "Down" | "Left" | "Right")[],
    headingsAi: body.headingsAi as ("Up" | "Down" | "Left" | "Right")[] | undefined,
    claimedScore: Number(body.claimedScore),
    claimedLevel: Number(body.claimedLevel),
  };

  const verified = verifyReplay(payload);
  if (!verified.ok) {
    return json({ error: "verification_failed", reason: verified.reason, verified }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  if (!actor.verified) {
    // Guests can't claim a name locked to a verified account.
    const escaped = displayName.replace(/[%_\\]/g, (ch) => `\\${ch}`);
    const { data: reserved, error: reservedError } = await admin
      .from("profiles")
      .select("id")
      .eq("username_set", true)
      .ilike("display_name", escaped)
      .limit(1)
      .maybeSingle();
    if (reservedError) {
      return json({ error: "name_check_failed" }, 500);
    }
    if (reserved) {
      return json({ error: "name_taken" }, 409);
    }
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let rateQuery = admin
    .from("scores")
    .select("id", { count: "exact", head: true })
    .gte("created_at", hourAgo);
  rateQuery = actor.verified
    ? rateQuery.eq("user_id", actor.userId)
    : rateQuery.eq("guest_id", actor.guestId);
  const { count, error: countError } = await rateQuery;
  if (countError) {
    return json({ error: "rate_limit_check_failed" }, 500);
  }
  if ((count ?? 0) >= MAX_SUBMITS_PER_HOUR) {
    return json({ error: "rate_limited" }, 429);
  }

  if (actor.verified) {
    await admin.from("profiles").upsert({
      id: actor.userId,
      display_name: displayName,
    });
  }

  const headingsStore = payload.headingsAi
    ? { human: payload.headings, ai: payload.headingsAi }
    : payload.headings;

  const { data: row, error: insertError } = await admin
    .from("scores")
    .insert({
      user_id: actor.verified ? actor.userId : null,
      guest_id: actor.verified ? null : actor.guestId,
      display_name: displayName,
      score: verified.score,
      level: verified.level,
      size_id: payload.sizeId,
      mode: payload.mode,
      seed: payload.seed,
      headings: headingsStore,
      verified: true,
    })
    .select("id, score, level, created_at")
    .single();

  if (insertError) {
    return json({ error: "insert_failed", detail: insertError.message }, 500);
  }

  return json({ ok: true, score: row });
});
