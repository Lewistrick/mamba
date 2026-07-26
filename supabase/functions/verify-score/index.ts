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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: {
    seed?: number;
    sizeId?: string;
    mode?: string;
    headings?: string[];
    claimedScore?: number;
    claimedLevel?: number;
    displayName?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const displayName = String(body.displayName ?? "AAA")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12) || "AAA";

  const payload = {
    seed: Number(body.seed),
    sizeId: body.sizeId as "small" | "medium" | "large",
    mode: String(body.mode ?? "solo"),
    headings: body.headings as ("Up" | "Down" | "Left" | "Right")[],
    claimedScore: Number(body.claimedScore),
    claimedLevel: Number(body.claimedLevel),
  };

  const verified = verifyReplay(payload);
  if (!verified.ok) {
    return json({ error: "verification_failed", reason: verified.reason, verified }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("scores")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", hourAgo);
  if (countError) {
    return json({ error: "rate_limit_check_failed" }, 500);
  }
  if ((count ?? 0) >= MAX_SUBMITS_PER_HOUR) {
    return json({ error: "rate_limited" }, 429);
  }

  await admin.from("profiles").upsert({
    id: user.id,
    display_name: displayName,
  });

  const { data: row, error: insertError } = await admin
    .from("scores")
    .insert({
      user_id: user.id,
      display_name: displayName,
      score: verified.score,
      level: verified.level,
      size_id: payload.sizeId,
      mode: payload.mode,
      seed: payload.seed,
      headings: payload.headings,
      verified: true,
    })
    .select("id, score, level, created_at")
    .single();

  if (insertError) {
    return json({ error: "insert_failed", detail: insertError.message }, 500);
  }

  return json({ ok: true, score: row });
});
