import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import sharp from "sharp";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  const missing = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  throw new Error(`MISSING SUPABASE CONFIGURATION: ${missing.join(", ")}. Please add these to the environment variables in the Settings menu.`);
}

// Service role client for administrative tasks (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidString(s: string): boolean {
  return typeof s === "string" && UUID_RE.test(s);
}

/** 32 hex digits → dashed UUID only if it matches RFC variant/version pattern. */
function uuidFrom32HexLoose(hex: string): string | null {
  const h = hex.replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (h.length !== 32) return null;
  const dashed = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  return isUuidString(dashed) ? dashed : null;
}

function inviteTokenColumnMissingInDb(err: unknown): boolean {
  const o = err as { message?: string; code?: string; details?: string } | null;
  const m = `${o?.message || ""} ${o?.details || ""}`.toLowerCase();
  return (
    m.includes("join_invite_token") ||
    (m.includes("column") && m.includes("does not exist")) ||
    o?.code === "42703" ||
    o?.code === "PGRST204"
  );
}

/** Return YYYY-MM-DD or null */
function normalizeDobInput(input: string): string | null {
  const t = String(input || "").trim();
  if (!t) return null;
  const ymd = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function memberDobEqualsYmd(stored: string | null | undefined, ymd: string): boolean {
  if (!stored || !ymd) return false;
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === ymd;
}

function generateJoinInviteToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Subgroup first, then parent, … up to root (max depth guard). */
async function getGroupAncestorChainIncludingSelf(startGroupId: string): Promise<string[]> {
  const chain: string[] = [];
  let current: string | null = startGroupId;
  const seen = new Set<string>();
  let depth = 0;
  while (current && !seen.has(current) && depth < 32) {
    seen.add(current);
    chain.push(current);
    depth += 1;
    const { data: row } = await supabaseAdmin
      .from("groups")
      .select("parent_group_id")
      .eq("id", current)
      .maybeSingle();
    current = (row as { parent_group_id?: string | null } | null)?.parent_group_id ?? null;
  }
  return chain;
}

/** Add member to leaf group and every ancestor (parent ministry chain). Skips duplicates. */
async function addMemberToGroupHierarchy(
  memberId: string,
  leafGroupId: string,
  organizationId: string,
  branchId: string | null
): Promise<{ addedTo: string[] }> {
  const chain = await getGroupAncestorChainIncludingSelf(leafGroupId);
  const addedTo: string[] = [];
  for (const gid of chain) {
    const { data: existing } = await supabaseAdmin
      .from("group_members")
      .select("id")
      .eq("group_id", gid)
      .eq("member_id", memberId)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabaseAdmin.from("group_members").insert([
      {
        group_id: gid,
        member_id: memberId,
        role_in_group: "member",
        organization_id: organizationId,
        branch_id: branchId,
      },
    ]);
    if (error) {
      if (error.code === "23505") continue;
      throw error;
    }
    addedTo.push(gid);
  }
  return { addedTo };
}

// Helper to get a scoped Supabase client for a specific user
const getSupabaseClient = (token?: string) => {
  if (!token) return createClient(supabaseUrl, supabaseAnonKey);
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Temporary test route to check server routing
app.get("/api/test", (req, res) => {
  res.status(200).json({ message: "Test route working!" });
});

// Helper to generate slug
// Helper to generate slug
const generateSlug = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^\w ]+/g, "")
    .replace(/ +/g, "-");
};

const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const optimizedBuffer = await sharp(req.file.buffer)
      .resize({ width: 800, height: 800, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const { data, error } = await supabaseAdmin.storage
      .from("member-images")
      .upload(`public/${fileName}`, optimizedBuffer, {
        contentType: "image/jpeg",
      });

    if (error) throw error;

    const { data: publicUrlData } = supabaseAdmin.storage
      .from("member-images")
      .getPublicUrl(`public/${fileName}`);

    res.json({ url: publicUrlData.publicUrl });
   } catch (error: any) {
     // Provide more specific error details if available
     const errorMessage = error.message || "Internal Server Error";
     res.status(500).json({ error: errorMessage, details: error.details, code: error.code });
  }
});

app.post("/api/group-requests", async (req, res) => {
  try {
    const {
      group_id,
      full_name,
      email,
      phone,
      message,
      first_name,
      last_name,
      dob,
    } = req.body;

    if (!group_id) {
      return res.status(400).json({ error: "Missing required field: group_id" });
    }

    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, organization_id, branch_id, join_link_enabled")
      .eq("id", group_id)
      .single();

    if (groupError || !group) {
      return res.status(404).json({ error: "Group not found" });
    }

    if (!group.join_link_enabled) {
      return res.status(403).json({ error: "Join link is not enabled for this group" });
    }

    const verifiedPath =
      typeof first_name === "string" &&
      typeof last_name === "string" &&
      typeof dob === "string" &&
      first_name.trim().length > 0 &&
      last_name.trim().length > 0 &&
      dob.trim().length > 0;

    if (verifiedPath) {
      const fn = String(first_name).trim();
      const ln = String(last_name).trim();
      const ymd = normalizeDobInput(dob);
      if (!ymd) {
        return res.status(400).json({ error: "Please enter a valid date of birth." });
      }

      const { data: candidates, error: memErr } = await supabaseAdmin
        .from("members")
        .select("id, first_name, last_name, dob, organization_id, is_deleted")
        .eq("organization_id", group.organization_id);

      if (memErr) {
        return res.status(500).json({ error: memErr.message || "Could not verify member" });
      }

      const rows = (candidates || []).filter((m: { is_deleted?: boolean }) => !m.is_deleted);
      const fnL = fn.toLowerCase();
      const lnL = ln.toLowerCase();
      const matched = rows.filter(
        (m: { first_name?: string; last_name?: string; dob?: string | null }) =>
          (m.first_name || "").trim().toLowerCase() === fnL &&
          (m.last_name || "").trim().toLowerCase() === lnL &&
          memberDobEqualsYmd(m.dob, ymd)
      );

      if (matched.length === 0) {
        return res.status(404).json({
          error:
            "No member matched those details. Use the same first name, last name, and date of birth as your church directory.",
          code: "VERIFY_NO_MATCH",
        });
      }

      // Duplicate rows often share name + DOB (imports, twins on same DOB, etc.). Use one record deterministically.
      matched.sort((a: { id?: string }, b: { id?: string }) =>
        String(a.id || "").localeCompare(String(b.id || ""))
      );
      const memberRow = matched[0] as {
        id: string;
        first_name: string;
        last_name: string;
      };

      const { data: alreadyIn } = await supabaseAdmin
        .from("group_members")
        .select("id")
        .eq("group_id", group.id)
        .eq("member_id", memberRow.id)
        .maybeSingle();

      if (alreadyIn) {
        return res.status(409).json({
          error: "You are already a member of this group.",
          code: "ALREADY_IN_GROUP",
        });
      }

      const { data: pendingDup } = await supabaseAdmin
        .from("group_requests")
        .select("id")
        .eq("group_id", group.id)
        .eq("member_id", memberRow.id)
        .eq("status", "pending")
        .maybeSingle();

      if (pendingDup) {
        return res.status(409).json({
          error: "A join request is already pending for you.",
          code: "PENDING_REQUEST_EXISTS",
        });
      }

      const newRequestData: Record<string, unknown> = {
        organization_id: group.organization_id,
        branch_id: group.branch_id,
        group_id: group.id,
        member_id: memberRow.id,
        first_name: fn,
        last_name: ln,
        dob: ymd,
        status: "pending",
        requested_at: new Date().toISOString(),
      };

      const { data: newRequest, error } = await supabaseAdmin
        .from("group_requests")
        .insert([newRequestData])
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message || "Failed to submit group request" });
      }

      return res.status(201).json(newRequest);
    }

    const legacyDob = normalizeDobInput(typeof dob === "string" ? dob : "");
    if (!full_name || !email || !legacyDob) {
      return res.status(400).json({
        error:
          "Missing required fields. For directory join use first name, last name, and date of birth; otherwise provide full name, email, and date of birth.",
      });
    }

    const nameRaw = String(full_name || "").trim();
    const nameParts = nameRaw.split(/\s+/).filter(Boolean);
    const legacyFirst = nameParts[0] || "";
    const legacyLast = nameParts.slice(1).join(" ") || "";

    // Matches docs/app_database strucure.txt — group_requests has first_name, last_name, dob, requested_at (no email column).
    const newRequestData: Record<string, unknown> = {
      organization_id: group.organization_id,
      branch_id: group.branch_id,
      group_id: group.id,
      first_name: legacyFirst,
      last_name: legacyLast,
      dob: legacyDob,
      status: "pending",
      requested_at: new Date().toISOString(),
    };

    const { data: newRequest, error } = await supabaseAdmin
      .from("group_requests")
      .insert([newRequestData])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message || "Failed to submit group request" });
    }

    res.status(201).json(newRequest);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to submit group join request" });
  }
});

