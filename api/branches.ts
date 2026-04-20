import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuthedProfile } from "./_lib/auth";
import { supabaseAdmin } from "./_lib/supabaseAdmin";

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
    const auth = await requireAuthedProfile(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: branches, error } = await supabaseAdmin
      .from("branches")
      .select("*")
      .eq("organization_id", auth.organizationId);

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
            data: { errorMessage: error.message || null, organizationId: auth.organizationId },
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
          runId: "option1-branches-initial",
          hypothesisId: "B7",
          location: "api/branches.ts:handler.query",
          message: "branches query succeeded",
          data: { count: Array.isArray(branches) ? branches.length : 0, organizationId: auth.organizationId },
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
