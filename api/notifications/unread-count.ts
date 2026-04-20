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
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-fix',hypothesisId:'D8',location:'api/notifications/unread-count.ts:handler.entry',message:'unread-count endpoint invoked',data:{method:req.method,hasAuth:!!(req.headers.authorization||req.headers.Authorization),hasBranchHeader:typeof req.headers['x-branch-id']==='string'},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server environment." });
  }
  const token = bearerFromHeader(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const branchIdRaw = req.headers["x-branch-id"];
  const branchId = typeof branchIdRaw === "string" && branchIdRaw.trim() ? branchIdRaw.trim() : null;

  try {
    const supabaseForUser = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: authErr,
    } = await supabaseForUser.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let q = admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", user.id)
      .is("read_at", null);
    if (branchId) q = q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
    const { count, error } = await q;
    if (error) return res.status(500).json({ error: error.message || "Failed to load unread count" });
    return res.status(200).json({ unread_count: Number(count || 0) });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unexpected server error" });
  }
}