app.post("/api/member-requests/public/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const formData = req.body || {};

    const branchId = (code.startsWith('BRANCH-') ? code.substring(7) : code).toLowerCase();
    // Registration link code maps to a branch ID (UUID).
    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .select("id, organization_id")
      .eq("id", branchId)
      .single();

    if (branchError || !branch) {
      return res.status(404).json({ error: "Invalid registration link" });
    }

    /*
    const requiredFields = [
      "first_name",
      "last_name",
      "phone",
      "emergency_contact_name",
      "emergency_contact_phone",
      "member_url",
    ];

    const missingFields = requiredFields.filter((field) => !formData[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }
    */

    const now = new Date().toISOString();
    const payload = {
      organization_id: branch.organization_id,
      branch_id: branch.id,
      status: "pending",
      form_data: { // Store the original frontend form data as is
        firstName: formData.first_name,
        lastName: formData.last_name,
        email: formData.email,
        phoneNumber: formData.phone,
        location: formData.location,
        emergencyContactName: formData.emergency_contact_name,
        emergencyContactPhone: formData.emergency_contact_phone,
        dateOfBirth: formData.dob,
        gender: formData.gender,
        maritalStatus: formData.marital_status,
        occupation: formData.occupation,
        dateJoined: formData.date_joined,
        profileImage: formData.member_url,
      },
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabaseAdmin
      .from("member_requests")
      .insert([payload])
      .select("id, status, created_at")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message || "Failed to submit member request" });
    }

    return res.status(201).json({
      message: "Member request submitted",
      request: data,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to submit member request" });
   }
 });

