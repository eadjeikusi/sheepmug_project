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

async function resolveUserProfileId(req: VercelRequest): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const token = bearerFromHeader(req);
  if (!token) return { ok: false, status: 401, error: "Unauthorized" };
  if (!supabaseUrl || !anonKey) return { ok: false, status: 500, error: "Missing auth environment." };
  const supabaseForUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error,
  } = await supabaseForUser.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: "Invalid token" };
  return { ok: true, userId: user.id };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ error: "Missing server environment." });
  const auth = await resolveUserProfileId(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 10) || 10));
  const offset = Math.max(0, Number(req.query.offset || 0) || 0);
  const branchIdRaw = req.headers["x-branch-id"];
  const branchId = typeof branchIdRaw === "string" && branchIdRaw.trim() ? branchIdRaw.trim() : null;

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let q = admin
      .from("notifications")
      .select("id, type, category, title, message, severity, read_at, created_at, entity_type, entity_id, action_path, payload")
      .eq("recipient_profile_id", auth.userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (branchId) q = q.or(`branch_id.is.null,branch_id.eq.${branchId}`);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message || "Failed to load notifications" });
    return res.status(200).json({ notifications: data || [] });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unexpected server error" });
  }
}
