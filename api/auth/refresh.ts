import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  // #region agent log
  try {
    fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'login-loop-bootstrap',hypothesisId:'L6',location:'api/auth/refresh.ts:handler.entry',message:'refresh endpoint invoked',data:{method:req.method},timestamp:Date.now()})}).catch(()=>{});
  } catch {}
  // #endregion
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ error: "Missing server auth environment." });
  }
  const refreshToken = String((req.body as any)?.refresh_token || "").trim();
  if (!refreshToken) return res.status(400).json({ error: "refresh_token is required" });

  try {
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sessionData, error: refreshErr } = await supabaseAuth.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (refreshErr || !sessionData.session?.access_token || !sessionData.user?.id) {
      return res.status(401).json({ error: refreshErr?.message || "Invalid refresh token" });
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let profile: any = null;
    const full = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, profile_image, avatar_url")
      .eq("id", sessionData.user.id)
      .single();
    if (!full.error) {
      profile = full.data;
    } else if (String(full.error.message || "").toLowerCase().includes("is_super_admin")) {
      const fallback = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, profile_image, avatar_url")
        .eq("id", sessionData.user.id)
        .single();
      if (!fallback.error) profile = { ...fallback.data, is_super_admin: false };
    }
    if (!profile && sessionData.user.email) {
      const byEmail = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_super_admin, profile_image, avatar_url")
        .eq("email", sessionData.user.email)
        .maybeSingle();
      if (!byEmail.error && byEmail.data) {
        profile = byEmail.data;
        // #region agent log
        try {
          fetch('http://127.0.0.1:7406/ingest/7632e6e8-af16-4700-a4cf-377fe497ddcb',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'46abe0'},body:JSON.stringify({sessionId:'46abe0',runId:'login-loop-profile-fallback',hypothesisId:'L8',location:'api/auth/refresh.ts:profileByEmail',message:'refresh resolved profile by email fallback',data:{hasEmail:true,profileId:byEmail.data.id||null},timestamp:Date.now()})}).catch(()=>{});
        } catch {}
        // #endregion
      }
    }
    if (!profile) return res.status(401).json({ error: "User profile not found" });

    return res.status(200).json({
      token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token || refreshToken,
      user: {
        id: profile.id,
        email: profile.email || sessionData.user.email || "",
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