// Debug endpoint to test Supabase Storage configuration
app.get("/api/debug/storage", async (req, res) => {
  try {
    const { data: buckets, error: listBucketsError } = await supabaseAdmin.storage.listBuckets();
    if (listBucketsError) throw listBucketsError;

    const memberImagesBucket = buckets.find(b => b.name === "member-images");
    let bucketStatus = memberImagesBucket ? "Exists" : "Not Found";
    let bucketPublic = memberImagesBucket ? memberImagesBucket.public : "N/A";

    // Try to perform a dummy upload to test write permissions
    let testUploadStatus = "Skipped";
    if (memberImagesBucket) {
      try {
        const dummyFile = Buffer.from("test content");
        const dummyFileName = `test-upload-${Date.now()}.txt`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("member-images")
          .upload(`test/${dummyFileName}`, dummyFile, { contentType: "text/plain" });
        
        if (uploadError) {
          testUploadStatus = `Failed: ${uploadError.message}`;
        } else {
          testUploadStatus = "Success (dummy file uploaded)";
          await supabaseAdmin.storage.from("member-images").remove([`test/${dummyFileName}`]); // Clean up
        }
      } catch (uploadTestError: any) {
        testUploadStatus = `Failed to test upload: ${uploadTestError.message}`;
      }
    }

    res.json({ bucket: "member-images", status: bucketStatus, isPublic: bucketPublic, testUpload: testUploadStatus });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

 // Debug endpoint to test Supabase Admin connection and check table names
 app.get("/api/debug/supabase", async (req, res) => {
  try {
    // Check organizations table
    const { error: orgError } = await supabaseAdmin.from("organizations").select("id").limit(1);
    
    // Check profiles table
    const { error: profilesError } = await supabaseAdmin.from("profiles").select("id").limit(1);

    // Check users table
    const { error: usersError } = await supabaseAdmin.from("users").select("id").limit(1);

    // Check members table
    const { error: membersError } = await supabaseAdmin.from("members").select("id").limit(1);

    // List users
    const { data: usersList, error: usersListError } = await supabaseAdmin.auth.admin.listUsers();

    // List all tables in the database
    const { data: tables, error: tablesError } = await supabaseAdmin
      .from("information_schema.tables")
      .select("table_schema, table_name")
      .not("table_schema", "in", '("information_schema", "pg_catalog")');

    const results = { 
      status: "ok", 
      message: "Supabase Admin connection successful",
      tables: {
        organizations: orgError ? `Error: ${orgError.message}` : "Exists",
        profiles: profilesError ? `Error: ${profilesError.message}` : "Exists",
        users: usersError ? `Error: ${usersError.message}` : "Exists",
        members: membersError ? `Error: ${membersError.message}` : "Exists",
      },
      allTables: tablesError ? `Error: ${tablesError.message}` : tables,
      adminTest: {
        listUsers: usersListError ? `Error: ${usersListError.message}` : `Success (${usersList?.users.length} users found)`,
      },
      env: {
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ? "Set" : "Not Set",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "Set" : "Not Set",
      }
    };
    return res.json(results);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Auth Routes
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, organizationName, fullName } = req.body;

  try {
    // 1. Create User in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // 2. Create Organization
    let orgSlug = generateSlug(organizationName || "organization");
    orgSlug = `${orgSlug}-${Math.random().toString(36).substring(2, 7)}`;
    
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert([
        { 
          name: organizationName || "My Organization",
          slug: orgSlug,
          subscription_tier: 'free'
        }
      ])
      .select()
      .single();

    if (orgError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: "Failed to create organization", details: orgError.message });
    }

    // 3. Create Default Branch
    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .insert([
        { 
          organization_id: org.id, 
          name: "Main Branch",
          is_main_branch: true
        }
      ])
      .select()
      .single();

    if (branchError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: "Failed to create branch", details: branchError.message });
    }

    // 4. Create User Profile
    const nameParts = (fullName || "User").split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "User";

    const { data: userProfile, error: userError } = await supabaseAdmin
      .from("profiles")
      .insert([
        {
          id: userId,
          email: email,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          organization_id: org.id,
          branch_id: branch.id
        }
      ])
      .select()
      .single();

    if (userError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: "Failed to create user profile", details: userError.message });
    }

    // 5. Sign in to get session
    const supabaseAnon = getSupabaseClient();
    const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      // If sign-in fails, we still created the user, but we can't give them a session easily
      // Let's return a 201 but without a token, the client will have to log in manually
      return res.status(201).json({ 
        message: "User created successfully, but automatic sign-in failed. Please sign in manually.",
        user: { 
          id: userProfile.id, 
          email: userProfile.email, 
          first_name: userProfile.first_name,
          last_name: userProfile.last_name,
          organization_id: org.id,
          branch_id: branch.id
        } 
      });
    }

    res.status(201).json({ 
      token: signInData?.session?.access_token, 
      user: { 
        id: userProfile.id, 
        email: userProfile.email, 
        first_name: userProfile.first_name,
        last_name: userProfile.last_name,
        organization_id: org.id,
        branch_id: branch.id
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Authenticate with Supabase Auth
    // Use the anon client for standard user authentication
    const supabaseAnon = getSupabaseClient();
    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: authError.message || "Invalid credentials" });
    }

    if (!authData.session) {
      return res.status(401).json({ error: "Authentication successful but no session was created. Please check if email confirmation is required." });
    }

    const token = authData.session.access_token;
    const userId = authData.user.id;

    // 2. Fetch User details using admin client to bypass RLS if needed
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError) {
      return res.status(404).json({ error: "User profile not found", details: profileError.message });
    }

    if (!profileData) {
      return res.status(404).json({ error: "User profile not found" });
    }

    res.json({ 
      token, 
      user: { 
        id: profileData.id, 
        email: profileData.email, 
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        organization_id: profileData.organization_id,
        branch_id: profileData.branch_id
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

app.get("/api/branches", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    // Fetch user profile to get organization_id
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { data: branches, error } = await supabaseAdmin
      .from("branches")
      .select("*")
      .eq("organization_id", userProfile.organization_id);

    if (error) throw error;
    res.json(branches);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.get("/api/members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { branch_id, showDeleted, not_in_group_id } = req.query;
    
    let query = supabaseAdmin
      .from("members")
      .select("*")
      .eq("organization_id", userProfile.organization_id);

    if (not_in_group_id) {
      // Get member IDs that are already in the specified group
      const { data: existingGroupMembers, error: gmError } = await supabaseAdmin
        .from("group_members")
        .select("member_id")
        .eq("group_id", not_in_group_id as string)
        .eq("organization_id", userProfile.organization_id);

      if (gmError) throw gmError;

      const existingMemberIds = [
        ...new Set(
          (existingGroupMembers || [])
            .map((gm) => gm.member_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        ),
      ];

      if (existingMemberIds.length > 0) {
        query = query.not("id", "in", existingMemberIds);
      }
    }

    // Frontend now handles filtering by is_deleted status. Backend fetches all members.
    // if (showDeleted !== 'true') {
    //   query = query.eq('is_deleted', false);
    // }

    if (branch_id) {
      query = query.eq("branch_id", branch_id);
    }

    const { data: members, error } = await query;

    if (error) {
      return res.status(500).json({ error: "Failed to fetch members", details: error });
    }

    // Fetch member_families to get familyIds
    const { data: memberFamilies, error: mfError } = await supabaseAdmin
      .from("member_families")
      .select("member_id, family_id");
    
    if (mfError) {
      return res.status(500).json({ error: "Failed to fetch member families", details: mfError });
    }

    const { data: memberGroupRows, error: mgListError } = await supabaseAdmin
      .from("group_members")
      .select("member_id, group_id")
      .eq("organization_id", userProfile.organization_id);

    if (mgListError) {
      return res.status(500).json({ error: "Failed to fetch group memberships", details: mgListError });
    }

    // Map database columns back to frontend format
    const mappedMembers = (members || []).map(m => ({
      ...m,
      phoneNumber: m.phone_number,
      dateOfBirth: m.dob,
      dateJoined: m.date_joined,
      memberIdString: m.member_id_string,
      profileImage: m.memberimage_url,
      fullName: `${m.first_name} ${m.last_name}`,
      location: m.address,
      emergencyContactName: m.emergency_contact_name,
      emergencyContactPhone: m.emergency_contact_phone,
      status: m.status,
      familyIds: memberFamilies.filter(mf => mf.member_id === m.id).map(mf => mf.family_id),
      groupIds: (memberGroupRows || []).filter(mg => mg.member_id === m.id).map(mg => mg.group_id),
    }));

    res.json(mappedMembers);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.get("/api/member-requests", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error("Invalid token");
    }

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw new Error("User profile fetch error");
    }
    if (!userProfile) {
      throw new Error("User profile not found");
    }

    const rawStatus = req.query.status;
    const statusFilter =
      typeof rawStatus === "string"
        ? rawStatus
        : Array.isArray(rawStatus) && typeof rawStatus[0] === "string"
          ? rawStatus[0]
          : undefined;

    const rawBranchId = req.query.branch_id;
    const branchIdFilter =
      typeof rawBranchId === "string"
        ? rawBranchId.trim()
        : Array.isArray(rawBranchId) && typeof rawBranchId[0] === "string"
          ? rawBranchId[0].trim()
          : undefined;

    const runMemberRequestsQuery = (db: ReturnType<typeof createClient>) => {
      let q = db
        .from("member_requests")
        .select("*")
        .eq("organization_id", userProfile.organization_id);

      if (statusFilter) {
        q = q.eq("status", statusFilter);
      } else {
        q = q.eq("status", "pending");
      }

      if (branchIdFilter) {
        q = q.eq("branch_id", branchIdFilter);
      } else if (userProfile.branch_id) {
        q = q.eq("branch_id", userProfile.branch_id);
      }

      return q;
    };

    let { data: requests, error } = await runMemberRequestsQuery(getSupabaseClient(token));

    if (error) {
      const { data: adminData, error: adminError } = await runMemberRequestsQuery(supabaseAdmin);
      if (adminError) {
        return res.status(500).json({ error: adminError.message || "Failed to fetch member requests", details: adminError });
      }
      requests = adminData;
    } else if (!requests || requests.length === 0) {
      const { data: adminData, error: adminError } = await runMemberRequestsQuery(supabaseAdmin);
      if (adminError) {
        return res.status(500).json({ error: adminError.message || "Failed to fetch member requests", details: adminError });
      }
      if (adminData && adminData.length > 0) {
        requests = adminData;
      }
    }

    res.status(200).json(requests ?? []);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.put("/api/member-requests/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  const { form_data } = req.body ?? {};

  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("member_requests")
      .select("id, organization_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Member request not found" });
    }

    if (existing.organization_id !== userProfile.organization_id) {
      return res.status(403).json({ error: "Unauthorized to update this request" });
    }

    if (existing.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be edited" });
    }

    if (form_data === undefined || form_data === null || typeof form_data !== "object" || Array.isArray(form_data)) {
      return res.status(400).json({ error: "form_data must be a JSON object" });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("member_requests")
      .update({
        form_data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message || "Failed to update member request", details: updateError });
    }

    res.status(200).json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/member-requests/:id/approve", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;

  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const { data: mreq, error: reqError } = await supabaseAdmin
      .from("member_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (reqError || !mreq) {
      return res.status(404).json({ error: "Member request not found" });
    }

    if (mreq.organization_id !== userProfile.organization_id) {
      return res.status(403).json({ error: "Unauthorized to approve this request" });
    }

    if (mreq.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be approved" });
    }

    const fd = (mreq.form_data && typeof mreq.form_data === "object" ? mreq.form_data : {}) as Record<string, any>;
    const dbMemberData: any = {
      email: fd.email ?? null,
      phone_number: fd.phoneNumber ?? fd.phone ?? "",
      address: fd.location ?? "",
      emergency_contact_name: fd.emergencyContactName ?? "",
      emergency_contact_phone: fd.emergencyContactPhone ?? "",
      dob: fd.dateOfBirth ?? null,
      memberimage_url: fd.profileImage ?? null,
      organization_id: mreq.organization_id,
      branch_id: mreq.branch_id,
      date_joined: fd.dateJoined || new Date().toISOString().split("T")[0],
      member_id_string: "",
      status: "active",
      first_name: fd.firstName || "Unknown",
      last_name: fd.lastName || "",
      gender: fd.gender || null,
      marital_status: fd.maritalStatus || null,
      occupation: fd.occupation || null,
    };

    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .insert([dbMemberData])
      .select()
      .single();

    if (memberError) {
      return res.status(500).json({
        error: memberError.message || "Failed to create member",
        details: memberError.details,
        code: memberError.code,
      });
    }

    const { data: updatedReq, error: updErr } = await supabaseAdmin
      .from("member_requests")
      .update({
        status: "approved",
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updErr) {
      return res.status(500).json({
        error: updErr.message || "Member created but failed to update request status",
        member,
        details: updErr,
      });
    }

    res.status(200).json({ message: "Member request approved", member, request: updatedReq });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/member-requests/:id/reject", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;

  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const { data: mreq, error: fetchError } = await supabaseAdmin
      .from("member_requests")
      .select("id, organization_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !mreq) {
      return res.status(404).json({ error: "Member request not found" });
    }

    if (mreq.organization_id !== userProfile.organization_id) {
      return res.status(403).json({ error: "Unauthorized to reject this request" });
    }

    if (mreq.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be rejected" });
    }

    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from("member_requests")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json({ message: "Member request rejected", request: updatedRequest });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to reject member request" });
  }
});

app.post("/api/members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const memberData = req.body;
    

    // Map frontend fields to database columns
    const dbMemberData: any = {
      email: memberData.email,
      phone_number: memberData.phone || memberData.phoneNumber || '',
      address: memberData.address || memberData.location || '',
      emergency_contact_name: memberData.emergency_contact_name || memberData.emergencyContactName || '',
      emergency_contact_phone: memberData.emergency_contact_phone || memberData.emergencyContactPhone || '',
      dob: memberData.dob || memberData.dateOfBirth || null,
      memberimage_url: memberData.member_url || memberData.memberUrl || memberData.profileImage || null,
      organization_id: userProfile.organization_id,
      branch_id: memberData.branch_id || userProfile.branch_id,
      date_joined: memberData.date_joined || memberData.dateJoined || new Date().toISOString().split('T')[0],
      member_id_string: memberData.member_id_string || memberData.memberIdString || '',
      status: memberData.status || 'active',
      first_name: memberData.first_name || (memberData.fullName ? memberData.fullName.split(' ')[0] : 'Unknown'),
      last_name: memberData.last_name || (memberData.fullName ? memberData.fullName.split(' ').slice(1).join(' ') : ''),
      gender: memberData.gender || null,
      marital_status: memberData.marital_status || null,
      occupation: memberData.occupation || null
    };

    const { data: member, error } = await supabaseAdmin
      .from("members")
      .insert([dbMemberData])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ 
        error: error.message, 
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }
    
    res.status(201).json(member);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.put("/api/members/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;
    const memberData = req.body;

    // Map frontend fields to database columns
    const dbMemberData: any = {
      updated_at: new Date().toISOString()
    };

    // Helper to map fields
    const mapField = (dbKey: string, frontendKeys: string[]) => {
      for (const key of frontendKeys) {
        if (memberData[key] !== undefined) {
          dbMemberData[dbKey] = memberData[key];
          return;
        }
      }
    };

    mapField('email', ['email']);
    mapField('phone_number', ['phone', 'phoneNumber', 'phone_number']);
    mapField('address', ['address', 'location']);
    mapField('emergency_contact_name', ['emergency_contact_name', 'emergencyContactName']);
    mapField('emergency_contact_phone', ['emergency_contact_phone', 'emergencyContactPhone']);
    mapField('dob', ['dob', 'dateOfBirth', 'date_of_birth']);
    mapField('memberimage_url', ['member_url', 'memberUrl', 'profileImage', 'memberimage_url']);
    mapField('date_joined', ['date_joined', 'dateJoined']);
    mapField('member_id_string', ['member_id_string', 'memberIdString']);
    mapField('status', ['status']);
    mapField('gender', ['gender']);
    mapField('marital_status', ['marital_status', 'maritalStatus']);
    mapField('occupation', ['occupation']);

    if (memberData.fullName || memberData.first_name || memberData.last_name) {
      if (memberData.first_name) dbMemberData.first_name = memberData.first_name;
      if (memberData.last_name) dbMemberData.last_name = memberData.last_name;
      if (memberData.fullName) {
        if (!dbMemberData.first_name) dbMemberData.first_name = memberData.fullName.split(' ')[0];
        if (!dbMemberData.last_name) dbMemberData.last_name = memberData.fullName.split(' ').slice(1).join(' ');
      }
    }

    const { data: member, error } = await supabaseAdmin
      .from("members")
      .update(dbMemberData)
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ 
        error: error.message, 
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    // Keep group detail & "Add members" in sync with Members page: assignments use groupIds on PUT.
    if (memberData.groupIds !== undefined) {
      const rawIds = Array.isArray(memberData.groupIds) ? memberData.groupIds : [];
      const groupIds = [...new Set(rawIds.filter((gid: unknown) => typeof gid === "string" && gid.length > 0))];

      const { error: delError } = await supabaseAdmin
        .from("group_members")
        .delete()
        .eq("member_id", id)
        .eq("organization_id", userProfile.organization_id);

      if (delError) {
        return res.status(500).json({ error: delError.message });
      }

      if (groupIds.length > 0) {
        const { data: validGroups, error: vgError } = await supabaseAdmin
          .from("groups")
          .select("id")
          .eq("organization_id", userProfile.organization_id)
          .in("id", groupIds);

        if (vgError) {
          return res.status(500).json({ error: vgError.message });
        }

        const allowed = new Set((validGroups || []).map((g) => g.id));
        const branchId = member.branch_id ?? userProfile.branch_id;
        const toInsert = groupIds
          .filter((gid) => allowed.has(gid))
          .map((group_id) => ({
            group_id,
            member_id: id,
            role_in_group: "member",
            organization_id: userProfile.organization_id,
            branch_id: branchId,
          }));

        if (toInsert.length > 0) {
          const { error: insError } = await supabaseAdmin.from("group_members").insert(toInsert);
          if (insError) {
            return res.status(500).json({ error: insError.message });
          }
        }
      }
    }
    
    res.json(member);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.delete("/api/members/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    // Create a Supabase client with the service role key and the user's token
    const supabaseAuthClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const { data: { user }, error: authError } = await supabaseAuthClient.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("members")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.status(200).json({ message: "Member soft-deleted successfully" });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/members/:id/restore", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    // Create a Supabase client with the service role key and the user's token
    const supabaseAuthClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const { data: { user }, error: authError } = await supabaseAuthClient.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("members")
      .update({ is_deleted: false, deleted_at: null })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.status(200).json({ message: "Member restored successfully" });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

// Family Routes
app.get("/api/families", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { branch_id } = req.query;
    
    let query = supabaseAdmin
      .from("families")
      .select("*")
      .eq("organization_id", userProfile.organization_id);
      
    if (branch_id) {
      query = query.eq("branch_id", branch_id);
    }

    const { data: families, error } = await query;

    if (error) throw error;
    res.json(families);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/families", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { familyName, branch_id } = req.body;
    
    const { data: family, error } = await supabaseAdmin
      .from("families")
      .insert([
        { 
          family_name: familyName,
          branch_id: branch_id,
          organization_id: userProfile.organization_id
        }
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(family);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/families/:id", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.split(" ")[1];
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { id } = req.params;
    const { family_name } = req.body;
    
    const { data: family, error } = await supabaseAdmin
      .from("families")
      .update({ family_name: family_name })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    res.json(family);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown error" });
  }
});

app.delete("/api/families/:id", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.split(" ")[1];
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from("families")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Unknown error" });
  }
});

// Member Family Routes
app.post("/api/member-families", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { member_id, family_id } = req.body;
    
    const { data, error } = await supabaseAdmin
      .from("member_families")
      .upsert([{ member_id, family_id }], { onConflict: 'member_id, family_id' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/member-families", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { member_id, family_id } = req.query;
    
    const { error } = await supabaseAdmin
      .from("member_families")
      .delete()
      .eq("member_id", member_id)
      .eq("family_id", family_id);

    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/member-families", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { member_id, family_id } = req.query;
    
    const { error } = await supabaseAdmin
      .from("member_families")
      .delete()
      .eq("member_id", member_id)
      .eq("family_id", family_id);

    if (error) throw error;
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/member-families/member/:memberId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { memberId } = req.params;
    
    const { data, error } = await supabaseAdmin
      .from("member_families")
      .select("family_id, families(*)")
      .eq("member_id", memberId);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Group Routes
app.get("/api/groups", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { branch_id, parent_group_id, member_id, tree } = req.query;
    const treeAll =
      tree === "1" ||
      tree === "true" ||
      (typeof tree === "string" && tree.toLowerCase() === "yes");

    let query = supabaseAdmin
      .from("groups")
      .select("*, profiles(first_name, last_name)") // Select leader's name
      .eq("organization_id", userProfile.organization_id);
      
    if (member_id) {
      // Fetch groups the member is already in
      const { data: memberGroups, error: memberGroupsError } = await supabaseAdmin
        .from("group_members")
        .select("group_id")
        .eq("member_id", member_id as string)
        .eq("organization_id", userProfile.organization_id);

      if (memberGroupsError) throw memberGroupsError;

      const existingGroupIds = memberGroups.map(mg => mg.group_id);

      // Filter out groups the member is already in
      if (existingGroupIds.length > 0) {
        query = query.not("id", "in", existingGroupIds);
      }
    }

    if (branch_id) {
      query = query.eq("branch_id", branch_id);
    }
    if (parent_group_id !== undefined && String(parent_group_id).length > 0) {
      query = query.eq("parent_group_id", parent_group_id);
    } else if (!treeAll) {
      // Ministries list: top-level only (unless tree mode)
      query = query.is("parent_group_id", null);
    }

    const { data: groups, error } = await query;

    if (error) throw error;

    const list = groups || [];
    const groupIds = list.map((g: { id: string }) => g.id);

    if (groupIds.length === 0) {
      res.json(list);
      return;
    }

    const { data: gmRows, error: gmErr } = await supabaseAdmin
      .from("group_members")
      .select("group_id, member_id, members(memberimage_url, first_name, last_name)")
      .in("group_id", groupIds)
      .eq("organization_id", userProfile.organization_id);

    if (gmErr) throw gmErr;

    type MemberRow = {
      group_id: string;
      member_id: string | null;
      members: {
        memberimage_url?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      } | null;
    };

    const byGroup = new Map<string, MemberRow[]>();
    for (const row of (gmRows || []) as MemberRow[]) {
      const gid = row.group_id;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(row);
    }

    const enriched = list.map((g: any) => {
      const rows = byGroup.get(g.id) || [];
      const seen = new Set<string>();
      const uniqueRows: MemberRow[] = [];
      for (const r of rows) {
        const mid = r.member_id;
        if (!mid || typeof mid !== "string") continue;
        if (seen.has(mid)) continue;
        seen.add(mid);
        uniqueRows.push(r);
      }
      const count = uniqueRows.length;
      const preview = uniqueRows.slice(0, 3).map((r) => {
        const mraw = r.members;
        const m = Array.isArray(mraw) ? mraw[0] : mraw;
        const first = (m?.first_name || "").trim();
        const last = (m?.last_name || "").trim();
        const initials =
          `${first[0] || ""}${last[0] || ""}`.toUpperCase() ||
          (r.member_id ? r.member_id.slice(0, 2).toUpperCase() : "?");
        const url =
          m?.memberimage_url && String(m.memberimage_url).trim()
            ? String(m.memberimage_url).trim()
            : null;
        return {
          member_id: r.member_id || "",
          image_url: url,
          initials,
        };
      });
      return {
        ...g,
        member_count: count,
        member_preview: preview,
      };
    });

    res.json(enriched);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/groups", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { 
      name,
      description,
      group_type,
      parent_group_id,
      leader_id,
      public_website_enabled,
      join_link_enabled,
    } = req.body;

    if (!name || !group_type) {
      return res.status(400).json({ error: "Missing required fields: name and group_type" });
    }

    const newGroupData: Record<string, unknown> = {
      organization_id: userProfile.organization_id,
      branch_id: userProfile.branch_id,
      name,
      description: description || null,
      group_type,
      parent_group_id: parent_group_id || null,
      leader_id: leader_id || null,
      public_website_enabled: public_website_enabled || false,
      join_link_enabled: join_link_enabled || true,
      join_invite_token: generateJoinInviteToken(),
    };

    let { data: newGroup, error } = await supabaseAdmin
      .from("groups")
      .insert([newGroupData])
      .select()
      .single();

    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("join_invite_token")
    ) {
      delete newGroupData.join_invite_token;
      const retry = await supabaseAdmin.from("groups").insert([newGroupData]).select().single();
      newGroup = retry.data;
      error = retry.error;
    }

    if (error) {
      return res.status(500).json({ 
        error: error.message, 
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    res.status(201).json(newGroup);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.put("/api/groups/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;
    const groupData = req.body;

    const updatedGroupData: any = {
      updated_at: new Date().toISOString(),
    };

    // Map incoming fields to database columns, ignoring id and organization_id
    const fieldsToUpdate = [
      "name", "description", "group_type", "parent_group_id", "leader_id",
      "public_website_enabled", "join_link_enabled",
      "public_link_slug", "cover_image_url", "announcements_content",
      "program_outline_content", "contact_email", "contact_phone",
    ];

    for (const field of fieldsToUpdate) {
      if (groupData[field] !== undefined) {
        updatedGroupData[field] = groupData[field];
      }
    }

    if (groupData.join_link_enabled === true) {
      const { data: existing, error: tokenColErr } = await supabaseAdmin
        .from("groups")
        .select("join_invite_token")
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (
        !tokenColErr &&
        existing &&
        !(existing as { join_invite_token?: string | null }).join_invite_token
      ) {
        updatedGroupData.join_invite_token = generateJoinInviteToken();
      }
    }

    let { data: updatedGroup, error } = await supabaseAdmin
      .from("groups")
      .update(updatedGroupData)
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .select()
      .single();

    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("join_invite_token")
    ) {
      delete updatedGroupData.join_invite_token;
      const retry = await supabaseAdmin
        .from("groups")
        .update(updatedGroupData)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .select()
        .single();
      updatedGroup = retry.data;
      error = retry.error;
    }

    if (error) {
      return res.status(500).json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    res.status(200).json(updatedGroup);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.delete("/api/groups/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("groups")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: "Group soft-deleted successfully" });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/groups/:id/restore", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from("groups")
      .update({ is_deleted: false, deleted_at: null })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: "Group restored successfully" });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.get("/api/groups/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { id } = req.params;
    
    const { data: group, error } = await supabaseAdmin
      .from("groups")
      .select("*, profiles(first_name, last_name)") // Select leader's name
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    const breadcrumb: { id: string; name: string }[] = [];
    let parentId: string | null = group.parent_group_id ?? null;
    const visited = new Set<string>([group.id]);
    for (let depth = 0; depth < 24 && parentId; depth += 1) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const { data: parent, error: parentError } = await supabaseAdmin
        .from("groups")
        .select("id, name, parent_group_id")
        .eq("id", parentId)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (parentError || !parent) break;
      breadcrumb.unshift({ id: parent.id, name: parent.name || "Untitled group" });
      parentId = parent.parent_group_id ?? null;
    }

    res.status(200).json({ ...group, breadcrumb });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.get("/api/group-members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { group_id } = req.query;

    if (!group_id) {
      return res.status(400).json({ error: "Missing required query parameter: group_id" });
    }

    const { data: groupMembers, error } = await supabaseAdmin
      .from("group_members")
      .select("*, members(id, first_name, last_name, email, memberimage_url)")
      .eq("group_id", group_id as string)
      .eq("organization_id", userProfile.organization_id);

    if (error) {
      return res.status(500).json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    const rows = groupMembers || [];
    const byMember = new Map<string, (typeof rows)[number]>();
    const duplicateRowIds: string[] = [];

    for (const row of rows) {
      const mid = row.member_id;
      if (!mid || typeof mid !== "string") continue;
      if (!byMember.has(mid)) {
        byMember.set(mid, row);
        continue;
      }
      const keep = byMember.get(mid)!;
      const keepId = String(keep.id || "");
      const rowId = String(row.id || "");
      if (keepId && rowId && rowId.localeCompare(keepId) < 0) {
        duplicateRowIds.push(keepId);
        byMember.set(mid, row);
      } else if (rowId) {
        duplicateRowIds.push(rowId);
      }
    }

    if (duplicateRowIds.length > 0) {
      const { error: delDupErr }  = await supabaseAdmin
        .from("group_members")
        .delete()
        .in("id", duplicateRowIds);
      if (delDupErr) {
        return res.status(500).json({ error: delDupErr.message });
      }
    }

    res.status(200).json([...byMember.values()]);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/group-members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { group_id, member_id, role_in_group } = req.body;

    if (!group_id || !member_id || !role_in_group) {
      return res.status(400).json({ error: "Missing required fields: group_id, member_id, role_in_group" });
    }

    // Check if the member and group exist and belong to the same organization/branch
    const { data: memberExists, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id")
      .eq("id", member_id)
      .eq("organization_id", userProfile.organization_id)
      .single();

    if (memberError || !memberExists) {
      return res.status(404).json({ error: "Member not found or unauthorized" });
    }

    const { data: groupExists, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id")
      .eq("id", group_id)
      .eq("organization_id", userProfile.organization_id)
      .single();

    if (groupError || !groupExists) {
      return res.status(404).json({ error: "Group not found or unauthorized" });
    }

    const { data: alreadyIn } = await supabaseAdmin
      .from("group_members")
      .select("id")
      .eq("group_id", group_id)
      .eq("member_id", member_id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (alreadyIn) {
      return res.status(409).json({
        error: "This member is already in this group.",
        code: "ALREADY_GROUP_MEMBER",
      });
    }

    const { data: newGroupMember, error } = await supabaseAdmin
      .from("group_members")
      .insert([
        {
          group_id,
          member_id,
          role_in_group,
          organization_id: userProfile.organization_id,
          branch_id: userProfile.branch_id, // Assign to current user's branch by default
        }
      ])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "This member is already in this group.",
          code: "ALREADY_GROUP_MEMBER",
        });
      }
      return res.status(500).json({
        error: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }

    res.status(201).json(newGroupMember);
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.delete("/api/group-members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { group_id, member_id } = req.query;

    if (!group_id || !member_id) {
      return res.status(400).json({ error: "Missing required query parameters: group_id, member_id" });
    }

    // Ensure group belongs to org (same checks as GET list)
    const { data: groupRow, error: groupErr } = await supabaseAdmin
      .from("groups")
      .select("id")
      .eq("id", group_id as string)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (groupErr) {
      return res.status(500).json({ error: groupErr.message });
    }
    if (!groupRow) {
      return res.status(404).json({ error: "Group not found or unauthorized" });
    }

    const { data: memberRow, error: memberErr } = await supabaseAdmin
      .from("members")
      .select("id")
      .eq("id", member_id as string)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (memberErr) {
      return res.status(500).json({ error: memberErr.message });
    }
    if (!memberRow) {
      return res.status(404).json({ error: "Member not found or unauthorized" });
    }

    const { data: removed, error: delError } = await supabaseAdmin
      .from("group_members")
      .delete()
      .eq("group_id", group_id as string)
      .eq("member_id", member_id as string)
      .eq("organization_id", userProfile.organization_id)
      .select("id");

    if (delError) {
      return res.status(500).json({
        error: delError.message,
        details: delError.details,
        hint: delError.hint,
        code: delError.code,
      });
    }

    if (!removed || removed.length === 0) {
      return res.status(404).json({ error: "Membership not found (already removed or different organization)" });
    }

    res.status(200).json({ ok: true, id: removed[0].id });
  } catch (error: any) {
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

// Group Requests Routes
app.get("/api/group-requests", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { status, group_id, branch_id } = req.query;

    let query = supabaseAdmin
      .from("group_requests")
      .select("*, groups(name)") // Also fetch group name
      .eq("organization_id", userProfile.organization_id);

    if (status) {
      query = query.eq("status", status);
    }
    if (group_id) {
      query = query.eq("group_id", group_id);
    }
    if (branch_id) {
      query = query.eq("branch_id", branch_id);
    } else if (!group_id) {
      // Unscoped list: branch staff see their branch; also show org-level rows (group.branch_id null → request.branch_id null).
      const bid = userProfile.branch_id;
      if (bid != null && String(bid).length > 0) {
        query = query.or(`branch_id.eq.${bid},branch_id.is.null`);
      }
    }
    // When group_id is set (ministry detail), do not filter branch_id — stored branch_id comes from the group
    // and may be null while the viewer's profile has a branch, which would hide valid requests.

    const { data: requests, error } = await query;

    if (error) throw error;
    res.json(requests);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch group requests" });
  }
});

app.post("/api/group-requests/:id/approve", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { id } = req.params;

    // 1. Fetch the group request
    const { data: request, error: fetchError } = await supabaseAdmin
      .from("group_requests")
      .select("*, groups(organization_id, branch_id)") // Select organization_id from the joined groups table
      .eq("id", id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Group request not found" });
    }

    // Ensure the user has permission for this organization and branch
    const userProfileResponse = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id, id")
      .eq("id", user.id)
      .single();

    if (userProfileResponse.error || !userProfileResponse.data) {
      throw new Error("User profile not found or unauthorized");
    }

    if (request.organization_id !== userProfileResponse.data.organization_id || request.branch_id !== userProfileResponse.data.branch_id) {
      return res.status(403).json({ error: "Unauthorized to approve this request" });
    }

    const reqAny = request as Record<string, unknown>;
    const linkedMemberId = typeof reqAny.member_id === "string" && reqAny.member_id.length > 0 ? reqAny.member_id : null;

    const markApproved = async () => {
      const { data: updatedRequest, error: updateError } = await supabaseAdmin
        .from("group_requests")
        .update({
          status: "approved",
          reviewer_id: user.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (updateError) throw updateError;
      return updatedRequest;
    };

    // Directory-verified request: member already exists — add to requested group + ancestor ministries
    if (linkedMemberId) {
      const leafGroupId = request.group_id as string;
      const { data: alreadyInLeaf } = await supabaseAdmin
        .from("group_members")
        .select("id")
        .eq("group_id", leafGroupId)
        .eq("member_id", linkedMemberId)
        .maybeSingle();

      if (alreadyInLeaf) {
        const updatedRequest = await markApproved();
        return res.status(200).json({
          message: "Member was already in this group; request closed as approved.",
          member: { id: linkedMemberId },
          request: updatedRequest,
        });
      }

      try {
        const { addedTo } = await addMemberToGroupHierarchy(
          linkedMemberId,
          leafGroupId,
          request.organization_id as string,
          (request.branch_id as string | null) ?? null
        );
        const updatedRequest = await markApproved();
        const { data: memberRow } = await supabaseAdmin.from("members").select("*").eq("id", linkedMemberId).single();
        return res.status(200).json({
          message:
            addedTo.length > 0
              ? `Join approved. Added to ${addedTo.length} group(s) (this group and parent levels where needed).`
              : "Join request approved.",
          member: memberRow || { id: linkedMemberId },
          request: updatedRequest,
          added_to_group_ids: addedTo,
        });
      } catch (addErr: any) {
        return res.status(500).json({ error: addErr.message || "Failed to add member to group hierarchy" });
      }
    }

    // Legacy guest request: create a new member record
    const reqRow = request as Record<string, unknown>;
    const fullName = typeof request.full_name === "string" ? request.full_name : "";
    const firstFromRow =
      typeof reqRow.first_name === "string" && reqRow.first_name.trim() ? String(reqRow.first_name).trim() : "";
    const lastFromRow =
      typeof reqRow.last_name === "string" && reqRow.last_name.trim() ? String(reqRow.last_name).trim() : "";
    const dbMemberData = {
      first_name: firstFromRow || fullName.split(" ")[0] || "Unknown",
      last_name: lastFromRow || fullName.split(" ").slice(1).join(" ") || "",
      email: typeof reqRow.email === "string" ? reqRow.email : "",
      phone_number: typeof reqRow.phone === "string" ? reqRow.phone : "",
      organization_id: request.organization_id,
      branch_id: request.branch_id,
      status: "active",
    };

    const { data: newMember, error: memberError } = await supabaseAdmin
      .from("members")
      .insert([dbMemberData])
      .select()
      .single();

    if (memberError) {
      return res.status(500).json({ error: memberError.message || "Failed to create new member" });
    }

    try {
      const { addedTo } = await addMemberToGroupHierarchy(
        newMember.id,
        request.group_id as string,
        request.organization_id as string,
        (request.branch_id as string | null) ?? null
      );
      const updatedRequest = await markApproved();
      res.status(200).json({
        message:
          addedTo.length > 0
            ? `Group join approved. Member added to ${addedTo.length} group(s) (requested group and parent levels).`
            : "Group join request approved; member was already in the relevant groups.",
        member: newMember,
        request: updatedRequest,
        added_to_group_ids: addedTo,
      });
    } catch (addErr: any) {
      return res.status(500).json({ error: addErr.message || "Failed to add member to group hierarchy" });
    }

  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to approve group request" });
  }
});

async function finalizeGroupRequestStatus(
  id: string,
  userId: string,
  status: "rejected" | "ignored"
): Promise<{ ok: true; request: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const { data: updatedRequest, error: updateError } = await supabaseAdmin
    .from("group_requests")
    .update({
      status,
      reviewer_id: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message || "Failed to update request" };
  }
  return { ok: true, request: updatedRequest as Record<string, unknown> };
}

app.post("/api/group-requests/:id/reject", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { id } = req.params;

    const { data: request, error: fetchError } = await supabaseAdmin
      .from("group_requests")
      .select("organization_id, branch_id")
      .eq("id", id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Group request not found" });
    }

    const userProfileResponse = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id, id")
      .eq("id", user.id)
      .single();

    if (userProfileResponse.error || !userProfileResponse.data) {
      throw new Error("User profile not found or unauthorized");
    }

    if (
      request.organization_id !== userProfileResponse.data.organization_id ||
      request.branch_id !== userProfileResponse.data.branch_id
    ) {
      return res.status(403).json({ error: "Unauthorized to reject this request" });
    }

    const result = await finalizeGroupRequestStatus(id, user.id, "rejected");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(200).json({ message: "Group join request rejected", request: result.request });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to reject member request" });
  }
});

app.post("/api/group-requests/:id/ignore", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { id } = req.params;

    const { data: request, error: fetchError } = await supabaseAdmin
      .from("group_requests")
      .select("organization_id, branch_id")
      .eq("id", id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Group request not found" });
    }

    const userProfileResponse = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id, id")
      .eq("id", user.id)
      .single();

    if (userProfileResponse.error || !userProfileResponse.data) {
      throw new Error("User profile not found or unauthorized");
    }

    if (
      request.organization_id !== userProfileResponse.data.organization_id ||
      request.branch_id !== userProfileResponse.data.branch_id
    ) {
      return res.status(403).json({ error: "Unauthorized to ignore this request" });
    }

    const result = await finalizeGroupRequestStatus(id, user.id, "ignored");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(200).json({ message: "Join request ignored", request: result.request });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to ignore join request" });
  }
});

// Events (org calendar — matches public.events + optional groups FK)
const EVENTS_SELECT =
  "id, organization_id, branch_id, group_id, title, start_time, end_time, event_type, location_type, location_details, notes, cover_image_url, program_outline, created_at, updated_at, groups(name)";

function slugifyLabel(text: string): string {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** PostgREST / Supabase when `event_outline.event_type_id` is missing or API schema cache is stale */
function isPostgrestMissingEventOutlineEventTypeId(err: { message?: string; code?: string } | null | undefined): boolean {
  const m = String(err?.message || "").toLowerCase();
  const code = String((err as { code?: string })?.code || "");
  if (code === "pgrst204" && m.includes("event_type_id")) return true;
  return m.includes("event_type_id") && (m.includes("schema cache") || m.includes("could not find"));
}

const EVENT_OUTLINE_EVENT_TYPE_ID_HINT =
  "Run migrations/event_outline_event_type_id.sql in the Supabase SQL Editor, then open Project Settings → API → Reload schema.";

function parseProgramOutlineBody(body: Record<string, unknown>): Record<string, unknown> | null | "invalid" {
  const raw = body.program_outline;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      const o = JSON.parse(t) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
      return "invalid";
    } catch {
      return "invalid";
    }
  }
  return "invalid";
}

async function assertEventTypeInOrg(eventTypeId: string, organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("event_types")
    .select("id")
    .eq("id", eventTypeId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
}

// Custom event labels (event_types)
app.get("/api/event-types", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const { data: rows, error } = await supabaseAdmin
      .from("event_types")
      .select("*")
      .eq("organization_id", userProfile.organization_id)
      .order("name", { ascending: true });
    if (error) throw error;
    res.json(rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch event types" });
  }
});

app.post("/api/event-types", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    let slug = typeof body.slug === "string" ? body.slug.trim() : "";
    slug = slug ? slugifyLabel(slug) : slugifyLabel(name);
    if (!slug) slug = `type-${Date.now().toString(36)}`;

    const description = typeof body.description === "string" ? body.description.trim() || null : null;
    const color = typeof body.color === "string" ? body.color.trim() || null : null;
    let branch_id: string | null = null;
    if (typeof body.branch_id === "string" && isUuidString(body.branch_id.trim())) {
      branch_id = body.branch_id.trim();
    }

    const row = {
      organization_id: userProfile.organization_id,
      branch_id,
      name,
      slug,
      description,
      color,
      sort_order: 0,
      is_active: body.is_active === false ? false : true,
    };

    let { data: created, error } = await supabaseAdmin.from("event_types").insert([row]).select("*").single();
    if (error?.code === "23505") {
      const slug2 = `${slug}-${Date.now().toString(36)}`;
      const retry = await supabaseAdmin
        .from("event_types")
        .insert([{ ...row, slug: slug2 }])
        .select("*")
        .single();
      created = retry.data;
      error = retry.error;
    }
    if (error) {
      return res.status(500).json({ error: error.message || "Failed to create event type" });
    }
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create event type" });
  }
});

app.patch("/api/event-types/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const body = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.slug === "string") patch.slug = slugifyLabel(body.slug.trim()) || null;
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (typeof body.color === "string") patch.color = body.color.trim() || null;
    if (body.is_active === true || body.is_active === false) patch.is_active = body.is_active;
    if (typeof body.branch_id === "string") {
      patch.branch_id = body.branch_id.trim() === "" ? null : body.branch_id.trim();
    }
    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin
      .from("event_types")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .select("*")
      .single();
    if (error) throw error;
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update event type" });
  }
});

