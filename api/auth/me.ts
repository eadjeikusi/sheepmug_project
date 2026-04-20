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
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'vercel-prod-api-fix',hypothesisId:'D5',location:'api/auth/me.ts:handler.entry',message:'auth me endpoint invoked',data:{method:req.method,hasAuth:!!(req.headers.authorization||req.headers.Authorization)},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
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

    let profile: any = null;
    const full = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, profile_image, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (!full.error && full.data) {
      profile = full.data;
    } else if (full.error && String(full.error.message || "").toLowerCase().includes("is_super_admin")) {
      const fallback = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, profile_image, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        profile = { ...fallback.data, is_super_admin: false };
      }
    }
    // #region agent log
    const idLookupDiag = {
      hasData: !!full.data,
      errorMessage: full.error?.message || null,
      errorCode: (full.error as any)?.code || null,
      errorDetails: (full.error as any)?.details || null,
      errorHint: (full.error as any)?.hint || null,
    };
    // #endregion
    let emailLookupDiag: Record<string, unknown> | null = null;
    if (!profile && user.email) {
      const byEmail = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, profile_image, avatar_url")
        .ilike("email", user.email)
        .maybeSingle();
      // #region agent log
      emailLookupDiag = {
        hasData: !!byEmail.data,
        errorMessage: byEmail.error?.message || null,
        errorCode: (byEmail.error as any)?.code || null,
        errorDetails: (byEmail.error as any)?.details || null,
        errorHint: (byEmail.error as any)?.hint || null,
        queriedEmail: user.email,
      };
      // #endregion
      if (!byEmail.error && byEmail.data) {
        profile = byEmail.data;
      }
    }
    if (!profile) {
      return res.status(401).json({
        error: "User profile not found",
        diag: {
          authUserId: user.id,
          authUserEmail: user.email || null,
          idLookup: idLookupDiag,
          emailLookup: emailLookupDiag,
        },
      });
    }

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
        profile_image: profile.profile_image || profile.avatar_url || null,
      },
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Unexpected server error" });
  }
}
