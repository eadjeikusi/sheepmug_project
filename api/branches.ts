import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function bearerFromHeader(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader !== "string") return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  // #region agent log
  try {
    fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
      body: JSON.stringify({
        sessionId: "46abe0",
        runId: "option1-branches-initial",
        hypothesisId: "B5",
        location: "api/branches.ts:handler.entry",
        message: "branches endpoint called",
        data: { method: req.method, hasAuthHeader: !!req.headers.authorization || !!req.headers.Authorization },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch {}
  // #endregion

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = bearerFromHeader(req);
    if (!token) {
      // #region agent log
      try {
        fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
          body: JSON.stringify({
            sessionId: "46abe0",
            runId: "option1-branches-fix-import",
            hypothesisId: "C2",
            location: "api/branches.ts:handler.auth",
            message: "missing bearer token",
            data: { hasAuthorizationHeader: !!req.headers.authorization || !!req.headers.Authorization },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
      // #endregion
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      // #region agent log
      try {
        fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
          body: JSON.stringify({
            sessionId: "46abe0",
            runId: "option1-branches-fix-import",
            hypothesisId: "C3",
            location: "api/branches.ts:handler.env",
            message: "missing supabase env",
            data: {
              hasSupabaseUrl: !!supabaseUrl,
              hasAnonKey: !!anonKey,
              hasServiceRole: !!serviceRoleKey,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
      // #endregion
      return res.status(500).json({ error: "Server auth environment is missing." });
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
            runId: "option1-branches-fix-import",
            hypothesisId: "C4",
            location: "api/branches.ts:handler.auth",
            message: "token rejected by supabase",
            data: { hasError: !!authErr, errorMessage: authErr?.message || null },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
      // #endregion
      return res.status(401).json({ error: "Invalid token" });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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
            runId: "option1-branches-fix-import",
            hypothesisId: "C5",
            location: "api/branches.ts:handler.profile",
            message: "profile lookup failed",
            data: { hasError: !!profileErr, errorMessage: profileErr?.message || null, userId: user.id },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
      // #endregion
      return res.status(401).json({ error: "User profile not found" });
    }

    const { data: branches, error } = await supabaseAdmin
      .from("branches")
      .select("*")
      .eq("organization_id", String(profile.organization_id));

    if (error) {
      // #region agent log
      try {
        fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
          body: JSON.stringify({
            sessionId: "46abe0",
            runId: "option1-branches-initial",
            hypothesisId: "B6",
            location: "api/branches.ts:handler.query",
            message: "branches query failed",
            data: { errorMessage: error.message || null, organizationId: String(profile.organization_id) },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      } catch {}
      // #endregion
      return res.status(500).json({ error: error.message || "Failed to fetch branches" });
    }
    // #region agent log
    try {
      fetch("http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "46abe0" },
        body: JSON.stringify({
          sessionId: "46abe0",
          runId: "option1-branches-fix-import",
          hypothesisId: "C1",
          location: "api/branches.ts:handler.query",
          message: "branches query succeeded",
          data: { count: Array.isArray(branches) ? branches.length : 0, organizationId: String(profile.organization_id) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
    // #endregion
    return res.status(200).json(branches || []);
  } catch (err: unknown) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Unexpected server error" });
  }
}