app.delete("/api/event-types/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const { error } = await supabaseAdmin
      .from("event_types")
      .delete()
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete event type" });
  }
});

const OUTLINE_TEMPLATE_SELECT = "*, event_types(name, slug, color)";

app.get("/api/event-outline-templates", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const eventTypeId = typeof req.query.event_type_id === "string" ? req.query.event_type_id.trim() : "";
    let q = supabaseAdmin
      .from("event_outline")
      .select(OUTLINE_TEMPLATE_SELECT)
      .eq("organization_id", userProfile.organization_id)
      .order("name", { ascending: true });
    if (eventTypeId && isUuidString(eventTypeId)) {
      q = q.eq("event_type_id", eventTypeId);
    }
    const { data: rows, error } = await q;
    if (error) {
      const errMsg = String(error.message || "").toLowerCase();
      if (
        errMsg.includes("event_type_id") ||
        errMsg.includes("relationship") ||
        errMsg.includes("schema cache") ||
        (error as { code?: string }).code === "42703"
      ) {
        let q2 = supabaseAdmin
          .from("event_outline")
          .select("*")
          .eq("organization_id", userProfile.organization_id)
          .order("name", { ascending: true });
        if (eventTypeId && isUuidString(eventTypeId)) {
          q2 = q2.eq("event_type_id", eventTypeId);
        }
        let r2 = await q2;
        if (r2.error && isPostgrestMissingEventOutlineEventTypeId(r2.error)) {
          r2 = await supabaseAdmin
            .from("event_outline")
            .select("*")
            .eq("organization_id", userProfile.organization_id)
            .order("name", { ascending: true });
        }
        if (r2.error) throw r2.error;
        return res.json(r2.data || []);
      }
      throw error;
    }
    res.json(rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch templates" });
  }
});

