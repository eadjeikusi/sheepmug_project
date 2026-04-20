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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const token = bearerFromHeader(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server auth environment." });
  }
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

    // Profile lookup: try by user.id first, then fall back to email.
    // is_super_admin may be missing in some environments — retry without it.
    let profile: any = null;
    const full = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (!full.error && full.data) {
      profile = full.data;
    } else if (full.error && String(full.error.message || "").toLowerCase().includes("is_super_admin")) {
      const fallback = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        profile = { ...fallback.data, is_super_admin: false };
      }
    }
    if (!profile && user.email) {
      const byEmail = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, avatar_url")
        .ilike("email", user.email)
        .maybeSingle();
      if (!byEmail.error && byEmail.data) {
        profile = byEmail.data;
      }
    }
    if (!profile) return res.status(401).json({ error: "User profile not found" });

    return res.status(200).json({
      user: {
        id: profile.id,
        email: profile.email || user.email || "",
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        organization_id: profile.organization_id || "",
        branch_id: profile.branch_id || null,
        role_id: profile.role_id || null,
        is_org_owner: profile.is_org_owner === true,
        is_super_admin: profile.is_super_admin === true,
        permissions: [],
        profile_image: profile.avatar_url || null,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unexpected server error" });
  }
}
