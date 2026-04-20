import type { VercelRequest } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabaseAdmin";

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();

function bearerFromHeader(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader !== "string") return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

export async function requireAuthedProfile(req: VercelRequest): Promise<
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; status: number; error: string }
> {
  const token = bearerFromHeader(req);
  if (!token) {
    // #region agent log
    try {
      fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
        body: JSON.stringify({
          sessionId: "46abe0",
          runId: "option1-branches-initial",
          hypothesisId: "B1",
          location: "api/_lib/auth.ts:requireAuthedProfile",
          message: "missing bearer token",
          data: { hasAuthorizationHeader: !!req.headers.authorization || !!req.headers.Authorization },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (!supabaseUrl || !anonKey) {
    // #region agent log
    try {
      fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
        body: JSON.stringify({
          sessionId: "46abe0",
          runId: "option1-branches-initial",
          hypothesisId: "B2",
          location: "api/_lib/auth.ts:requireAuthedProfile",
          message: "missing supabase auth env",
          data: { hasSupabaseUrl: !!supabaseUrl, hasAnonKey: !!anonKey },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion
    return { ok: false, status: 500, error: "Server auth environment is missing." };
  }

  const supabaseForUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: authErr,
  } = await supabaseForUser.auth.getUser(token);
  if (authErr || !user) {
    // #region agent log
    try {
      fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
        body: JSON.stringify({
          sessionId: "46abe0",
          runId: "option1-branches-initial",
          hypothesisId: "B3",
          location: "api/_lib/auth.ts:requireAuthedProfile",
          message: "token rejected by supabase",
          data: { hasError: !!authErr, errorMessage: authErr?.message || null },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion
    return { ok: false, status: 401, error: "Invalid token" };
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile?.organization_id) {
    // #region agent log
    try {
      fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
        body: JSON.stringify({
          sessionId: "46abe0",
          runId: "option1-branches-initial",
          hypothesisId: "B4",
          location: "api/_lib/auth.ts:requireAuthedProfile",
          message: "profile lookup failed",
          data: { hasError: !!profileErr, errorMessage: profileErr?.message || null, userId: user.id },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion
    return { ok: false, status: 401, error: "User profile not found" };
  }

  return { ok: true, userId: user.id, organizationId: String(profile.organization_id) };
}