app.post("/api/event-outline-templates", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const eventTypeId = typeof body.event_type_id === "string" ? body.event_type_id.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!isUuidString(eventTypeId)) return res.status(400).json({ error: "event_type_id is required" });
    if (!(await assertEventTypeInOrg(eventTypeId, userProfile.organization_id))) {
      return res.status(400).json({ error: "Invalid event type" });
    }

    let program_outline: Record<string, unknown> = {};
    const po = parseProgramOutlineBody(body as Record<string, unknown>);
    if (po === "invalid") return res.status(400).json({ error: "Invalid program_outline JSON" });
    if (po) program_outline = po;

    let branch_id: string | null = userProfile.branch_id ?? null;
    if (typeof body.branch_id === "string" && isUuidString(body.branch_id.trim())) {
      branch_id = body.branch_id.trim();
    }
    const description = typeof body.description === "string" ? body.description.trim() || null : null;

    const insertRow: Record<string, unknown> = {
      organization_id: userProfile.organization_id,
      branch_id,
      event_type_id: eventTypeId,
      name,
      description,
      program_outline,
      sort_order: 0,
      is_active: body.is_active === false ? false : true,
    };

    const insertTpl = (row: Record<string, unknown>) =>
      supabaseAdmin.from("event_outline").insert([row]).select("*").single();

    let ins = await insertTpl(insertRow);
    if (ins.error && isPostgrestMissingEventOutlineEventTypeId(ins.error)) {
      const { event_type_id: _omit, ...rowNoEt } = insertRow;
      ins = await insertTpl(rowNoEt);
    }
    if (ins.error) {
      const msg = isPostgrestMissingEventOutlineEventTypeId(ins.error)
        ? `Cannot save template: ${ins.error.message}. ${EVENT_OUTLINE_EVENT_TYPE_ID_HINT}`
        : ins.error.message || "Failed to create template";
      return res.status(500).json({ error: msg });
    }
    res.status(201).json(ins.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create template" });
  }
});

app.patch("/api/event-outline-templates/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (body.is_active === true || body.is_active === false) patch.is_active = body.is_active;
    if (typeof body.event_type_id === "string" && isUuidString(body.event_type_id.trim())) {
      const et = body.event_type_id.trim();
      if (!(await assertEventTypeInOrg(et, userProfile.organization_id))) {
        return res.status(400).json({ error: "Invalid event type" });
      }
      patch.event_type_id = et;
    }
    if (body.program_outline !== undefined) {
      const po = parseProgramOutlineBody(body as Record<string, unknown>);
      if (po === "invalid") return res.status(400).json({ error: "Invalid program_outline JSON" });
      if (po) patch.program_outline = po;
    }

    const doPatch = (p: Record<string, unknown>) =>
      supabaseAdmin
        .from("event_outline")
        .update(p)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .select("*")
        .single();

    let upd = await doPatch(patch);
    if (upd.error && patch.event_type_id !== undefined && isPostgrestMissingEventOutlineEventTypeId(upd.error)) {
      const { event_type_id: _omit, ...patchNoEt } = patch;
      upd = await doPatch(patchNoEt);
    }
    if (upd.error) {
      const msg = isPostgrestMissingEventOutlineEventTypeId(upd.error)
        ? `${upd.error.message} ${EVENT_OUTLINE_EVENT_TYPE_ID_HINT}`
        : upd.error.message || "Failed to update template";
      return res.status(500).json({ error: msg });
    }
    if (!upd.data) return res.status(404).json({ error: "Not found" });
    res.json(upd.data);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update template" });
  }
});

app.delete("/api/event-outline-templates/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const { error } = await supabaseAdmin
      .from("event_outline")
      .delete()
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete template" });
  }
});

app.get("/api/events", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    let query = supabaseAdmin
      .from("events")
      .select(EVENTS_SELECT)
      .eq("organization_id", userProfile.organization_id)
      .order("start_time", { ascending: false });

    const { data: rows, error } = await query;
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (msg.includes("cover_image_url") || msg.includes("program_outline") || code === "42703") {
        const retry = await supabaseAdmin
          .from("events")
          .select(
            "id, organization_id, branch_id, group_id, title, start_time, end_time, event_type, location_type, location_details, notes, created_at, updated_at, groups(name)"
          )
          .eq("organization_id", userProfile.organization_id)
          .order("start_time", { ascending: false });
        if (retry.error) throw retry.error;
        return res.json(retry.data || []);
      }
      throw error;
    }
    res.json(rows || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch events" });
  }
});

app.post("/api/events", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const body = req.body || {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const startRaw = typeof body.start_time === "string" ? body.start_time.trim() : "";
    if (!title || !startRaw) {
      return res.status(400).json({ error: "title and start_time are required" });
    }

    const startTime = new Date(startRaw);
    if (Number.isNaN(startTime.getTime())) {
      return res.status(400).json({ error: "Invalid start_time" });
    }

    let endTime: Date | null = null;
    if (typeof body.end_time === "string" && body.end_time.trim()) {
      endTime = new Date(body.end_time.trim());
      if (Number.isNaN(endTime.getTime())) {
        return res.status(400).json({ error: "Invalid end_time" });
      }
    }

    const groupScope = body.group_scope === "group" ? "group" : "organization";
    let groupId: string | null = null;
    let branchId: string | null = userProfile.branch_id ?? null;

    if (groupScope === "group") {
      const gid = typeof body.group_id === "string" ? body.group_id.trim() : "";
      if (!isUuidString(gid)) {
        return res.status(400).json({ error: "group_id is required for ministry-specific events" });
      }
      const { data: g, error: gErr } = await supabaseAdmin
        .from("groups")
        .select("id, organization_id, branch_id")
        .eq("id", gid)
        .single();
      if (gErr || !g) {
        return res.status(404).json({ error: "Group not found" });
      }
      if ((g as { organization_id: string }).organization_id !== userProfile.organization_id) {
        return res.status(403).json({ error: "Group is not in your organization" });
      }
      groupId = gid;
      branchId = (g as { branch_id: string | null }).branch_id ?? branchId;
    }

    const row: Record<string, unknown> = {
      organization_id: userProfile.organization_id,
      branch_id: branchId,
      group_id: groupId,
      title,
      start_time: startTime.toISOString(),
      end_time: endTime ? endTime.toISOString() : null,
      event_type: typeof body.event_type === "string" ? body.event_type.trim() || null : null,
      location_type: typeof body.location_type === "string" ? body.location_type.trim() || null : null,
      location_details: typeof body.location_details === "string" ? body.location_details.trim() || null : null,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    };

    const poParsed = parseProgramOutlineBody(body as Record<string, unknown>);
    if (poParsed === "invalid") {
      return res.status(400).json({ error: "Invalid program_outline JSON" });
    }
    if (poParsed) row.program_outline = poParsed;

    const cover = typeof body.cover_image_url === "string" ? body.cover_image_url.trim() : "";
    if (cover) row.cover_image_url = cover;

    const insertEventRow = async (omitCover: boolean, omitProgramOutline: boolean) => {
      const payload: Record<string, unknown> = { ...row };
      if (omitCover) delete payload.cover_image_url;
      if (omitProgramOutline) delete payload.program_outline;
      return supabaseAdmin.from("events").insert([payload]).select(EVENTS_SELECT).single();
    };

    let omitCover = false;
    let omitProgramOutline = false;
    let created: Record<string, unknown> | null = null;
    let lastError: { message?: string; code?: string } | null = null;
    for (let i = 0; i < 4; i++) {
      const r = await insertEventRow(omitCover, omitProgramOutline);
      if (!r.error && r.data) {
        created = r.data as Record<string, unknown>;
        lastError = null;
        break;
      }
      lastError = r.error;
      const msg = String(r.error?.message || "").toLowerCase();
      if (msg.includes("cover_image_url") || r.error?.code === "42703") {
        omitCover = true;
        continue;
      }
      if (msg.includes("program_outline")) {
        omitProgramOutline = true;
        continue;
      }
      break;
    }

    if (lastError || !created) {
      return res.status(500).json({ error: lastError?.message || "Failed to create event" });
    }

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create event" });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) {
    return res.status(400).json({ error: "Invalid event id" });
  }

  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const { error } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id);

    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete event" });
  }
});

// Public Group Routes — join link by group UUID or per-group invite token (no login)
app.get("/api/public/join-group/:groupIdOrToken", async (req, res) => {
  try {
    const raw = String(req.params.groupIdOrToken || "").trim();
    let param = raw;
    try {
      param = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      param = raw;
    }
    if (!param) {
      return res.status(400).json({ error: "Invalid group link" });
    }

    // Only columns required for join verification UI (avoid optional columns missing in some DBs).
    const selectCols = "id, name, join_link_enabled";

    let group: Record<string, unknown> | null = null;

    if (isUuidString(param)) {
      const { data, error } = await supabaseAdmin
        .from("groups")
        .select(selectCols)
        .eq("id", param)
        .maybeSingle();
      if (error) {
        return res.status(500).json({ error: error.message || "Database error" });
      }
      group = data as Record<string, unknown> | null;
    } else {
      const hex = param.replace(/[^a-f0-9]/gi, "").toLowerCase();
      if (hex.length < 16) {
        return res.status(400).json({ error: "Invalid group link" });
      }

      if (hex.length === 32) {
        const { data: byToken, error: tokenErr } = await supabaseAdmin
          .from("groups")
          .select(selectCols)
          .eq("join_invite_token", hex)
          .maybeSingle();

        if (tokenErr && !inviteTokenColumnMissingInDb(tokenErr)) {
          return res.status(500).json({ error: tokenErr.message || "Database error" });
        }
        if (byToken) {
          group = byToken as Record<string, unknown>;
        }
        if (!group && (!tokenErr || inviteTokenColumnMissingInDb(tokenErr))) {
          const dashed = uuidFrom32HexLoose(hex);
          if (dashed) {
            const { data: byId, error: idErr } = await supabaseAdmin
              .from("groups")
              .select(selectCols)
              .eq("id", dashed)
              .maybeSingle();
            if (idErr) {
              return res.status(500).json({ error: idErr.message || "Database error" });
            }
            group = byId as Record<string, unknown> | null;
          }
        }
      } else {
        const { data: byToken, error: tokenErr } = await supabaseAdmin
          .from("groups")
          .select(selectCols)
          .eq("join_invite_token", hex)
          .maybeSingle();
        if (tokenErr && !inviteTokenColumnMissingInDb(tokenErr)) {
          return res.status(500).json({ error: tokenErr.message || "Database error" });
        }
        group = byToken as Record<string, unknown> | null;
      }
    }

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    if (!group.join_link_enabled) {
      return res.status(403).json({ error: "Join link is not enabled for this group" });
    }

    const g = group as Record<string, unknown>;
    res.status(200).json({
      id: g.id,
      name: g.name,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load group" });
  }
});

app.get("/api/public/groups/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const { data: group, error } = await supabaseAdmin
      .from("groups")
      .select("*, profiles(first_name, last_name)") // Select leader's name
      .eq("public_link_slug", slug)
      .eq("public_website_enabled", true)
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!group) {
      return res.status(404).json({ error: "Public group not found or not enabled" });
    }

    const g = group as { join_invite_token?: string | null; join_link_enabled?: boolean };
    const inviteToken =
      g.join_link_enabled && g.join_invite_token ? g.join_invite_token : null;

    // Return only public-facing information
    res.status(200).json({
      id: group.id,
      name: group.name,
      description: group.description,
      group_type: group.group_type,
      cover_image_url: group.cover_image_url,
      announcements_content: group.announcements_content,
      program_outline_content: group.program_outline_content,
      contact_email: group.contact_email,
      contact_phone: group.contact_phone,
      public_link_slug: group.public_link_slug,
      leader_name: group.profiles ? `${group.profiles.first_name} ${group.profiles.last_name}` : null,
      join_link_enabled: group.join_link_enabled,
      join_invite_token: inviteToken,
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch public group" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0");
}

startServer();
