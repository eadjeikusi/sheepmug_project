import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import http from "node:http";
import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import * as jwt from "jsonwebtoken";
import { runCustomFieldsMigrationFromEnv } from "./migrations/runCustomFieldsMigration.js";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import {
  ALL_PERMISSION_IDS,
  expandStoredPermissionIds,
  resolveImpliedPermissions,
  validatePermissionIds,
} from "./src/permissions/catalog";
import {
  normalizePhoneToE164,
  sanitizeCountryIso,
} from "./src/lib/phoneE164.js";
import { assertOrgLimit, fetchOrgLimitRow, getOrgUsage } from "./src/server/orgLimits.ts";
import {
  ensureAllMembersGroupForBranch,
  ensureMemberInAllMembersGroup,
  eventAudienceVisibleUnderScope,
  getAllMembersGroupIdForBranch,
  groupIdVisibleUnderScope,
  memberIdsVisibleUnderScope,
  resolveMinistryScope,
  type MinistryScopeResult,
} from "./src/server/ministryScope.ts";
import { compressImageBufferForPublicUpload } from "./src/server/compressImageBuffer.ts";
import {
  SUBSCRIPTION_PLANS,
  normalizeSubscriptionTier,
  effectiveLimit,
  type OrgLimitRow,
} from "./src/app/config/subscriptionPlans.ts";
import { formatLongWeekdayDateTime } from "./src/app/utils/dateDisplayFormat.ts";
import type { Request, Response } from "express";
import { Expo } from "expo-server-sdk";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MEMBER_CARE_NEW_MEMBER_GRACE_DAYS = Math.max(
  0,
  Number(process.env.MEMBER_CARE_NEW_MEMBER_GRACE_DAYS || "30") || 30,
);
const IMPORTANT_DATES_DEFAULT_TIMEZONE = "Africa/Accra";
const IMPORTANT_DATES_DEFAULT_REMINDER_TIME = "08:00:00";

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
const expoPush = new Expo();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidString(s: string): boolean {
  return typeof s === "string" && UUID_RE.test(s);
}

/** Strip ILIKE wildcards; min length 2 after strip. */
function searchQueryToIlikePattern(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .slice(0, 64)
    .replace(/[%_\\]/g, "");
  if (s.length < 2) return null;
  return s;
}

function firstNonEmptyString(...vals: unknown[]): string {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function normalizeBinaryGender(raw: unknown, out: "title" | "lower" = "title"): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "male") return out === "lower" ? "male" : "Male";
  if (v === "female") return out === "lower" ? "female" : "Female";
  return null;
}

async function getOrgDefaultPhoneCountryIso(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("default_phone_country_iso")
    .eq("id", orgId)
    .maybeSingle();
  const d = (data as { default_phone_country_iso?: string | null } | null)?.default_phone_country_iso;
  if (typeof d === "string" && /^[A-Z]{2}$/i.test(d.trim())) return d.trim().toUpperCase();
  const env = process.env.DEFAULT_PHONE_COUNTRY;
  if (typeof env === "string" && /^[A-Z]{2}$/i.test(env.trim())) return env.trim().toUpperCase();
  return "US";
}

/** Normalize primary + emergency phones to E.164; empty strings become null. */
function normalizeMemberPhonesForDb(
  input: {
    phone: string;
    phone_country_iso: string | null | undefined;
    emergency_contact_phone: string;
    emergency_contact_phone_country_iso: string | null | undefined;
  },
  defaultCountry: string,
): {
  phone_number: string | null;
  phone_country_iso: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_phone_country_iso: string | null;
} {
  let primary: ReturnType<typeof normalizePhoneToE164>;
  let emergency: ReturnType<typeof normalizePhoneToE164>;
  try {
    primary = normalizePhoneToE164(input.phone, input.phone_country_iso, defaultCountry);
  } catch (e: unknown) {
    const base = e instanceof Error ? e.message : "Invalid phone number";
    const msg = base.startsWith("Invalid phone") ? `Primary phone: ${base}` : base;
    throw Object.assign(new Error(msg), { statusCode: 400 });
  }
  try {
    emergency = normalizePhoneToE164(
      input.emergency_contact_phone,
      input.emergency_contact_phone_country_iso,
      defaultCountry,
    );
  } catch (e: unknown) {
    const base = e instanceof Error ? e.message : "Invalid phone number";
    const msg = base.startsWith("Invalid phone") ? `Emergency contact phone: ${base}` : base;
    throw Object.assign(new Error(msg), { statusCode: 400 });
  }
  return {
    phone_number: primary.e164,
    phone_country_iso: primary.countryIso,
    emergency_contact_phone: emergency.e164,
    emergency_contact_phone_country_iso: emergency.countryIso,
  };
}

function normalizeSinglePhoneField(
  raw: string,
  countryIso: string | null | undefined,
  defaultCountry: string,
): { e164: string | null; country_iso: string | null } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return {
      e164: null,
      country_iso: countryIso ? sanitizeCountryIso(countryIso, defaultCountry) : null,
    };
  }
  try {
    const n = normalizePhoneToE164(trimmed, countryIso, defaultCountry);
    return {
      e164: n.e164,
      country_iso: n.countryIso,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Invalid phone number";
    throw Object.assign(new Error(msg), { statusCode: 400 });
  }
}

/** Default: auto-confirm email on signup / staff create (good for testing). Set AUTH_EMAIL_AUTO_CONFIRM=false to require Supabase email confirmation. */
function shouldAutoConfirmAuthEmail(): boolean {
  return process.env.AUTH_EMAIL_AUTO_CONFIRM !== "false";
}

/** Temporary path while Hubtel billing approval is pending. Set false in production when payment is live. */
function isDemoPaymentBypassEnabled(): boolean {
  return process.env.ENABLE_DEMO_PAYMENT_BYPASS !== "false";
}

const PASSWORD_RESET_EXPIRES_MINUTES = 15;

type PasswordResetTokenPayload = {
  sub: string;
  email: string;
  purpose: "password_reset";
};

function passwordResetSecret(): string {
  return String(process.env.PASSWORD_RESET_SECRET || "").trim();
}

function appBaseUrl(): string {
  const explicit = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;
  return `http://localhost:${PORT}`;
}

async function sendBrevoEmail(params: {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}): Promise<void> {
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured.");
  }
  const fromEmail = String(process.env.BREVO_FROM_EMAIL || "noreply@sheepmug.com").trim();
  const fromName = String(process.env.BREVO_FROM_NAME || "SheepMug").trim();

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: params.toEmail, name: params.toName || params.toEmail }],
      subject: params.subject,
      htmlContent: params.htmlContent,
      textContent: params.textContent || undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brevo send failed (${response.status}): ${body || response.statusText}`);
  }
}

type OrgProfile = { organization_id: string; branch_id?: string | null };

function httpError(statusCode: number, message: string): Error {
  const e = new Error(message);
  (e as { statusCode?: number }).statusCode = statusCode;
  return e;
}

/** Branch selected in the app header (`X-Branch-Id`). Query `branch_id` is not accepted for scope (avoids spoofing). */
function readViewerBranchIdFromRequest(req: { headers: any; query?: any }): string | null {
  const rawHeader = req.headers?.["x-branch-id"];
  const fromHeader =
    typeof rawHeader === "string"
      ? rawHeader.trim()
      : Array.isArray(rawHeader) && rawHeader[0]
        ? String(rawHeader[0]).trim()
        : "";
  if (fromHeader && isUuidString(fromHeader)) return fromHeader;
  return null;
}

/**
 * Validates header branch exists in the user's org and matches their assigned profile branch when set.
 * Org owners may switch branches (pass `userId` so we can verify `is_org_owner`).
 */
async function assertViewerBranchScope(
  req: { headers: any; query?: any },
  userProfile: OrgProfile,
  userId?: string | null,
): Promise<string> {
  let branchId = readViewerBranchIdFromRequest(req);
  if (!branchId) {
    const fallback =
      userProfile.branch_id != null && String(userProfile.branch_id).trim().length > 0
        ? String(userProfile.branch_id).trim()
        : "";
    if (fallback && isUuidString(fallback)) {
      branchId = fallback;
    }
  }
  if (!branchId) {
    const { data: orgBranches, error: obErr } = await supabaseAdmin
      .from("branches")
      .select("id")
      .eq("organization_id", userProfile.organization_id)
      .limit(2);
    if (!obErr && orgBranches && orgBranches.length === 1) {
      const only = String((orgBranches[0] as { id: string }).id);
      if (isUuidString(only)) branchId = only;
    }
  }
  if (!branchId) {
    throw httpError(
      400,
      "Missing branch scope: set the X-Branch-Id header to the branch selected in the app header.",
    );
  }
  const { data: br, error: brErr } = await supabaseAdmin
    .from("branches")
    .select("id, organization_id")
    .eq("id", branchId)
    .maybeSingle();
  if (brErr) throw brErr;
  if (!br || (br as { organization_id: string }).organization_id !== userProfile.organization_id) {
    throw httpError(403, "Invalid branch or branch does not belong to your organization.");
  }
  const home =
    userProfile.branch_id != null && String(userProfile.branch_id).length > 0
      ? String(userProfile.branch_id)
      : null;
  if (home && branchId !== home) {
    if (userId) {
      const { data: ownerRow } = await supabaseAdmin
        .from("profiles")
        .select("is_org_owner")
        .eq("id", userId)
        .maybeSingle();
      if ((ownerRow as { is_org_owner?: boolean })?.is_org_owner === true) {
        return branchId;
      }
    }
    throw httpError(403, "You may only access data for your assigned branch.");
  }
  return branchId;
}

/** Hide cross-branch rows (404) when branch_id is missing or does not match the viewer scope. */
function assertEntityBranch(
  entityBranchId: string | null | undefined,
  viewerBranchId: string,
  _label: string,
): void {
  const eb =
    entityBranchId != null && String(entityBranchId).length > 0 ? String(entityBranchId) : null;
  if (!eb || eb !== viewerBranchId) {
    throw httpError(404, "Not found.");
  }
}

/** Oldest branch in the org — legacy org-wide config rows (branch_id null) are treated as belonging here. */
async function getMainBranchIdForOrg(orgId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from("branches")
    .select("id")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const id = row && (row as { id?: string }).id ? String((row as { id: string }).id) : "";
  return id && isUuidString(id) ? id : null;
}

/** Org config rows (event types, templates, custom fields, statuses, roles): scoped per branch; legacy null = main branch only. */
function filterRowsByBranchScope<T extends { branch_id?: string | null }>(
  rows: T[],
  viewerBranchId: string,
  mainBranchId: string | null,
): T[] {
  return rows.filter((r) => {
    const bid = r.branch_id != null && String(r.branch_id).length > 0 ? String(r.branch_id) : null;
    if (bid === viewerBranchId) return true;
    if (bid == null && mainBranchId && viewerBranchId === mainBranchId) return true;
    return false;
  });
}

function assertConfigRowInBranchScope<T extends { branch_id?: string | null }>(
  row: T,
  viewerBranchId: string,
  mainBranchId: string | null,
): void {
  const bid = row.branch_id != null && String(row.branch_id).length > 0 ? String(row.branch_id) : null;
  if (bid === viewerBranchId) return;
  if (bid == null && mainBranchId && viewerBranchId === mainBranchId) return;
  throw httpError(404, "Not found.");
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

/** Cross-tenant SuperAdmin APIs: profile flag or SUPERADMIN_EMAILS (comma-separated). */
async function requireSuperAdmin(req: Request, res: Response): Promise<{ userId: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const token = authHeader.split(" ")[1];
  const supabase = getSupabaseClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
  const { data: profRow, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, email, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr && String(profErr.message || "").toLowerCase().includes("is_super_admin")) {
    const { data: p2 } = await supabaseAdmin.from("profiles").select("id, email").eq("id", user.id).maybeSingle();
    const envEmails = (process.env.SUPERADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const em = p2 && typeof (p2 as { email?: string }).email === "string" ? (p2 as { email: string }).email.toLowerCase() : "";
    if (em && envEmails.includes(em)) return { userId: user.id };
    res.status(403).json({ error: "Super admin access required" });
    return null;
  }
  if ((profRow as { is_super_admin?: boolean } | null)?.is_super_admin === true) {
    return { userId: user.id };
  }
  const envEmails = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const em =
    profRow && typeof (profRow as { email?: string }).email === "string"
      ? (profRow as { email: string }).email.toLowerCase()
      : "";
  if (em && envEmails.includes(em)) return { userId: user.id };
  res.status(403).json({ error: "Super admin access required" });
  return null;
}

/** Resolved auth + permission set for API RBAC (org owner bypasses individual checks). */
type ActorAuthContext = {
  userId: string;
  orgId: string;
  branchId: string | null;
  roleId: string | null;
  isOrgOwner: boolean;
  permissionSet: Set<string>;
};

type NotificationCategory =
  | "tasks"
  | "attendance"
  | "events"
  | "requests"
  | "assignments"
  | "permissions"
  | "member_care"
  | "leader_updates";

type NotificationInsert = {
  organization_id: string;
  branch_id: string | null;
  recipient_profile_id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  message: string;
  severity?: "low" | "medium" | "high";
  entity_type?: string | null;
  entity_id?: string | null;
  action_path?: string | null;
  payload?: Record<string, unknown>;
  dedupe_key?: string | null;
  dedupe_window_minutes?: number;
};

type NotificationTestType =
  | "task_assigned"
  | "task_pending_reminder"
  | "task_overdue"
  | "task_completed"
  | "attendance_start_reminder"
  | "attendance_close_reminder"
  | "attendance_missed"
  | "event_created"
  | "event_updated"
  | "member_request_approved"
  | "group_request_approved"
  | "member_assigned_group"
  | "permission_updated"
  | "low_attendance_alert";

const NOTIFICATION_TEST_TYPE_META: Record<
  NotificationTestType,
  {
    category: NotificationCategory;
    severity: "low" | "medium" | "high";
    title: string;
    message: string;
    entity_type: string;
    action_path: string;
  }
> = {
  task_assigned: {
    category: "tasks",
    severity: "medium",
    title: "New task assigned",
    message: "Test notification: a task was assigned.",
    entity_type: "member_task",
    action_path: "/members/00000000-0000-4000-8000-000000000001",
  },
  task_pending_reminder: {
    category: "tasks",
    severity: "medium",
    title: "Task due in 24 hours",
    message: "Test notification: a task is due soon.",
    entity_type: "member_task",
    action_path: "/members/00000000-0000-4000-8000-000000000001",
  },
  task_overdue: {
    category: "tasks",
    severity: "high",
    title: "Task overdue",
    message: "Test notification: a task is overdue.",
    entity_type: "member_task",
    action_path: "/members/00000000-0000-4000-8000-000000000001",
  },
  task_completed: {
    category: "leader_updates",
    severity: "low",
    title: "Task completed",
    message: "Test notification: a task was marked complete.",
    entity_type: "member_task",
    action_path: "/members/00000000-0000-4000-8000-000000000001",
  },
  attendance_start_reminder: {
    category: "attendance",
    severity: "high",
    title: "Attendance starts in 5 minutes",
    message: "Test notification: event attendance is about to start.",
    entity_type: "event",
    action_path: "/events/00000000-0000-4000-8000-000000000002",
  },
  attendance_close_reminder: {
    category: "attendance",
    severity: "high",
    title: "Attendance closes in 10 minutes",
    message: "Test notification: attendance closes soon.",
    entity_type: "event",
    action_path: "/events/00000000-0000-4000-8000-000000000002",
  },
  attendance_missed: {
    category: "attendance",
    severity: "high",
    title: "Attendance not marked yet",
    message: "Test notification: attendance has not been marked.",
    entity_type: "event",
    action_path: "/events/00000000-0000-4000-8000-000000000002",
  },
  event_created: {
    category: "events",
    severity: "low",
    title: "New event created",
    message: "Test notification: a new event was created.",
    entity_type: "event",
    action_path: "/events/00000000-0000-4000-8000-000000000002",
  },
  event_updated: {
    category: "events",
    severity: "low",
    title: "Event updated",
    message: "Test notification: an event was updated.",
    entity_type: "event",
    action_path: "/events/00000000-0000-4000-8000-000000000002",
  },
  member_request_approved: {
    category: "requests",
    severity: "medium",
    title: "Member request approved",
    message: "Test notification: a member request was approved.",
    entity_type: "member_request",
    action_path: "/members/00000000-0000-4000-8000-000000000003",
  },
  group_request_approved: {
    category: "requests",
    severity: "medium",
    title: "Group request approved",
    message: "Test notification: a group request was approved.",
    entity_type: "group_request",
    action_path: "/members/00000000-0000-4000-8000-000000000003",
  },
  member_assigned_group: {
    category: "assignments",
    severity: "medium",
    title: "Member assigned to group",
    message: "Test notification: a member was assigned to a group.",
    entity_type: "group",
    action_path: "/members/00000000-0000-4000-8000-000000000003",
  },
  permission_updated: {
    category: "permissions",
    severity: "high",
    title: "Access updated",
    message: "Test notification: account access was changed.",
    entity_type: "profile",
    action_path: "/profile",
  },
  low_attendance_alert: {
    category: "member_care",
    severity: "high",
    title: "Member needs follow-up",
    message: "Test notification: member attendance risk detected.",
    entity_type: "member",
    action_path: "/members/00000000-0000-4000-8000-000000000003",
  },
};

type NotificationPreferencesRow = {
  profile_id: string;
  organization_id: string;
  branch_id: string | null;
  mute_all: boolean;
  tasks_enabled: boolean;
  attendance_enabled: boolean;
  events_enabled: boolean;
  requests_enabled: boolean;
  assignments_enabled: boolean;
  permissions_enabled: boolean;
  member_care_enabled: boolean;
  leader_updates_enabled: boolean;
  granular_preferences?: Record<string, boolean> | null;
  created_at: string;
  updated_at: string;
};

const NOTIFICATION_PREF_DEFAULTS = {
  mute_all: false,
  tasks_enabled: true,
  attendance_enabled: true,
  events_enabled: true,
  requests_enabled: true,
  assignments_enabled: true,
  permissions_enabled: true,
  member_care_enabled: true,
  leader_updates_enabled: true,
  granular_preferences: {} as Record<string, boolean>,
} satisfies Omit<NotificationPreferencesRow, "profile_id" | "organization_id" | "branch_id" | "created_at" | "updated_at">;

async function permissionSetForProfileRow(profile: {
  organization_id: string | null;
  branch_id?: string | null;
  role_id?: string | null;
  is_org_owner?: boolean | null;
  is_super_admin?: boolean | null;
  email?: string | null;
}): Promise<{
  permissionSet: Set<string>;
  isOrgOwner: boolean;
  orgId: string;
  branchId: string | null;
  roleId: string | null;
}> {
  const orgId = String(profile.organization_id || "");
  const branchId =
    profile.branch_id != null && String(profile.branch_id).length > 0 ? String(profile.branch_id) : null;
  const roleId = profile.role_id != null && String(profile.role_id).length > 0 ? String(profile.role_id) : null;
  const isSuperAdmin =
    profile.is_super_admin === true ||
    ((process.env.SUPERADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(String(profile.email || "").toLowerCase()));
  if (isSuperAdmin) {
    return {
      permissionSet: new Set(ALL_PERMISSION_IDS),
      isOrgOwner: true,
      orgId,
      branchId,
      roleId,
    };
  }
  const isOrgOwner = profile.is_org_owner === true;
  if (isOrgOwner) {
    return {
      permissionSet: new Set(ALL_PERMISSION_IDS),
      isOrgOwner: true,
      orgId,
      branchId,
      roleId,
    };
  }
  const permissionSet = new Set<string>();
  if (roleId) {
    const { data: roleRow } = await supabaseAdmin.from("roles").select("permissions").eq("id", roleId).maybeSingle();
    const raw = roleRow && (roleRow as { permissions?: unknown }).permissions;
    if (Array.isArray(raw)) {
      for (const p of raw) {
        if (typeof p === "string") permissionSet.add(p);
      }
    }
  }
  return { permissionSet: expandStoredPermissionIds(permissionSet), isOrgOwner: false, orgId, branchId, roleId };
}

async function getActorAuthContextFromToken(token: string | undefined): Promise<ActorAuthContext | null> {
  if (!token) return null;
  const supabase = getSupabaseClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  let { data: profile, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("organization_id, branch_id, role_id, is_org_owner, is_super_admin, email")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr && String(pErr.message || "").toLowerCase().includes("is_org_owner")) {
    const r2 = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id, role_id, email")
      .eq("id", user.id)
      .maybeSingle();
    profile = r2.data ? { ...r2.data, is_org_owner: false, is_super_admin: false } : null;
    pErr = r2.error;
  }

  if (pErr || !profile) return null;
  const r = await permissionSetForProfileRow(profile as typeof profile & { is_org_owner?: boolean | null });
  return {
    userId: user.id,
    orgId: r.orgId,
    branchId: r.branchId,
    roleId: r.roleId,
    isOrgOwner: r.isOrgOwner,
    permissionSet: r.permissionSet,
  };
}

function prefColumnForCategory(category: NotificationCategory): keyof typeof NOTIFICATION_PREF_DEFAULTS {
  switch (category) {
    case "tasks":
      return "tasks_enabled";
    case "attendance":
      return "attendance_enabled";
    case "events":
      return "events_enabled";
    case "requests":
      return "requests_enabled";
    case "assignments":
      return "assignments_enabled";
    case "permissions":
      return "permissions_enabled";
    case "member_care":
      return "member_care_enabled";
    case "leader_updates":
      return "leader_updates_enabled";
    default:
      return "tasks_enabled";
  }
}

async function ensureNotificationPreferences(profileId: string, orgId: string, branchId: string | null): Promise<NotificationPreferencesRow> {
  const { data: existing } = await supabaseAdmin
    .from("notification_preferences")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) return existing as NotificationPreferencesRow;

  const seed = {
    profile_id: profileId,
    organization_id: orgId,
    branch_id: branchId,
    ...NOTIFICATION_PREF_DEFAULTS,
  };
  let inserted: unknown = null;
  let { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert(seed, { onConflict: "profile_id" })
    .select("*")
    .maybeSingle();
  if (error && String(error.message || "").toLowerCase().includes("granular_preferences")) {
    const fallback = { ...seed };
    delete (fallback as Record<string, unknown>).granular_preferences;
    const r2 = await supabaseAdmin
      .from("notification_preferences")
      .upsert(fallback, { onConflict: "profile_id" })
      .select("*")
      .maybeSingle();
    data = r2.data;
    error = r2.error;
  }
  inserted = data;
  return (inserted as NotificationPreferencesRow) || ({ ...seed, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as NotificationPreferencesRow);
}

function granularKeyForType(type: string): string | null {
  const t = String(type || "").trim();
  if (!t) return null;
  if (t === "member_request_approved" || t === "group_request_approved") return "request_approval_updates";
  if (t === "pending_member_join_request") return "member_request";
  if (t === "pending_group_join_request") return "group_join_request";
  if (t === "member_assigned_group") return "member_assigned";
  if (t === "permission_updated" || t === "staff_access_group_assigned") return "permission_changed";
  if (t === "task_pending_reminder" || t === "task_overdue") return "task_overdue";
  if (t === "important_date_reminder") return "follow_up_needed";
  return t;
}

async function canDeliverNotification(
  recipientProfileId: string,
  orgId: string,
  branchId: string | null,
  category: NotificationCategory,
  type: string,
): Promise<boolean> {
  const pref = await ensureNotificationPreferences(recipientProfileId, orgId, branchId);
  if (pref.mute_all) return false;
  const col = prefColumnForCategory(category);
  if (pref[col] === false) return false;
  const g = pref.granular_preferences && typeof pref.granular_preferences === "object" ? pref.granular_preferences : {};
  const gKey = granularKeyForType(type);
  if (!gKey) return true;
  if (Object.prototype.hasOwnProperty.call(g, gKey)) {
    return (g as Record<string, unknown>)[gKey] !== false;
  }
  return true;
}

const _memoryDedupeCache = new Map<string, number>();
function _memoryDedupeCleanup() {
  if (_memoryDedupeCache.size < 5000) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of _memoryDedupeCache) { if (v < cutoff) _memoryDedupeCache.delete(k); }
}

/** Same Expo token can be on multiple profiles; avoid double push for identical dedupe_key (e.g. double handler). */
const _expoPushDedupeByTokenAndKey = new Map<string, number>();
function _expoPushDedupeCleanup() {
  if (_expoPushDedupeByTokenAndKey.size < 8000) return;
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [k, v] of _expoPushDedupeByTokenAndKey) {
    if (v < cutoff) _expoPushDedupeByTokenAndKey.delete(k);
  }
}

const _pendingMemberJoinNotifyOnce = new Set<string>();
const _pendingGroupJoinNotifyOnce = new Set<string>();

/** Recipient's branch so GET /api/notifications (filtered by viewer branch) returns the row. */
async function branchIdForNotificationRecipient(recipientProfileId: string): Promise<string | null> {
  if (!isUuidString(recipientProfileId)) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("branch_id")
    .eq("id", recipientProfileId)
    .maybeSingle();
  const b = data && (data as { branch_id?: string | null }).branch_id;
  return typeof b === "string" && b.trim().length > 0 ? b.trim() : null;
}

async function createNotification(input: NotificationInsert): Promise<boolean> {
  const dedupeWindow = Number.isFinite(input.dedupe_window_minutes)
    ? Math.max(1, Math.min(Number(input.dedupe_window_minutes), 60 * 24 * 14))
    : 0;
  const dedupeKey = input.dedupe_key ? String(input.dedupe_key).trim() : "";
  if (dedupeWindow > 0 && dedupeKey) {
    const compositeKey = `${input.recipient_profile_id}:${dedupeKey}`;
    const windowMs = dedupeWindow * 60 * 1000;
    const lastSent = _memoryDedupeCache.get(compositeKey);
    if (lastSent && Date.now() - lastSent < windowMs) return false;

    const sinceIso = new Date(Date.now() - dedupeWindow * 60 * 1000).toISOString();
    const { data: recentRows } = await supabaseAdmin
      .from("notifications")
      .select("id, payload")
      .eq("recipient_profile_id", input.recipient_profile_id)
      .eq("organization_id", input.organization_id)
      .eq("type", input.type)
      .eq("entity_id", input.entity_id ?? null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(30);
    const exists = (recentRows || []).some((r) => {
      const p = (r as { payload?: unknown }).payload;
      if (!p || typeof p !== "object" || Array.isArray(p)) return false;
      return String((p as Record<string, unknown>).dedupe_key || "") === dedupeKey;
    });
    if (exists) {
      _memoryDedupeCache.set(compositeKey, Date.now());
      return false;
    }
  }

  const recipientBranch = await branchIdForNotificationRecipient(input.recipient_profile_id);
  const effectiveBranchId = recipientBranch ?? input.branch_id ?? null;
  const allowed = await canDeliverNotification(
    input.recipient_profile_id,
    input.organization_id,
    effectiveBranchId,
    input.category,
    input.type,
  );
  if (!allowed) return false;
  const row = {
    organization_id: input.organization_id,
    branch_id: effectiveBranchId,
    recipient_profile_id: input.recipient_profile_id,
    type: input.type,
    category: input.category,
    title: input.title,
    message: input.message,
    severity: input.severity || "medium",
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    action_path: input.action_path ?? null,
    payload: input.payload || {},
    read_at: null,
    is_archived: false,
  };
  if (dedupeKey) {
    (row.payload as Record<string, unknown>).dedupe_key = dedupeKey;
  }
  const insRes = await supabaseAdmin.from("notifications").insert(row);
  if (insRes.error) {
    console.error("[notifications] insert failed:", insRes.error);
    return false;
  }
  try {
    const pushToken = await pushTokenForProfile(input.recipient_profile_id);
    if (pushToken) {
      let skipExpo = false;
      if (dedupeKey) {
        const pushDedupeK = `${input.organization_id}:${pushToken}:${dedupeKey}`;
        const prev = _expoPushDedupeByTokenAndKey.get(pushDedupeK);
        if (prev != null && Date.now() - prev < 120_000) skipExpo = true;
      }
      if (!skipExpo) {
        // FCM/APNs data values should be strings; nested objects are unreliable on some devices.
        const payloadObj =
          input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
            ? (input.payload as Record<string, unknown>)
            : {};
        const dataPayload: Record<string, string> = {
          action_path: String(input.action_path ?? ""),
          payload_json: JSON.stringify(payloadObj),
          entity_type: String(input.entity_type ?? ""),
          entity_id: String(input.entity_id ?? ""),
          notification_type: String(input.type ?? ""),
        };
        const mid =
          typeof payloadObj.member_id === "string" && isUuidString(payloadObj.member_id.trim())
            ? payloadObj.member_id.trim()
            : "";
        const openMid =
          typeof payloadObj.openMemberId === "string" && isUuidString(payloadObj.openMemberId.trim())
            ? payloadObj.openMemberId.trim()
            : "";
        if (mid) dataPayload.member_id = mid;
        if (openMid) dataPayload.openMemberId = openMid;
        const imageUrlRaw =
          input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
            ? String(
                (input.payload as Record<string, unknown>).member_image_url ||
                  (input.payload as Record<string, unknown>).event_cover_image_url ||
                  "",
              ).trim()
            : "";
        const message: {
          to: string;
          title: string;
          body: string;
          data: Record<string, unknown>;
          sound: "default";
          mutableContent: boolean;
          richContent?: { image?: string };
        } = {
          to: pushToken,
          title: String(input.title || "New notification"),
          body: String(input.message || ""),
          data: dataPayload,
          sound: "default",
          mutableContent: true,
        };
        if (imageUrlRaw) {
          message.richContent = { image: imageUrlRaw };
        }
        const chunks = expoPush.chunkPushNotifications([message]);
        for (const chunk of chunks) {
          await expoPush.sendPushNotificationsAsync(chunk);
        }
        if (dedupeKey) {
          const pushDedupeK = `${input.organization_id}:${pushToken}:${dedupeKey}`;
          _expoPushDedupeByTokenAndKey.set(pushDedupeK, Date.now());
          _expoPushDedupeCleanup();
        }
      }
    }
  } catch (pushErr) {
    console.warn("[notifications] push send failed:", pushErr);
  }
  if (dedupeKey) {
    _memoryDedupeCache.set(`${input.recipient_profile_id}:${dedupeKey}`, Date.now());
    _memoryDedupeCleanup();
  }
  return true;
}

async function createNotificationsForRecipients(
  recipientIds: string[],
  input: Omit<NotificationInsert, "recipient_profile_id">,
): Promise<void> {
  const uniq = [...new Set(recipientIds.filter((x) => isUuidString(x)))];
  for (const recipient_profile_id of uniq) {
    await createNotification({
      ...input,
      recipient_profile_id,
    });
  }
}

/** Do not notify the actor about their own approve action (avoids duplicate-feel + redundant alerts). */
function recipientIdsExcludingActor(recipientIds: string[], actorProfileId: string): string[] {
  const a = String(actorProfileId || "").trim();
  if (!a || !isUuidString(a)) return recipientIds;
  return recipientIds.filter((id) => id !== a);
}

/** For batching retroactive guards on automated notifications. */
async function mapProfileCreatedAtMsById(profileIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(profileIds.filter((x) => isUuidString(x)))];
  if (ids.length === 0) return out;
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data } = await supabaseAdmin.from("profiles").select("id, created_at").in("id", slice);
    for (const r of (data || []) as Array<{ id: string; created_at?: string | null }>) {
      const ms = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (Number.isFinite(ms)) out.set(r.id, ms);
    }
  }
  return out;
}

/** Skip staff whose account was created after `entityMs` (e.g. event start, task creation). */
function filterRecipientsProfileCreatedNotAfterEntity(
  recipientIds: string[],
  profileCreatedMs: Map<string, number>,
  entityMs: number | null,
): string[] {
  if (entityMs === null || !Number.isFinite(entityMs)) return recipientIds;
  return recipientIds.filter((id) => {
    const pMs = profileCreatedMs.get(id);
    const created = pMs !== undefined ? pMs : 0;
    return created <= entityMs;
  });
}

/**
 * Member-care: skip staff accounts created after the member record was created,
 * so new hires are not flooded with alerts about legacy directory members.
 */
function filterRecipientsForMemberCareMember(
  recipientIds: string[],
  profileCreatedMs: Map<string, number>,
  memberCreatedMs: number,
): string[] {
  if (!Number.isFinite(memberCreatedMs)) return recipientIds;
  return recipientIds.filter((id) => {
    const pMs = profileCreatedMs.get(id) ?? 0;
    return memberCreatedMs >= pMs;
  });
}

async function fetchGroupDisplayName(groupId: string, organizationId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const n = String((data as { name?: string | null } | null)?.name || "").trim();
  return n || "a ministry";
}

function memberImageFromMemberRecord(row: Record<string, unknown> | null | undefined): string {
  return String(row?.memberimage_url || row?.avatar_url || row?.member_url || "").trim();
}

function memberDisplayNameFromParts(first?: string | null, last?: string | null): string {
  const fn = String(first || "").trim();
  const ln = String(last || "").trim();
  const n = `${fn} ${ln}`.trim();
  return n || "Member";
}

function parseActionPathIds(actionPath: string | null | undefined): {
  memberId: string | null;
  eventId: string | null;
  groupId: string | null;
} {
  const p = String(actionPath || "").trim();
  const mem = /^\/members\/([^/?#]+)/i.exec(p);
  const ev = /^\/events\/([^/?#]+)/i.exec(p);
  const grp = /^\/groups\/([^/?#]+)/i.exec(p);
  return {
    memberId: mem?.[1] && isUuidString(mem[1]) ? mem[1] : null,
    eventId: ev?.[1] && isUuidString(ev[1]) ? ev[1] : null,
    groupId: grp?.[1] && isUuidString(grp[1]) ? grp[1] : null,
  };
}

async function fetchMemberRichFieldsForPayload(
  memberId: string,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from("members")
    .select("id, organization_id, first_name, last_name, memberimage_url")
    .eq("id", memberId)
    .maybeSingle();
  if (!data || String((data as { organization_id?: string }).organization_id || "") !== organizationId) return {};
  const row = data as Record<string, unknown>;
  const img = memberImageFromMemberRecord(row);
  return {
    member_id: memberId,
    member_display_name: memberDisplayNameFromParts(
      row.first_name as string | undefined,
      row.last_name as string | undefined,
    ),
    ...(img ? { member_image_url: img } : {}),
  };
}

async function fetchEventRichFieldsForPayload(
  eventId: string,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from("events")
    .select("id, organization_id, title, cover_image_url")
    .eq("id", eventId)
    .maybeSingle();
  if (!data || String((data as { organization_id?: string }).organization_id || "") !== organizationId) return {};
  const title = String((data as { title?: string }).title || "Event").trim() || "Event";
  const cover = String((data as { cover_image_url?: string }).cover_image_url || "").trim();
  return {
    event_id: eventId,
    event_display_name: title,
    ...(cover ? { event_cover_image_url: cover } : {}),
  };
}

async function fetchProfileAvatarPayload(
  profileId: string,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, organization_id, first_name, last_name, avatar_url, profile_image")
    .eq("id", profileId)
    .maybeSingle();
  if (!data || String((data as { organization_id?: string }).organization_id || "") !== organizationId) return {};
  const pu = String(
    (data as { avatar_url?: string }).avatar_url || (data as { profile_image?: string }).profile_image || "",
  ).trim();
  return {
    profile_id: profileId,
    member_display_name: memberDisplayNameFromParts(
      (data as { first_name?: string }).first_name,
      (data as { last_name?: string }).last_name,
    ),
    ...(pu ? { member_image_url: pu } : {}),
  };
}

/** In-app + push when a profile is added to a staff access group (Settings → staff groups; not ministry `groups`). */
async function notifyProfilesStaffAccessGroupAssigned(args: {
  recipientProfileIds: string[];
  organizationId: string;
  branchId: string | null;
  staffProfileGroupId: string;
  groupDisplayName: string;
}): Promise<void> {
  const { recipientProfileIds, organizationId, branchId, staffProfileGroupId, groupDisplayName } = args;
  const label = String(groupDisplayName || "").trim() || "Staff access group";
  try {
    await Promise.all(
      recipientProfileIds.filter((x) => isUuidString(x)).map(async (profileId) => {
        await createNotificationsForRecipients([profileId], {
          organization_id: organizationId,
          branch_id: branchId,
          type: "staff_access_group_assigned",
          category: "permissions",
          title: "Staff access updated",
          message: `You were added to "${label}". Your permissions may have changed.`,
          severity: "medium",
          entity_type: "staff_profile_group",
          entity_id: staffProfileGroupId,
          action_path: "/settings",
          payload: {
            group_display_name: label,
            staff_profile_group_id: staffProfileGroupId,
            ...(await fetchProfileAvatarPayload(profileId, organizationId)),
          },
        });
      }),
    );
  } catch (e) {
    console.warn("[notifications] staff_access_group_assigned:", e);
  }
}

/** In-app + push when staff ministry visibility (`profile_ministry_scope`) is saved (Settings → Staff & leaders). */
async function notifyRecipientProfileMinistryScopeUpdated(args: {
  recipientProfileId: string;
  organizationId: string;
  previousGroupIds: string[];
  newGroupIds: string[];
}): Promise<void> {
  const { recipientProfileId, organizationId, previousGroupIds, newGroupIds } = args;
  if (!isUuidString(recipientProfileId)) return;
  const prev = new Set(previousGroupIds.filter((id) => isUuidString(id)));
  const next = new Set(newGroupIds.filter((id) => isUuidString(id)));
  if (prev.size === next.size && [...next].every((id) => prev.has(id))) return;

  const added = [...next].filter((id) => !prev.has(id));
  const removed = [...prev].filter((id) => !next.has(id));

  const idUnion = [...new Set([...added, ...removed, ...newGroupIds])];
  const nameMap = new Map<string, string>();
  if (idUnion.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("groups")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", idUnion);
    for (const r of rows || []) {
      const id = String((r as { id?: string }).id || "");
      const nm = String((r as { name?: string | null }).name || "").trim() || "Ministry";
      if (id) nameMap.set(id, nm);
    }
  }
  const label = (id: string) => nameMap.get(id) || "Ministry";

  const quoteList = (ids: string[]): string => {
    if (ids.length === 0) return "";
    const parts = ids.map((id) => `"${label(id)}"`);
    if (parts.length === 1) return parts[0];
    if (parts.length <= 4) return parts.join(", ");
    return `${parts.slice(0, 4).join(", ")}, and ${parts.length - 4} more`;
  };

  let message = "";
  if (added.length > 0 && removed.length > 0) {
    message = `You now have access to ${quoteList(added)}. You no longer have access to ${quoteList(removed)}.`;
  } else if (added.length > 0) {
    message =
      added.length === 1
        ? `You now have access to ${quoteList(added)}.`
        : `You now have access to: ${quoteList(added)}.`;
  } else {
    message =
      removed.length === 1
        ? `You no longer have access to ${quoteList(removed)}.`
        : `You no longer have access to: ${quoteList(removed)}.`;
  }

  const actionPath =
    newGroupIds.length === 1 && isUuidString(newGroupIds[0]) ? `/groups/${newGroupIds[0]}` : "/groups";

  try {
    const avatarPayload = await fetchProfileAvatarPayload(recipientProfileId, organizationId);
    const groupNamesOrdered = newGroupIds.map((id) => label(id));

    await createNotificationsForRecipients([recipientProfileId], {
      organization_id: organizationId,
      branch_id: null,
      type: "permission_updated",
      category: "permissions",
      title: "Ministry access updated",
      message,
      severity: "medium",
      entity_type: "profile",
      entity_id: recipientProfileId,
      action_path: actionPath,
      payload: {
        ministry_scope_updated: true,
        ministry_scope_group_ids: newGroupIds,
        ...(groupNamesOrdered.length > 0 ? { ministry_scope_group_names: groupNamesOrdered } : {}),
        ministry_scope_added_group_ids: added,
        ministry_scope_removed_group_ids: removed,
        ...avatarPayload,
      },
    });
  } catch (e) {
    console.warn("[notifications] profile_ministry_scope:", e);
  }
}

async function buildNotificationQaRichPayload(args: {
  organizationId: string;
  type: NotificationTestType;
  actionPath: string;
  syntheticEntityId: string | null;
}): Promise<Record<string, unknown>> {
  const { organizationId, type, actionPath, syntheticEntityId } = args;
  const paths = parseActionPathIds(actionPath);
  const out: Record<string, unknown> = {};

  const taskTypes: NotificationTestType[] = [
    "task_assigned",
    "task_pending_reminder",
    "task_overdue",
    "task_completed",
  ];
  if (taskTypes.includes(type)) {
    if (syntheticEntityId && isUuidString(syntheticEntityId)) {
      const { data: task } = await supabaseAdmin
        .from("member_tasks")
        .select("id, organization_id, title, member_id")
        .eq("id", syntheticEntityId)
        .maybeSingle();
      if (task && String((task as { organization_id?: string }).organization_id || "") === organizationId) {
        out.task_id = syntheticEntityId;
        out.task_title = String((task as { title?: string }).title || "").trim() || "Task";
        const mid = String((task as { member_id?: string }).member_id || "");
        if (mid && isUuidString(mid)) {
          Object.assign(out, await fetchMemberRichFieldsForPayload(mid, organizationId));
        }
      }
    }
    if (!out.member_display_name && paths.memberId) {
      Object.assign(out, await fetchMemberRichFieldsForPayload(paths.memberId, organizationId));
    }
    if (!out.task_title) out.task_title = "Sample task";
    return out;
  }

  if (
    type === "attendance_start_reminder" ||
    type === "attendance_close_reminder" ||
    type === "attendance_missed" ||
    type === "event_created" ||
    type === "event_updated"
  ) {
    const eid = paths.eventId || (syntheticEntityId && isUuidString(syntheticEntityId) ? syntheticEntityId : null);
    if (eid) Object.assign(out, await fetchEventRichFieldsForPayload(eid, organizationId));
    return out;
  }

  if (type === "group_request_approved") {
    if (paths.groupId) {
      out.group_id = paths.groupId;
      out.group_display_name = await fetchGroupDisplayName(paths.groupId, organizationId);
    }
    const mid =
      syntheticEntityId && isUuidString(syntheticEntityId) ? syntheticEntityId : paths.memberId;
    if (mid) Object.assign(out, await fetchMemberRichFieldsForPayload(mid, organizationId));
    return out;
  }

  if (type === "member_request_approved" || type === "low_attendance_alert" || type === "member_assigned_group") {
    const mid =
      paths.memberId || (syntheticEntityId && isUuidString(syntheticEntityId) ? syntheticEntityId : null);
    if (mid) Object.assign(out, await fetchMemberRichFieldsForPayload(mid, organizationId));
    return out;
  }

  if (type === "permission_updated") {
    const pid =
      syntheticEntityId && isUuidString(syntheticEntityId) ? syntheticEntityId : paths.memberId;
    if (pid) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("id, organization_id, first_name, last_name, avatar_url, profile_image")
        .eq("id", pid)
        .maybeSingle();
      if (prof && String((prof as { organization_id?: string }).organization_id || "") === organizationId) {
        out.profile_id = pid;
        out.member_display_name = memberDisplayNameFromParts(
          (prof as { first_name?: string }).first_name,
          (prof as { last_name?: string }).last_name,
        );
        const pu = String(
          (prof as { avatar_url?: string }).avatar_url ||
            (prof as { profile_image?: string }).profile_image ||
            "",
        ).trim();
        if (pu) out.member_image_url = pu;
      }
    }
    return out;
  }

  return out;
}

async function profileIdsWithPermission(
  orgId: string,
  branchId: string | null,
  permissionId: string,
): Promise<string[]> {
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, role_id, is_org_owner")
    .eq("organization_id", orgId)
    .eq("branch_id", branchId)
    .limit(3000);
  const rows = (profiles || []) as Array<{ id: string; role_id?: string | null; is_org_owner?: boolean | null }>;
  const roleIds = [...new Set(rows.map((r) => (typeof r.role_id === "string" ? r.role_id : "")).filter(isUuidString))];
  const rolePerms = new Map<string, Set<string>>();
  if (roleIds.length > 0) {
    const { data: roleRows } = await supabaseAdmin.from("roles").select("id, permissions").in("id", roleIds);
    for (const rr of (roleRows || []) as Array<{ id: string; permissions?: unknown }>) {
      const ps = new Set<string>();
      if (Array.isArray(rr.permissions)) {
        for (const p of rr.permissions) if (typeof p === "string") ps.add(p);
      }
      rolePerms.set(rr.id, expandStoredPermissionIds(ps));
    }
  }
  const out: string[] = [];
  for (const r of rows) {
    if (r.is_org_owner) {
      out.push(r.id);
      continue;
    }
    if (!r.role_id) continue;
    if (rolePerms.get(r.role_id)?.has(permissionId)) out.push(r.id);
  }
  return out;
}

async function profileIdsWithAnyPermission(
  orgId: string,
  branchId: string | null,
  permissionIds: string[],
): Promise<string[]> {
  if (permissionIds.length === 0) return [];
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, role_id, is_org_owner")
    .eq("organization_id", orgId)
    .eq("branch_id", branchId)
    .limit(3000);
  const rows = (profiles || []) as Array<{ id: string; role_id?: string | null; is_org_owner?: boolean | null }>;
  const roleIds = [...new Set(rows.map((r) => (typeof r.role_id === "string" ? r.role_id : "")).filter(isUuidString))];
  const rolePerms = new Map<string, Set<string>>();
  if (roleIds.length > 0) {
    const { data: roleRows } = await supabaseAdmin.from("roles").select("id, permissions").in("id", roleIds);
    for (const rr of (roleRows || []) as Array<{ id: string; permissions?: unknown }>) {
      const ps = new Set<string>();
      if (Array.isArray(rr.permissions)) {
        for (const p of rr.permissions) if (typeof p === "string") ps.add(p);
      }
      rolePerms.set(rr.id, expandStoredPermissionIds(ps));
    }
  }
  const out: string[] = [];
  const need = new Set(permissionIds);
  for (const r of rows) {
    if (r.is_org_owner) {
      out.push(r.id);
      continue;
    }
    if (!r.role_id) continue;
    const exp = rolePerms.get(r.role_id);
    if (!exp) continue;
    for (const p of need) {
      if (exp.has(p)) {
        out.push(r.id);
        break;
      }
    }
  }
  return out;
}

async function ministryScopeForActor(
  userId: string,
  orgId: string,
  viewerBranch: string,
  isOrgOwner: boolean,
): Promise<MinistryScopeResult> {
  return resolveMinistryScope(supabaseAdmin, userId, orgId, viewerBranch, isOrgOwner);
}

function filterGroupRowsByMinistryScope<T extends { id: string; is_system?: boolean | null; system_kind?: string | null }>(
  rows: T[],
  scope: MinistryScopeResult,
  includeSystem: boolean,
): T[] {
  let list = rows;
  if (!includeSystem) {
    list = list.filter((g) => !(g.is_system && g.system_kind !== "all_members"));
  }
  if (scope.kind === "groups") {
    list = list.filter((g) => scope.allowedGroupIds.has(g.id));
  }
  return list;
}

function assertPermission(ctx: ActorAuthContext, permission: string): void {
  if (ctx.isOrgOwner) return;
  if (!ctx.permissionSet.has(permission)) {
    throw httpError(403, `Missing permission: ${permission}`);
  }
}

async function requirePermission(
  req: { headers: { authorization?: string } },
  res: { status: (n: number) => { json: (b: object) => void } },
  permission: string,
): Promise<ActorAuthContext | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")?.[1];
  const ctx = await getActorAuthContextFromToken(token);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  try {
    assertPermission(ctx, permission);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    res.status(403).json({ error: msg });
    return null;
  }
  return ctx;
}

async function requireAnyPermission(
  req: { headers: { authorization?: string } },
  res: { status: (n: number) => { json: (b: object) => void } },
  permissions: string[],
): Promise<ActorAuthContext | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")?.[1];
  const ctx = await getActorAuthContextFromToken(token);
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (ctx.isOrgOwner) return ctx;
  const ok = permissions.some((p) => ctx.permissionSet.has(p));
  if (!ok) {
    res.status(403).json({ error: `Missing one of: ${permissions.join(", ")}` });
    return null;
  }
  return ctx;
}

function actorCanViewMemberTasksMine(ctx: ActorAuthContext): boolean {
  return ctx.isOrgOwner || ctx.permissionSet.has("view_member_tasks");
}
function actorCanViewGroupTasksMine(ctx: ActorAuthContext): boolean {
  return (
    ctx.isOrgOwner ||
    ctx.permissionSet.has("view_group_tasks") ||
    ctx.permissionSet.has("view_member_tasks")
  );
}
function actorCanSeeMemberBranchTasks(ctx: ActorAuthContext): boolean {
  return ctx.isOrgOwner;
}
function actorCanSeeGroupBranchTasks(ctx: ActorAuthContext): boolean {
  return ctx.isOrgOwner;
}
function actorCanManageGroupTasks(ctx: ActorAuthContext): boolean {
  return (
    ctx.isOrgOwner ||
    ctx.permissionSet.has("add_group_tasks") ||
    ctx.permissionSet.has("edit_group_tasks") ||
    ctx.permissionSet.has("delete_group_tasks") ||
    ctx.permissionSet.has("add_member_tasks") ||
    ctx.permissionSet.has("edit_member_tasks") ||
    ctx.permissionSet.has("delete_member_tasks")
  );
}
function actorCanManageGroupTaskChecklistStructure(ctx: ActorAuthContext): boolean {
  return (
    ctx.isOrgOwner ||
    ctx.permissionSet.has("edit_group_tasks") ||
    ctx.permissionSet.has("edit_member_tasks") ||
    ctx.permissionSet.has("edit_group_task_checklist") ||
    ctx.permissionSet.has("edit_member_task_checklist")
  );
}

/** Legacy `manage_permissions` + `manage_staff` settings surfaces (atomic). */
const SETTINGS_ELEVATED_STAFF_PERMS: string[] = [
  "view_roles",
  "add_roles",
  "edit_roles",
  "delete_roles",
  "assign_staff_roles",
  "view_staff",
  "edit_staff_access",
  "view_staff_profile_groups",
  "add_staff_profile_groups",
  "edit_staff_profile_groups",
  "delete_staff_profile_groups",
  "assign_staff_profile_groups",
  "view_staff_ministry_scope",
  "edit_staff_ministry_scope",
];

const MEMBER_TASK_RELATED_PERMS: string[] = [
  "view_member_tasks",
  "monitor_member_tasks",
  "add_member_tasks",
  "edit_member_tasks",
  "delete_member_tasks",
  "edit_member_task_checklist",
  "complete_member_task_checklist",
];

const GROUP_TASK_RELATED_PERMS: string[] = [
  "view_group_tasks",
  "monitor_group_tasks",
  "add_group_tasks",
  "edit_group_tasks",
  "delete_group_tasks",
  "edit_group_task_checklist",
  "complete_group_task_checklist",
];

const ANY_MEMBER_OR_GROUP_TASK_PERM: string[] = [...MEMBER_TASK_RELATED_PERMS, ...GROUP_TASK_RELATED_PERMS];

/** Photo URL from a members or profiles row (supports common column names). */
function pickMemberAvatarUrl(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  for (const k of ["avatar_url", "memberimage_url", "member_url", "profile_image"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Staff UI avatar is stored on `members` (e.g. avatar_url / memberimage_url), linked by same email + organization. */
async function findLinkedMemberForStaffProfile(
  profileData: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const rawEmail = String(profileData.email || "").trim();
  const orgId = String(profileData.organization_id || "");
  if (!rawEmail || !orgId) return null;

  const tryEmails = [...new Set([rawEmail, rawEmail.toLowerCase()])];
  let rows: Record<string, unknown>[] = [];
  for (const em of tryEmails) {
    const { data, error } = await supabaseAdmin
      .from("members")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .eq("email", em)
      .limit(25);
    if (!error && data?.length) {
      rows = data as Record<string, unknown>[];
      break;
    }
  }

  if (!rows.length) return null;

  const bid =
    profileData.branch_id != null && String(profileData.branch_id).length > 0
      ? String(profileData.branch_id)
      : null;
  if (bid) {
    const same = rows.filter((r: Record<string, unknown>) => String(r.branch_id ?? "") === bid);
    if (same.length) return same[0] as Record<string, unknown>;
  }
  return rows[0] as Record<string, unknown>;
}

async function avatarUrlForStaffProfile(profileData: Record<string, unknown>): Promise<string | null> {
  const linked = await findLinkedMemberForStaffProfile(profileData);
  const fromMember = pickMemberAvatarUrl(linked);
  if (fromMember) return fromMember;
  return pickMemberAvatarUrl(profileData);
}

/** When no linked member exists, store staff photo on profiles.avatar_url. */
async function updateStaffProfileAvatarOnProfileRow(profileId: string, url: string | null): Promise<void> {
  const { error } = await supabaseAdmin.from("profiles").update({ avatar_url: url }).eq("id", profileId);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("avatar_url") || msg.includes("schema cache") || msg.includes("column")) {
      throw new Error(
        "Run migration profiles_avatar_url.sql on your database (add profiles.avatar_url), or add a member with your email.",
      );
    }
    throw new Error(error.message || "Failed to save profile photo");
  }
}

/** Try member image columns in order (schemas vary: avatar_url vs memberimage_url vs member_url). */
async function updateMemberPrimaryPhoto(memberId: string, url: string | null): Promise<void> {
  const ts = new Date().toISOString();
  const attempts: Record<string, string | null>[] = [
    { avatar_url: url, updated_at: ts },
    { memberimage_url: url, updated_at: ts },
    { member_url: url, updated_at: ts },
  ];
  let lastErr: { message?: string } | null = null;
  for (const partial of attempts) {
    const { error } = await supabaseAdmin.from("members").update(partial).eq("id", memberId);
    if (!error) return;
    lastErr = error;
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("profile_image")) continue;
    if (msg.includes("avatar_url") || msg.includes("memberimage_url") || msg.includes("member_url")) continue;
    if (msg.includes("schema cache") || msg.includes("column")) continue;
  }
  throw new Error(lastErr?.message || "Could not update member photo (no matching image column)");
}

/** Matches `requireSuperAdmin` / `permissionSetForProfileRow` super-admin detection for the client payload. */
function profileIsSuperAdminForAuthPayload(profileData: Record<string, unknown>): boolean {
  if (profileData.is_super_admin === true) return true;
  const envEmails = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const em = String(profileData.email || "").toLowerCase();
  return em.length > 0 && envEmails.includes(em);
}

function buildUserAuthPayload(
  profileData: Record<string, unknown>,
  perm: Awaited<ReturnType<typeof permissionSetForProfileRow>>,
  linkedMemberAvatar?: string | null,
) {
  const fromProfilesRow = pickMemberAvatarUrl(profileData);
  const img =
    linkedMemberAvatar != null && String(linkedMemberAvatar).trim()
      ? String(linkedMemberAvatar).trim()
      : fromProfilesRow;
  const cmsAt = profileData.cms_onboarding_completed_at;
  const cmsDone =
    cmsAt != null && String(cmsAt).trim() !== "" && String(cmsAt).toLowerCase() !== "null";
  return {
    id: profileData.id,
    email: profileData.email,
    first_name: profileData.first_name,
    last_name: profileData.last_name,
    organization_id: profileData.organization_id,
    branch_id: profileData.branch_id,
    role_id: profileData.role_id ?? null,
    is_org_owner: perm.isOrgOwner,
    is_super_admin: profileIsSuperAdminForAuthPayload(profileData),
    permissions: [...perm.permissionSet],
    profile_image: img || null,
    cms_onboarding_completed: cmsDone,
  };
}

async function buildUserAuthPayloadWithMemberAvatar(
  profileData: Record<string, unknown>,
  perm: Awaited<ReturnType<typeof permissionSetForProfileRow>>,
) {
  const av = await avatarUrlForStaffProfile(profileData);
  const base = buildUserAuthPayload(profileData, perm, av) as Record<string, unknown>;
  const orgId = String(profileData.organization_id || "");
  const branchId =
    profileData.branch_id != null && String(profileData.branch_id).length > 0
      ? String(profileData.branch_id)
      : "";
  const uid = typeof profileData.id === "string" ? profileData.id : "";
  let ministry_scope: { kind: "bypass" | "branch_all" | "groups"; group_ids: string[] } = {
    kind: "branch_all",
    group_ids: [],
  };
  if (orgId && branchId && uid && isUuidString(uid)) {
    try {
      const scope = await resolveMinistryScope(supabaseAdmin, uid, orgId, branchId, perm.isOrgOwner);
      const rawIds = await fetchProfileMinistryScopeGroupIds(uid);
      const kind =
        scope.kind === "bypass" ? "bypass" : scope.kind === "branch_all" ? "branch_all" : "groups";
      ministry_scope = { kind, group_ids: rawIds };
    } catch {
      /* optional columns */
    }
  }
  let organization_name: string | null = null;
  if (orgId) {
    const { data: orgRow } = await supabaseAdmin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const n = orgRow && typeof (orgRow as { name?: unknown }).name === "string" ? String((orgRow as { name: string }).name).trim() : "";
    organization_name = n.length > 0 ? n : null;
  }
  return { ...base, ministry_scope, organization_name };
}

async function pushTokenForProfile(profileId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("expo_push_token")
      .eq("id", profileId)
      .maybeSingle();
    const token = String((data as { expo_push_token?: string | null } | null)?.expo_push_token || "").trim();
    if (!token || !Expo.isExpoPushToken(token)) return null;
    return token;
  } catch {
    return null;
  }
}

/** Deny platform access for suspended staff / suspended staff access group (org owners always allowed). */
async function assertStaffPlatformAccess(
  profile: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (profile.is_org_owner === true) return { ok: true };
  if (profile.is_active === false) {
    return {
      ok: false,
      code: "ACCESS_DISABLED",
      message: "Your account access has been suspended. Contact an administrator.",
    };
  }
  const profileId = typeof profile.id === "string" ? profile.id : "";
  if (!isUuidString(profileId)) return { ok: true };

  try {
    const { data: mem, error: mErr } = await supabaseAdmin
      .from("staff_profile_group_members")
      .select("group_id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (mErr || !mem) return { ok: true };
    const gid = (mem as { group_id: string }).group_id;
    const { data: grp, error: gErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("suspended")
      .eq("id", gid)
      .maybeSingle();
    if (gErr) return { ok: true };
    if (grp && (grp as { suspended?: boolean }).suspended === true) {
      return {
        ok: false,
        code: "ACCESS_SUSPENDED",
        message: "Your staff access group has been suspended. Contact an administrator.",
      };
    }
  } catch {
    /* missing tables/columns — allow access */
  }
  return { ok: true };
}

async function bootstrapAdministratorRoleIfEmpty(orgId: string): Promise<void> {
  const { data: existing, error: e1 } = await supabaseAdmin.from("roles").select("id").eq("organization_id", orgId).limit(1);
  if (e1 || (existing && existing.length > 0)) return;

  const mainBranchId = await getMainBranchIdForOrg(orgId);
  const row: Record<string, unknown> = {
    organization_id: orgId,
    name: "Administrator",
    permissions: ALL_PERMISSION_IDS,
  };
  if (mainBranchId) row.branch_id = mainBranchId;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("roles")
    .insert(row)
    .select("id")
    .single();

  if (insErr || !inserted) return;

  const adminId = (inserted as { id: string }).id;
  const { data: owners, error: ownErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_org_owner", true);

  if (!ownErr && owners && owners.length > 0) {
    for (const o of owners) {
      await supabaseAdmin.from("profiles").update({ role_id: adminId }).eq("id", (o as { id: string }).id);
    }
  }
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Temporary test route to check server routing
app.get("/api/test", (req, res) => {
  res.status(200).json({ message: "Test route working!" });
});

// Lightweight health check for platform probes (Render, Railway, Fly, etc.)
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// Helper to generate slug
// Helper to generate slug
const generateSlug = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^\w ]+/g, "")
    .replace(/ +/g, "-");
};

const PROFILE_IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_IMAGE_UPLOAD_MAX_BYTES },
});

const EVENT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const uploadEventFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVENT_FILE_MAX_BYTES },
});

const ALLOWED_EVENT_FILE_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

const MAX_ATTACHMENT_NAME_LEN = 500;

function isSafeEventFileStoragePath(p: string): boolean {
  if (!p || p.length > 600) return false;
  if (!p.startsWith("event-files/")) return false;
  if (p.includes("..") || p.includes("\\")) return false;
  const rest = p.slice("event-files/".length);
  if (!rest || rest.includes("/")) return false;
  return /^[a-zA-Z0-9._\-]+$/.test(rest);
}

function imageExtFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return "bin";
}

app.post("/api/upload-image", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Image file is too large to upload" });
      }
      return res.status(400).json({ error: (err as Error).message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const mime = (req.file.mimetype || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      return res.status(400).json({ error: "File must be an image" });
    }

    const extProbe = imageExtFromMime(mime);
    if (extProbe === "bin") {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    let buffer = req.file.buffer;
    let contentType = mime;
    let ext = extProbe;
    try {
      const compressed = await compressImageBufferForPublicUpload(buffer, mime);
      buffer = compressed.buffer;
      contentType = compressed.contentType;
      ext = compressed.fileExt;
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : "Could not process image",
      });
    }

    const safeBase = crypto.randomBytes(8).toString("hex");
    const fileName = `${Date.now()}-${safeBase}.${ext}`;
    const { data, error } = await supabaseAdmin.storage
      .from("member-images")
      .upload(`public/${fileName}`, buffer, {
        contentType,
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

const uploadNoteAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
const NOTE_AUDIO_MIMES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
]);

function audioExtFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("opus")) return "opus";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  return "bin";
}

/** Public URL in member-images bucket for voice clips on member profile notes. */
app.post("/api/upload-note-audio", uploadNoteAudio.single("file"), async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.split(" ")[1];

    const permCtx = await requireAnyPermission(req, res, ["add_member_notes", "edit_member_notes"]);
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const mime = (req.file.mimetype || "").toLowerCase();
    if (!NOTE_AUDIO_MIMES.has(mime)) {
      return res.status(400).json({ error: "Unsupported audio type for notes" });
    }

    const ext = audioExtFromMime(mime);
    if (ext === "bin") return res.status(400).json({ error: "Unsupported audio type for notes" });

    const safeBase = crypto.randomBytes(8).toString("hex");
    const path = `public/note-audio/${Date.now()}-${safeBase}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage.from("member-images").upload(path, req.file.buffer, {
      contentType: mime || "application/octet-stream",
    });
    if (upErr) throw upErr;

    const { data: publicUrlData } = supabaseAdmin.storage.from("member-images").getPublicUrl(path);
    res.json({ url: publicUrlData.publicUrl });
  } catch (error: any) {
    const errorMessage = error.message || "Internal Server Error";
    res.status(500).json({ error: errorMessage, details: error.details, code: error.code });
  }
});

app.post("/api/upload-event-file", (req, res, next) => {
  uploadEventFile.single("file")(req, res, (err) => {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 50 MB per file)" });
      }
      return res.status(400).json({ error: (err as Error).message || "Upload failed" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.split(" ")[1];
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const mime = (req.file.mimetype || "").toLowerCase();
    if (!ALLOWED_EVENT_FILE_MIMES.has(mime)) {
      return res.status(400).json({ error: "File type not allowed" });
    }

    const orig = typeof req.file.originalname === "string" ? req.file.originalname : "file";
    const safeBase = crypto.randomBytes(8).toString("hex");
    const extFromName = (() => {
      const lower = orig.toLowerCase();
      const i = lower.lastIndexOf(".");
      if (i <= 0 || i >= lower.length - 1) return "";
      const ext = lower.slice(i + 1).replace(/[^a-z0-9]/g, "");
      return ext.length > 0 && ext.length <= 12 ? ext : "";
    })();
    const ext =
      extFromName ||
      (mime === "application/pdf"
        ? "pdf"
        : mime === "application/msword"
          ? "doc"
          : mime.includes("wordprocessingml")
            ? "docx"
            : mime === "application/vnd.ms-excel"
              ? "xls"
              : mime.includes("spreadsheetml")
                ? "xlsx"
                : mime === "text/csv"
                  ? "csv"
                  : mime === "application/vnd.ms-powerpoint"
                    ? "ppt"
                    : mime.includes("presentationml")
                      ? "pptx"
                      : mime.startsWith("image/")
                        ? imageExtFromMime(mime)
                        : mime === "text/plain"
                          ? "txt"
                          : "");
    if (!ext || ext === "bin") {
      return res.status(400).json({ error: "Could not determine safe file extension" });
    }

    let uploadBuffer = req.file.buffer;
    let uploadMime = mime;
    let storageExt = ext;

    if (mime.startsWith("image/")) {
      try {
        const compressed = await compressImageBufferForPublicUpload(req.file.buffer, mime);
        uploadBuffer = compressed.buffer;
        uploadMime = compressed.contentType;
        storageExt = compressed.fileExt;
      } catch (e) {
        return res.status(400).json({
          error: e instanceof Error ? e.message : "Could not process image",
        });
      }
    }

    const fileName = `event-files/${Date.now()}-${safeBase}.${storageExt}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("member-images")
      .upload(fileName, uploadBuffer, { contentType: uploadMime || "application/octet-stream" });

    if (upErr) throw upErr;

    const uploaded_at = new Date().toISOString();
    res.json({
      storage_path: fileName,
      name: orig,
      size_bytes: uploadBuffer.length,
      content_type: uploadMime,
      uploaded_at,
    });
  } catch (error: any) {
    const errorMessage = error.message || "Internal Server Error";
    res.status(500).json({ error: errorMessage, details: error.details, code: error.code });
  }
});

app.get("/api/download-event-file", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });

    await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const pathRaw = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!isSafeEventFileStoragePath(pathRaw)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    let downloadName = typeof req.query.name === "string" ? req.query.name.trim().slice(0, MAX_ATTACHMENT_NAME_LEN) : "";
    if (!downloadName) downloadName = pathRaw.split("/").pop() || "download";

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from("member-images").download(pathRaw);
    if (dlErr || !blob) {
      return res.status(404).json({ error: "File not found" });
    }

    const buf = Buffer.from(await blob.arrayBuffer());
    const ctype =
      typeof req.query.type === "string" && req.query.type.trim()
        ? String(req.query.type).trim().slice(0, 200)
        : "application/octet-stream";
    const asciiFilename = downloadName.replace(/"/g, '\\"').replace(/[^\x20-\x7E]/g, "_");

    res.setHeader("Content-Type", ctype);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    );
    res.send(buf);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Download failed" });
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

      try {
        const lbl = `${fn} ${ln}`.trim() || "Someone";
        await notifyApproversPendingGroupJoinRequest({
          organizationId: group.organization_id as string,
          branchId: group.branch_id as string,
          groupId: group.id as string,
          requestId: String((newRequest as { id: string }).id),
          applicantLabel: lbl,
        });
      } catch {
        /* notification failure must not block join request */
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

    try {
      const lbl =
        nameRaw ||
        `${legacyFirst} ${legacyLast}`.trim() ||
        "Someone";
      await notifyApproversPendingGroupJoinRequest({
        organizationId: group.organization_id as string,
        branchId: group.branch_id as string,
        groupId: group.id as string,
        requestId: String((newRequest as { id: string }).id),
        applicantLabel: lbl,
      });
    } catch {
      /* non-fatal */
    }

    res.status(201).json(newRequest);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to submit group join request" });
  }
});

/** Last name trim + lowercase for duplicate comparison (public registration). */
function normalizeRegistrationLastNameForDup(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Same branch: block if normalized last name + DOB (YYYY-MM-DD) matches an active member
 * or another pending member request.
 */
async function checkPublicRegistrationDuplicateLastNameDob(args: {
  branchId: string;
  organizationId: string;
  lastNameRaw: unknown;
  dobRaw: unknown;
}): Promise<null | "existing_member" | "pending_request"> {
  const lastNorm = normalizeRegistrationLastNameForDup(args.lastNameRaw);
  const dobYmd = normalizeDobInput(String(args.dobRaw ?? ""));
  if (!lastNorm || !dobYmd) return null;

  const { branchId, organizationId } = args;

  const { data: memberRows, error: mErr } = await supabaseAdmin
    .from("members")
    .select("id, last_name, dob, is_deleted")
    .eq("branch_id", branchId)
    .eq("organization_id", organizationId)
    .eq("dob", dobYmd);

  if (mErr) {
    throw mErr;
  }
  for (const m of memberRows || []) {
    if ((m as { is_deleted?: boolean }).is_deleted === true) continue;
    if (normalizeRegistrationLastNameForDup((m as { last_name?: string }).last_name) === lastNorm) {
      return "existing_member";
    }
  }

  const { data: pendingReqs, error: rErr } = await supabaseAdmin
    .from("member_requests")
    .select("id, form_data")
    .eq("branch_id", branchId)
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  if (rErr) {
    throw rErr;
  }
  for (const row of pendingReqs || []) {
    const fd = (row as { form_data?: unknown }).form_data;
    if (!fd || typeof fd !== "object" || Array.isArray(fd)) continue;
    const rec = fd as Record<string, unknown>;
    const ln = normalizeRegistrationLastNameForDup(rec.lastName ?? rec.last_name);
    const dobCandidate = normalizeDobInput(
      String(rec.dateOfBirth ?? rec.date_of_birth ?? rec.dob ?? ""),
    );
    if (ln === lastNorm && dobCandidate === dobYmd) {
      return "pending_request";
    }
  }

  return null;
}

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

    const orgIdPub = branch.organization_id as string;
    const defaultCountryPub = await getOrgDefaultPhoneCountryIso(orgIdPub);
    let phonesPub: ReturnType<typeof normalizeMemberPhonesForDb>;
    try {
      phonesPub = normalizeMemberPhonesForDb(
        {
          phone: firstNonEmptyString(formData.phone, formData.phoneNumber),
          phone_country_iso:
            formData.phone_country_iso ?? formData.phoneCountryIso ?? null,
          emergency_contact_phone: firstNonEmptyString(
            formData.emergency_contact_phone,
            formData.emergencyContactPhone,
          ),
          emergency_contact_phone_country_iso:
            formData.emergency_contact_phone_country_iso ??
            formData.emergencyContactPhoneCountryIso ??
            null,
        },
        defaultCountryPub,
      );
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 400) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid phone number" });
      }
      throw e;
    }
    if (!phonesPub.phone_number) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    try {
      const dup = await checkPublicRegistrationDuplicateLastNameDob({
        branchId: branch.id as string,
        organizationId: orgIdPub,
        lastNameRaw: formData.last_name,
        dobRaw: formData.dob,
      });
      if (dup === "existing_member") {
        return res.status(409).json({
          error:
            "A member with this last name and date of birth is already registered for this church. If you need help, contact your church office.",
          code: "DUPLICATE_LASTNAME_DOB_MEMBER",
        });
      }
      if (dup === "pending_request") {
        return res.status(409).json({
          error:
            "A registration with this last name and date of birth is already pending. Please wait for a decision or contact your church office.",
          code: "DUPLICATE_LASTNAME_DOB_PENDING",
        });
      }
    } catch (dupErr: unknown) {
      const msg = dupErr instanceof Error ? dupErr.message : "Duplicate check failed";
      return res.status(500).json({ error: msg });
    }

    const now = new Date().toISOString();
    const payload = {
      organization_id: branch.organization_id,
      branch_id: branch.id,
      status: "pending",
      form_data: {
        firstName: formData.first_name,
        lastName: formData.last_name,
        email: formData.email,
        phoneNumber: phonesPub.phone_number,
        phoneCountryIso: phonesPub.phone_country_iso,
        location: formData.location,
        emergencyContactName: formData.emergency_contact_name,
        emergencyContactPhone: phonesPub.emergency_contact_phone,
        emergencyContactPhoneCountryIso: phonesPub.emergency_contact_phone_country_iso,
        dateOfBirth: formData.dob,
        gender: normalizeBinaryGender(formData.gender, "lower") ?? "",
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

    try {
      const fn = String(formData.first_name ?? "").trim();
      const ln = String(formData.last_name ?? "").trim();
      const namePart = `${fn} ${ln}`.trim();
      /** No email in notification body (privacy); full details remain on the request record. */
      const applicantSummary = namePart
        ? `${namePart} submitted a registration request.`
        : "Someone submitted a registration request.";
      await notifyApproversPendingMemberJoinRequest({
        organizationId: orgIdPub,
        branchId: branch.id as string,
        requestId: String((data as { id: string }).id),
        applicantSummary,
      });
    } catch {
      /* non-fatal */
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
  const tierRaw = typeof req.body?.subscriptionTier === "string" ? req.body.subscriptionTier : "free";
  const subscriptionTier = normalizeSubscriptionTier(tierRaw);
  const demoBypass = req.body?.demoBypass === true;
  const isPaidTier = subscriptionTier !== "free";

  if (demoBypass && !isDemoPaymentBypassEnabled()) {
    return res.status(403).json({ error: "Demo payment bypass is disabled." });
  }
  if (isPaidTier && !demoBypass) {
    return res.status(402).json({
      error:
        "Paid plan setup requires Hubtel payment. Hubtel integration is pending approval, so use demo bypass for now.",
    });
  }

  try {
    // 1. Create User in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: shouldAutoConfirmAuthEmail(),
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
          subscription_tier: subscriptionTier,
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

    // 4. Seed Administrator role + create org owner profile
    const nameParts = (fullName || "User").split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "User";

    const { data: adminRoleIns, error: adminRoleErr } = await supabaseAdmin
      .from("roles")
      .insert({
        organization_id: org.id,
        name: "Administrator",
        permissions: ALL_PERMISSION_IDS,
      })
      .select("id")
      .single();

    const adminRoleId = !adminRoleErr && adminRoleIns ? (adminRoleIns as { id: string }).id : null;

    const profileInsert: Record<string, unknown> = {
      id: userId,
      email: email,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      organization_id: org.id,
      branch_id: branch.id,
      is_org_owner: true,
    };
    if (adminRoleId) profileInsert.role_id = adminRoleId;

    const { data: userProfile, error: userError } = await supabaseAdmin
      .from("profiles")
      .insert([profileInsert])
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

    const permRow = await permissionSetForProfileRow(userProfile as typeof userProfile & { is_org_owner?: boolean | null; role_id?: string | null });
    const userPayload = await buildUserAuthPayloadWithMemberAvatar(userProfile as Record<string, unknown>, permRow);

    if (signInError) {
      // If sign-in fails, we still created the user, but we can't give them a session easily
      // Let's return a 201 but without a token, the client will have to log in manually
      return res.status(201).json({ 
        message: "User created successfully, but automatic sign-in failed. Please sign in manually.",
        user: userPayload,
      });
    }

    res.status(201).json({
      token: signInData?.session?.access_token,
      refresh_token: signInData?.session?.refresh_token,
      user: userPayload,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!emailRaw) {
    return res.status(400).json({ error: "Email is required." });
  }

  const genericMessage =
    "If your account exists, we sent a password reset link. The link expires in 15 minutes.";

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .ilike("email", emailRaw)
      .limit(1)
      .maybeSingle();

    if (!profile) {
      return res.json({ message: genericMessage });
    }

    const resetSecret = passwordResetSecret();
    if (!resetSecret) {
      console.warn("[auth] PASSWORD_RESET_SECRET missing; skipping forgot-password email send.");
      return res.json({ message: genericMessage });
    }

    const userId = String((profile as { id?: string }).id || "").trim();
    const userEmail = String((profile as { email?: string }).email || "").trim();
    if (!userId || !userEmail) {
      return res.json({ message: genericMessage });
    }

    const token = jwt.sign(
      { sub: userId, email: userEmail, purpose: "password_reset" } satisfies PasswordResetTokenPayload,
      resetSecret,
      { expiresIn: `${PASSWORD_RESET_EXPIRES_MINUTES}m` },
    );
    const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    const name = String((profile as { full_name?: string }).full_name || "there").trim() || "there";

    try {
      await sendBrevoEmail({
        toEmail: userEmail,
        toName: name,
        subject: "Reset your SheepMug password",
        htmlContent: `<p>Hello ${name},</p>
<p>Use the link below to reset your SheepMug password.</p>
<p><a href="${resetUrl}">Reset password</a></p>
<p>This link expires in ${PASSWORD_RESET_EXPIRES_MINUTES} minutes.</p>
<p>If you did not request this, you can ignore this email.</p>`,
        textContent: `Hello ${name},\n\nReset your SheepMug password using this link:\n${resetUrl}\n\nThis link expires in ${PASSWORD_RESET_EXPIRES_MINUTES} minutes.\nIf you did not request this, ignore this email.`,
      });
    } catch (e: unknown) {
      console.error("[auth] forgot-password email send failed:", e);
    }

    return res.json({ message: genericMessage });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new_password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const resetSecret = passwordResetSecret();
  if (!resetSecret) {
    return res.status(500).json({ error: "Password reset is not configured." });
  }

  try {
    const decoded = jwt.verify(token, resetSecret) as PasswordResetTokenPayload & { exp?: number };
    if (!decoded || decoded.purpose !== "password_reset" || !decoded.sub || !decoded.email) {
      return res.status(400).json({ error: "Invalid reset token." });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .eq("id", decoded.sub)
      .maybeSingle();
    if (!profile) {
      return res.status(400).json({ error: "Invalid reset token." });
    }

    const profileEmail = String((profile as { email?: string }).email || "").trim().toLowerCase();
    if (!profileEmail || profileEmail !== decoded.email.toLowerCase()) {
      return res.status(400).json({ error: "Invalid reset token." });
    }

    const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(decoded.sub, {
      password: newPassword,
    });
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr.message || "Failed to update password." });
    }

    return res.json({ ok: true });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (/jwt/i.test(msg) || /token/i.test(msg)) {
      return res.status(400).json({ error: "Reset link is invalid or expired." });
    }
    return res.status(500).json({ error: "Internal server error" });
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
    const refreshToken = authData.session.refresh_token;
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

    const prof = profileData as Record<string, unknown> & { is_org_owner?: boolean | null };
    const access = await assertStaffPlatformAccess(prof);
    if (!access.ok) {
      return res.status(403).json({ error: access.message, code: access.code });
    }
    const permRow = await permissionSetForProfileRow(prof);
    const userPayload = await buildUserAuthPayloadWithMemberAvatar(prof, permRow);

    res.json({
      token,
      refresh_token: refreshToken,
      user: userPayload,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  const refreshTokenRaw = typeof req.body?.refresh_token === "string" ? req.body.refresh_token.trim() : "";
  if (!refreshTokenRaw) {
    return res.status(400).json({ error: "refresh_token is required" });
  }

  try {
    const supabaseAnon = getSupabaseClient();
    const { data: refreshData, error: refreshError } = await supabaseAnon.auth.refreshSession({
      refresh_token: refreshTokenRaw,
    });
    if (refreshError || !refreshData.session || !refreshData.user) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const profRes = await supabaseAdmin.from("profiles").select("*").eq("id", refreshData.user.id).single();
    let profileData = profRes.data;
    let profileError = profRes.error;
    if (profileError && String(profileError.message || "").toLowerCase().includes("is_org_owner")) {
      const fallback = await supabaseAdmin.from("profiles").select("*").eq("id", refreshData.user.id).single();
      profileData = fallback.data;
      profileError = fallback.error;
    }
    if (profileError || !profileData) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const prof = profileData as Record<string, unknown> & { is_org_owner?: boolean | null };
    const access = await assertStaffPlatformAccess(prof);
    if (!access.ok) {
      return res.status(403).json({ error: access.message, code: access.code });
    }

    const permRow = await permissionSetForProfileRow(prof);
    res.json({
      token: refreshData.session.access_token,
      refresh_token: refreshData.session.refresh_token || refreshTokenRaw,
      user: await buildUserAuthPayloadWithMemberAvatar(prof, permRow),
    });
  } catch (error: any) {
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    let { data: profileData, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError && String(profileError.message || "").toLowerCase().includes("is_org_owner")) {
      const r2 = await supabaseAdmin.from("profiles").select("*").eq("id", user.id).single();
      profileData = r2.data as typeof profileData;
      profileError = r2.error;
    }

    if (profileError || !profileData) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const prof = profileData as typeof profileData & { is_org_owner?: boolean | null };
    const access = await assertStaffPlatformAccess(prof as Record<string, unknown>);
    if (!access.ok) {
      return res.status(403).json({ error: access.message, code: access.code });
    }
    const permRow = await permissionSetForProfileRow(prof);
    res.json({ user: await buildUserAuthPayloadWithMemberAvatar(prof as Record<string, unknown>, permRow) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/auth/complete-cms-onboarding", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ cms_onboarding_completed_at: nowIso })
      .eq("id", user.id);
    if (upErr) {
      const msg = String(upErr.message || "").toLowerCase();
      if (msg.includes("column") && msg.includes("cms_onboarding")) {
        return res.status(503).json({
          error: "Database migration required: run migrations/profiles_cms_onboarding.sql",
        });
      }
      return res.status(500).json({ error: upErr.message || "Could not update profile" });
    }

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (profileError || !profileData) {
      return res.status(404).json({ error: "User profile not found" });
    }
    const prof = profileData as Record<string, unknown> & { is_org_owner?: boolean | null };
    const access = await assertStaffPlatformAccess(prof);
    if (!access.ok) {
      return res.status(403).json({ error: access.message, code: access.code });
    }
    const permRow = await permissionSetForProfileRow(prof);
    res.json({ user: await buildUserAuthPayloadWithMemberAvatar(prof, permRow) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.get("/api/notifications", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 40;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 40;
    const offsetRaw = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const unreadOnly = String(req.query.unread_only || "").toLowerCase() === "true";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    let q = supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (unreadOnly) q = q.is("read_at", null);
    if (category) q = q.eq("category", category);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ notifications: data || [], total_count: count ?? (data || []).length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load notifications" });
  }
});

app.get("/api/notifications/unread-count", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    let q = supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId)
      .is("read_at", null);
    const { count, error } = await q;
    if (error) throw error;
    res.json({ unread_count: count || 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load unread count" });
  }
});

app.post("/api/profile/push-token", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return res.status(401).json({ error: "Invalid token" });
    const raw = typeof req.body?.push_token === "string" ? req.body.push_token.trim() : "";
    if (!raw) return res.status(400).json({ error: "push_token is required" });
    if (!Expo.isExpoPushToken(raw)) return res.status(400).json({ error: "Invalid Expo push token" });
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ expo_push_token: raw })
      .eq("id", authData.user.id);
    if (upErr) throw upErr;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save push token" });
  }
});

app.patch("/api/notifications/read-all", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const now = new Date().toISOString();
    let q = supabaseAdmin
      .from("notifications")
      .update({ read_at: now, updated_at: now })
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId)
      .is("read_at", null);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to mark all as read" });
  }
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid notification id" });
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const now = new Date().toISOString();
    let q = supabaseAdmin
      .from("notifications")
      .update({ read_at: now, updated_at: now })
      .eq("id", id)
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to mark read" });
  }
});

app.delete("/api/notifications/clear-all", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    let q = supabaseAdmin
      .from("notifications")
      .delete()
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to clear all notifications" });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid notification id" });
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    let q = supabaseAdmin
      .from("notifications")
      .delete()
      .eq("id", id)
      .eq("recipient_profile_id", ctx.userId)
      .eq("organization_id", ctx.orgId);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete notification" });
  }
});

app.get("/api/notification-preferences/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const pref = await ensureNotificationPreferences(ctx.userId, ctx.orgId, ctx.branchId);
    res.json({ preferences: pref });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load preferences" });
  }
});

app.patch("/api/notification-preferences/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const allowKeys = [
      "mute_all",
      "tasks_enabled",
      "attendance_enabled",
      "events_enabled",
      "requests_enabled",
      "assignments_enabled",
      "permissions_enabled",
      "member_care_enabled",
      "leader_updates_enabled",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const k of allowKeys) {
      if (typeof body[k] === "boolean") patch[k] = body[k];
    }
    if (body.granular_preferences && typeof body.granular_preferences === "object" && !Array.isArray(body.granular_preferences)) {
      const incoming = body.granular_preferences as Record<string, unknown>;
      const normalized: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (typeof v === "boolean" && k.trim()) normalized[k.trim()] = v;
      }
      const { data: existingPref } = await supabaseAdmin
        .from("notification_preferences")
        .select("granular_preferences")
        .eq("profile_id", ctx.userId)
        .maybeSingle();
      const current =
        existingPref &&
        typeof (existingPref as { granular_preferences?: unknown }).granular_preferences === "object" &&
        !Array.isArray((existingPref as { granular_preferences?: unknown }).granular_preferences)
          ? ((existingPref as { granular_preferences: Record<string, unknown> }).granular_preferences as Record<string, unknown>)
          : {};
      patch.granular_preferences = {
        ...Object.fromEntries(Object.entries(current).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>,
        ...normalized,
      };
    }
    patch.updated_at = new Date().toISOString();
    const basePayload: Record<string, unknown> = {
      profile_id: ctx.userId,
      organization_id: ctx.orgId,
      branch_id: ctx.branchId,
      ...NOTIFICATION_PREF_DEFAULTS,
      ...patch,
    };
    let { data, error } = await supabaseAdmin
      .from("notification_preferences")
      .upsert(basePayload, { onConflict: "profile_id" })
      .select("*")
      .single();
    if (error && String(error.message || "").toLowerCase().includes("granular_preferences")) {
      const fallback = { ...basePayload };
      delete fallback.granular_preferences;
      const r2 = await supabaseAdmin
        .from("notification_preferences")
        .upsert(fallback, { onConflict: "profile_id" })
        .select("*")
        .single();
      data = r2.data;
      error = r2.error;
    }
    if (error) throw error;
    res.json({ preferences: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save preferences" });
  }
});

app.get("/api/notifications/test-types", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const allowed = ctx.isOrgOwner || ctx.permissionSet.has("configure_notifications");
    if (!allowed) return res.status(403).json({ error: "Missing permission to access notification QA." });
    const types = Object.entries(NOTIFICATION_TEST_TYPE_META).map(([type, meta]) => ({
      type,
      category: meta.category,
      severity: meta.severity,
      title: meta.title,
      message: meta.message,
      entity_type: meta.entity_type,
      action_path: meta.action_path,
    }));
    res.json({ types });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load notification test types" });
  }
});

app.post("/api/notifications/test-send", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const allowed =
      ctx.isOrgOwner ||
      ctx.permissionSet.has("send_notifications") ||
      ctx.permissionSet.has("configure_notifications");
    if (!allowed) return res.status(403).json({ error: "Missing permission to send notification tests." });

    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const type = String(body.type || "").trim() as NotificationTestType;
    const recipientProfileId = String(body.recipient_profile_id || "").trim();
    const actorProfileId = String(body.actor_profile_id || "").trim();
    if (!type || !(type in NOTIFICATION_TEST_TYPE_META)) {
      return res.status(400).json({ error: "Invalid notification type" });
    }
    if (!isUuidString(recipientProfileId)) {
      return res.status(400).json({ error: "Invalid recipient_profile_id" });
    }

    const { data: recipient } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, branch_id")
      .eq("id", recipientProfileId)
      .maybeSingle();
    if (!recipient) return res.status(404).json({ error: "Recipient profile not found" });
    if (String((recipient as { organization_id?: string }).organization_id || "") !== ctx.orgId) {
      return res.status(403).json({ error: "Recipient is outside your organization." });
    }

    let actorName = "Admin";
    if (isUuidString(actorProfileId)) {
      const { data: actor } = await supabaseAdmin
        .from("profiles")
        .select("id, organization_id, first_name, last_name")
        .eq("id", actorProfileId)
        .maybeSingle();
      if (actor && String((actor as { organization_id?: string }).organization_id || "") === ctx.orgId) {
        const first = String((actor as { first_name?: string }).first_name || "").trim();
        const last = String((actor as { last_name?: string }).last_name || "").trim();
        const full = `${first} ${last}`.trim();
        if (full) actorName = full;
      }
    }

    const meta = NOTIFICATION_TEST_TYPE_META[type];
    const now = Date.now();
    const forceRetest = body.force === true || body.force === "true";
    const syntheticEntityId = isUuidString(String(body.entity_id || "")) ? String(body.entity_id) : null;
    const actionPath =
      typeof body.action_path === "string" && body.action_path.trim().length > 0
        ? body.action_path.trim()
        : meta.action_path;
    const qaRich = await buildNotificationQaRichPayload({
      organizationId: ctx.orgId,
      type,
      actionPath,
      syntheticEntityId,
    });
    const payload: Record<string, unknown> = {
      test_mode: true,
      test_type: type,
      actor_profile_id: isUuidString(actorProfileId) ? actorProfileId : ctx.userId,
      actor_name: actorName,
      requested_by_profile_id: ctx.userId,
      qa_run_at: new Date(now).toISOString(),
      ...qaRich,
    };

    let notifTitle = `${meta.title} (QA)`;
    let notifMessage = `${meta.message} Triggered by ${actorName}.`;
    const evDisp = String(qaRich.event_display_name || "").trim();
    const memDisp = String(qaRich.member_display_name || "").trim();
    const taskT = String(qaRich.task_title || "").trim();
    const grpDisp = String(qaRich.group_display_name || "").trim();
    if (evDisp) {
      notifTitle = `${meta.title}: ${evDisp} (QA)`;
      notifMessage = `${meta.message} Event: ${evDisp}. Triggered by ${actorName}.`;
    } else if (taskT) {
      notifTitle = `${meta.title}: ${taskT} (QA)`;
      notifMessage = `${taskT}. ${meta.message} Triggered by ${actorName}.`;
    } else if (grpDisp && memDisp) {
      notifTitle = `${meta.title}: ${memDisp} → ${grpDisp} (QA)`;
      notifMessage = `${memDisp} · ${grpDisp}. ${meta.message} Triggered by ${actorName}.`;
    } else if (memDisp) {
      notifTitle = `${meta.title}: ${memDisp} (QA)`;
      notifMessage = `${meta.message} ${memDisp}. Triggered by ${actorName}.`;
    }

    const qaDedupeKey = forceRetest
      ? `qa_${ctx.userId}_${recipientProfileId}_${type}_force_${now}`
      : `qa_${ctx.userId}_${recipientProfileId}_${type}`;

    const inserted = await createNotification({
      organization_id: ctx.orgId,
      branch_id: (recipient as { branch_id?: string | null }).branch_id ?? null,
      recipient_profile_id: recipientProfileId,
      type,
      category: meta.category,
      title: notifTitle,
      message: notifMessage,
      severity: meta.severity,
      entity_type: meta.entity_type,
      entity_id: syntheticEntityId,
      action_path: actionPath,
      payload,
      dedupe_key: qaDedupeKey,
      dedupe_window_minutes: forceRetest ? 1 : 60,
    });

    res.json({
      ok: true,
      inserted,
      skipped: inserted ? undefined : "deduped_or_muted",
      delivered: inserted,
      status: inserted ? "delivered" : "skipped_duplicate_or_muted",
      notification: {
        type,
        category: meta.category,
        title: notifTitle,
        message: notifMessage,
        action_path: actionPath,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to send test notification" });
  }
});

app.get("/api/notifications/test-preview", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const allowed = ctx.isOrgOwner || ctx.permissionSet.has("configure_notifications");
    if (!allowed) return res.status(403).json({ error: "Missing permission to access notification QA." });
    const recipientProfileId = String(req.query.recipient_profile_id || "").trim();
    if (!isUuidString(recipientProfileId)) return res.status(400).json({ error: "Invalid recipient_profile_id" });

    const { data: recipient } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", recipientProfileId)
      .maybeSingle();
    if (!recipient) return res.status(404).json({ error: "Recipient profile not found" });
    if (String((recipient as { organization_id?: string }).organization_id || "") !== ctx.orgId) {
      return res.status(403).json({ error: "Recipient is outside your organization." });
    }

    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 25;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 25;
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("recipient_profile_id", recipientProfileId)
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json({ notifications: data || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load recipient notifications" });
  }
});

app.get("/api/notifications/test-preview/unread-count", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await getActorAuthContextFromToken(token);
    if (!ctx) return res.status(401).json({ error: "Unauthorized" });
    const allowed = ctx.isOrgOwner || ctx.permissionSet.has("configure_notifications");
    if (!allowed) return res.status(403).json({ error: "Missing permission to access notification QA." });
    const recipientProfileId = String(req.query.recipient_profile_id || "").trim();
    if (!isUuidString(recipientProfileId)) return res.status(400).json({ error: "Invalid recipient_profile_id" });

    const { data: recipient } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", recipientProfileId)
      .maybeSingle();
    if (!recipient) return res.status(404).json({ error: "Recipient profile not found" });
    if (String((recipient as { organization_id?: string }).organization_id || "") !== ctx.orgId) {
      return res.status(403).json({ error: "Recipient is outside your organization." });
    }

    const { count, error } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_profile_id", recipientProfileId)
      .eq("organization_id", ctx.orgId)
      .is("read_at", null);
    if (error) throw error;
    res.json({ unread_count: count || 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load recipient unread count" });
  }
});

app.patch("/api/auth/profile", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const body = req.body || {};
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (exErr || !existing) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const ex = existing as Record<string, unknown>;
    const photoRequested = body.profile_image !== undefined;

    if (photoRequested) {
      let url: string | null;
      if (body.profile_image === null || body.profile_image === "") {
        url = null;
      } else if (typeof body.profile_image === "string") {
        url = body.profile_image.trim() || null;
      } else {
        return res.status(400).json({ error: "Invalid profile_image" });
      }

      const linked = await findLinkedMemberForStaffProfile(ex);
      try {
        if (linked) {
          await updateMemberPrimaryPhoto(String((linked as { id: string }).id), url);
        } else {
          await updateStaffProfileAvatarOnProfileRow(user.id, url);
        }
      } catch (pe: unknown) {
        const msg = pe instanceof Error ? pe.message : "Failed to update profile photo";
        return res.status(500).json({ error: msg });
      }
    }

    const patch: Record<string, unknown> = {};

    if (body.first_name !== undefined) {
      if (typeof body.first_name !== "string" || !body.first_name.trim()) {
        return res.status(400).json({ error: "First name is required" });
      }
      patch.first_name = body.first_name.trim();
    }
    if (body.last_name !== undefined) {
      if (typeof body.last_name !== "string" || !body.last_name.trim()) {
        return res.status(400).json({ error: "Last name is required" });
      }
      patch.last_name = body.last_name.trim();
    }

    let emailNext: string | undefined;
    if (body.email !== undefined) {
      if (typeof body.email !== "string") {
        return res.status(400).json({ error: "Invalid email" });
      }
      const e = body.email.trim().toLowerCase();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      emailNext = e;
    }

    if (Object.keys(patch).length === 0 && emailNext === undefined && !photoRequested) {
      return res.status(400).json({ error: "No changes provided" });
    }

    if (patch.first_name !== undefined || patch.last_name !== undefined) {
      const fn = (patch.first_name !== undefined ? patch.first_name : ex.first_name) as string;
      const ln = (patch.last_name !== undefined ? patch.last_name : ex.last_name) as string;
      patch.full_name = `${String(fn || "").trim()} ${String(ln || "").trim()}`.trim();
    }

    if (emailNext !== undefined) {
      const cur = String(ex.email || "").toLowerCase();
      if (emailNext !== cur) {
        const { error: auErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
          email: emailNext,
        });
        if (auErr) {
          return res.status(400).json({ error: auErr.message || "Could not update email" });
        }
        patch.email = emailNext;
      }
    }

    let profileRow: Record<string, unknown> = ex;
    if (Object.keys(patch).length > 0) {
      const { data: updated, error: upErr } = await supabaseAdmin
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select("*")
        .single();

      if (upErr) {
        return res.status(500).json({ error: upErr.message || "Failed to update profile" });
      }
      profileRow = updated as Record<string, unknown>;
    } else if (photoRequested) {
      const { data: refreshed, error: refErr } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!refErr && refreshed) {
        profileRow = refreshed as Record<string, unknown>;
      }
    }

    const permRow = await permissionSetForProfileRow(
      profileRow as typeof existing & { is_org_owner?: boolean | null },
    );
    res.json({ user: await buildUserAuthPayloadWithMemberAvatar(profileRow, permRow) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/auth/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const current_password =
      typeof req.body?.current_password === "string" ? req.body.current_password : "";
    const new_password = typeof req.body?.new_password === "string" ? req.body.new_password : "";
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .single();

    if (pErr || !prof) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const email = String((prof as { email?: string }).email || "").trim();
    if (!email) {
      return res.status(400).json({ error: "Account email missing" });
    }

    const supabaseAnon = getSupabaseClient();
    const { error: signErr } = await supabaseAnon.auth.signInWithPassword({
      email,
      password: current_password,
    });
    if (signErr) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: new_password,
    });
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr.message || "Failed to update password" });
    }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

/** Current organization (tenant-scoped); any member of the org may read. */
app.get("/api/org/organization", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")?.[1];
  const ctx = await getActorAuthContextFromToken(token);
  if (!ctx) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { data: org, error } = await supabaseAdmin.from("organizations").select("*").eq("id", ctx.orgId).maybeSingle();
    if (error) throw error;
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json({ organization: org });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load organization" });
  }
});

/** Update organization display name (owners bypass; requires edit_organization_name). */
app.patch("/api/org/organization", async (req, res) => {
  const ctx = await requireAnyPermission(req, res, ["edit_organization_name"]);
  if (!ctx) return;
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) {
    return res.status(400).json({ error: "name must be between 1 and 200 characters" });
  }
  try {
    const { data: updated, error } = await supabaseAdmin
      .from("organizations")
      .update({ name })
      .eq("id", ctx.orgId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ organization: updated });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update organization" });
  }
});

app.get("/api/org/roles", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await requirePermission(req, res, "view_roles");
    if (!ctx) return;

    await bootstrapAdministratorRoleIfEmpty(ctx.orgId);

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: rows, error } = await supabaseAdmin
      .from("roles")
      .select("id, organization_id, name, permissions, branch_id, created_at, updated_at")
      .eq("organization_id", ctx.orgId)
      .order("name", { ascending: true });

    if (error) throw error;
    const scoped = filterRowsByBranchScope(
      (rows || []) as { branch_id?: string | null }[],
      viewerBranch,
      mainBranchId,
    );
    res.json({ roles: scoped });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load roles" });
  }
});

app.post("/api/org/roles", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  try {
    const ctx = await requirePermission(req, res, "add_roles");
    if (!ctx) return;

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Role name is required" });
    const rawIds = Array.isArray(body.permission_ids) ? body.permission_ids : [];
    const permission_ids = validatePermissionIds(rawIds.filter((x: unknown) => typeof x === "string") as string[]);

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);

    const { data: inserted, error } = await supabaseAdmin
      .from("roles")
      .insert({
        organization_id: ctx.orgId,
        branch_id: viewerBranch,
        name,
        permissions: permission_ids,
      })
      .select("id, organization_id, name, permissions, branch_id, created_at, updated_at")
      .single();

    if (error) throw error;
    res.status(201).json({ role: inserted });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to create role" });
  }
});

app.patch("/api/org/roles/:roleId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { roleId } = req.params;
  if (!isUuidString(roleId)) return res.status(400).json({ error: "Invalid role id" });
  try {
    const ctx = await requirePermission(req, res, "edit_roles");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("roles")
      .select("id, organization_id, branch_id")
      .eq("id", roleId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Role not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (Array.isArray(body.permission_ids)) {
      patch.permissions = validatePermissionIds(body.permission_ids.filter((x: unknown) => typeof x === "string") as string[]);
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("roles")
      .update(patch)
      .eq("id", roleId)
      .select("id, organization_id, name, permissions, branch_id, created_at, updated_at")
      .single();

    if (upErr) throw upErr;
    res.json({ role: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update role" });
  }
});

app.delete("/api/org/roles/:roleId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { roleId } = req.params;
  if (!isUuidString(roleId)) return res.status(400).json({ error: "Invalid role id" });
  try {
    const ctx = await requirePermission(req, res, "delete_roles");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("roles")
      .select("id, organization_id, name, branch_id")
      .eq("id", roleId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Role not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { count, error: cErr } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("organization_id", ctx.orgId);
    if (cErr) throw cErr;
    if (count && count > 0) {
      return res.status(409).json({
        error: "This role is assigned to one or more users. Reassign them before deleting the role.",
      });
    }

    const { count: groupRoleCount, error: grErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("organization_id", ctx.orgId);
    if (grErr && !String(grErr.message || "").toLowerCase().includes("does not exist")) throw grErr;
    if (groupRoleCount && groupRoleCount > 0) {
      return res.status(409).json({
        error:
          "This role is assigned to a staff access group. Change the group’s role or delete the group first.",
      });
    }

    const { error: delErr } = await supabaseAdmin.from("roles").delete().eq("id", roleId);
    if (delErr) throw delErr;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete role" });
  }
});

app.patch("/api/org/staff/:profileId/role", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { profileId } = req.params;
  if (!isUuidString(profileId)) return res.status(400).json({ error: "Invalid profile id" });
  try {
    const ctx = await requirePermission(req, res, "assign_staff_roles");
    if (!ctx) return;

    const body = req.body || {};
    const roleIdRaw = body.role_id;
    const role_id =
      roleIdRaw === null || roleIdRaw === ""
        ? null
        : typeof roleIdRaw === "string" && isUuidString(roleIdRaw)
          ? roleIdRaw
          : undefined;
    if (role_id === undefined && roleIdRaw !== null && roleIdRaw !== "") {
      return res.status(400).json({ error: "Invalid role_id" });
    }

    if (role_id) {
      const { data: roleRow } = await supabaseAdmin
        .from("roles")
        .select("id, organization_id")
        .eq("id", role_id)
        .maybeSingle();
      if (!roleRow || (roleRow as { organization_id: string }).organization_id !== ctx.orgId) {
        return res.status(400).json({ error: "Role not in your organization" });
      }
    }

    const { data: target, error: tErr } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, is_org_owner")
      .eq("id", profileId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target || (target as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "User not found in organization" });
    }
    if ((target as { is_org_owner?: boolean }).is_org_owner) {
      return res.status(403).json({ error: "Cannot change role for the organization owner" });
    }

    const { data: updated, error: uErr } = await supabaseAdmin
      .from("profiles")
      .update({ role_id })
      .eq("id", profileId)
      .select("id, email, first_name, last_name, branch_id, role_id, created_at")
      .single();

    if (uErr) throw uErr;

    const { error: ungroupErr } = await supabaseAdmin.from("staff_profile_group_members").delete().eq("profile_id", profileId);
    if (ungroupErr && !String(ungroupErr.message || "").toLowerCase().includes("does not exist")) {
      console.warn("staff_profile_group_members delete after manual role:", ungroupErr.message);
    }

    res.json({ staff: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update role" });
  }
});

/** Suspend or restore platform access for a staff profile (profiles.is_active). Org owner cannot be changed. */
app.patch("/api/org/staff/:profileId/access", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { profileId } = req.params;
  if (!isUuidString(profileId)) return res.status(400).json({ error: "Invalid profile id" });
  try {
    const ctx = await requirePermission(req, res, "edit_staff_access");
    if (!ctx) return;

    const body = req.body || {};
    const activeRaw = body.is_active;
    const is_active =
      activeRaw === true || activeRaw === "true" || activeRaw === 1
        ? true
        : activeRaw === false || activeRaw === "false" || activeRaw === 0
          ? false
          : undefined;
    if (is_active === undefined) return res.status(400).json({ error: "is_active must be true or false" });

    const { data: target, error: tErr } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, is_org_owner")
      .eq("id", profileId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target || (target as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "User not found in organization" });
    }
    if ((target as { is_org_owner?: boolean }).is_org_owner) {
      return res.status(403).json({ error: "Cannot change access for the organization owner" });
    }

    const { data: updated, error: uErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_active })
      .eq("id", profileId)
      .select("id, email, first_name, last_name, branch_id, role_id, is_org_owner, is_active, created_at")
      .single();

    if (uErr) throw uErr;
    const permPayload: Record<string, unknown> = {
      is_active,
      ...(await fetchProfileAvatarPayload(profileId, ctx.orgId)),
    };
    await createNotificationsForRecipients([profileId], {
      organization_id: ctx.orgId,
      branch_id: ctx.branchId,
      type: "permission_updated",
      category: "permissions",
      title: "Access updated",
      message: `Your access was ${is_active ? "enabled" : "disabled"} by an administrator.`,
      severity: "high",
      entity_type: "profile",
      entity_id: profileId,
      action_path: "/profile",
      payload: permPayload,
    });
    res.json({ staff: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update access" });
  }
});

/** Named staff access groups (bulk role assignment; not ministry groups). */
app.get("/api/org/staff-profile-groups", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const ctx = await requirePermission(req, res, "view_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: rows, error } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id, name, role_id, suspended, created_at, updated_at")
      .eq("organization_id", ctx.orgId)
      .order("name", { ascending: true });

    if (error) throw error;
    const scoped = filterRowsByBranchScope(
      (rows || []) as { branch_id?: string | null }[],
      viewerBranch,
      mainBranchId,
    );

    const { data: memberRows, error: mErr } = await supabaseAdmin
      .from("staff_profile_group_members")
      .select("group_id, profile_id");
    if (mErr) throw mErr;

    const membersByGroup = new Map<string, string[]>();
    for (const r of memberRows || []) {
      const g = (r as { group_id: string; profile_id: string }).group_id;
      const p = (r as { group_id: string; profile_id: string }).profile_id;
      if (!membersByGroup.has(g)) membersByGroup.set(g, []);
      membersByGroup.get(g)!.push(p);
    }

    const allProfileIds = new Set<string>();
    for (const ids of membersByGroup.values()) for (const id of ids) allProfileIds.add(id);
    let profileInfo = new Map<string, { email: string | null; first_name: string | null; last_name: string | null }>();
    if (allProfileIds.size > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email, first_name, last_name")
        .eq("organization_id", ctx.orgId)
        .in("id", [...allProfileIds]);
      for (const p of profs || []) {
        const row = p as { id: string; email: string | null; first_name: string | null; last_name: string | null };
        profileInfo.set(row.id, { email: row.email, first_name: row.first_name, last_name: row.last_name });
      }
    }

    const groups = scoped.map((g) => {
      const row = g as {
        id: string;
        name: string;
        role_id: string | null;
        suspended?: boolean | null;
        branch_id?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      };
      const pids = membersByGroup.get(row.id) || [];
      const members = pids.map((pid) => ({
        profile_id: pid,
        ...(profileInfo.get(pid) || { email: null, first_name: null, last_name: null }),
      }));
      return {
        id: row.id,
        name: row.name,
        role_id: row.role_id,
        suspended: row.suspended === true,
        branch_id: row.branch_id ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        member_count: members.length,
        members,
      };
    });

    res.json({ groups });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.toLowerCase().includes("staff_profile_groups") && msg.toLowerCase().includes("does not exist")) {
      return res.status(503).json({
        error: "Staff access groups are not set up yet. Run migrations/staff_profile_groups.sql on the database.",
      });
    }
    res.status(500).json({ error: error.message || "Failed to load staff profile groups" });
  }
});

app.post("/api/org/staff-profile-groups", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  try {
    const ctx = await requirePermission(req, res, "add_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    const roleIdRaw = body.role_id;
    const role_id =
      typeof roleIdRaw === "string" && isUuidString(roleIdRaw)
        ? roleIdRaw
        : roleIdRaw === null || roleIdRaw === ""
          ? null
          : undefined;
    if (role_id === undefined && roleIdRaw != null && roleIdRaw !== "") {
      return res.status(400).json({ error: "Invalid role_id" });
    }
    if (role_id) {
      const { data: roleRow } = await supabaseAdmin
        .from("roles")
        .select("id, organization_id")
        .eq("id", role_id)
        .maybeSingle();
      if (!roleRow || (roleRow as { organization_id: string }).organization_id !== ctx.orgId) {
        return res.status(400).json({ error: "Role not in your organization" });
      }
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("staff_profile_groups")
      .insert({
        organization_id: ctx.orgId,
        branch_id: viewerBranch,
        name,
        role_id,
      })
      .select("id, organization_id, branch_id, name, role_id, suspended, created_at, updated_at")
      .single();

    if (error) throw error;
    res.status(201).json({ group: { ...inserted, member_count: 0, members: [] } });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.toLowerCase().includes("staff_profile_groups") && msg.toLowerCase().includes("does not exist")) {
      return res.status(503).json({
        error: "Staff access groups are not set up yet. Run migrations/staff_profile_groups.sql on the database.",
      });
    }
    res.status(500).json({ error: error.message || "Failed to create staff profile group" });
  }
});

app.patch("/api/org/staff-profile-groups/:groupId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    const ctx = await requirePermission(req, res, "edit_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id, name, role_id")
      .eq("id", groupId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Group not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const roleIdRaw = body.role_id;
    const role_id =
      roleIdRaw === undefined
        ? undefined
        : roleIdRaw === null || roleIdRaw === ""
          ? null
          : typeof roleIdRaw === "string" && isUuidString(roleIdRaw)
            ? roleIdRaw
            : "__bad__";
    if (role_id === "__bad__") return res.status(400).json({ error: "Invalid role_id" });

    const suspendedRaw = body.suspended;
    const suspended =
      suspendedRaw === undefined
        ? undefined
        : suspendedRaw === true || suspendedRaw === "true" || suspendedRaw === 1
          ? true
          : suspendedRaw === false || suspendedRaw === "false" || suspendedRaw === 0
            ? false
            : "__bad__";
    if (suspended === "__bad__") return res.status(400).json({ error: "Invalid suspended" });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: "name cannot be empty" });
      patch.name = name;
    }
    if (suspended !== undefined) patch.suspended = suspended;
    if (role_id !== undefined) {
      if (role_id) {
        const { data: roleRow } = await supabaseAdmin
          .from("roles")
          .select("id, organization_id")
          .eq("id", role_id)
          .maybeSingle();
        if (!roleRow || (roleRow as { organization_id: string }).organization_id !== ctx.orgId) {
          return res.status(400).json({ error: "Role not in your organization" });
        }
      }
      patch.role_id = role_id;
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .update(patch)
      .eq("id", groupId)
      .select("id, organization_id, branch_id, name, role_id, suspended, created_at, updated_at")
      .single();
    if (upErr) throw upErr;

    if (role_id !== undefined) {
      const { data: memberIds } = await supabaseAdmin
        .from("staff_profile_group_members")
        .select("profile_id")
        .eq("group_id", groupId);
      const ids = (memberIds || []).map((m) => (m as { profile_id: string }).profile_id);
      if (ids.length > 0) {
        await supabaseAdmin.from("profiles").update({ role_id }).in("id", ids);
      }
    }

    res.json({ group: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update staff profile group" });
  }
});

app.delete("/api/org/staff-profile-groups/:groupId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    const ctx = await requirePermission(req, res, "delete_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id")
      .eq("id", groupId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Group not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { data: mems } = await supabaseAdmin
      .from("staff_profile_group_members")
      .select("profile_id")
      .eq("group_id", groupId);
    const profileIds = (mems || []).map((m) => (m as { profile_id: string }).profile_id);

    const { error: delErr } = await supabaseAdmin.from("staff_profile_groups").delete().eq("id", groupId);
    if (delErr) throw delErr;

    if (profileIds.length > 0) {
      await supabaseAdmin.from("profiles").update({ role_id: null }).in("id", profileIds);
    }

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete staff profile group" });
  }
});

app.post("/api/org/staff-profile-groups/:groupId/members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    const ctx = await requirePermission(req, res, "assign_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id, role_id, name")
      .eq("id", groupId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Group not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const groupRoleId = (existing as { role_id: string | null }).role_id;
    if (!groupRoleId) {
      return res.status(400).json({ error: "Assign a role to this group before adding members." });
    }
    const staffGroupDisplayName = String((existing as { name?: string | null }).name || "").trim();

    const body = req.body || {};
    const profileId = typeof body.profile_id === "string" ? body.profile_id.trim() : "";
    if (!isUuidString(profileId)) return res.status(400).json({ error: "profile_id is required" });

    const { data: target, error: tErr } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, branch_id, is_org_owner")
      .eq("id", profileId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target || (target as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if ((target as { is_org_owner?: boolean }).is_org_owner === true) {
      return res.status(403).json({ error: "Organization owner cannot be added to a staff access group." });
    }

    const tBranch = (target as { branch_id?: string | null }).branch_id;
    const inScope =
      filterRowsByBranchScope([{ branch_id: tBranch }] as { branch_id?: string | null }[], viewerBranch, mainBranchId).length > 0;
    if (!inScope) return res.status(403).json({ error: "Profile is not in this branch scope." });

    const { data: otherRow } = await supabaseAdmin
      .from("staff_profile_group_members")
      .select("group_id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (otherRow && (otherRow as { group_id: string }).group_id !== groupId) {
      return res.status(409).json({
        error: "This person is already in another staff access group. Remove them there first.",
      });
    }
    if (otherRow && (otherRow as { group_id: string }).group_id === groupId) {
      return res.status(409).json({ error: "Already in this group." });
    }

    const { error: insErr } = await supabaseAdmin
      .from("staff_profile_group_members")
      .insert({ group_id: groupId, profile_id: profileId });
    if (insErr) throw insErr;

    const { error: roleErr } = await supabaseAdmin
      .from("profiles")
      .update({ role_id: groupRoleId })
      .eq("id", profileId);
    if (roleErr) throw roleErr;

    await notifyProfilesStaffAccessGroupAssigned({
      recipientProfileIds: [profileId],
      organizationId: ctx.orgId,
      branchId: viewerBranch,
      staffProfileGroupId: groupId,
      groupDisplayName: staffGroupDisplayName,
    });

    res.status(201).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to add member" });
  }
});

app.post("/api/org/staff-profile-groups/:groupId/members/bulk", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    const ctx = await requirePermission(req, res, "assign_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id, role_id, name")
      .eq("id", groupId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Group not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const groupRoleId = (existing as { role_id: string | null }).role_id;
    if (!groupRoleId) {
      return res.status(400).json({ error: "Assign a role to this group before adding members." });
    }
    const staffGroupDisplayNameBulk = String((existing as { name?: string | null }).name || "").trim();

    const body = req.body || {};
    const rawIds = Array.isArray(body.profile_ids) ? body.profile_ids : [];
    const seen = new Set<string>();
    const profile_ids: string[] = [];
    for (const x of rawIds) {
      if (typeof x !== "string" || !isUuidString(x)) continue;
      if (seen.has(x)) continue;
      seen.add(x);
      profile_ids.push(x);
      if (profile_ids.length >= 100) break;
    }
    if (profile_ids.length === 0) {
      return res.status(400).json({ error: "profile_ids must be a non-empty array of UUIDs (max 100)" });
    }

    const added: string[] = [];
    const skipped: { profile_id: string; reason: string }[] = [];

    for (const profileId of profile_ids) {
      const { data: target, error: tErr } = await supabaseAdmin
        .from("profiles")
        .select("id, organization_id, branch_id, is_org_owner")
        .eq("id", profileId)
        .maybeSingle();
      if (tErr || !target || (target as { organization_id: string }).organization_id !== ctx.orgId) {
        skipped.push({ profile_id: profileId, reason: "Profile not found" });
        continue;
      }
      if ((target as { is_org_owner?: boolean }).is_org_owner === true) {
        skipped.push({ profile_id: profileId, reason: "Organization owner cannot be added" });
        continue;
      }
      const tBranch = (target as { branch_id?: string | null }).branch_id;
      const inScope =
        filterRowsByBranchScope([{ branch_id: tBranch }] as { branch_id?: string | null }[], viewerBranch, mainBranchId)
          .length > 0;
      if (!inScope) {
        skipped.push({ profile_id: profileId, reason: "Not in branch scope" });
        continue;
      }
      const { data: otherRow } = await supabaseAdmin
        .from("staff_profile_group_members")
        .select("group_id")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (otherRow && (otherRow as { group_id: string }).group_id !== groupId) {
        skipped.push({ profile_id: profileId, reason: "Already in another staff access group" });
        continue;
      }
      if (otherRow && (otherRow as { group_id: string }).group_id === groupId) {
        skipped.push({ profile_id: profileId, reason: "Already in this group" });
        continue;
      }
      const { error: insErr } = await supabaseAdmin
        .from("staff_profile_group_members")
        .insert({ group_id: groupId, profile_id: profileId });
      if (insErr) {
        skipped.push({ profile_id: profileId, reason: insErr.message || "Insert failed" });
        continue;
      }
      const { error: roleErr } = await supabaseAdmin
        .from("profiles")
        .update({ role_id: groupRoleId })
        .eq("id", profileId);
      if (roleErr) {
        skipped.push({ profile_id: profileId, reason: roleErr.message || "Role update failed" });
        await supabaseAdmin.from("staff_profile_group_members").delete().eq("group_id", groupId).eq("profile_id", profileId);
        continue;
      }
      added.push(profileId);
    }

    if (added.length > 0) {
      await notifyProfilesStaffAccessGroupAssigned({
        recipientProfileIds: added,
        organizationId: ctx.orgId,
        branchId: viewerBranch,
        staffProfileGroupId: groupId,
        groupDisplayName: staffGroupDisplayNameBulk,
      });
    }

    res.status(200).json({ added, skipped });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to bulk add members" });
  }
});

app.delete("/api/org/staff-profile-groups/:groupId/members/:profileId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const { groupId, profileId } = req.params;
  if (!isUuidString(groupId) || !isUuidString(profileId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const ctx = await requirePermission(req, res, "assign_staff_profile_groups");
    if (!ctx) return;

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const mainBranchId = await getMainBranchIdForOrg(ctx.orgId);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("staff_profile_groups")
      .select("id, organization_id, branch_id")
      .eq("id", groupId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || (existing as { organization_id: string }).organization_id !== ctx.orgId) {
      return res.status(404).json({ error: "Group not found" });
    }
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error: delErr } = await supabaseAdmin
      .from("staff_profile_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("profile_id", profileId);
    if (delErr) throw delErr;

    await supabaseAdmin.from("profiles").update({ role_id: null }).eq("id", profileId);

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to remove member" });
  }
});

/** Group rows for expanding subgroups (same branch). */
async function loadGroupTreeRowsForBranch(
  organizationId: string,
  branchId: string,
): Promise<{ id: string; parent_group_id: string | null }[]> {
  const { data, error } = await supabaseAdmin
    .from("groups")
    .select("id, parent_group_id")
    .eq("organization_id", organizationId)
    .eq("branch_id", branchId)
    .or("is_deleted.eq.false,is_deleted.is.null");
  if (error) throw error;
  return (data || []) as { id: string; parent_group_id: string | null }[];
}

function expandGroupIdsWithDescendants(
  rows: { id: string; parent_group_id: string | null }[],
  roots: string[],
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const g of rows) {
    const p = g.parent_group_id;
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(g.id);
  }
  const out = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of childrenByParent.get(id) || []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return [...out];
}

/**
 * Staff profile ids who should receive in-app alerts for activity on `groupId`:
 * org owners, and profiles whose `profile_ministry_scope` roots expand to include `groupId`
 * (including branch-wide "All Members" scope rows).
 */
async function profileIdsStaffWhoSeeMinistryGroup(
  organizationId: string,
  branchId: string,
  groupId: string,
): Promise<string[]> {
  const treeRows = await loadGroupTreeRowsForBranch(organizationId, branchId);
  const branchGroupIds = new Set(treeRows.map((r) => r.id));
  if (!branchGroupIds.has(groupId)) return [];

  const idsArray = [...branchGroupIds];
  let scopeRows: { profile_id: string; group_id: string }[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("profile_ministry_scope")
      .select("profile_id, group_id")
      .in("group_id", idsArray);
    if (error) throw error;
    scopeRows = (data || []) as { profile_id: string; group_id: string }[];
  } catch {
    scopeRows = [];
  }

  const { data: gMeta, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id, system_kind")
    .eq("organization_id", organizationId)
    .eq("branch_id", branchId)
    .or("is_deleted.eq.false,is_deleted.is.null");
  if (gErr) throw gErr;
  const systemKindById = new Map<string, string | null>();
  for (const g of gMeta || []) {
    systemKindById.set((g as { id: string }).id, (g as { system_kind?: string | null }).system_kind ?? null);
  }

  const out = new Set<string>();
  for (const r of scopeRows) {
    if (!isUuidString(r.profile_id) || !isUuidString(r.group_id)) continue;
    if (!branchGroupIds.has(r.group_id)) continue;
    const sk = systemKindById.get(r.group_id);
    if (sk === "all_members") {
      out.add(r.profile_id);
      continue;
    }
    const expanded = expandGroupIdsWithDescendants(treeRows, [r.group_id]);
    if (expanded.includes(groupId)) out.add(r.profile_id);
  }

  try {
    const { data: owners, error: ownErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_org_owner", true);
    if (!ownErr) {
      for (const o of owners || []) {
        const id = (o as { id?: string }).id;
        if (id && isUuidString(id)) out.add(id);
      }
    }
  } catch {
    /* is_org_owner missing */
  }

  return [...out];
}

async function recipientProfilesForNewGroupJoinRequest(
  organizationId: string,
  branchId: string,
  groupId: string,
): Promise<string[]> {
  const [approve, view, ministry] = await Promise.all([
    profileIdsWithAnyPermission(organizationId, branchId, ["approve_group_requests", "reject_group_requests"]),
    profileIdsWithPermission(organizationId, branchId, "view_group_requests"),
    profileIdsStaffWhoSeeMinistryGroup(organizationId, branchId, groupId),
  ]);
  return [...new Set([...approve, ...view, ...ministry])];
}

async function recipientProfilesForNewMemberJoinRequest(
  organizationId: string,
  branchId: string,
): Promise<string[]> {
  const [approve, view] = await Promise.all([
    profileIdsWithAnyPermission(organizationId, branchId, ["approve_member_requests", "reject_member_requests"]),
    profileIdsWithPermission(organizationId, branchId, "view_member_requests"),
  ]);
  return [...new Set([...approve, ...view])];
}

async function notifyApproversPendingGroupJoinRequest(args: {
  organizationId: string;
  branchId: string;
  groupId: string;
  requestId: string;
  applicantLabel: string;
}): Promise<void> {
  const { organizationId, branchId, groupId, requestId, applicantLabel } = args;
  if (!isUuidString(requestId) || !isUuidString(groupId)) return;
  if (_pendingGroupJoinNotifyOnce.has(requestId)) return;
  if (_pendingGroupJoinNotifyOnce.size > 8000) _pendingGroupJoinNotifyOnce.clear();
  _pendingGroupJoinNotifyOnce.add(requestId);
  let groupLabel = "a ministry";
  try {
    groupLabel = await fetchGroupDisplayName(groupId, organizationId);
  } catch {
    /* keep default */
  }
  const recipients = await recipientProfilesForNewGroupJoinRequest(organizationId, branchId, groupId);
  if (recipients.length === 0) return;
  const actionPath = `/groups/${encodeURIComponent(groupId)}?tab=requests&openRequestId=${encodeURIComponent(requestId)}`;
  const payload: Record<string, unknown> = {
    group_id: groupId,
    group_request_id: requestId,
    entity_type: "group_request",
    entity_id: requestId,
    group_display_name: groupLabel,
    applicant_display_name: applicantLabel,
  };
  await createNotificationsForRecipients(recipients, {
    organization_id: organizationId,
    branch_id: branchId,
    type: "pending_group_join_request",
    category: "requests",
    title: "New group join request",
    message: `${applicantLabel} requested to join "${groupLabel}".`,
    severity: "medium",
    entity_type: "group_request",
    entity_id: requestId,
    action_path: actionPath,
    payload,
    /** One push per request per recipient even if notify runs twice (double submit / retries). */
    dedupe_key: `pending_group_join:${requestId}`,
    dedupe_window_minutes: 30,
  });
}

async function notifyApproversPendingMemberJoinRequest(args: {
  organizationId: string;
  branchId: string;
  requestId: string;
  applicantSummary: string;
}): Promise<void> {
  const { organizationId, branchId, requestId, applicantSummary } = args;
  if (!isUuidString(requestId)) return;
  if (_pendingMemberJoinNotifyOnce.has(requestId)) return;
  if (_pendingMemberJoinNotifyOnce.size > 8000) _pendingMemberJoinNotifyOnce.clear();
  _pendingMemberJoinNotifyOnce.add(requestId);
  const recipients = await recipientProfilesForNewMemberJoinRequest(organizationId, branchId);
  if (recipients.length === 0) return;
  const actionPath = `/member-join-requests?openRequestId=${encodeURIComponent(requestId)}`;
  await createNotificationsForRecipients(recipients, {
    organization_id: organizationId,
    branch_id: branchId,
    type: "pending_member_join_request",
    category: "requests",
    title: "New member request",
    message: applicantSummary || "Someone submitted a registration request.",
    severity: "medium",
    entity_type: "member_request",
    entity_id: requestId,
    action_path: actionPath,
    payload: { member_request_id: requestId, entity_type: "member_request", entity_id: requestId },
    dedupe_key: `pending_member_join:${requestId}`,
    dedupe_window_minutes: 30,
  });
}

async function countUniqueMembersInGroups(organizationId: string, groupIds: string[]): Promise<number> {
  if (groupIds.length === 0) return 0;
  const { data, error } = await supabaseAdmin
    .from("group_members")
    .select("member_id")
    .eq("organization_id", organizationId)
    .in("group_id", groupIds);
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of data || []) {
    const mid = (r as { member_id?: string | null }).member_id;
    if (mid) seen.add(mid);
  }
  return seen.size;
}

async function countBranchMembers(organizationId: string, branchId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("branch_id", branchId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Bulk SMS message history — actual delivery via Hubtel is not implemented here.
 * POST inserts a row with status pending_external or scheduled for a future worker.
 */
app.get("/api/org/messages", async (req, res) => {
  try {
    const ctx = await requirePermission(req, res, "send_messages");
    if (!ctx) return;

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (profileError || !userProfile) return res.status(401).json({ error: "User profile not found" });

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const orgId = ctx.orgId;

    let query = supabaseAdmin
      .from("messages")
      .select("id, subject, content, recipient_type, status, scheduled_for, created_at, sender_id, branch_id, metadata")
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .order("created_at", { ascending: false })
      .limit(200);

    const { data: rows, error } = await query;
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("metadata") && (msg.includes("column") || msg.includes("does not exist"))) {
        const q2 = await supabaseAdmin
          .from("messages")
          .select("id, subject, content, recipient_type, status, scheduled_for, created_at, sender_id, branch_id")
          .eq("organization_id", orgId)
          .eq("branch_id", viewerBranch)
          .order("created_at", { ascending: false })
          .limit(200);
        if (q2.error) throw q2.error;
        return res.json((q2.data || []).map((r: Record<string, unknown>) => ({ ...r, metadata: {} })));
      }
      if (msg.includes("messages") && (msg.includes("does not exist") || msg.includes("42p01"))) {
        return res.json([]);
      }
      throw error;
    }
    res.json(rows || []);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load messages" });
  }
});

app.post("/api/org/messages", async (req, res) => {
  try {
    const ctx = await requirePermission(req, res, "send_messages");
    if (!ctx) return;

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();
    if (profileError || !userProfile) return res.status(401).json({ error: "User profile not found" });

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, ctx.userId);
    const orgId = ctx.orgId;

    const body = req.body || {};
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const recipient_scope = typeof body.recipient_scope === "string" ? body.recipient_scope : "";
    const include_subgroups = Boolean(body.include_subgroups);
    const group_ids = (Array.isArray(body.group_ids) ? body.group_ids : []).filter(
      (id: unknown): id is string => typeof id === "string" && isUuidString(id),
    );
    const member_id_raw = body.member_id;
    const member_id =
      typeof member_id_raw === "string" && isUuidString(member_id_raw) ? member_id_raw : null;

    const scheduled_for_raw = body.scheduled_for;
    let scheduled_for: string | null = null;
    if (typeof scheduled_for_raw === "string" && scheduled_for_raw.trim().length > 0) {
      const d = new Date(scheduled_for_raw);
      if (!Number.isNaN(d.getTime())) scheduled_for = d.toISOString();
    }

    const recurrence = body.recurrence && typeof body.recurrence === "object" ? body.recurrence : null;

    if (!content) return res.status(400).json({ error: "Message content is required" });
    if (!["all", "groups", "member"].includes(recipient_scope)) {
      return res.status(400).json({ error: "recipient_scope must be all, groups, or member" });
    }

    const msgScope = await ministryScopeForActor(ctx.userId, orgId, viewerBranch, ctx.isOrgOwner);
    if (recipient_scope === "all" && msgScope.kind === "groups") {
      return res.status(403).json({ error: "Only users with branch-wide ministry access can message all members." });
    }

    if (recipient_scope === "groups" && group_ids.length === 0) {
      return res.status(400).json({ error: "Select at least one group" });
    }
    if (recipient_scope === "member" && !member_id) {
      return res.status(400).json({ error: "member_id is required" });
    }

    const treeRows = await loadGroupTreeRowsForBranch(orgId, viewerBranch);
    const validGroupIds = new Set(treeRows.map((g) => g.id));

    if (recipient_scope === "groups") {
      for (const gid of group_ids) {
        if (!validGroupIds.has(gid)) {
          return res.status(400).json({ error: `Invalid group id: ${gid}` });
        }
        if (msgScope.kind === "groups" && !groupIdVisibleUnderScope(gid, msgScope)) {
          return res.status(403).json({ error: "You are not assigned to one or more selected groups." });
        }
      }
    }

    let expandedGroupIds: string[] = [];
    let recipientLabel = "";
    let recipient_count = 0;

    if (recipient_scope === "all") {
      recipient_count = await countBranchMembers(orgId, viewerBranch);
      recipientLabel = "All members";
    } else if (recipient_scope === "member") {
      const { data: mrow, error: mErr } = await supabaseAdmin
        .from("members")
        .select("id, first_name, last_name")
        .eq("id", member_id as string)
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!mrow) return res.status(404).json({ error: "Member not found" });
      if (msgScope.kind === "groups") {
        const allowedM = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, msgScope);
        if (allowedM !== null && member_id && !allowedM.has(member_id)) {
          return res.status(403).json({ error: "You do not have access to message this member." });
        }
      }
      recipient_count = 1;
      const fn = (mrow as { first_name?: string | null }).first_name || "";
      const ln = (mrow as { last_name?: string | null }).last_name || "";
      recipientLabel = `${fn} ${ln}`.trim() || "Member";
    } else {
      expandedGroupIds = include_subgroups ? expandGroupIdsWithDescendants(treeRows, group_ids) : [...group_ids];
      for (const gid of expandedGroupIds) {
        if (!validGroupIds.has(gid)) {
          return res.status(400).json({ error: `Invalid group in expansion: ${gid}` });
        }
      }
      const { data: gnames, error: gErr } = await supabaseAdmin
        .from("groups")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .in("id", group_ids);
      if (gErr) throw gErr;
      const nameMap = new Map(
        (gnames || []).map((g: { id: string; name: string | null }) => [g.id, g.name || "Group"]),
      );
      const parts = group_ids.map((id) => nameMap.get(id) || "Group");
      recipientLabel = parts.join(", ") + (include_subgroups ? " (+ subgroups)" : "");
      recipient_count = await countUniqueMembersInGroups(orgId, expandedGroupIds);
    }

    const now = new Date();
    const isScheduled = !!(scheduled_for && new Date(scheduled_for) > now);
    const status = isScheduled ? "scheduled" : "pending_external";

    const metadata: Record<string, unknown> = {
      channel: "sms",
      recipient_scope,
      recipient_label: recipientLabel,
      recipient_count,
      group_ids: recipient_scope === "groups" ? group_ids : [],
      expanded_group_ids: recipient_scope === "groups" ? expandedGroupIds : [],
      include_subgroups: recipient_scope === "groups" ? include_subgroups : false,
      member_id: recipient_scope === "member" ? member_id : null,
      recurrence: recurrence || { frequency: "none" },
    };

    const row: Record<string, unknown> = {
      organization_id: orgId,
      branch_id: viewerBranch,
      sender_id: ctx.userId,
      subject: subject || null,
      content,
      recipient_type: recipient_scope,
      status,
      scheduled_for,
      metadata,
    };

    let insertResult = await supabaseAdmin.from("messages").insert([row]).select().single();
    if (insertResult.error) {
      const msg = String(insertResult.error.message || "").toLowerCase();
      if (msg.includes("metadata") && (msg.includes("column") || msg.includes("does not exist"))) {
        delete row.metadata;
        insertResult = await supabaseAdmin.from("messages").insert([row]).select().single();
      }
    }
    if (insertResult.error) {
      const msg = String(insertResult.error.message || "").toLowerCase();
      if (msg.includes("messages") && (msg.includes("does not exist") || msg.includes("42p01"))) {
        return res.status(503).json({
          error:
            "Database table `messages` is not available. Apply the schema from docs or create the messages table.",
        });
      }
      throw insertResult.error;
    }

    res.status(201).json(insertResult.data);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to save message" });
  }
});

/** List staff profiles in the signed-in user's organization (for Settings). */
app.get("/api/org/staff", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const ctx = await requireAnyPermission(req, res, [
      "view_staff",
      "view_roles",
      "add_groups",
      "edit_groups",
      "view_member_tasks",
      "view_group_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "delete_member_tasks",
      "monitor_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
      "add_group_tasks",
      "edit_group_tasks",
      "delete_group_tasks",
      "monitor_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
    ]);
    if (!ctx) return;

    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    let { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, email, first_name, last_name, branch_id, role_id, is_org_owner, is_active, created_at, avatar_url",
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error && String(error.message || "").toLowerCase().includes("avatar_url")) {
      const rAv = await supabaseAdmin
        .from("profiles")
        .select("id, email, first_name, last_name, branch_id, role_id, is_org_owner, is_active, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      rows = (rAv.data || []).map((p) => ({ ...p, avatar_url: null as string | null }));
      error = rAv.error;
    }

    if (error && String(error.message || "").toLowerCase().includes("is_org_owner")) {
      const r2 = await supabaseAdmin
        .from("profiles")
        .select("id, email, first_name, last_name, branch_id, role_id, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      rows = (r2.data || []).map((p) => ({ ...p, is_org_owner: false, is_active: true, avatar_url: null as string | null }));
      error = r2.error;
    }

    if (error && String(error.message || "").toLowerCase().includes("is_active")) {
      const r3 = await supabaseAdmin
        .from("profiles")
        .select("id, email, first_name, last_name, branch_id, role_id, is_org_owner, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      rows = (r3.data || []).map((p) => ({ ...p, is_active: true, avatar_url: (p as { avatar_url?: string }).avatar_url ?? null }));
      error = r3.error;
    }

    if (error) throw error;

    const raw = rows || [];
    const scoped = raw.filter((p) => {
      const row = p as { branch_id?: string | null; is_org_owner?: boolean | null };
      if (row.is_org_owner === true) return true;
      return filterRowsByBranchScope([row] as { branch_id?: string | null }[], viewerBranch, mainBranchId).length > 0;
    });

    const pidSet = new Set(scoped.map((p) => (p as { id: string }).id));
    const groupNameByProfile = new Map<string, string>();
    try {
      const { data: links } = await supabaseAdmin
        .from("staff_profile_group_members")
        .select("profile_id, group_id");
      const gidSet = new Set<string>();
      for (const l of links || []) {
        const pid = (l as { profile_id: string }).profile_id;
        if (pidSet.has(pid)) gidSet.add((l as { group_id: string }).group_id);
      }
      if (gidSet.size > 0) {
        const { data: grps } = await supabaseAdmin
          .from("staff_profile_groups")
          .select("id, name")
          .in("id", [...gidSet]);
        const nameByGid = new Map<string, string>();
        for (const g of grps || []) {
          const r = g as { id: string; name: string };
          nameByGid.set(r.id, r.name);
        }
        for (const l of links || []) {
          const pid = (l as { profile_id: string }).profile_id;
          const gid = (l as { group_id: string }).group_id;
          if (pidSet.has(pid)) {
            const nm = nameByGid.get(gid);
            if (nm) groupNameByProfile.set(pid, nm);
          }
        }
      }
    } catch {
      /* staff tables optional */
    }

    const ministryIdsByProfile = new Map<string, string[]>();
    const scopeProfileIds = scoped
      .map((p) => (p as { id: string }).id)
      .filter((id): id is string => isUuidString(id));
    if (scopeProfileIds.length > 0) {
      try {
        const { data: scRows } = await supabaseAdmin
          .from("profile_ministry_scope")
          .select("profile_id, group_id")
          .in("profile_id", scopeProfileIds);
        for (const r of scRows || []) {
          const pid = (r as { profile_id?: string }).profile_id;
          const gid = (r as { group_id?: string }).group_id;
          if (!pid || !gid || !isUuidString(gid)) continue;
          if (!ministryIdsByProfile.has(pid)) ministryIdsByProfile.set(pid, []);
          ministryIdsByProfile.get(pid)!.push(gid);
        }
      } catch {
        /* table missing */
      }
    }

    const staffOut = scoped.map((p) => {
      const row = p as { id: string; is_active?: boolean | null };
      return {
        ...row,
        staff_access_group_name: groupNameByProfile.get(row.id) ?? null,
        is_active: row.is_active === false ? false : true,
        ministry_scope_group_ids: ministryIdsByProfile.get(row.id) ?? [],
      };
    });

    res.json({ staff: staffOut });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load staff" });
  }
});

/** GET/PUT staff ministry visibility (profile_ministry_scope). Org owners or manage_staff. */
app.get("/api/org/staff/:profileId/ministry-scope", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { profileId } = req.params;
  if (!isUuidString(profileId)) return res.status(400).json({ error: "Invalid profile id" });
  try {
    const ctx = await requirePermission(req, res, "view_staff_ministry_scope");
    if (!ctx) return;

    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!actorProfile) return res.status(404).json({ error: "Profile not found" });

    const orgId = actorProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, actorProfile as OrgProfile, user.id);

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, branch_id, is_org_owner")
      .eq("id", profileId)
      .maybeSingle();
    if (!target || (target as { organization_id?: string }).organization_id !== orgId) {
      return res.status(404).json({ error: "Staff profile not found" });
    }
    const mainBranchId = await getMainBranchIdForOrg(orgId);
    const inScope = filterRowsByBranchScope([target] as { branch_id?: string | null }[], viewerBranch, mainBranchId).length > 0;
    if (!inScope && (target as { is_org_owner?: boolean }).is_org_owner !== true) {
      return res.status(404).json({ error: "Staff profile not found" });
    }

    const groupIds = await fetchProfileMinistryScopeGroupIds(profileId);
    res.json({ profile_id: profileId, group_ids: groupIds });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load ministry scope" });
  }
});

app.put("/api/org/staff/:profileId/ministry-scope", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { profileId } = req.params;
  if (!isUuidString(profileId)) return res.status(400).json({ error: "Invalid profile id" });
  try {
    const ctx = await requirePermission(req, res, "edit_staff_ministry_scope");
    if (!ctx) return;

    const supabase = getSupabaseClient(token);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return res.status(401).json({ error: "Invalid token" });

    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!actorProfile) return res.status(404).json({ error: "Profile not found" });

    const orgId = actorProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, actorProfile as OrgProfile, user.id);

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id, branch_id, is_org_owner")
      .eq("id", profileId)
      .maybeSingle();
    if (!target || (target as { organization_id?: string }).organization_id !== orgId) {
      return res.status(404).json({ error: "Staff profile not found" });
    }
    if ((target as { is_org_owner?: boolean }).is_org_owner === true) {
      return res.status(400).json({ error: "Organization owners use full-branch access; ministry scope does not apply." });
    }

    const mainBranchId = await getMainBranchIdForOrg(orgId);
    const inScope = filterRowsByBranchScope([target] as { branch_id?: string | null }[], viewerBranch, mainBranchId).length > 0;
    if (!inScope) {
      return res.status(404).json({ error: "Staff profile not found" });
    }

    const previousScopeIds = await fetchProfileMinistryScopeGroupIds(profileId);

    const body = req.body || {};
    const raw = Array.isArray(body.group_ids) ? body.group_ids : [];
    const wanted = [...new Set(raw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)))];
    if (wanted.length === 0) {
      const { error: delErr } = await supabaseAdmin.from("profile_ministry_scope").delete().eq("profile_id", profileId);
      if (delErr) {
        const m = String(delErr.message || "").toLowerCase();
        if (!m.includes("profile_ministry_scope") && delErr.code !== "42P01") throw delErr;
      }
      await notifyRecipientProfileMinistryScopeUpdated({
        recipientProfileId: profileId,
        organizationId: orgId,
        previousGroupIds: previousScopeIds,
        newGroupIds: [],
      });
      return res.json({ profile_id: profileId, group_ids: [] });
    }

    let { data: gRows, error: gErr } = await supabaseAdmin
      .from("groups")
      .select("id, branch_id, is_system, system_kind")
      .eq("organization_id", orgId)
      .in("id", wanted);
    if (gErr) {
      const msg = String(gErr.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (gErr as { code?: string }).code === "42703") {
        const fb = await supabaseAdmin
          .from("groups")
          .select("id, branch_id")
          .eq("organization_id", orgId)
          .in("id", wanted);
        gRows = fb.data;
        gErr = fb.error;
      } else {
        throw gErr;
      }
    }
    if (gErr) throw gErr;
    const okIds = new Set((gRows || []).map((g) => (g as { id: string }).id));
    if (okIds.size !== wanted.length) {
      return res.status(400).json({ error: "One or more invalid group ids." });
    }
    for (const g of gRows || []) {
      const bid = (g as { branch_id?: string | null }).branch_id;
      if (String(bid || "") !== viewerBranch) {
        return res.status(400).json({ error: "All groups must belong to the current branch." });
      }
      const sys = g as { is_system?: boolean | null; system_kind?: string | null };
      if (sys.is_system === true && sys.system_kind !== "all_members") {
        return res.status(400).json({ error: "Cannot assign system groups except All Members." });
      }
    }

    const { error: delAll } = await supabaseAdmin.from("profile_ministry_scope").delete().eq("profile_id", profileId);
    if (delAll) {
      const m = String(delAll.message || "").toLowerCase();
      if (!m.includes("profile_ministry_scope") && delAll.code !== "42P01") throw delAll;
    }

    const rows = wanted.map((group_id) => ({ profile_id: profileId, group_id }));
    const { error: insErr } = await supabaseAdmin.from("profile_ministry_scope").insert(rows);
    if (insErr) {
      const m = String(insErr.message || "").toLowerCase();
      if (m.includes("profile_ministry_scope") || insErr.code === "42P01") {
        return res.status(503).json({ error: "Run migrations/profile_ministry_scope.sql on your database." });
      }
      throw insErr;
    }

    await notifyRecipientProfileMinistryScopeUpdated({
      recipientProfileId: profileId,
      organizationId: orgId,
      previousGroupIds: previousScopeIds,
      newGroupIds: wanted,
    });

    res.json({ profile_id: profileId, group_ids: wanted });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to save ministry scope" });
  }
});

/**
 * Create a group-leader-style staff login: auth user + profile in the inviter's org/branch.
 * Uses service-role profile insert (same pattern as signup). For testing, emails are auto-confirmed unless AUTH_EMAIL_AUTO_CONFIRM=false.
 */
app.post("/api/org/group-leaders", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const ctx = await requirePermission(req, res, "assign_staff_roles");
    if (!ctx) return;

    const { data: inviterProfile, error: inviterErr } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", ctx.userId)
      .single();

    if (inviterErr || !inviterProfile) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const orgId = inviterProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, inviterProfile as OrgProfile, ctx.userId);

    const body = req.body || {};
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const firstName = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body.last_name === "string" ? body.last_name.trim() : "";

    if (!emailRaw || !emailRaw.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (!firstName || !lastName) {
      return res.status(400).json({ error: "First and last name are required" });
    }

    const fullName = `${firstName} ${lastName}`.trim();

    let roleId: string | null = null;
    const { data: orgRoles } = await supabaseAdmin
      .from("roles")
      .select("id, name")
      .eq("organization_id", orgId)
      .limit(50);
    if (orgRoles && orgRoles.length > 0) {
      const match = orgRoles.find((row) => {
        const n = String((row as { name?: string | null }).name || "").toLowerCase().trim();
        return n === "group leader" || n === "group_leader" || (n.includes("group") && n.includes("leader"));
      });
      if (match) roleId = (match as { id: string }).id;
    }
    if (!roleId) {
      const glPerms = validatePermissionIds([
        "view_dashboard",
        "view_members",
        "view_member_tasks",
        "view_group_tasks",
        "add_group_tasks",
        "edit_group_tasks",
        "delete_group_tasks",
        "edit_group_task_checklist",
        "complete_group_task_checklist",
        "view_groups",
        "assign_groups",
        "view_events",
        "view_event_attendance",
        "record_event_attendance",
        "send_messages",
      ]);
      const { data: insertedGl, error: glErr } = await supabaseAdmin
        .from("roles")
        .insert({ organization_id: orgId, name: "Group Leader", permissions: glPerms })
        .select("id")
        .single();
      if (!glErr && insertedGl) roleId = (insertedGl as { id: string }).id;
    }

    const { data: authData, error: authError2 } = await supabaseAdmin.auth.admin.createUser({
      email: emailRaw,
      password,
      email_confirm: shouldAutoConfirmAuthEmail(),
      user_metadata: { full_name: fullName },
    });

    if (authError2) {
      return res.status(400).json({ error: authError2.message || "Failed to create user" });
    }

    const newUserId = authData.user.id;

    const profilePayload: Record<string, unknown> = {
      id: newUserId,
      email: emailRaw,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      organization_id: orgId,
      branch_id: viewerBranch,
      is_active: true,
    };
    if (roleId) profilePayload.role_id = roleId;

    const { data: createdProfile, error: profileInsertError } = await supabaseAdmin
      .from("profiles")
      .insert([profilePayload])
      .select("id, email, first_name, last_name, branch_id, role_id, created_at")
      .single();

    if (profileInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return res.status(500).json({
        error: "Failed to create profile",
        details: profileInsertError.message,
      });
    }

    res.status(201).json({ staff: createdProfile });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to create group leader" });
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

app.post("/api/branches", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, ["system_settings"]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, is_org_owner")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    if (!userProfile.is_org_owner) {
      return res.status(403).json({ error: "Only the organization owner can create branches." });
    }
    const orgId = userProfile.organization_id as string;
    const limB = await assertOrgLimit(supabaseAdmin, orgId, "branches");
    if (!limB.ok)
      return res.status(403).json({ error: limB.message, code: "ORG_LIMIT", current: limB.current, limit: limB.limit });

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Branch name is required" });
    const timezone = normalizeTimezoneInput(body.timezone) || IMPORTANT_DATES_DEFAULT_TIMEZONE;
    const reminderTime = normalizeImportantTimeInput(body.important_dates_default_reminder_time);
    /** Only columns required by the app UI — avoids schema errors when optional columns are missing in DB. */
    const row: Record<string, unknown> = {
      organization_id: orgId,
      name,
      timezone,
      important_dates_default_reminder_time:
        reminderTime || IMPORTANT_DATES_DEFAULT_REMINDER_TIME,
    };
    if (typeof body.is_active === "boolean") {
      row.is_active = body.is_active;
    }
    const { data: created, error } = await supabaseAdmin
      .from("branches")
      .insert([row])
      .select("*")
      .single();
    if (error) throw error;
    const bid = (created as { id: string }).id;
    await ensureAllMembersGroupForBranch(supabaseAdmin, orgId, bid);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create branch" });
  }
});

app.put("/api/branches/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, ["system_settings"]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const body = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (body.timezone !== undefined) {
      const tz = normalizeTimezoneInput(body.timezone);
      if (!tz) return res.status(400).json({ error: "timezone must be a valid IANA timezone (e.g. Africa/Accra)." });
      patch.timezone = tz;
    }
    if (body.important_dates_default_reminder_time !== undefined) {
      const t = normalizeImportantTimeInput(body.important_dates_default_reminder_time);
      if (!t) {
        return res
          .status(400)
          .json({ error: "important_dates_default_reminder_time must be HH:MM or HH:MM:SS" });
      }
      patch.important_dates_default_reminder_time = t;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No fields to update" });
    const { data: updated, error } = await supabaseAdmin
      .from("branches")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) throw error;
    if (!updated) return res.status(404).json({ error: "Branch not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update branch" });
  }
});

app.patch("/api/branches/:id/timezone", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, ["system_settings"]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const timezone = normalizeTimezoneInput(req.body?.timezone);
    if (!timezone) {
      return res.status(400).json({ error: "timezone must be a valid IANA timezone (e.g. Africa/Accra)." });
    }
    const reminderTime = req.body?.important_dates_default_reminder_time;
    const patch: Record<string, unknown> = { timezone };
    if (reminderTime !== undefined) {
      const normalizedTime = normalizeImportantTimeInput(reminderTime);
      if (!normalizedTime) {
        return res
          .status(400)
          .json({ error: "important_dates_default_reminder_time must be HH:MM or HH:MM:SS" });
      }
      patch.important_dates_default_reminder_time = normalizedTime;
    }
    const { data: updated, error } = await supabaseAdmin
      .from("branches")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) throw error;
    if (!updated) return res.status(404).json({ error: "Branch not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update branch timezone" });
  }
});

app.delete("/api/branches/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, ["system_settings"]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, is_org_owner")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    if (!userProfile.is_org_owner) {
      return res.status(403).json({ error: "Only the organization owner can delete branches." });
    }
    const orgId = userProfile.organization_id as string;
    const { count: branchCount } = await supabaseAdmin
      .from("branches")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if ((branchCount ?? 0) <= 1) {
      return res.status(400).json({ error: "Cannot delete the last branch. An organization must have at least one branch." });
    }
    const { error } = await supabaseAdmin
      .from("branches")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete branch" });
  }
});

app.get("/api/members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const { showDeleted, not_in_group_id } = req.query;
    const includeDeleted =
      String(req.query.include_deleted || "").toLowerCase() === "true" ||
      String(showDeleted || "").toLowerCase() === "true";
    const deletedOnly = String(req.query.deleted_only || "").toLowerCase() === "true";

    const permCtx = deletedOnly
      ? await requireAnyPermission(req, res, ["view_deleted_members", "delete_members"])
      : await requireAnyPermission(req, res, [
          "view_members",
          "add_member_tasks",
          "edit_member_tasks",
          "delete_member_tasks",
          "add_group_tasks",
          "edit_group_tasks",
          "delete_group_tasks",
        ]);
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const notInGidRaw =
      typeof not_in_group_id === "string" && not_in_group_id.trim().length > 0
        ? not_in_group_id.trim()
        : null;
    if (notInGidRaw && isUuidString(notInGidRaw)) {
      const { data: gRow } = await supabaseAdmin
        .from("groups")
        .select("branch_id, organization_id")
        .eq("id", notInGidRaw)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!gRow) {
        throw httpError(404, "Group not found.");
      }
      assertEntityBranch((gRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    }

    let query = supabaseAdmin.from("members").select("*", { count: "exact" }).eq("organization_id", orgId);

    if (deletedOnly) {
      query = query.eq("is_deleted", true);
    } else if (!includeDeleted) {
      query = query.or("is_deleted.eq.false,is_deleted.is.null");
    }

    if (not_in_group_id) {
      const { data: existingGroupMembers, error: gmError } = await supabaseAdmin
        .from("group_members")
        .select("member_id")
        .eq("group_id", not_in_group_id as string)
        .eq("organization_id", orgId);

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

    query = query.eq("branch_id", viewerBranch);

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
    const canSeeBranchDeleted =
      permCtx.isOrgOwner || permCtx.permissionSet.has("view_deleted_members");

    if (!deletedOnly) {
      if (allowedMemberIds !== null) {
        if (allowedMemberIds.size === 0) {
          if (includeDeleted && canSeeBranchDeleted) {
            query = query.eq("is_deleted", true);
          } else {
            return res.json({ members: [], total_count: 0 });
          }
        } else if (includeDeleted && canSeeBranchDeleted) {
          const idList = [...allowedMemberIds].join(",");
          query = query.or(
            `and(id.in.(${idList}),or(is_deleted.eq.false,is_deleted.is.null)),is_deleted.eq.true`,
          );
        } else {
          query = query.in("id", [...allowedMemberIds]);
        }
      }
    }

    // Newest members first (matches product expectation after add / import).
    query = query.order("created_at", { ascending: false });
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    query = query.range(offset, offset + limit - 1);

    const { data: members, error, count: membersCount } = await query;

    if (error) {
      return res.status(500).json({ error: "Failed to fetch members", details: error });
    }

    const [{ data: memberFamilies, error: mfError }, { data: memberGroupRows, error: mgListError }] = await Promise.all([
      supabaseAdmin.from("member_families").select("member_id, family_id"),
      supabaseAdmin.from("group_members").select("member_id, group_id").eq("organization_id", orgId),
    ]);

    if (mfError) {
      return res.status(500).json({ error: "Failed to fetch member families", details: mfError });
    }
    if (mgListError) {
      return res.status(500).json({ error: "Failed to fetch group memberships", details: mgListError });
    }

    const mappedMembers = (members || []).map(m => ({
      ...m,
      phoneNumber: m.phone_number,
      dateOfBirth: m.dob,
      dateJoined: m.date_joined,
      memberIdString: m.member_id_string,
      profileImage: m.avatar_url || m.memberimage_url || m.member_url || null,
      fullName: `${m.first_name} ${m.last_name}`,
      location: m.address,
      emergencyContactName: m.emergency_contact_name,
      emergencyContactPhone: m.emergency_contact_phone,
      status: m.status,
      familyIds: (memberFamilies || []).filter(mf => mf.member_id === m.id).map(mf => mf.family_id),
      groupIds: (memberGroupRows || []).filter(mg => mg.member_id === m.id).map(mg => mg.group_id),
    }));

    res.json({ members: mappedMembers, total_count: membersCount ?? mappedMembers.length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

/**
 * Mobile dashboard: org owner (and super-admin-as-owner) → newest members in branch (`members.created_at`).
 * Everyone else → newest `group_members` in `profile_ministry_scope` groups (plus descendants).
 * Branch-wide staff (`branch_all`): prefer groups where `groups.leader_id` is this user; otherwise all non–all_members groups.
 */
app.get("/api/dashboard/recent-members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, ["view_members", ...ANY_MEMBER_OR_GROUP_TASK_PERM]);
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const limit = Math.max(3, Math.min(16, parseInt(String(req.query.limit ?? "8"), 10) || 8));

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);

    type RawMember = Record<string, unknown> & { id: string };
    let mode: "new_members" | "group_assignments" = "group_assignments";
    let memberRows: RawMember[] = [];

    if (permCtx.isOrgOwner) {
      mode = "new_members";
      const { data, error } = await supabaseAdmin
        .from("members")
        .select("*")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .or("is_deleted.eq.false,is_deleted.is.null")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      memberRows = (data || []) as RawMember[];
    } else {
      mode = "group_assignments";
      let filterGroupIds: string[] = [];

      if (mScope.kind === "groups") {
        filterGroupIds = [...mScope.allowedGroupIds].filter((id) => isUuidString(id));
        if (filterGroupIds.length === 0) {
          return res.json({ mode, members: [] });
        }
      } else {
        // branch_all (or legacy full-branch access): prefer ministries where this user is the assigned leader.
        const { data: ledGroups, error: ledErr } = await supabaseAdmin
          .from("groups")
          .select("id, system_kind")
          .eq("organization_id", orgId)
          .eq("branch_id", viewerBranch)
          .eq("leader_id", user.id)
          .or("is_deleted.eq.false,is_deleted.is.null");
        if (ledErr) throw ledErr;
        const leaderIds = (ledGroups || [])
          .filter((g) => (g as { system_kind?: string | null }).system_kind !== "all_members")
          .map((g) => (g as { id: string }).id)
          .filter((id) => isUuidString(id));

        if (leaderIds.length > 0) {
          filterGroupIds = leaderIds;
        } else {
          const { data: branchGroups, error: gErr } = await supabaseAdmin
            .from("groups")
            .select("id, system_kind")
            .eq("organization_id", orgId)
            .eq("branch_id", viewerBranch)
            .or("is_deleted.eq.false,is_deleted.is.null");
          if (gErr) throw gErr;
          filterGroupIds = (branchGroups || [])
            .filter((g) => (g as { system_kind?: string | null }).system_kind !== "all_members")
            .map((g) => (g as { id: string }).id)
            .filter((id) => isUuidString(id));
          if (filterGroupIds.length === 0) {
            return res.json({ mode, members: [] });
          }
        }
      }

      const { data: gmRows, error: gmErr } = await supabaseAdmin
        .from("group_members")
        .select("member_id, created_at, joined_at")
        .eq("organization_id", orgId)
        .in("group_id", filterGroupIds)
        .order("created_at", { ascending: false })
        .limit(Math.min(120, limit * 15));
      if (gmErr) throw gmErr;

      const orderedMemberIds: string[] = [];
      const seenMid = new Set<string>();
      for (const r of gmRows || []) {
        const mid = (r as { member_id?: string | null }).member_id;
        if (!mid || !isUuidString(mid) || seenMid.has(mid)) continue;
        seenMid.add(mid);
        orderedMemberIds.push(mid);
        if (orderedMemberIds.length >= limit * 4) break;
      }

      if (orderedMemberIds.length === 0) {
        return res.json({ mode, members: [] });
      }

      const { data: mdata, error: mErr } = await supabaseAdmin
        .from("members")
        .select("*")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .in("id", orderedMemberIds)
        .or("is_deleted.eq.false,is_deleted.is.null");
      if (mErr) throw mErr;

      const byId = new Map((mdata || []).map((m) => [(m as { id: string }).id, m as RawMember]));
      for (const id of orderedMemberIds) {
        const row = byId.get(id);
        if (!row) continue;
        if (allowedMemberIds !== null && !allowedMemberIds.has(id)) continue;
        memberRows.push(row);
        if (memberRows.length >= limit) break;
      }
    }

    const mids = memberRows.map((m) => m.id);
    if (mids.length === 0) {
      return res.json({ mode, members: [] });
    }

    const [{ data: memberFamilies, error: mfError }, { data: memberGroupRows, error: mgListError }] =
      await Promise.all([
        supabaseAdmin.from("member_families").select("member_id, family_id").in("member_id", mids),
        supabaseAdmin
          .from("group_members")
          .select("member_id, group_id")
          .eq("organization_id", orgId)
          .in("member_id", mids),
      ]);

    if (mfError) {
      return res.status(500).json({ error: "Failed to fetch member families", details: mfError });
    }
    if (mgListError) {
      return res.status(500).json({ error: "Failed to fetch group memberships", details: mgListError });
    }

    const mappedMembers = memberRows.map((m) => ({
      ...m,
      phoneNumber: m.phone_number,
      dateOfBirth: m.dob,
      dateJoined: m.date_joined,
      memberIdString: m.member_id_string,
      profileImage: m.avatar_url || m.memberimage_url || m.member_url || null,
      fullName: `${m.first_name || ""} ${m.last_name || ""}`.trim(),
      location: m.address,
      emergencyContactName: m.emergency_contact_name,
      emergencyContactPhone: m.emergency_contact_phone,
      status: m.status,
      familyIds: (memberFamilies || []).filter((mf) => mf.member_id === m.id).map((mf) => mf.family_id),
      groupIds: (memberGroupRows || []).filter((mg) => mg.member_id === m.id).map((mg) => mg.group_id),
    }));

    res.json({ mode, members: mappedMembers });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

/**
 * Unified header search: members, events, groups (ministries), families.
 * Query: `q` — min 2 characters (after stripping % _ \\).
 */
app.get("/api/search", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_members",
      "view_events",
      "view_groups",
      "view_families",
    ]);
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const pat = searchQueryToIlikePattern(req.query.q);
    if (!pat) {
      return res.json({ members: [], events: [], groups: [], families: [] });
    }
    const like = `%${pat}%`;

    const { data: profForScope } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerScope = (profForScope as { is_org_owner?: boolean } | null)?.is_org_owner === true;

    const canMembers = permCtx.isOrgOwner || permCtx.permissionSet.has("view_members");
    const canEvents = permCtx.isOrgOwner || permCtx.permissionSet.has("view_events");
    const canGroups = permCtx.isOrgOwner || permCtx.permissionSet.has("view_groups");
    const canFamilies = permCtx.isOrgOwner || permCtx.permissionSet.has("view_families");

    type Hit = { id: string; label: string; subtitle: string | null; kind: "member" | "event" | "group" | "family" };
    const members: Hit[] = [];
    const events: Hit[] = [];
    const groups: Hit[] = [];
    const families: Hit[] = [];

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const gScope = mScope;

    if (canMembers) {
      const { data: mrows, error: mErr } = await supabaseAdmin
        .from("members")
        .select("id, first_name, last_name, email, member_id_string")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .or("is_deleted.eq.false,is_deleted.is.null")
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},member_id_string.ilike.${like}`)
        .limit(15);
      if (mErr) throw mErr;
      let list = mrows || [];
      const allowedMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
      if (allowedMemberIds !== null) {
        list = list.filter((m) => allowedMemberIds.has(String((m as { id: string }).id)));
      }
      for (const m of list) {
        const r = m as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          member_id_string: string | null;
        };
        const name = `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Member";
        const sub = r.email || r.member_id_string || null;
        members.push({ id: r.id, label: name, subtitle: sub, kind: "member" });
      }
    }

    if (canEvents) {
      let erows: Record<string, unknown>[] = [];
      const evSel = "id, title, start_time, group_id, location_details";
      const { data: e1, error: eErr } = await supabaseAdmin
        .from("events")
        .select(evSel)
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .or(`title.ilike.${like},location_details.ilike.${like}`)
        .limit(20);
      if (eErr) {
        const msg = String(eErr.message || "").toLowerCase();
        if (msg.includes("location_details") || msg.includes("42703")) {
          const { data: e2, error: e2err } = await supabaseAdmin
            .from("events")
            .select("id, title, start_time, group_id")
            .eq("organization_id", orgId)
            .eq("branch_id", viewerBranch)
            .or(`title.ilike.${like}`)
            .limit(20);
          if (e2err) throw e2err;
          erows = (e2 || []) as Record<string, unknown>[];
        } else {
          throw eErr;
        }
      } else {
        erows = (e1 || []) as Record<string, unknown>[];
      }
      const filtered = await filterEventsRowsByMinistryScope(erows, orgId, viewerBranch, user.id, isOrgOwnerScope);
      for (const row of filtered.slice(0, 15)) {
        const id = String(row.id);
        const title = String(row.title || "Event");
        const st = row.start_time ? String(row.start_time) : null;
        let subtitle: string | null = null;
        if (st) {
          try {
            const d = new Date(st);
            if (!Number.isNaN(d.getTime())) {
              subtitle = formatLongWeekdayDateTime(st) || null;
            }
          } catch {
            subtitle = null;
          }
        }
        events.push({ id, label: title, subtitle, kind: "event" });
      }
    }

    if (canGroups) {
      const { data: grows, error: gErr } = await supabaseAdmin
        .from("groups")
        .select("id, name, description, group_type, is_system, system_kind, parent_group_id, is_deleted")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .or("is_deleted.eq.false,is_deleted.is.null")
        .or(`name.ilike.${like},description.ilike.${like}`)
        .limit(12);
      if (gErr) throw gErr;
      let glist = filterGroupRowsByMinistryScope(
        (grows || []) as { id: string; is_system?: boolean | null; system_kind?: string | null }[],
        gScope,
        true,
      );
      for (const g of glist.slice(0, 12)) {
        const gr = g as { id: string; name: string | null; description?: string | null; group_type?: string | null };
        const label = (gr.name || "").trim() || "Group";
        const subtitle = (gr.description?.trim() || gr.group_type || null) as string | null;
        groups.push({ id: gr.id, label, subtitle, kind: "group" });
      }
    }

    if (canFamilies) {
      const { data: frows, error: fErr } = await supabaseAdmin
        .from("families")
        .select("id, family_name, address")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .or(`family_name.ilike.${like},address.ilike.${like}`)
        .limit(12);
      if (fErr) {
        const msg = String(fErr.message || "").toLowerCase();
        if (msg.includes("address") || msg.includes("42703")) {
          const { data: f2, error: f2err } = await supabaseAdmin
            .from("families")
            .select("id, family_name")
            .eq("organization_id", orgId)
            .eq("branch_id", viewerBranch)
            .ilike("family_name", like)
            .limit(12);
          if (f2err) throw f2err;
          for (const f of f2 || []) {
            const fr = f as { id: string; family_name: string | null };
            families.push({
              id: fr.id,
              label: (fr.family_name || "").trim() || "Family",
              subtitle: null,
              kind: "family",
            });
          }
        } else {
          throw fErr;
        }
      } else {
        for (const f of frows || []) {
          const fr = f as { id: string; family_name: string | null; address?: string | null };
          families.push({
            id: fr.id,
            label: (fr.family_name || "").trim() || "Family",
            subtitle: (fr.address && String(fr.address).trim()) || null,
            kind: "family",
          });
        }
      }
    }

    res.json({ members, events, groups, families });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    const msg = String(error?.message || "Search failed");
    const authLike =
      msg === "Invalid token" ||
      msg === "User profile not found" ||
      msg.toLowerCase().includes("jwt") ||
      msg.toLowerCase().includes("invalid token");
    if (authLike) {
      return res.status(401).json({ error: msg });
    }
    console.error("[GET /api/search]", error);
    res.status(500).json({ error: msg });
  }
});

/** Single member (same shape as one element from GET /api/members). Used by mobile profile when list lookup misses. */
app.get("/api/members/:memberId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requireAnyPermission(req, res, ["view_members", ...ANY_MEMBER_OR_GROUP_TASK_PERM]);
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: m, error } = await supabaseAdmin
      .from("members")
      .select("*")
      .eq("id", memberId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) throw error;
    if (!m) return res.status(404).json({ error: "Member not found" });

    if ((m as { is_deleted?: boolean }).is_deleted === true) {
      return res.status(404).json({ error: "Member not found" });
    }

    try {
      assertEntityBranch((m as { branch_id?: string | null }).branch_id, viewerBranch, "member");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Member not found" });
      throw e;
    }

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
    if (allowedMemberIds !== null && !allowedMemberIds.has(memberId)) {
      return res.status(403).json({ error: "You do not have access to this member." });
    }

    const { data: mfRows } = await supabaseAdmin
      .from("member_families")
      .select("member_id, family_id")
      .eq("member_id", memberId);

    const { data: mgRows } = await supabaseAdmin
      .from("group_members")
      .select("member_id, group_id")
      .eq("organization_id", orgId)
      .eq("member_id", memberId);

    const mapped = {
      ...m,
      phoneNumber: (m as { phone_number?: string | null }).phone_number,
      dateOfBirth: (m as { dob?: string | null }).dob,
      dateJoined: (m as { date_joined?: string | null }).date_joined,
      memberIdString: (m as { member_id_string?: string | null }).member_id_string,
      profileImage:
        (m as { avatar_url?: string | null }).avatar_url ||
        (m as { memberimage_url?: string | null }).memberimage_url ||
        (m as { member_url?: string | null }).member_url ||
        null,
      fullName: `${(m as { first_name?: string }).first_name || ""} ${(m as { last_name?: string }).last_name || ""}`.trim(),
      location: (m as { address?: string | null }).address,
      emergencyContactName: (m as { emergency_contact_name?: string | null }).emergency_contact_name,
      emergencyContactPhone: (m as { emergency_contact_phone?: string | null }).emergency_contact_phone,
      status: (m as { status?: string | null }).status,
      familyIds: (mfRows || []).map((mf: { family_id: string }) => mf.family_id),
      groupIds: (mgRows || []).map((mg: { group_id: string }) => mg.group_id),
    };

    res.json(mapped);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.get("/api/members/:memberId/groups", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "view_members");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
    if (allowedIds !== null && !allowedIds.has(memberId)) {
      return res.status(403).json({ error: "You do not have access to this member." });
    }

    const { data: mem, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", memberId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!mem) return res.status(404).json({ error: "Member not found" });
    try {
      assertEntityBranch((mem as { branch_id?: string | null }).branch_id, viewerBranch, "member");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Member not found" });
      throw e;
    }

    const { data: gmRows, error: gmErr } = await supabaseAdmin
      .from("group_members")
      .select("group_id, role_in_group")
      .eq("member_id", memberId)
      .eq("organization_id", orgId);

    if (gmErr) throw gmErr;

    const roleByGroup = new Map<string, string>();
    for (const r of gmRows || []) {
      const gid = (r as { group_id?: string }).group_id;
      if (typeof gid !== "string" || !isUuidString(gid)) continue;
      if (!roleByGroup.has(gid)) {
        const role = (r as { role_in_group?: string | null }).role_in_group;
        roleByGroup.set(gid, typeof role === "string" && role.trim() ? role.trim() : "Member");
      }
    }

    const groupIds = [...roleByGroup.keys()];
    if (groupIds.length === 0) {
      return res.json([]);
    }

    const { data: groups, error: gErr } = await supabaseAdmin
      .from("groups")
      .select("id, name, description, group_type, parent_group_id, branch_id")
      .in("id", groupIds)
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch);

    if (gErr) throw gErr;

    const { data: gmPreviewRows, error: gmPrevErr } = await supabaseAdmin
      .from("group_members")
      .select("group_id, member_id, members(memberimage_url, first_name, last_name)")
      .in("group_id", groupIds)
      .eq("organization_id", orgId);

    if (gmPrevErr) throw gmPrevErr;

    type MemberPreviewRow = {
      group_id: string;
      member_id: string | null;
      members: {
        memberimage_url?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      } | null;
    };

    const byGroupPreview = new Map<string, MemberPreviewRow[]>();
    for (const row of (gmPreviewRows || []) as MemberPreviewRow[]) {
      const gid = row.group_id;
      if (!byGroupPreview.has(gid)) byGroupPreview.set(gid, []);
      byGroupPreview.get(gid)!.push(row);
    }

    const out = (groups || []).map((g: { id: string; name: string | null; description?: string | null; group_type?: string | null; parent_group_id?: string | null }) => {
      const rows = byGroupPreview.get(g.id) || [];
      const seen = new Set<string>();
      const uniqueRows: MemberPreviewRow[] = [];
      for (const r of rows) {
        const mid = r.member_id;
        if (!mid || typeof mid !== "string") continue;
        if (seen.has(mid)) continue;
        seen.add(mid);
        uniqueRows.push(r);
      }
      const member_count = uniqueRows.length;
      const member_preview = uniqueRows.slice(0, 3).map((r) => {
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
        id: g.id,
        group_id: g.id,
        name: (g.name || "").trim() || "Ministry",
        description: g.description ?? null,
        group_type: g.group_type ?? null,
        parent_group_id: g.parent_group_id ?? null,
        role_in_group: roleByGroup.get(g.id) || "Member",
        viewer_accessible: groupIdVisibleUnderScope(g.id, mScope),
        member_count,
        member_preview,
      };
    });

    out.sort((a, b) => a.name.localeCompare(b.name));
    res.json(out);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load member ministries" });
  }
});

app.get("/api/members/:memberId/events", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "view_members");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: mem, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", memberId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!mem) return res.status(404).json({ error: "Member not found" });
    try {
      assertEntityBranch((mem as { branch_id?: string | null }).branch_id, viewerBranch, "member");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Member not found" });
      throw e;
    }

    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const eventIds = await fetchEventIdsForMember(memberId, orgId, viewerBranch);
    if (eventIds.length === 0) {
      return res.json({ events: [] });
    }

    const idList = eventIds.slice(0, 200);
    let query = supabaseAdmin
      .from("events")
      .select(EVENTS_SELECT)
      .in("id", idList)
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .order("start_time", { ascending: false });

    let { data: evRows, error: evErr } = await query;

    if (evErr) {
      const msg = String(evErr.message || "").toLowerCase();
      const code = (evErr as { code?: string }).code;
      if (
        msg.includes("cover_image_url") ||
        msg.includes("program_outline") ||
        msg.includes("attachments") ||
        msg.includes("custom_fields") ||
        code === "42703"
      ) {
        const retry = await supabaseAdmin
          .from("events")
          .select("id, title, start_time, end_time, event_type, group_id, groups!group_id(name)")
          .in("id", idList)
          .eq("organization_id", orgId)
          .eq("branch_id", viewerBranch)
          .order("start_time", { ascending: false });
        if (retry.error) throw retry.error;
        evRows = retry.data;
      } else {
        throw evErr;
      }
    }

    const evFiltered = await filterEventsRowsByMinistryScope(
      (evRows || []) as Record<string, unknown>[],
      orgId,
      viewerBranch,
      user.id,
      permCtx.isOrgOwner,
    );
    const events = evFiltered;
    const visibleIdList = events.map((e) => String(e.id || "")).filter((id) => isUuidString(id));

    let attRows: {
      event_id?: string;
      status?: string;
      check_in_time?: string | null;
      recorded_by_user_id?: string | null;
      updated_at?: string | null;
    }[] = [];
    if (visibleIdList.length > 0) {
      const { data: attData, error: attErr } = await supabaseAdmin
        .from("event_attendance")
        .select("event_id, status, check_in_time, check_in_method, recorded_by_user_id, updated_at")
        .eq("member_id", memberId)
        .eq("organization_id", orgId)
        .in("event_id", visibleIdList);
      if (attErr) throw attErr;
      attRows = (attData || []) as typeof attRows;
    }

    const attByEvent = new Map<
      string,
      {
        status: string;
        check_in_time: string | null;
        recorded_by_user_id: string | null;
        updated_at: string | null;
      }
    >();
    for (const a of attRows || []) {
      const row = a as {
        event_id?: string;
        status?: string;
        check_in_time?: string | null;
        recorded_by_user_id?: string | null;
        updated_at?: string | null;
      };
      if (row.event_id && typeof row.status === "string") {
        attByEvent.set(row.event_id, {
          status: row.status,
          check_in_time: row.check_in_time ?? null,
          recorded_by_user_id: typeof row.recorded_by_user_id === "string" ? row.recorded_by_user_id : null,
          updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
        });
      }
    }

    const recorderIds = new Set<string>();
    for (const v of attByEvent.values()) {
      if (v.recorded_by_user_id) recorderIds.add(v.recorded_by_user_id);
    }
    const nameByRecorderId = new Map<string, string>();
    if (recorderIds.size > 0) {
      const { data: recProfs, error: recErr } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name")
        .in("id", [...recorderIds]);
      if (recErr) throw recErr;
      for (const p of recProfs || []) {
        const pr = p as { id?: string; first_name?: string | null; last_name?: string | null };
        const fn = (pr.first_name || "").trim();
        const ln = (pr.last_name || "").trim();
        const label = [fn, ln].filter(Boolean).join(" ").trim() || "Staff";
        if (pr.id) nameByRecorderId.set(pr.id, label);
      }
    }

    const payload = events.map((ev) => {
      const id = String(ev.id || "");
      const g = ev.groups as { name?: string | null } | null | undefined;
      const groupName =
        g && typeof g === "object" && !Array.isArray(g) && typeof g.name === "string"
          ? g.name.trim() || null
          : null;
      const att = attByEvent.get(id);
      const rid = att?.recorded_by_user_id ?? null;
      return {
        id,
        title: (ev.title as string) || "",
        start_time: ev.start_time as string,
        end_time: (ev.end_time as string | null) ?? null,
        event_type: (ev.event_type as string | null) ?? null,
        status: (ev.status as string | null) ?? null,
        group_name: groupName,
        attendance_status: att?.status ?? "not_marked",
        check_in_time: att?.check_in_time ?? null,
        attendance_recorded_by_user_id: rid,
        attendance_recorded_by_name: rid ? nameByRecorderId.get(rid) ?? null : null,
        attendance_updated_at: att?.updated_at ?? null,
      };
    });

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const paged = payload.slice(offset, offset + limit);
    res.json({ events: paged });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load member events" });
  }
});

async function assertMemberForOrgBranch(
  memberId: string,
  orgId: string,
  viewerBranch: string,
): Promise<void> {
  const { data: mem, error: memErr } = await supabaseAdmin
    .from("members")
    .select("id, branch_id")
    .eq("id", memberId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) {
    const e = new Error("Member not found") as Error & { statusCode?: number };
    e.statusCode = 404;
    throw e;
  }
  try {
    assertEntityBranch((mem as { branch_id?: string | null }).branch_id, viewerBranch, "member");
  } catch (e: any) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404) {
      const err = new Error("Member not found") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    throw e;
  }
}

async function assertMemberVisibleUnderMinistryScope(
  memberId: string,
  orgId: string,
  viewerBranch: string,
  userId: string,
  isOrgOwner: boolean,
): Promise<void> {
  const mScope = await ministryScopeForActor(userId, orgId, viewerBranch, isOrgOwner);
  const allowed = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
  if (allowed === null) return;
  if (!allowed.has(memberId)) {
    const e = new Error("You do not have access to this member.") as Error & { statusCode?: number };
    e.statusCode = 403;
    throw e;
  }
}

async function assertGroupVisibleUnderMinistryScope(
  groupId: string,
  orgId: string,
  viewerBranch: string,
  userId: string,
  isOrgOwner: boolean,
): Promise<void> {
  const mScope = await ministryScopeForActor(userId, orgId, viewerBranch, isOrgOwner);
  if (!groupIdVisibleUnderScope(groupId, mScope)) {
    const e = new Error("You do not have access to this group.") as Error & { statusCode?: number };
    e.statusCode = 403;
    throw e;
  }
}

async function fetchProfileMinistryScopeGroupIds(profileId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profile_ministry_scope")
      .select("group_id")
      .eq("profile_id", profileId);
    if (error) {
      const m = String(error.message || "").toLowerCase();
      if (m.includes("profile_ministry_scope") || m.includes("42p01") || m.includes("does not exist")) {
        return [];
      }
      throw error;
    }
    return [
      ...new Set(
        (data || [])
          .map((r) => (r as { group_id?: string }).group_id)
          .filter((id): id is string => typeof id === "string" && isUuidString(id)),
      ),
    ];
  } catch {
    return [];
  }
}

function memberTasksTableMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = `${o.code || ""} ${o.message || ""}`.toLowerCase();
  // Do not treat "column … of relation member_tasks does not exist" as a missing table.
  if (o.code === "42703") return false;
  if (m.includes("column") && m.includes("does not exist")) return false;
  if (m.includes("could not find") && m.includes("column")) return false;
  return o.code === "42P01" || (m.includes("member_tasks") && m.includes("does not exist"));
}

/** First SELECT used MEMBER_TASK_DB_FIELDS; retry with fewer columns when a migration column is absent. */
function memberTasksSelectMissingColumn(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = `${o.message || ""}`.toLowerCase();
  if (o.code === "42703") return true;
  if (m.includes("column") && m.includes("does not exist")) return true;
  if (m.includes("could not find") && m.includes("column") && m.includes("member_tasks")) return true;
  if (m.includes("checklist") || m.includes("related_member") || m.includes("assignee_profile_ids")) return true;
  return false;
}

async function assertAssigneeProfileForBranch(
  assigneeProfileId: string,
  orgId: string,
  viewerBranch: string,
): Promise<void> {
  const { data: p, error } = await supabaseAdmin
    .from("profiles")
    .select("id, organization_id, branch_id")
    .eq("id", assigneeProfileId)
    .maybeSingle();
  if (error) throw error;
  if (!p || String((p as { organization_id: string }).organization_id) !== String(orgId)) {
    throw httpError(404, "Assignee not found.");
  }
  const home =
    (p as { branch_id?: string | null }).branch_id != null &&
    String((p as { branch_id?: string | null }).branch_id).length > 0
      ? String((p as { branch_id?: string | null }).branch_id)
      : null;
  if (home && home !== viewerBranch) {
    throw httpError(400, "Assignee belongs to a different branch.");
  }
}

type TaskChecklistItem = { id: string; label: string; done: boolean };

function coerceChecklistInput(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t) as unknown;
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function checklistItemLabelFromObject(o: Record<string, unknown>): string {
  if (typeof o.label === "string" && o.label.trim()) return o.label.trim();
  if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
  return "";
}

/** RFC-style UUID v4 from seed so checklist ids stay stable across reads (merge/toggle). */
function deterministicChecklistItemId(scopeId: string, index: number, label: string): string {
  const h = crypto.createHash("md5").update(`${scopeId}|${index}|${label}`).digest("hex");
  const p1 = h.slice(0, 8);
  const p2 = h.slice(8, 12);
  const p3 = "4" + h.slice(13, 16);
  const v = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  const p4 = v + h.slice(18, 20);
  const p5 = h.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

function normalizeChecklistFromBody(raw: unknown, scopeIdForNewIds: string): TaskChecklistItem[] {
  const source = coerceChecklistInput(raw);
  const out: TaskChecklistItem[] = [];
  let idx = 0;
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = checklistItemLabelFromObject(o);
    if (!label) continue;
    const id =
      typeof o.id === "string" && isUuidString(o.id)
        ? o.id
        : deterministicChecklistItemId(scopeIdForNewIds, idx, label);
    out.push({ id, label, done: o.done === true });
    idx += 1;
  }
  return out;
}

function parseChecklistFromRow(raw: unknown, taskId: string): TaskChecklistItem[] {
  const source = coerceChecklistInput(raw);
  const out: TaskChecklistItem[] = [];
  let idx = 0;
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = checklistItemLabelFromObject(o);
    if (!label) continue;
    const id =
      typeof o.id === "string" && isUuidString(o.id)
        ? o.id
        : deterministicChecklistItemId(taskId, idx, label);
    out.push({ id, label, done: o.done === true });
    idx += 1;
  }
  return out;
}

function relatedIdsFromRow(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.filter((x): x is string => typeof x === "string" && isUuidString(x)))];
  }
  return [];
}

function mergeChecklistDoneOnly(
  existing: TaskChecklistItem[],
  patch: unknown,
): TaskChecklistItem[] | null {
  if (!Array.isArray(patch)) return null;
  const byId = new Map(existing.map((i) => [i.id, { ...i }]));
  for (const item of patch) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!isUuidString(id) || !byId.has(id)) return null;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    if (keys.some((k) => k !== "id" && k !== "done")) return null;
    if (o.done !== undefined && o.done !== true && o.done !== false) return null;
    const cur = byId.get(id)!;
    if (o.done !== undefined) cur.done = o.done === true;
  }
  return [...byId.values()];
}

async function assertRelatedMembersForTask(
  orgId: string,
  viewerBranch: string,
  primaryMemberId: string,
  relatedIds: string[],
  viewerUserId?: string,
  viewerIsOrgOwner?: boolean,
): Promise<string[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of relatedIds) {
    if (!isUuidString(id)) continue;
    if (id === primaryMemberId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  for (const mid of unique) {
    await assertMemberForOrgBranch(mid, orgId, viewerBranch);
    if (viewerUserId !== undefined) {
      await assertMemberVisibleUnderMinistryScope(mid, orgId, viewerBranch, viewerUserId, viewerIsOrgOwner ?? false);
    }
  }
  return unique;
}

async function assertGroupForOrgBranch(
  groupId: string,
  orgId: string,
  viewerBranch: string,
): Promise<void> {
  const { data: g, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id, branch_id")
    .eq("id", groupId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (gErr) throw gErr;
  if (!g) {
    const e = new Error("Group not found") as Error & { statusCode?: number };
    e.statusCode = 404;
    throw e;
  }
  try {
    assertEntityBranch((g as { branch_id?: string | null }).branch_id, viewerBranch, "group");
  } catch (e: any) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404) {
      const err = new Error("Group not found") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    throw e;
  }
}

async function assertRelatedGroupsForTask(
  orgId: string,
  viewerBranch: string,
  primaryGroupId: string,
  relatedIds: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of relatedIds) {
    if (!isUuidString(id)) continue;
    if (id === primaryGroupId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  for (const gid of unique) {
    await assertGroupForOrgBranch(gid, orgId, viewerBranch);
  }
  return unique;
}

function assigneeProfileIdsFromMemberTaskRow(row: {
  assignee_profile_id: string;
  assignee_profile_ids?: string[] | null;
}): string[] {
  const raw = row.assignee_profile_ids;
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw) {
      if (typeof id === "string" && isUuidString(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    if (out.length > 0) return out;
  }
  return row.assignee_profile_id ? [row.assignee_profile_id] : [];
}

function assigneeProfileIdsFromGroupTaskRow(row: {
  assignee_profile_id: string;
  assignee_profile_ids?: string[] | null;
}): string[] {
  const raw = row.assignee_profile_ids;
  if (Array.isArray(raw) && raw.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw) {
      if (typeof id === "string" && isUuidString(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    if (out.length > 0) return out;
  }
  return row.assignee_profile_id ? [row.assignee_profile_id] : [];
}

function parseAssigneeProfileIdsFromPostBody(body: unknown): { ids: string[]; error: string | null } {
  const b = body as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== "object") return { ids: [], error: "Invalid body" };
  const arr = b["assignee_profile_ids"];
  if (Array.isArray(arr)) {
    const ids = [
      ...new Set(
        arr
          .filter((x): x is string => typeof x === "string" && isUuidString(x.trim()))
          .map((x) => x.trim()),
      ),
    ];
    if (ids.length > 0) return { ids, error: null };
  }
  const single = typeof b["assignee_profile_id"] === "string" ? b["assignee_profile_id"].trim() : "";
  if (isUuidString(single)) return { ids: [single], error: null };
  return { ids: [], error: "assignee_profile_id or assignee_profile_ids is required" };
}

function parseAssigneeProfileIdsFromPatchBody(body: unknown): { ids: string[] | undefined; error: string | null } {
  const b = body as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== "object") return { ids: undefined, error: null };
  if (b["assignee_profile_ids"] !== undefined) {
    if (!Array.isArray(b["assignee_profile_ids"])) {
      return { ids: undefined, error: "assignee_profile_ids must be an array" };
    }
    const ids = [
      ...new Set(
        (b["assignee_profile_ids"] as unknown[])
          .filter((x): x is string => typeof x === "string" && isUuidString(x.trim()))
          .map((x) => x.trim()),
      ),
    ];
    if (ids.length === 0) {
      return { ids: undefined, error: "assignee_profile_ids must include at least one UUID" };
    }
    return { ids, error: null };
  }
  if (typeof b["assignee_profile_id"] === "string" && isUuidString(b["assignee_profile_id"].trim())) {
    return { ids: [b["assignee_profile_id"].trim()], error: null };
  }
  return { ids: undefined, error: null };
}

function mergeTaskRowsById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) map.set(r.id, r);
  return [...map.values()];
}

function taskAssigneeFilterColumnMissing(err: unknown): boolean {
  const m = `${(err as { message?: string })?.message || ""}`.toLowerCase();
  return m.includes("assignee_profile_ids") && (m.includes("does not exist") || m.includes("column"));
}

const MEMBER_TASK_DB_FIELDS =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, checklist, related_member_ids, branch_id, organization_id";
/** When `assignee_profile_ids` column is not migrated yet. */
const MEMBER_TASK_DB_FIELDS_LEGACY =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, created_by_profile_id, checklist, related_member_ids, branch_id, organization_id";

type MemberTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  member_id: string;
  assignee_profile_id: string;
  assignee_profile_ids?: string[] | null;
  created_by_profile_id: string;
  organization_id?: string;
  branch_id?: string | null;
  checklist?: unknown;
  related_member_ids?: unknown;
};

function mapMemberTaskRowToJson(t: MemberTaskRow) {
  const assignee_profile_ids = assigneeProfileIdsFromMemberTaskRow(t);
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    due_at: t.due_at ?? null,
    completed_at: t.completed_at ?? null,
    created_at: t.created_at,
    updated_at: t.updated_at,
    member_id: t.member_id,
    assignee_profile_id: t.assignee_profile_id,
    assignee_profile_ids,
    created_by_profile_id: t.created_by_profile_id,
    checklist: parseChecklistFromRow(t.checklist ?? [], t.id),
    related_member_ids: relatedIdsFromRow(t.related_member_ids ?? []),
  };
}

const GROUP_TASK_DB_FIELDS =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, checklist, related_group_ids, branch_id, organization_id";
const GROUP_TASK_DB_FIELDS_LEGACY =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, created_by_profile_id, checklist, related_group_ids, branch_id, organization_id";

type GroupTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  group_id: string;
  assignee_profile_id: string;
  assignee_profile_ids?: string[] | null;
  created_by_profile_id: string;
  organization_id?: string;
  branch_id?: string | null;
  checklist?: unknown;
  related_group_ids?: unknown;
};

function mapGroupTaskRowToJson(t: GroupTaskRow) {
  const assignee_profile_ids = assigneeProfileIdsFromGroupTaskRow(t);
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    due_at: t.due_at ?? null,
    completed_at: t.completed_at ?? null,
    created_at: t.created_at,
    updated_at: t.updated_at,
    group_id: t.group_id,
    assignee_profile_id: t.assignee_profile_id,
    assignee_profile_ids,
    created_by_profile_id: t.created_by_profile_id,
    checklist: parseChecklistFromRow(t.checklist ?? [], t.id),
    related_group_ids: relatedIdsFromRow(t.related_group_ids ?? []),
  };
}

/**
 * Fallback task list queries omit `checklist` (and sometimes related_* columns) so the main query
 * succeeds when PostgREST errors on newer columns. Merge those fields from a second read by id.
 */
async function enrichMemberTaskRowsFromIds(orgId: string, rows: MemberTaskRow[]): Promise<MemberTaskRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabaseAdmin
    .from("member_tasks")
    .select("id, checklist, related_member_ids")
    .eq("organization_id", orgId)
    .in("id", ids);
  if (error) return rows;
  const byId = new Map(
    (data as { id: string; checklist?: unknown; related_member_ids?: unknown }[] | null)?.map((r) => [r.id, r]) ?? [],
  );
  return rows.map((r) => {
    const extra = byId.get(r.id);
    if (!extra) return r;
    return {
      ...r,
      checklist: extra.checklist ?? r.checklist,
      related_member_ids: extra.related_member_ids ?? r.related_member_ids,
    };
  });
}

async function enrichGroupTaskRowsFromIds(orgId: string, rows: GroupTaskRow[]): Promise<GroupTaskRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabaseAdmin
    .from("group_tasks")
    .select("id, checklist, related_group_ids")
    .eq("organization_id", orgId)
    .in("id", ids);
  if (error) return rows;
  const byId = new Map(
    (data as { id: string; checklist?: unknown; related_group_ids?: unknown }[] | null)?.map((r) => [r.id, r]) ?? [],
  );
  return rows.map((r) => {
    const extra = byId.get(r.id);
    if (!extra) return r;
    return {
      ...r,
      checklist: extra.checklist ?? r.checklist,
      related_group_ids: extra.related_group_ids ?? r.related_group_ids,
    };
  });
}

function groupTasksTableMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = `${o.code || ""} ${o.message || ""}`.toLowerCase();
  if (o.code === "42703") return false;
  if (m.includes("column") && m.includes("does not exist")) return false;
  if (m.includes("could not find") && m.includes("column")) return false;
  return o.code === "42P01" || (m.includes("group_tasks") && m.includes("does not exist"));
}

function groupTasksSelectMissingColumn(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = `${o.message || ""}`.toLowerCase();
  if (o.code === "42703") return true;
  if (m.includes("column") && m.includes("does not exist")) return true;
  if (m.includes("could not find") && m.includes("column") && m.includes("group_tasks")) return true;
  if (m.includes("checklist") || m.includes("related_group") || m.includes("assignee_profile_ids")) return true;
  return false;
}

async function attachGroupNamesToTasks(
  tasks: ReturnType<typeof mapGroupTaskRowToJson>[],
): Promise<
  Array<
    ReturnType<typeof mapGroupTaskRowToJson> & {
      groups: { id: string; name: string | null }[];
    }
  >
> {
  const allIds = new Set<string>();
  for (const t of tasks) {
    allIds.add(t.group_id);
    for (const id of t.related_group_ids) allIds.add(id);
  }
  if (allIds.size === 0) return tasks.map((t) => ({ ...t, groups: [] }));
  const { data: grps } = await supabaseAdmin
    .from("groups")
    .select("id, name")
    .in("id", [...allIds]);
  const nm = new Map<string, { id: string; name: string | null }>();
  for (const g of grps || []) {
    const row = g as { id: string; name: string | null };
    nm.set(row.id, row);
  }
  return tasks.map((t) => {
    const order = [t.group_id, ...t.related_group_ids.filter((id) => id !== t.group_id)];
    const seen = new Set<string>();
    const groups: { id: string; name: string | null }[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = nm.get(id);
      if (row) groups.push(row);
    }
    return { ...t, groups };
  });
}

async function attachMemberNamesToTasks(
  tasks: ReturnType<typeof mapMemberTaskRowToJson>[],
): Promise<
  Array<
    ReturnType<typeof mapMemberTaskRowToJson> & {
      members: { id: string; first_name: string | null; last_name: string | null }[];
    }
  >
> {
  const allIds = new Set<string>();
  for (const t of tasks) {
    allIds.add(t.member_id);
    for (const id of t.related_member_ids) allIds.add(id);
  }
  if (allIds.size === 0) return tasks.map((t) => ({ ...t, members: [] }));
  const { data: mems } = await supabaseAdmin
    .from("members")
    .select("id, first_name, last_name")
    .in("id", [...allIds]);
  const nm = new Map<string, { id: string; first_name: string | null; last_name: string | null }>();
  for (const m of mems || []) {
    const row = m as { id: string; first_name: string | null; last_name: string | null };
    nm.set(row.id, row);
  }
  return tasks.map((t) => {
    const order = [t.member_id, ...t.related_member_ids.filter((id) => id !== t.member_id)];
    const seen = new Set<string>();
    const members: { id: string; first_name: string | null; last_name: string | null }[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = nm.get(id);
      if (row) members.push(row);
    }
    return { ...t, members };
  });
}

async function listMemberTasksForAssigneeInBranch(
  orgId: string,
  viewerBranch: string,
  assigneeProfileId: string,
  openOnly: boolean,
): Promise<Awaited<ReturnType<typeof attachMemberNamesToTasks>>> {
  const selFull =
    "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_member_ids";
  const selFb =
    "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, created_by_profile_id, branch_id";

  async function fetchPair(selectStr: string) {
    const hasAssigneeIds = selectStr.includes("assignee_profile_ids");
    let qPrimary = supabaseAdmin
      .from("member_tasks")
      .select(selectStr)
      .eq("organization_id", orgId)
      .eq("assignee_profile_id", assigneeProfileId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (openOnly) qPrimary = qPrimary.in("status", ["pending", "in_progress"]);
    let qCo: typeof qPrimary | null = null;
    if (hasAssigneeIds) {
      qCo = supabaseAdmin
        .from("member_tasks")
        .select(selectStr)
        .eq("organization_id", orgId)
        .contains("assignee_profile_ids", [assigneeProfileId])
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (openOnly) qCo = qCo.in("status", ["pending", "in_progress"]);
    }
    const results = await Promise.all([qPrimary, ...(qCo ? [qCo] : [])]);
    return [results[0], results[1] ?? { data: [] as any[], error: null }] as const;
  }

  let usedFallbackSelect = false;
  let [rPrimary, rCo] = await fetchPair(selFull);
  const errMsg = String(rPrimary.error?.message || "").toLowerCase();
  if (rPrimary.error && (errMsg.includes("checklist") || errMsg.includes("assignee_profile_ids"))) {
    usedFallbackSelect = true;
    [rPrimary, rCo] = await fetchPair(selFb);
  }
  if (rPrimary.error) {
    if (memberTasksTableMissing(rPrimary.error)) return [];
    throw rPrimary.error;
  }
  let coRows: MemberTaskRow[] = [];
  if (rCo.error) {
    if (taskAssigneeFilterColumnMissing(rCo.error)) coRows = [];
    else if (String(rCo.error.message || "").toLowerCase().includes("checklist")) {
      usedFallbackSelect = true;
      const [rPb, rCb] = await fetchPair(selFb);
      if (rPb.error) {
        if (memberTasksTableMissing(rPb.error)) return [];
        throw rPb.error;
      }
      rPrimary = rPb;
      if (rCb.error && !taskAssigneeFilterColumnMissing(rCb.error)) throw rCb.error;
      coRows = (rCb.data || []) as MemberTaskRow[];
    } else throw rCo.error;
  } else {
    coRows = (rCo.data || []) as MemberTaskRow[];
  }

  let tasks = mergeTaskRowsById((rPrimary.data || []) as MemberTaskRow[], coRows);
  if (usedFallbackSelect) {
    tasks = await enrichMemberTaskRowsFromIds(orgId, tasks);
  }

  const allMemberIds = new Set<string>();
  for (const t of tasks) {
    allMemberIds.add(t.member_id);
    for (const id of relatedIdsFromRow(t.related_member_ids)) allMemberIds.add(id);
  }
  if (allMemberIds.size === 0) return [];
  const { data: mems, error: mErr } = await supabaseAdmin
    .from("members")
    .select("id, first_name, last_name, branch_id")
    .in("id", [...allMemberIds]);
  if (mErr) throw mErr;
  const allowed = new Set<string>();
  const nm = new Map<string, { id: string; first_name: string | null; last_name: string | null }>();
  for (const m of mems || []) {
    const row = m as { id: string; first_name: string | null; last_name: string | null; branch_id?: string | null };
    nm.set(row.id, { id: row.id, first_name: row.first_name, last_name: row.last_name });
    const eb =
      row.branch_id != null && String(row.branch_id).length > 0 ? String(row.branch_id) : null;
    if (!eb || eb === viewerBranch) allowed.add(row.id);
  }
  const jsonTasks = tasks
    .filter((t: MemberTaskRow) => {
      if (allowed.has(t.member_id)) return true;
      return relatedIdsFromRow(t.related_member_ids).some((id) => allowed.has(id));
    })
    .map((t: MemberTaskRow) => mapMemberTaskRowToJson(t));
  return jsonTasks.map((t) => {
    const order = [t.member_id, ...t.related_member_ids.filter((id) => id !== t.member_id)];
    const seen = new Set<string>();
    const members: { id: string; first_name: string | null; last_name: string | null }[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = nm.get(id);
      if (row) members.push(row);
    }
    return { ...t, members };
  });
}

async function listGroupTasksForAssigneeInBranch(
  orgId: string,
  viewerBranch: string,
  assigneeProfileId: string,
  openOnly: boolean,
): Promise<Awaited<ReturnType<typeof attachGroupNamesToTasks>>> {
  const selFull =
    "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_group_ids";
  const selFb =
    "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, created_by_profile_id, branch_id, related_group_ids";

  async function fetchPair(selectStr: string) {
    const hasAssigneeIds = selectStr.includes("assignee_profile_ids");
    let qPrimary = supabaseAdmin
      .from("group_tasks")
      .select(selectStr)
      .eq("organization_id", orgId)
      .eq("assignee_profile_id", assigneeProfileId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (openOnly) qPrimary = qPrimary.in("status", ["pending", "in_progress"]);
    let qCo: typeof qPrimary | null = null;
    if (hasAssigneeIds) {
      qCo = supabaseAdmin
        .from("group_tasks")
        .select(selectStr)
        .eq("organization_id", orgId)
        .contains("assignee_profile_ids", [assigneeProfileId])
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (openOnly) qCo = qCo.in("status", ["pending", "in_progress"]);
    }
    const results = await Promise.all([qPrimary, ...(qCo ? [qCo] : [])]);
    return [results[0], results[1] ?? { data: [] as any[], error: null }] as const;
  }

  let usedFallbackSelect = false;
  let [rPrimary, rCo] = await fetchPair(selFull);
  const errMsg = String(rPrimary.error?.message || "").toLowerCase();
  if (rPrimary.error && (errMsg.includes("checklist") || errMsg.includes("assignee_profile_ids"))) {
    usedFallbackSelect = true;
    [rPrimary, rCo] = await fetchPair(selFb);
  }
  if (rPrimary.error) {
    if (groupTasksTableMissing(rPrimary.error)) return [];
    throw rPrimary.error;
  }
  let coRows: GroupTaskRow[] = [];
  if (rCo.error) {
    if (taskAssigneeFilterColumnMissing(rCo.error)) coRows = [];
    else if (String(rCo.error.message || "").toLowerCase().includes("checklist")) {
      usedFallbackSelect = true;
      const [rPb, rCb] = await fetchPair(selFb);
      if (rPb.error) {
        if (groupTasksTableMissing(rPb.error)) return [];
        throw rPb.error;
      }
      rPrimary = rPb;
      if (rCb.error && !taskAssigneeFilterColumnMissing(rCb.error)) throw rCb.error;
      coRows = (rCb.data || []) as GroupTaskRow[];
    } else throw rCo.error;
  } else {
    coRows = (rCo.data || []) as GroupTaskRow[];
  }

  let tasks = mergeTaskRowsById((rPrimary.data || []) as GroupTaskRow[], coRows);
  if (usedFallbackSelect) {
    tasks = await enrichGroupTaskRowsFromIds(orgId, tasks);
  }

  const allGroupIds = new Set<string>();
  for (const t of tasks) {
    allGroupIds.add(t.group_id);
    for (const id of relatedIdsFromRow(t.related_group_ids)) allGroupIds.add(id);
  }
  if (allGroupIds.size === 0) return [];
  const { data: grps, error: gErr } = await supabaseAdmin
    .from("groups")
    .select("id, name, branch_id")
    .in("id", [...allGroupIds]);
  if (gErr) throw gErr;
  const allowed = new Set<string>();
  const gm = new Map<string, { id: string; name: string | null }>();
  for (const g of grps || []) {
    const row = g as { id: string; name: string | null; branch_id?: string | null };
    gm.set(row.id, { id: row.id, name: row.name });
    const eb =
      row.branch_id != null && String(row.branch_id).length > 0 ? String(row.branch_id) : null;
    if (!eb || eb === viewerBranch) allowed.add(row.id);
  }
  const jsonTasks = tasks
    .filter((t: GroupTaskRow) => {
      if (allowed.has(t.group_id)) return true;
      return relatedIdsFromRow(t.related_group_ids).some((id) => allowed.has(id));
    })
    .map((t: GroupTaskRow) => mapGroupTaskRowToJson(t));
  return jsonTasks.map((t) => {
    const order = [t.group_id, ...t.related_group_ids.filter((id) => id !== t.group_id)];
    const seen = new Set<string>();
    const groups: { id: string; name: string | null }[] = [];
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = gm.get(id);
      if (row) groups.push(row);
    }
    return { ...t, groups };
  });
}

const BRANCH_TASKS_SELECT_FULL =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_member_ids";
const BRANCH_TASKS_SELECT_FALLBACK =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, created_by_profile_id, branch_id";

function applyBranchTaskFiltersWithoutAssignee(q: any, filters: {
  statusParam: string;
  createdByProfileId?: string;
  dueFromIso?: string;
  dueToIso?: string;
  createdFromIso?: string;
  createdToIso?: string;
}): any {
  let x = q;
  if (filters.createdByProfileId && isUuidString(filters.createdByProfileId)) {
    x = x.eq("created_by_profile_id", filters.createdByProfileId);
  }
  const sp = filters.statusParam.trim().toLowerCase();
  if (sp === "open") {
    x = x.in("status", ["pending", "in_progress"]);
  } else if (sp !== "" && sp !== "all") {
    const parts = filters.statusParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const allowed = ["pending", "in_progress", "completed", "cancelled"];
    const valid = [...new Set(parts.filter((p) => allowed.includes(p)))];
    if (valid.length) x = x.in("status", valid);
  }
  if (filters.dueFromIso) x = x.gte("due_at", filters.dueFromIso);
  if (filters.dueToIso) x = x.lte("due_at", filters.dueToIso);
  if (filters.createdFromIso) x = x.gte("created_at", filters.createdFromIso);
  if (filters.createdToIso) x = x.lte("created_at", filters.createdToIso);
  return x;
}

function applyBranchTaskFilters(q: any, filters: {
  statusParam: string;
  assigneeProfileId?: string;
  createdByProfileId?: string;
  dueFromIso?: string;
  dueToIso?: string;
  createdFromIso?: string;
  createdToIso?: string;
}): any {
  let x = applyBranchTaskFiltersWithoutAssignee(q, filters);
  if (filters.assigneeProfileId && isUuidString(filters.assigneeProfileId)) {
    x = x.eq("assignee_profile_id", filters.assigneeProfileId);
  }
  return x;
}

async function fetchMemberTasksChunk(
  orgId: string,
  viewerBranch: string,
  branchColumn: "match" | "null",
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
  useFullSelect: boolean,
): Promise<{ rows: MemberTaskRow[]; fullSelectOk: boolean }> {
  const sel = useFullSelect ? BRANCH_TASKS_SELECT_FULL : BRANCH_TASKS_SELECT_FALLBACK;
  const filtersNoAssignee = { ...filters, assigneeProfileId: undefined as string | undefined };

  const finish = async (rows: MemberTaskRow[]) => {
    const out = !useFullSelect ? await enrichMemberTaskRowsFromIds(orgId, rows) : rows;
    return { rows: out, fullSelectOk: useFullSelect };
  };

  if (filters.assigneeProfileId && isUuidString(filters.assigneeProfileId)) {
    const aid = filters.assigneeProfileId;
    let base1 = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
    base1 = branchColumn === "match" ? base1.eq("branch_id", viewerBranch) : base1.is("branch_id", null);
    const q1 = applyBranchTaskFiltersWithoutAssignee(base1, filtersNoAssignee)
      .eq("assignee_profile_id", aid)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    let base2 = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
    base2 = branchColumn === "match" ? base2.eq("branch_id", viewerBranch) : base2.is("branch_id", null);
    const q2 = applyBranchTaskFiltersWithoutAssignee(base2, filtersNoAssignee)
      .contains("assignee_profile_ids", [aid])
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    const [r1, r2] = await Promise.all([q1, q2]);

    if (r1.error) {
      if (
        useFullSelect &&
        String(r1.error.message || "")
          .toLowerCase()
          .match(/checklist|related_member|assignee_profile_ids/)
      ) {
        return fetchMemberTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
      }
      throw r1.error;
    }

    let rowsCo: MemberTaskRow[] = [];
    if (r2.error) {
      if (taskAssigneeFilterColumnMissing(r2.error)) {
        rowsCo = [];
      } else if (
        useFullSelect &&
        String(r2.error.message || "")
          .toLowerCase()
          .match(/checklist|related_member|assignee_profile_ids/)
      ) {
        return fetchMemberTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
      } else {
        throw r2.error;
      }
    } else {
      rowsCo = (r2.data || []) as MemberTaskRow[];
    }

    const merged = mergeTaskRowsById((r1.data || []) as MemberTaskRow[], rowsCo);
    return finish(merged);
  }

  let base = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
  base = branchColumn === "match" ? base.eq("branch_id", viewerBranch) : base.is("branch_id", null);
  const ordered = applyBranchTaskFilters(base, filters)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await ordered;
  if (error) {
    if (
      useFullSelect &&
      String(error.message || "")
        .toLowerCase()
        .match(/checklist|related_member|assignee_profile_ids/)
    ) {
      return fetchMemberTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
    }
    throw error;
  }
  return finish((data || []) as MemberTaskRow[]);
}

async function listMemberTasksForBranchMonitoring(
  orgId: string,
  viewerBranch: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
): Promise<Awaited<ReturnType<typeof attachMemberNamesToTasks>>> {
  const [{ rows: withBranch }, { rows: nullBranchRaw }] = await Promise.all([
    fetchMemberTasksChunk(orgId, viewerBranch, "match", filters, true),
    fetchMemberTasksChunk(orgId, viewerBranch, "null", filters, true),
  ]);

  let nullBranchRows = nullBranchRaw;
  if (nullBranchRows.length > 0) {
    const mids = [...new Set(nullBranchRows.map((r) => r.member_id))];
    const { data: mems, error: mErr } = await supabaseAdmin
      .from("members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .in("id", mids);
    if (mErr) throw mErr;
    const ok = new Set((mems || []).map((m) => (m as { id: string }).id));
    nullBranchRows = nullBranchRows.filter((r) => ok.has(r.member_id));
  }

  const byId = new Map<string, MemberTaskRow>();
  for (const r of withBranch) byId.set(r.id, r);
  for (const r of nullBranchRows) byId.set(r.id, r);
  const merged = [...byId.values()].sort(
    (a, b) =>
      new Date(a.due_at || a.created_at).getTime() - new Date(b.due_at || b.created_at).getTime(),
  );

  const jsonTasks = merged.map((t) => mapMemberTaskRowToJson(t));
  return await attachMemberNamesToTasks(jsonTasks);
}

const BRANCH_GROUP_TASKS_SELECT_FULL =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_group_ids";
const BRANCH_GROUP_TASKS_SELECT_FALLBACK =
  "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, created_by_profile_id, branch_id, related_group_ids";

async function fetchGroupTasksChunk(
  orgId: string,
  viewerBranch: string,
  branchColumn: "match" | "null",
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
  useFullSelect: boolean,
): Promise<{ rows: GroupTaskRow[]; fullSelectOk: boolean }> {
  const sel = useFullSelect ? BRANCH_GROUP_TASKS_SELECT_FULL : BRANCH_GROUP_TASKS_SELECT_FALLBACK;
  const filtersNoAssignee = { ...filters, assigneeProfileId: undefined as string | undefined };

  const finish = async (rows: GroupTaskRow[]) => {
    const out = !useFullSelect ? await enrichGroupTaskRowsFromIds(orgId, rows) : rows;
    return { rows: out, fullSelectOk: useFullSelect };
  };

  if (filters.assigneeProfileId && isUuidString(filters.assigneeProfileId)) {
    const aid = filters.assigneeProfileId;
    let base1 = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
    base1 = branchColumn === "match" ? base1.eq("branch_id", viewerBranch) : base1.is("branch_id", null);
    const q1 = applyBranchTaskFiltersWithoutAssignee(base1, filtersNoAssignee)
      .eq("assignee_profile_id", aid)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    let base2 = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
    base2 = branchColumn === "match" ? base2.eq("branch_id", viewerBranch) : base2.is("branch_id", null);
    const q2 = applyBranchTaskFiltersWithoutAssignee(base2, filtersNoAssignee)
      .contains("assignee_profile_ids", [aid])
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    const [r1, r2] = await Promise.all([q1, q2]);

    if (r1.error) {
      if (
        useFullSelect &&
        String(r1.error.message || "")
          .toLowerCase()
          .match(/checklist|related_group|assignee_profile_ids/)
      ) {
        return fetchGroupTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
      }
      throw r1.error;
    }

    let rowsCo: GroupTaskRow[] = [];
    if (r2.error) {
      if (taskAssigneeFilterColumnMissing(r2.error)) {
        rowsCo = [];
      } else if (
        useFullSelect &&
        String(r2.error.message || "")
          .toLowerCase()
          .match(/checklist|related_group|assignee_profile_ids/)
      ) {
        return fetchGroupTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
      } else {
        throw r2.error;
      }
    } else {
      rowsCo = (r2.data || []) as GroupTaskRow[];
    }

    const merged = mergeTaskRowsById((r1.data || []) as GroupTaskRow[], rowsCo);
    return finish(merged);
  }

  let base = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
  base = branchColumn === "match" ? base.eq("branch_id", viewerBranch) : base.is("branch_id", null);
  const ordered = applyBranchTaskFilters(base, filters)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await ordered;
  if (error) {
    if (
      useFullSelect &&
      String(error.message || "")
        .toLowerCase()
        .match(/checklist|related_group|assignee_profile_ids/)
    ) {
      return fetchGroupTasksChunk(orgId, viewerBranch, branchColumn, filters, false);
    }
    throw error;
  }
  return finish((data || []) as GroupTaskRow[]);
}

async function listGroupTasksForBranchMonitoring(
  orgId: string,
  viewerBranch: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
): Promise<Awaited<ReturnType<typeof attachGroupNamesToTasks>>> {
  const [{ rows: withBranch }, { rows: nullBranchRaw }] = await Promise.all([
    fetchGroupTasksChunk(orgId, viewerBranch, "match", filters, true),
    fetchGroupTasksChunk(orgId, viewerBranch, "null", filters, true),
  ]);

  let nullBranchRows = nullBranchRaw;
  if (nullBranchRows.length > 0) {
    const gids = [...new Set(nullBranchRows.map((r) => r.group_id))];
    const { data: grps, error: gErr } = await supabaseAdmin
      .from("groups")
      .select("id")
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .in("id", gids);
    if (gErr) throw gErr;
    const ok = new Set((grps || []).map((g) => (g as { id: string }).id));
    nullBranchRows = nullBranchRows.filter((r) => ok.has(r.group_id));
  }

  const byId = new Map<string, GroupTaskRow>();
  for (const r of withBranch) byId.set(r.id, r);
  for (const r of nullBranchRows) byId.set(r.id, r);
  const merged = [...byId.values()].sort(
    (a, b) =>
      new Date(a.due_at || a.created_at).getTime() - new Date(b.due_at || b.created_at).getTime(),
  );

  const jsonTasks = merged.map((t) => mapGroupTaskRowToJson(t));
  return await attachGroupNamesToTasks(jsonTasks);
}

/** All member tasks in the org (no branch filter). Org-owner-only via `/api/tasks/branch?org_wide=1`. */
async function fetchMemberTasksOrgWideChunk(
  orgId: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
  useFullSelect: boolean,
): Promise<{ rows: MemberTaskRow[]; fullSelectOk: boolean }> {
  const sel = useFullSelect ? BRANCH_TASKS_SELECT_FULL : BRANCH_TASKS_SELECT_FALLBACK;
  const filtersNoAssignee = { ...filters, assigneeProfileId: undefined as string | undefined };

  const finish = async (rows: MemberTaskRow[]) => {
    const out = !useFullSelect ? await enrichMemberTaskRowsFromIds(orgId, rows) : rows;
    return { rows: out, fullSelectOk: useFullSelect };
  };

  if (filters.assigneeProfileId && isUuidString(filters.assigneeProfileId)) {
    const aid = filters.assigneeProfileId;
    let base1 = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
    const q1 = applyBranchTaskFiltersWithoutAssignee(base1, filtersNoAssignee)
      .eq("assignee_profile_id", aid)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const r1 = await q1;

    if (r1.error) {
      if (
        useFullSelect &&
        String(r1.error.message || "")
          .toLowerCase()
          .match(/checklist|related_member|assignee_profile_ids/)
      ) {
        return fetchMemberTasksOrgWideChunk(orgId, filters, false);
      }
      throw r1.error;
    }

    let base2 = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
    const q2 = applyBranchTaskFiltersWithoutAssignee(base2, filtersNoAssignee)
      .contains("assignee_profile_ids", [aid])
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const r2 = await q2;

    let rowsCo: MemberTaskRow[] = [];
    if (r2.error) {
      if (taskAssigneeFilterColumnMissing(r2.error)) {
        rowsCo = [];
      } else if (
        useFullSelect &&
        String(r2.error.message || "")
          .toLowerCase()
          .match(/checklist|related_member|assignee_profile_ids/)
      ) {
        return fetchMemberTasksOrgWideChunk(orgId, filters, false);
      } else {
        throw r2.error;
      }
    } else {
      rowsCo = (r2.data || []) as MemberTaskRow[];
    }

    const merged = mergeTaskRowsById((r1.data || []) as MemberTaskRow[], rowsCo);
    return finish(merged);
  }

  let base = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId);
  const ordered = applyBranchTaskFilters(base, filters)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await ordered;
  if (error) {
    if (
      useFullSelect &&
      String(error.message || "")
        .toLowerCase()
        .match(/checklist|related_member|assignee_profile_ids/)
    ) {
      return fetchMemberTasksOrgWideChunk(orgId, filters, false);
    }
    throw error;
  }
  return finish((data || []) as MemberTaskRow[]);
}

async function listMemberTasksForOrgWideMonitoring(
  orgId: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
): Promise<Awaited<ReturnType<typeof attachMemberNamesToTasks>>> {
  const { rows } = await fetchMemberTasksOrgWideChunk(orgId, filters, true);
  const jsonTasks = rows.map((t) => mapMemberTaskRowToJson(t));
  return await attachMemberNamesToTasks(jsonTasks);
}

/** All group tasks in the org (no branch filter). Org-owner-only via `/api/tasks/branch?org_wide=1`. */
async function fetchGroupTasksOrgWideChunk(
  orgId: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
  useFullSelect: boolean,
): Promise<{ rows: GroupTaskRow[]; fullSelectOk: boolean }> {
  const sel = useFullSelect ? BRANCH_GROUP_TASKS_SELECT_FULL : BRANCH_GROUP_TASKS_SELECT_FALLBACK;
  const filtersNoAssignee = { ...filters, assigneeProfileId: undefined as string | undefined };

  const finish = async (rows: GroupTaskRow[]) => {
    const out = !useFullSelect ? await enrichGroupTaskRowsFromIds(orgId, rows) : rows;
    return { rows: out, fullSelectOk: useFullSelect };
  };

  if (filters.assigneeProfileId && isUuidString(filters.assigneeProfileId)) {
    const aid = filters.assigneeProfileId;
    let base1 = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
    const q1 = applyBranchTaskFiltersWithoutAssignee(base1, filtersNoAssignee)
      .eq("assignee_profile_id", aid)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const r1 = await q1;

    if (r1.error) {
      if (
        useFullSelect &&
        String(r1.error.message || "")
          .toLowerCase()
          .match(/checklist|related_group|assignee_profile_ids/)
      ) {
        return fetchGroupTasksOrgWideChunk(orgId, filters, false);
      }
      throw r1.error;
    }

    let base2 = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
    const q2 = applyBranchTaskFiltersWithoutAssignee(base2, filtersNoAssignee)
      .contains("assignee_profile_ids", [aid])
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const r2 = await q2;

    let rowsCo: GroupTaskRow[] = [];
    if (r2.error) {
      if (taskAssigneeFilterColumnMissing(r2.error)) {
        rowsCo = [];
      } else if (
        useFullSelect &&
        String(r2.error.message || "")
          .toLowerCase()
          .match(/checklist|related_group|assignee_profile_ids/)
      ) {
        return fetchGroupTasksOrgWideChunk(orgId, filters, false);
      } else {
        throw r2.error;
      }
    } else {
      rowsCo = (r2.data || []) as GroupTaskRow[];
    }

    const merged = mergeTaskRowsById((r1.data || []) as GroupTaskRow[], rowsCo);
    return finish(merged);
  }

  let base = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId);
  const ordered = applyBranchTaskFilters(base, filters)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await ordered;
  if (error) {
    if (
      useFullSelect &&
      String(error.message || "")
        .toLowerCase()
        .match(/checklist|related_group|assignee_profile_ids/)
    ) {
      return fetchGroupTasksOrgWideChunk(orgId, filters, false);
    }
    throw error;
  }
  return finish((data || []) as GroupTaskRow[]);
}

async function listGroupTasksForOrgWideMonitoring(
  orgId: string,
  filters: {
    statusParam: string;
    assigneeProfileId?: string;
    createdByProfileId?: string;
    dueFromIso?: string;
    dueToIso?: string;
    createdFromIso?: string;
    createdToIso?: string;
  },
): Promise<Awaited<ReturnType<typeof attachGroupNamesToTasks>>> {
  const { rows } = await fetchGroupTasksOrgWideChunk(orgId, filters, true);
  const jsonTasks = rows.map((t) => mapGroupTaskRowToJson(t));
  return await attachGroupNamesToTasks(jsonTasks);
}

function mapMemberNoteRowForClient(
  r: {
    id: string;
    content: string | null;
    audio_url?: string | null;
    audio_duration?: number | null;
    created_at: string;
    updated_at?: string | null;
    author_id: string;
  },
  authorName: string,
) {
  return {
    id: r.id,
    content: r.content ?? "",
    createdBy: authorName,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? undefined,
    audioUrl: r.audio_url ?? undefined,
    audioDuration: r.audio_duration ?? undefined,
  };
}

type MemberImportantDateRow = {
  id: string;
  title: string;
  description: string | null;
  date_value: string;
  time_value: string | null;
  date_type: "birthday" | "anniversary" | "custom";
  is_recurring_yearly: boolean;
  reminder_offsets: string[] | null;
  default_alert_enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

function normalizeImportantDateInput(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeImportantTimeInput(input: unknown): string | null {
  if (input == null) return null;
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  const m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  const hh = m[1];
  const mm = m[2];
  const ss = m[3] || "00";
  return `${hh}:${mm}:${ss}`;
}

function normalizeTimezoneInput(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return null;
  }
}

const IMPORTANT_REMINDER_OFFSET_IDS = new Set(["1w", "2d", "day_morning"]);
function normalizeImportantReminderOffsets(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!IMPORTANT_REMINDER_OFFSET_IDS.has(key)) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function normalizeImportantDateTypeInput(input: unknown): "birthday" | "anniversary" | "custom" {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw === "birthday" || raw === "anniversary") return raw;
  return "custom";
}

function mapMemberImportantDateRowForClient(r: MemberImportantDateRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    date_value: r.date_value,
    time_value: r.time_value,
    date_type: r.date_type || "custom",
    is_recurring_yearly: r.is_recurring_yearly === true,
    reminder_offsets: Array.isArray(r.reminder_offsets) ? r.reminder_offsets : [],
    default_alert_enabled: r.default_alert_enabled === true,
    created_at: r.created_at,
    updated_at: r.updated_at,
    created_by: r.created_by,
  };
}

async function branchImportantDateConfig(
  organizationId: string,
  branchId: string | null,
): Promise<{ timezone: string; reminderTime: string }> {
  if (!branchId || !isUuidString(branchId)) {
    return {
      timezone: IMPORTANT_DATES_DEFAULT_TIMEZONE,
      reminderTime: IMPORTANT_DATES_DEFAULT_REMINDER_TIME,
    };
  }
  const { data } = await supabaseAdmin
    .from("branches")
    .select("timezone, important_dates_default_reminder_time")
    .eq("id", branchId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const tzRaw = String((data as { timezone?: string | null } | null)?.timezone || "").trim();
  const reminderRaw = String(
    (data as { important_dates_default_reminder_time?: string | null } | null)
      ?.important_dates_default_reminder_time || "",
  ).trim();
  const timezone = normalizeTimezoneInput(tzRaw) || IMPORTANT_DATES_DEFAULT_TIMEZONE;
  const reminderTime = normalizeImportantTimeInput(reminderRaw) || IMPORTANT_DATES_DEFAULT_REMINDER_TIME;
  return { timezone, reminderTime };
}

function ymdInTimezone(input: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(input);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const y = byType.get("year") || "1970";
  const m = byType.get("month") || "01";
  const d = byType.get("day") || "01";
  return `${y}-${m}-${d}`;
}

function hmsInTimezone(input: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${fmt.format(input)}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(t)) return ymd;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function ymdDiffDays(fromYmd: string, toYmd: string): number {
  const f = Date.parse(`${fromYmd}T00:00:00Z`);
  const t = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return 0;
  return Math.round((t - f) / 86400000);
}

function nextOccurrenceYmd(
  dateValue: string,
  isRecurringYearly: boolean,
  todayYmd: string,
): string | null {
  const base = normalizeImportantDateInput(dateValue);
  if (!base) return null;
  if (!isRecurringYearly) return base;
  const mmdd = base.slice(5, 10);
  const year = Number(todayYmd.slice(0, 4));
  if (!Number.isFinite(year)) return base;
  const currentYear = `${String(year).padStart(4, "0")}-${mmdd}`;
  if (currentYear >= todayYmd) return currentYear;
  return `${String(year + 1).padStart(4, "0")}-${mmdd}`;
}

function reminderTargetDateYmd(occursOnYmd: string, offset: string): string {
  if (offset === "1w") return addDaysYmd(occursOnYmd, -7);
  if (offset === "2d") return addDaysYmd(occursOnYmd, -2);
  return occursOnYmd;
}

async function resolveImportantDateRecipients(
  organizationId: string,
  branchId: string | null,
  memberId: string,
): Promise<string[]> {
  const out = new Set<string>();

  const { data: owners } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_org_owner", true);
  for (const row of owners || []) {
    const id = (row as { id?: string }).id;
    if (typeof id === "string" && isUuidString(id)) out.add(id);
  }

  const { data: memberGroups } = await supabaseAdmin
    .from("group_members")
    .select("group_id")
    .eq("organization_id", organizationId)
    .eq("member_id", memberId);
  const groupIds = [
    ...new Set(
      (memberGroups || [])
        .map((r: { group_id?: string }) => r.group_id)
        .filter((id): id is string => typeof id === "string" && isUuidString(id)),
    ),
  ];
  if (groupIds.length > 0) {
    const { data: groups } = await supabaseAdmin
      .from("groups")
      .select("leader_id, branch_id")
      .in("id", groupIds)
      .eq("organization_id", organizationId);
    for (const row of groups || []) {
      const r = row as { leader_id?: string | null; branch_id?: string | null };
      if (branchId && r.branch_id && r.branch_id !== branchId) continue;
      if (typeof r.leader_id === "string" && isUuidString(r.leader_id)) out.add(r.leader_id);
    }
  }
  return [...out];
}

type MemberImportInputRow = {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  phone_country_iso?: unknown;
  dob?: unknown;
  gender?: unknown;
  marital_status?: unknown;
  occupation?: unknown;
  address?: unknown;
  emergency_contact_name?: unknown;
  emergency_contact_phone?: unknown;
  emergency_contact_phone_country_iso?: unknown;
  date_joined?: unknown;
  status?: unknown;
};

type MemberImportIssue = {
  row: number;
  field: string;
  code: string;
  message: string;
  fix_hint: string;
};

type NormalizedImportRow = {
  row_number: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
  phone_country_iso: string | null;
  dob: string | null;
  gender: string | null;
  marital_status: string | null;
  occupation: string | null;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_phone_country_iso: string | null;
  date_joined: string | null;
  status: string;
  duplicate_key: string | null;
};

const MEMBER_IMPORT_PREVIEWS = new Map<
  string,
  {
    orgId: string;
    branchId: string;
    actorId: string;
    rows: NormalizedImportRow[];
    duplicateRows: number[];
    createdAt: number;
  }
>();

const MEMBER_IMPORT_JOBS = new Map<
  string,
  {
    orgId: string;
    branchId: string;
    actorId: string;
    total: number;
    processed: number;
    created: number;
    skipped: number;
    failed: number;
    status: "running" | "done" | "error";
    error: string | null;
    row_results: Array<{ row: number; status: "created" | "skipped" | "failed"; message: string }>;
    createdAt: number;
    finishedAt: number | null;
  }
>();

function sanitizeImportText(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

function normalizeImportDate(v: unknown): string | null {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeImportRows(
  rows: unknown[],
  defaultCountry: string,
): { normalized: NormalizedImportRow[]; issues: MemberImportIssue[] } {
  const normalized: NormalizedImportRow[] = [];
  const issues: MemberImportIssue[] = [];
  rows.forEach((rowUnknown, idx) => {
    const rowNum = idx + 1;
    const row = (rowUnknown && typeof rowUnknown === "object" ? rowUnknown : {}) as MemberImportInputRow;

    const first_name = sanitizeImportText(row.first_name, 120);
    const last_name = sanitizeImportText(row.last_name, 120);
    const emailRaw = sanitizeImportText(row.email, 320);
    const phoneRaw = sanitizeImportText(row.phone, 80);
    const phone_country_iso_raw = sanitizeImportText(row.phone_country_iso, 8);
    const dobRaw = normalizeImportDate(row.dob);
    const gender = normalizeBinaryGender(sanitizeImportText(row.gender, 40), "title");
    const marital_status = sanitizeImportText(row.marital_status, 40) || null;
    const occupation = sanitizeImportText(row.occupation, 120) || null;
    const address = sanitizeImportText(row.address, 240);
    const emergency_contact_name = sanitizeImportText(row.emergency_contact_name, 120);
    const emergency_contact_phone = sanitizeImportText(row.emergency_contact_phone, 80);
    const emergency_contact_phone_country_iso_raw = sanitizeImportText(row.emergency_contact_phone_country_iso, 8);
    const date_joined = normalizeImportDate(row.date_joined);
    const status = sanitizeImportText(row.status, 40) || "active";

    if (!first_name) {
      issues.push({
        row: rowNum,
        field: "first_name",
        code: "REQUIRED",
        message: "First name is required.",
        fix_hint: "Fill first_name for this row.",
      });
    }
    if (!dobRaw) {
      issues.push({
        row: rowNum,
        field: "dob",
        code: "INVALID_DATE",
        message: "Date of birth is required and must be a valid date.",
        fix_hint: "Use YYYY-MM-DD format for dob.",
      });
    }
    if (!phoneRaw) {
      issues.push({
        row: rowNum,
        field: "phone",
        code: "REQUIRED",
        message: "Phone number is required.",
        fix_hint: "Provide phone in local or E.164 format.",
      });
    }
    if (!last_name) {
      issues.push({
        row: rowNum,
        field: "last_name",
        code: "REQUIRED",
        message: "Last name is required.",
        fix_hint: "Fill last_name for this row.",
      });
    }
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      issues.push({
        row: rowNum,
        field: "email",
        code: "INVALID_EMAIL",
        message: "Email format is invalid.",
        fix_hint: "Use a valid email like name@example.com.",
      });
    }

    let phoneNorm: ReturnType<typeof normalizeSinglePhoneField>;
    let emergencyNorm: ReturnType<typeof normalizeSinglePhoneField>;
    try {
      phoneNorm = normalizeSinglePhoneField(phoneRaw, phone_country_iso_raw || null, defaultCountry);
    } catch (e) {
      issues.push({
        row: rowNum,
        field: "phone",
        code: "INVALID_PHONE",
        message: e instanceof Error ? e.message : "Phone number is invalid.",
        fix_hint: "Use a valid phone number with optional country code.",
      });
      phoneNorm = { e164: null, country_iso: null };
    }
    try {
      emergencyNorm = normalizeSinglePhoneField(
        emergency_contact_phone,
        emergency_contact_phone_country_iso_raw || null,
        defaultCountry,
      );
    } catch (e) {
      issues.push({
        row: rowNum,
        field: "emergency_contact_phone",
        code: "INVALID_PHONE",
        message: e instanceof Error ? e.message : "Emergency contact phone is invalid.",
        fix_hint: "Fix emergency contact phone format or leave it blank.",
      });
      emergencyNorm = { e164: null, country_iso: null };
    }

    const duplicate_key =
      first_name && last_name && dobRaw ? `${first_name.toLowerCase()}|${last_name.toLowerCase()}|${dobRaw}` : null;
    normalized.push({
      row_number: rowNum,
      first_name,
      last_name,
      email: emailRaw ? emailRaw.toLowerCase() : null,
      phone: phoneNorm.e164 || "",
      phone_country_iso: phoneNorm.country_iso,
      dob: dobRaw,
      gender,
      marital_status,
      occupation,
      address,
      emergency_contact_name,
      emergency_contact_phone: emergencyNorm.e164 || "",
      emergency_contact_phone_country_iso: emergencyNorm.country_iso,
      date_joined,
      status,
      duplicate_key,
    });
  });
  return { normalized, issues };
}

function generateImportPreviewToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function generateImportJobId(): string {
  return crypto.randomBytes(18).toString("hex");
}

app.get("/api/members/:memberId/notes", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_members",
      "view_member_notes",
      "add_member_notes",
      "edit_member_notes",
      "delete_member_notes",
    ]);
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    let query = supabaseAdmin
      .from("member_notes")
      .select("id, content, audio_url, audio_duration, created_at, updated_at, created_by_user_id")
      .eq("member_id", memberId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    let { data: rows, error } = await query.is("deleted_at", null);

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (code === "42P01" || msg.includes("member_notes")) {
        return res.json({ notes: [] });
      }
      if (msg.includes("deleted_at") || code === "42703") {
        ({ data: rows, error } = await supabaseAdmin
          .from("member_notes")
          .select("id, content, audio_url, audio_duration, created_at, updated_at, created_by_user_id")
          .eq("member_id", memberId)
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }));
      }
      if (error) throw error;
    }

    type NRow = {
      id: string;
      content: string | null;
      audio_url: string | null;
      audio_duration: number | null;
      created_at: string;
      updated_at: string | null;
      created_by_user_id: string;
    };

    const authorIds = [
      ...new Set(
        ((rows || []) as NRow[])
          .map((r) => r.created_by_user_id)
          .filter((id): id is string => typeof id === "string" && isUuidString(id)),
      ),
    ];
    const nameById = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", authorIds);
      for (const p of profs || []) {
        const row = p as {
          id: string;
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
        };
        const n = `${row.first_name || ""} ${row.last_name || ""}`.trim();
        nameById.set(row.id, n || (row.email || "").trim() || "Staff");
      }
    }

    const notes = ((rows || []) as NRow[]).map((r) =>
      mapMemberNoteRowForClient(r, nameById.get(r.created_by_user_id) || "Staff"),
    );

    res.json({ notes });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load notes" });
  }
});

app.post("/api/members/:memberId/notes", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "add_member_notes");
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const body = req.body || {};
    const contentRaw = typeof body.content === "string" ? body.content.trim() : "";
    const content = contentRaw.length > 0 ? contentRaw.slice(0, 20000) : null;
    const audio_url =
      typeof body.audio_url === "string" && body.audio_url.trim()
        ? body.audio_url.trim().slice(0, 2000)
        : null;
    let audio_duration: number | null = null;
    if (typeof body.audio_duration === "number" && Number.isFinite(body.audio_duration) && body.audio_duration >= 0) {
      audio_duration = Math.min(86400, Math.floor(body.audio_duration));
    }

    const displayText = content ?? (audio_url ? "Voice note" : null);
    if (!displayText && !audio_url) {
      return res.status(400).json({ error: "Note must include text and/or voice" });
    }

    const insertRow: Record<string, unknown> = {
      organization_id: orgId,
      member_id: memberId,
      created_by_user_id: user.id,
      content: displayText,
      audio_url,
      audio_duration,
    };

    let { data: inserted, error: insErr } = await supabaseAdmin
      .from("member_notes")
      .insert(insertRow)
      .select("id, content, audio_url, audio_duration, created_at, updated_at, created_by_user_id")
      .single();

    if (insErr) {
      const msg = String(insErr.message || "").toLowerCase();
      if (msg.includes("member_notes") || (insErr as { code?: string }).code === "42P01") {
        return res.status(503).json({
          error:
            "Member notes are not set up in the database yet. Add the member_notes table (see project migrations/schema).",
        });
      }
      throw insErr;
    }

    const row = inserted as {
      id: string;
      content: string | null;
      audio_url: string | null;
      audio_duration: number | null;
      created_at: string;
      updated_at: string | null;
      created_by_user_id: string;
    };

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", user.id)
      .maybeSingle();
    const p = prof as { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
    const authorName = p
      ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || (p.email || "").trim() || "Staff"
      : "Staff";

    res.status(201).json({ note: mapMemberNoteRowForClient(row, authorName) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to save note" });
  }
});

app.put("/api/members/:memberId/notes/:noteId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId, noteId } = req.params;
  if (!isUuidString(memberId) || !isUuidString(noteId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const permCtx = await requirePermission(req, res, "edit_member_notes");
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("member_notes")
      .select("id, member_id, organization_id, audio_url")
      .eq("id", noteId)
      .maybeSingle();
    if (exErr) throw exErr;
    const ex = existing as { id: string; member_id: string; organization_id: string; audio_url: string | null } | null;
    if (!ex || ex.member_id !== memberId || ex.organization_id !== orgId) {
      return res.status(404).json({ error: "Note not found" });
    }

    const body = req.body || {};
    const contentRaw = typeof body.content === "string" ? body.content.trim() : "";
    if (!contentRaw) {
      if (!ex.audio_url) {
        return res.status(400).json({ error: "Note text cannot be empty" });
      }
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      content: contentRaw.length > 0 ? contentRaw.slice(0, 20000) : ex.audio_url ? "Voice note" : null,
    };

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("member_notes")
      .update(patch)
      .eq("id", noteId)
      .select("id, content, audio_url, audio_duration, created_at, updated_at, created_by_user_id")
      .single();

    if (upErr) throw upErr;

    const row = updated as {
      id: string;
      content: string | null;
      audio_url: string | null;
      audio_duration: number | null;
      created_at: string;
      updated_at: string | null;
      created_by_user_id: string;
    };

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", row.created_by_user_id)
      .maybeSingle();
    const p = prof as { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
    const authorName = p
      ? `${p.first_name || ""} ${p.last_name || ""}`.trim() || (p.email || "").trim() || "Staff"
      : "Staff";

    res.json({ note: mapMemberNoteRowForClient(row, authorName) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to update note" });
  }
});

app.delete("/api/members/:memberId/notes/:noteId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId, noteId } = req.params;
  if (!isUuidString(memberId) || !isUuidString(noteId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  try {
    const permCtx = await requirePermission(req, res, "delete_member_notes");
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("member_notes")
      .select("id, member_id, organization_id")
      .eq("id", noteId)
      .maybeSingle();
    if (exErr) throw exErr;
    const ex = existing as { member_id: string; organization_id: string } | null;
    if (!ex || ex.member_id !== memberId || ex.organization_id !== orgId) {
      return res.status(404).json({ error: "Note not found" });
    }

    const nowIso = new Date().toISOString();
    let { error: delErr } = await supabaseAdmin
      .from("member_notes")
      .update({ deleted_at: nowIso })
      .eq("id", noteId);

    if (delErr) {
      const msg = String(delErr.message || "").toLowerCase();
      if (msg.includes("deleted_at") || (delErr as { code?: string }).code === "42703") {
        const hard = await supabaseAdmin.from("member_notes").delete().eq("id", noteId);
        delErr = hard.error;
      }
    }
    if (delErr) throw delErr;

    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete note" });
  }
});

app.get("/api/members/:memberId/important-dates", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "view_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const { data, error } = await supabaseAdmin
      .from("member_important_dates")
      .select("id, title, description, date_value, time_value, date_type, is_recurring_yearly, reminder_offsets, default_alert_enabled, created_at, updated_at, created_by")
      .eq("organization_id", orgId)
      .eq("member_id", memberId)
      .order("date_value", { ascending: true })
      .order("time_value", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (code === "42P01" || msg.includes("member_important_dates")) {
        return res.json({ important_dates: [] });
      }
      throw error;
    }

    const rows = Array.isArray(data) ? (data as MemberImportantDateRow[]) : [];
    res.json({ important_dates: rows.map(mapMemberImportantDateRowForClient) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load important dates" });
  }
});

app.post("/api/members/:memberId/important-dates", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "edit_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const body = req.body || {};
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
    if (!title) return res.status(400).json({ error: "title is required" });

    const description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim().slice(0, 5000)
        : null;
    const dateValue = normalizeImportantDateInput(body.date_value);
    if (!dateValue) return res.status(400).json({ error: "date_value must be a valid date (YYYY-MM-DD)" });
    const timeProvided = body.time_value !== undefined && body.time_value !== null && String(body.time_value).trim() !== "";
    const timeValue = normalizeImportantTimeInput(body.time_value);
    if (timeProvided && !timeValue) {
      return res.status(400).json({ error: "time_value must be a valid time (HH:MM or HH:MM:SS)" });
    }

    const dateType = normalizeImportantDateTypeInput(body.date_type);
    const isRecurringYearly =
      typeof body.is_recurring_yearly === "boolean"
        ? body.is_recurring_yearly
        : dateType === "birthday";
    const defaultAlertEnabled =
      typeof body.default_alert_enabled === "boolean"
        ? body.default_alert_enabled
        : dateType === "birthday";
    const reminderOffsets = normalizeImportantReminderOffsets(body.reminder_offsets);

    const insertRow = {
      organization_id: orgId,
      branch_id: viewerBranch,
      member_id: memberId,
      title,
      description,
      date_value: dateValue,
      time_value: timeValue,
      date_type: dateType,
      is_recurring_yearly: isRecurringYearly,
      reminder_offsets: reminderOffsets,
      default_alert_enabled: defaultAlertEnabled,
      created_by: user.id,
    };

    const { data, error } = await supabaseAdmin
      .from("member_important_dates")
      .insert(insertRow)
      .select("id, title, description, date_value, time_value, date_type, is_recurring_yearly, reminder_offsets, default_alert_enabled, created_at, updated_at, created_by")
      .single();

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (code === "42P01" || msg.includes("member_important_dates")) {
        return res.status(503).json({
          error:
            "Important Dates are not set up in the database yet. Run migrations/member_important_dates.sql first.",
        });
      }
      throw error;
    }

    res.status(201).json({ important_date: mapMemberImportantDateRowForClient(data as MemberImportantDateRow) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to save important date" });
  }
});

app.patch("/api/members/:memberId/important-dates/:dateId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId, dateId } = req.params;
  if (!isUuidString(memberId) || !isUuidString(dateId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const permCtx = await requirePermission(req, res, "edit_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("member_important_dates")
      .select("id, member_id, organization_id")
      .eq("id", dateId)
      .maybeSingle();
    if (exErr) throw exErr;
    const ex = existing as { member_id: string; organization_id: string } | null;
    if (!ex || ex.member_id !== memberId || ex.organization_id !== orgId) {
      return res.status(404).json({ error: "Important date not found" });
    }

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
      if (!title) return res.status(400).json({ error: "title cannot be empty" });
      patch.title = title;
    }
    if (body.description !== undefined) {
      patch.description =
        typeof body.description === "string" && body.description.trim().length > 0
          ? body.description.trim().slice(0, 5000)
          : null;
    }
    if (body.date_value !== undefined) {
      const dateValue = normalizeImportantDateInput(body.date_value);
      if (!dateValue) return res.status(400).json({ error: "date_value must be a valid date (YYYY-MM-DD)" });
      patch.date_value = dateValue;
    }
    if (body.time_value !== undefined) {
      const timeProvided = body.time_value !== null && String(body.time_value).trim() !== "";
      const timeValue = normalizeImportantTimeInput(body.time_value);
      if (timeProvided && !timeValue) {
        return res.status(400).json({ error: "time_value must be a valid time (HH:MM or HH:MM:SS)" });
      }
      patch.time_value = timeValue;
    }
    if (body.date_type !== undefined) {
      patch.date_type = normalizeImportantDateTypeInput(body.date_type);
    }
    if (body.is_recurring_yearly !== undefined) {
      patch.is_recurring_yearly = Boolean(body.is_recurring_yearly);
    }
    if (body.reminder_offsets !== undefined) {
      patch.reminder_offsets = normalizeImportantReminderOffsets(body.reminder_offsets);
    }
    if (body.default_alert_enabled !== undefined) {
      patch.default_alert_enabled = Boolean(body.default_alert_enabled);
    }

    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 1 && patchKeys[0] === "updated_at") {
      return res.status(400).json({ error: "No changes provided" });
    }

    const { data, error } = await supabaseAdmin
      .from("member_important_dates")
      .update(patch)
      .eq("id", dateId)
      .select("id, title, description, date_value, time_value, date_type, is_recurring_yearly, reminder_offsets, default_alert_enabled, created_at, updated_at, created_by")
      .single();
    if (error) throw error;

    res.json({ important_date: mapMemberImportantDateRowForClient(data as MemberImportantDateRow) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to update important date" });
  }
});

app.delete("/api/members/:memberId/important-dates/:dateId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { memberId, dateId } = req.params;
  if (!isUuidString(memberId) || !isUuidString(dateId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const permCtx = await requirePermission(req, res, "edit_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("member_important_dates")
      .select("id, member_id, organization_id")
      .eq("id", dateId)
      .maybeSingle();
    if (exErr) throw exErr;
    const ex = existing as { member_id: string; organization_id: string } | null;
    if (!ex || ex.member_id !== memberId || ex.organization_id !== orgId) {
      return res.status(404).json({ error: "Important date not found" });
    }

    const { error } = await supabaseAdmin
      .from("member_important_dates")
      .delete()
      .eq("id", dateId);
    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete important date" });
  }
});

app.get("/api/important-dates/upcoming", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "view_members");
    if (!permCtx) return;

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

    const orgId = String(userProfile.organization_id || "");
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const searchQ = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const rangeDays = Math.max(1, Math.min(366, parseInt(String(req.query.range_days || "30"), 10) || 30));

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const visibleMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
    if (visibleMemberIds !== null && visibleMemberIds.size === 0) {
      return res.json({ items: [] });
    }

    let membersQuery = supabaseAdmin
      .from("members")
      .select("id, first_name, last_name, memberimage_url, dob")
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .or("is_deleted.eq.false,is_deleted.is.null");
    if (visibleMemberIds !== null) {
      membersQuery = membersQuery.in("id", [...visibleMemberIds]);
    }
    const { data: memberRows, error: memberErr } = await membersQuery;
    if (memberErr) throw memberErr;

    const members = (memberRows || []) as Array<{
      id: string;
      first_name?: string | null;
      last_name?: string | null;
      memberimage_url?: string | null;
      dob?: string | null;
    }>;
    const memberById = new Map<string, (typeof members)[number]>();
    for (const m of members) memberById.set(String(m.id), m);

    const { timezone } = await branchImportantDateConfig(orgId, viewerBranch);
    const todayYmd = ymdInTimezone(new Date(), timezone);

    const { data: importantRows, error: importantErr } = await supabaseAdmin
      .from("member_important_dates")
      .select(
        "id, member_id, title, description, date_value, time_value, date_type, is_recurring_yearly, reminder_offsets, default_alert_enabled",
      )
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch);
    if (importantErr) {
      const msg = String(importantErr.message || "").toLowerCase();
      const code = (importantErr as { code?: string }).code;
      if (code !== "42P01" && !msg.includes("member_important_dates")) throw importantErr;
    }

    const items: Array<Record<string, unknown>> = [];
    for (const row of (importantRows || []) as Array<{
      id: string;
      member_id?: string | null;
      title?: string | null;
      description?: string | null;
      date_value?: string | null;
      time_value?: string | null;
      date_type?: "birthday" | "anniversary" | "custom" | null;
      is_recurring_yearly?: boolean | null;
      reminder_offsets?: string[] | null;
      default_alert_enabled?: boolean | null;
    }>) {
      const memberId = String(row.member_id || "");
      const member = memberById.get(memberId);
      if (!member) continue;
      const occursOn = nextOccurrenceYmd(
        String(row.date_value || ""),
        row.is_recurring_yearly === true,
        todayYmd,
      );
      if (!occursOn) continue;
      const daysUntil = ymdDiffDays(todayYmd, occursOn);
      if (daysUntil < 0 || daysUntil > rangeDays) continue;
      const memberName =
        `${String(member.first_name || "").trim()} ${String(member.last_name || "").trim()}`.trim() ||
        "Member";
      const title =
        String(row.title || "").trim() ||
        (row.date_type === "birthday" ? "Birthday" : "Important Date");
      if (searchQ) {
        const hay = `${memberName} ${title} ${String(row.description || "")}`.toLowerCase();
        if (!hay.includes(searchQ)) continue;
      }
      items.push({
        id: String(row.id),
        member_id: memberId,
        member_display_name: memberName,
        member_image_url: member.memberimage_url || null,
        title,
        description: row.description || null,
        date_type: row.date_type || "custom",
        occurs_on: occursOn,
        time_value: row.time_value || null,
        days_until: daysUntil,
        source: "member_important_date",
        default_alert_enabled: row.default_alert_enabled === true,
        reminder_offsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets : [],
      });
    }

    // Birthdays from member DOB are always included by default.
    for (const member of members) {
      const dob = normalizeImportantDateInput(member.dob);
      if (!dob) continue;
      const occursOn = nextOccurrenceYmd(dob, true, todayYmd);
      if (!occursOn) continue;
      const daysUntil = ymdDiffDays(todayYmd, occursOn);
      if (daysUntil < 0 || daysUntil > rangeDays) continue;
      const memberName =
        `${String(member.first_name || "").trim()} ${String(member.last_name || "").trim()}`.trim() ||
        "Member";
      if (searchQ) {
        const hay = `${memberName} birthday`.toLowerCase();
        if (!hay.includes(searchQ)) continue;
      }
      const syntheticId = `birthday:${member.id}`;
      if (items.some((x) => String(x.id) === syntheticId)) continue;
      items.push({
        id: syntheticId,
        member_id: member.id,
        member_display_name: memberName,
        member_image_url: member.memberimage_url || null,
        title: "Birthday",
        description: null,
        date_type: "birthday",
        occurs_on: occursOn,
        time_value: null,
        days_until: daysUntil,
        source: "member_birthday",
        default_alert_enabled: true,
        reminder_offsets: ["day_morning"],
      });
    }

    items.sort((a, b) => {
      const da = Number(a.days_until || 0);
      const db = Number(b.days_until || 0);
      if (da !== db) return da - db;
      return String(a.member_display_name || "").localeCompare(String(b.member_display_name || ""));
    });

    res.json({ items });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load upcoming important dates" });
  }
});

app.post("/api/members/import/precheck", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "import_members");
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: "rows array is required" });
    if (rows.length > 5000) return res.status(400).json({ error: "Maximum 5000 rows per import" });

    const defaultCountry = await getOrgDefaultPhoneCountryIso(orgId);
    const { normalized, issues } = normalizeImportRows(rows, defaultCountry);
    const invalidRows = new Set<number>(issues.map((x) => x.row));

    const duplicateRows = new Set<number>();
    const keyToRows = new Map<string, number[]>();
    for (const row of normalized) {
      if (!row.duplicate_key) continue;
      const list = keyToRows.get(row.duplicate_key) || [];
      list.push(row.row_number);
      keyToRows.set(row.duplicate_key, list);
    }
    for (const list of keyToRows.values()) {
      if (list.length > 1) list.forEach((r) => duplicateRows.add(r));
    }

    const nonNullKeys = [...new Set(normalized.map((r) => r.duplicate_key).filter((k): k is string => Boolean(k)))];
    if (nonNullKeys.length > 0) {
      const dobs = [...new Set(nonNullKeys.map((k) => k.split("|")[2]).filter(Boolean))];
      const { data: existing } = await supabaseAdmin
        .from("members")
        .select("first_name, last_name, dob")
        .eq("organization_id", orgId)
        .eq("branch_id", viewerBranch)
        .in("dob", dobs)
        .or("is_deleted.eq.false,is_deleted.is.null");
      const existingKeys = new Set<string>();
      for (const e of existing || []) {
        const fn = typeof (e as { first_name?: string }).first_name === "string"
          ? String((e as { first_name: string }).first_name).trim().toLowerCase()
          : "";
        const ln = typeof (e as { last_name?: string }).last_name === "string"
          ? String((e as { last_name: string }).last_name).trim().toLowerCase()
          : "";
        const dob = typeof (e as { dob?: string | null }).dob === "string"
          ? String((e as { dob: string }).dob).slice(0, 10)
          : "";
        if (fn && ln && dob) existingKeys.add(`${fn}|${ln}|${dob}`);
      }
      for (const row of normalized) {
        if (row.duplicate_key && existingKeys.has(row.duplicate_key)) duplicateRows.add(row.row_number);
      }
    }

    const duplicateIssues: MemberImportIssue[] = [...duplicateRows]
      .sort((a, b) => a - b)
      .map((row) => ({
        row,
        field: "first_name,last_name,dob",
        code: "DUPLICATE",
        message: "Duplicate member detected by first name + last name + date of birth.",
        fix_hint:
          "Change first_name, last_name, or dob to make this row unique.",
      }));
    const allIssues = [...issues, ...duplicateIssues].sort((a, b) => a.row - b.row);

    const previewToken = generateImportPreviewToken();
    MEMBER_IMPORT_PREVIEWS.set(previewToken, {
      orgId,
      branchId: viewerBranch,
      actorId: user.id,
      rows: normalized,
      duplicateRows: [...duplicateRows],
      createdAt: Date.now(),
    });

    const validRows = normalized.filter((r) => !invalidRows.has(r.row_number) && !duplicateRows.has(r.row_number));
    res.json({
      preview_token: previewToken,
      summary: {
        total_rows: normalized.length,
        valid_rows: validRows.length,
        duplicate_rows: duplicateRows.size,
        invalid_rows: invalidRows.size,
      },
      duplicate_rows: [...duplicateRows].sort((a, b) => a - b),
      issues: allIssues,
      defaults: {
        duplicate_action: "skip",
      },
    });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to precheck import" });
  }
});

app.post("/api/members/import/commit", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "import_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const previewToken = typeof req.body?.preview_token === "string" ? req.body.preview_token.trim() : "";
    if (!previewToken) return res.status(400).json({ error: "preview_token is required" });
    const preview = MEMBER_IMPORT_PREVIEWS.get(previewToken);
    if (!preview) return res.status(400).json({ error: "Import preview expired or invalid. Run precheck again." });
    if (preview.orgId !== orgId || preview.branchId !== viewerBranch || preview.actorId !== user.id) {
      return res.status(403).json({ error: "Import preview does not match your current context." });
    }
    if (Date.now() - preview.createdAt > 30 * 60 * 1000) {
      MEMBER_IMPORT_PREVIEWS.delete(previewToken);
      return res.status(400).json({ error: "Import preview expired. Run precheck again." });
    }

    const limM = await assertOrgLimit(supabaseAdmin, orgId, "members");
    if (!limM.ok) {
      return res.status(403).json({ error: limM.message, code: "ORG_LIMIT", current: limM.current, limit: limM.limit });
    }

    const duplicateActionRaw = typeof req.body?.duplicate_action === "string" ? req.body.duplicate_action.trim().toLowerCase() : "";
    const duplicateAction: "skip" | "import" = duplicateActionRaw === "import" ? "import" : "skip";
    const removeDuplicateRows = Array.isArray(req.body?.remove_duplicate_rows)
      ? req.body.remove_duplicate_rows.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    const removeSet = new Set<number>(removeDuplicateRows);
    const dupSet = duplicateAction === "import" ? new Set<number>() : new Set<number>(preview.duplicateRows);
    const { normalized, issues } = normalizeImportRows(preview.rows, await getOrgDefaultPhoneCountryIso(orgId));
    const normalizedFiltered = normalized.filter((row) => !removeSet.has(row.row_number));
    const invalidSet = new Set<number>(issues.map((x) => x.row));

    const jobId = generateImportJobId();
    MEMBER_IMPORT_JOBS.set(jobId, {
      orgId,
      branchId: viewerBranch,
      actorId: user.id,
      total: normalizedFiltered.length,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      status: "running",
      error: null,
      row_results: [],
      createdAt: Date.now(),
      finishedAt: null,
    });

    void (async () => {
      const job = MEMBER_IMPORT_JOBS.get(jobId);
      if (!job) return;
      try {
        for (const row of normalizedFiltered) {
          if (invalidSet.has(row.row_number)) {
            job.skipped += 1;
            job.processed += 1;
            job.row_results.push({ row: row.row_number, status: "skipped", message: "Skipped: row has validation errors." });
            continue;
          }
          if (dupSet.has(row.row_number)) {
            job.skipped += 1;
            job.processed += 1;
            job.row_results.push({
              row: row.row_number,
              status: "skipped",
              message: "Skipped duplicate (first_name + last_name + dob).",
            });
            continue;
          }
          try {
            const cfCreate = await validateAndMergeCustomFields(
              orgId,
              "member",
              viewerBranch,
              null,
              {},
              "create",
            );
            if (!cfCreate.ok) {
              job.failed += 1;
              job.processed += 1;
              job.row_results.push({ row: row.row_number, status: "failed", message: cfCreate.error });
              continue;
            }
            const payload: any = {
              email: row.email,
              phone_number: row.phone,
              phone_country_iso: row.phone_country_iso,
              address: row.address,
              emergency_contact_name: row.emergency_contact_name,
              emergency_contact_phone: row.emergency_contact_phone,
              emergency_contact_phone_country_iso: row.emergency_contact_phone_country_iso,
              dob: row.dob,
              memberimage_url: null,
              organization_id: orgId,
              branch_id: viewerBranch,
              date_joined: row.date_joined || new Date().toISOString().slice(0, 10),
              member_id_string: "",
              status: row.status || "active",
              first_name: row.first_name,
              last_name: row.last_name,
              gender: row.gender,
              marital_status: row.marital_status,
              occupation: row.occupation,
              custom_fields: cfCreate.value,
            };
            let { data: inserted, error } = await supabaseAdmin.from("members").insert([payload]).select("id").single();
            if (error && jsonbCustomFieldsColumnMissing(error)) {
              const retryPayload = { ...payload };
              delete retryPayload.custom_fields;
              ({ data: inserted, error } = await supabaseAdmin.from("members").insert([retryPayload]).select("id").single());
            }
            if (error) throw error;
            if (inserted?.id) {
              await ensureMemberInAllMembersGroup(supabaseAdmin, orgId, viewerBranch, String(inserted.id));
            }
            job.created += 1;
            job.processed += 1;
            job.row_results.push({ row: row.row_number, status: "created", message: "Created." });
          } catch (e: unknown) {
            job.failed += 1;
            job.processed += 1;
            job.row_results.push({
              row: row.row_number,
              status: "failed",
              message: e instanceof Error ? e.message : "Failed to create row.",
            });
          }
        }
        job.status = "done";
        job.finishedAt = Date.now();
      } catch (e: unknown) {
        job.status = "error";
        job.error = e instanceof Error ? e.message : "Import job failed.";
        job.finishedAt = Date.now();
      } finally {
        MEMBER_IMPORT_PREVIEWS.delete(previewToken);
      }
    })();

    res.json({
      job_id: jobId,
      total_rows: normalized.length,
      started: true,
    });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to commit import" });
  }
});

app.get("/api/members/import/status/:jobId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "import_members");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const jobId = String(req.params.jobId || "").trim();
    const job = MEMBER_IMPORT_JOBS.get(jobId);
    if (!job) return res.status(404).json({ error: "Import job not found." });
    if (job.actorId !== user.id || job.orgId !== orgId || job.branchId !== viewerBranch) {
      return res.status(403).json({ error: "Not authorized for this import job." });
    }

    res.json({
      status: job.status,
      total_rows: job.total,
      processed_rows: job.processed,
      created_rows: job.created,
      skipped_rows: job.skipped,
      failed_rows: job.failed,
      error: job.error,
      row_results: job.status === "running" ? [] : job.row_results,
    });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to read import status" });
  }
});

app.get("/api/tasks/my-open-count", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_member_tasks",
      "view_group_tasks",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "delete_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
      "monitor_group_tasks",
      "add_group_tasks",
      "edit_group_tasks",
      "delete_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const countMemberTasks = async (): Promise<number> => {
      if (!actorCanViewMemberTasksMine(permCtx)) return 0;
      const sel = "id, member_id, related_member_ids";
      let qP = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId)
        .eq("assignee_profile_id", user.id).in("status", ["pending", "in_progress"]);
      let qC = supabaseAdmin.from("member_tasks").select(sel).eq("organization_id", orgId)
        .contains("assignee_profile_ids", [user.id]).in("status", ["pending", "in_progress"]);
      const [rP, rC] = await Promise.all([qP, qC.catch(() => ({ data: null }))]);
      if (rP.error) { if (memberTasksTableMissing(rP.error)) return 0; throw rP.error; }
      const rows = mergeTaskRowsById(
        (rP.data || []) as MemberTaskRow[],
        ((rC as any).data || []) as MemberTaskRow[],
      );
      return rows.length;
    };
    const countGroupTasks = async (): Promise<number> => {
      if (!actorCanViewGroupTasksMine(permCtx)) return 0;
      const sel = "id, group_id, related_group_ids";
      let qP = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId)
        .eq("assignee_profile_id", user.id).in("status", ["pending", "in_progress"]);
      let qC = supabaseAdmin.from("group_tasks").select(sel).eq("organization_id", orgId)
        .contains("assignee_profile_ids", [user.id]).in("status", ["pending", "in_progress"]);
      const [rP, rC] = await Promise.all([qP, qC.catch(() => ({ data: null }))]);
      if (rP.error) { if (groupTasksTableMissing(rP.error)) return 0; throw rP.error; }
      const rows = mergeTaskRowsById(
        (rP.data || []) as GroupTaskRow[],
        ((rC as any).data || []) as GroupTaskRow[],
      );
      return rows.length;
    };
    const [mCount, gCount] = await Promise.all([countMemberTasks(), countGroupTasks()]);
    res.json({ count: mCount + gCount });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (memberTasksTableMissing(error)) {
      return res.json({ count: 0 });
    }
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to count tasks" });
  }
});

app.get("/api/tasks/mine", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_member_tasks",
      "view_group_tasks",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "delete_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
      "monitor_group_tasks",
      "add_group_tasks",
      "edit_group_tasks",
      "delete_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const qStatus = typeof req.query.status === "string" ? req.query.status : "open";
    const openOnly = qStatus !== "all";
    const memberTaskSel =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_member_ids";
    const memberTaskSelFb =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, created_by_profile_id, branch_id";
    const groupTaskSel =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, branch_id, checklist, related_group_ids";
    const groupTaskSelFb =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, created_by_profile_id, branch_id";

    async function fetchCreatedByMemberTasks(): Promise<Awaited<ReturnType<typeof listMemberTasksForAssigneeInBranch>>> {
      let q = supabaseAdmin
        .from("member_tasks")
        .select(memberTaskSel)
        .eq("organization_id", orgId)
        .eq("created_by_profile_id", user.id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (openOnly) q = q.in("status", ["pending", "in_progress"]);
      let { data, error } = await q;
      if (error && /checklist|assignee_profile_ids/.test(String(error.message || "").toLowerCase())) {
        let q2 = supabaseAdmin.from("member_tasks").select(memberTaskSelFb)
          .eq("organization_id", orgId).eq("created_by_profile_id", user.id)
          .order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
        if (openOnly) q2 = q2.in("status", ["pending", "in_progress"]);
        const r2 = await q2;
        data = r2.data; error = r2.error;
      }
      if (error) { if (memberTasksTableMissing(error)) return []; throw error; }
      return await attachMemberNamesToTasks((data || []).map((r) => mapMemberTaskRowToJson(r as MemberTaskRow)));
    }

    async function fetchCreatedByGroupTasks(): Promise<Awaited<ReturnType<typeof listGroupTasksForAssigneeInBranch>>> {
      let q = supabaseAdmin
        .from("group_tasks")
        .select(groupTaskSel)
        .eq("organization_id", orgId)
        .eq("created_by_profile_id", user.id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (openOnly) q = q.in("status", ["pending", "in_progress"]);
      let { data, error } = await q;
      if (error && /checklist|assignee_profile_ids/.test(String(error.message || "").toLowerCase())) {
        let q2 = supabaseAdmin.from("group_tasks").select(groupTaskSelFb)
          .eq("organization_id", orgId).eq("created_by_profile_id", user.id)
          .order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
        if (openOnly) q2 = q2.in("status", ["pending", "in_progress"]);
        const r2 = await q2;
        data = r2.data; error = r2.error;
      }
      if (error) { if (groupTasksTableMissing(error)) return []; throw error; }
      return await attachGroupNamesToTasks((data || []).map((r) => mapGroupTaskRowToJson(r as GroupTaskRow)));
    }

    const [memberAssigned, groupAssigned, memberCreated, groupCreated] = await Promise.all([
      actorCanViewMemberTasksMine(permCtx)
        ? listMemberTasksForAssigneeInBranch(orgId, viewerBranch, user.id, openOnly)
        : Promise.resolve([] as Awaited<ReturnType<typeof listMemberTasksForAssigneeInBranch>>),
      actorCanViewGroupTasksMine(permCtx)
        ? listGroupTasksForAssigneeInBranch(orgId, viewerBranch, user.id, openOnly).catch((e: unknown) => {
            if (!groupTasksTableMissing(e)) throw e;
            return [] as Awaited<ReturnType<typeof listGroupTasksForAssigneeInBranch>>;
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof listGroupTasksForAssigneeInBranch>>),
      fetchCreatedByMemberTasks().catch(() => [] as Awaited<ReturnType<typeof listMemberTasksForAssigneeInBranch>>),
      fetchCreatedByGroupTasks().catch(() => [] as Awaited<ReturnType<typeof listGroupTasksForAssigneeInBranch>>),
    ]);

    const seenIds = new Set<string>();
    const dedup = <T extends { id: string }>(items: T[]): T[] => {
      const out: T[] = [];
      for (const it of items) { if (!seenIds.has(it.id)) { seenIds.add(it.id); out.push(it); } }
      return out;
    };
    const memberList = dedup([...memberAssigned, ...memberCreated]);
    const groupList = dedup([...groupAssigned, ...groupCreated]);

    const list = [
      ...memberList.map((t) => ({ ...t, task_type: "member" as const })),
      ...groupList.map((t) => ({ ...t, task_type: "group" as const })),
    ].sort(
      (a, b) =>
        new Date(a.due_at || a.created_at).getTime() - new Date(b.due_at || b.created_at).getTime(),
    );
    const profIds = [
      ...new Set(
        list.flatMap((t) => {
          const tt = t as { assignee_profile_id: string; assignee_profile_ids?: string[] | null; created_by_profile_id: string };
          return [...assigneeProfileIdsFromMemberTaskRow(tt as MemberTaskRow), tt.created_by_profile_id];
        }),
      ),
    ].filter((id): id is string => typeof id === "string" && isUuidString(id));
    const nameById = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", profIds);
      for (const p of profs || []) {
        const row = p as { id: string; first_name?: string | null; last_name?: string | null; email?: string | null };
        const n = `${row.first_name || ""} ${row.last_name || ""}`.trim();
        nameById.set(row.id, n || (row.email || "").trim() || "Staff");
      }
    }
    let tasks = list.map((t) => {
      const tt = t as { assignee_profile_id: string; assignee_profile_ids?: string[] | null; created_by_profile_id: string };
      const aids = assigneeProfileIdsFromMemberTaskRow(tt as MemberTaskRow);
      return {
        ...t,
        assignee_name: aids.map((id) => nameById.get(id) || "Staff").join(", "),
        created_by_name: nameById.get(tt.created_by_profile_id) || "Staff",
      };
    });
    const mScopeMine = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIdsMine = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScopeMine);
    if (allowedMemberIdsMine !== null) {
      tasks = tasks.filter((t) => {
        const tt = (t as { task_type?: string }).task_type;
        if (tt === "member") {
          const mid = (t as { member_id?: string }).member_id;
          if (mid && allowedMemberIdsMine.has(mid)) return true;
          for (const id of relatedIdsFromRow((t as { related_member_ids?: unknown }).related_member_ids)) {
            if (allowedMemberIdsMine.has(id)) return true;
          }
          return false;
        }
        if (tt === "group") {
          const gid = (t as { group_id?: string }).group_id;
          if (gid && groupIdVisibleUnderScope(gid, mScopeMine)) return true;
          for (const id of relatedIdsFromRow((t as { related_group_ids?: unknown }).related_group_ids)) {
            if (groupIdVisibleUnderScope(id, mScopeMine)) return true;
          }
          return false;
        }
        return true;
      });
    }
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const totalCount = tasks.length;
    const paged = tasks.slice(offset, offset + limit);
    res.json({ tasks: paged, total_count: totalCount });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (memberTasksTableMissing(error)) {
      return res.json({ tasks: [] });
    }
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load tasks" });
  }
});

function parseBranchTasksRangeFromQuery(q: Record<string, unknown | undefined>) {
  const month = typeof q.month === "string" ? q.month.trim() : "";
  let fromMs: number | undefined;
  let toMs: number | undefined;
  if (/^\d{4}-\d{2}$/.test(month)) {
    const parts = month.split("-").map(Number);
    const y = parts[0];
    const mo = parts[1];
    fromMs = Date.UTC(y, mo - 1, 1, 0, 0, 0, 0);
    toMs = Date.UTC(y, mo, 0, 23, 59, 59, 999);
  }
  const dueFromQ = typeof q.due_from === "string" ? q.due_from.trim() : "";
  const dueToQ = typeof q.due_to === "string" ? q.due_to.trim() : "";
  if (dueFromQ) {
    const t = new Date(dueFromQ).getTime();
    if (!Number.isNaN(t)) fromMs = fromMs === undefined ? t : Math.max(fromMs, t);
  }
  if (dueToQ) {
    const t = new Date(dueToQ).getTime();
    if (!Number.isNaN(t)) toMs = toMs === undefined ? t : Math.min(toMs, t);
  }
  let createdFromIso: string | undefined;
  let createdToIso: string | undefined;
  const createdFromQ = typeof q.created_from === "string" ? q.created_from.trim() : "";
  const createdToQ = typeof q.created_to === "string" ? q.created_to.trim() : "";
  if (createdFromQ) {
    const d = new Date(createdFromQ);
    if (!Number.isNaN(d.getTime())) createdFromIso = d.toISOString();
  }
  if (createdToQ) {
    const d = new Date(createdToQ);
    if (!Number.isNaN(d.getTime())) createdToIso = d.toISOString();
  }
  return {
    dueFromIso: fromMs !== undefined ? new Date(fromMs).toISOString() : undefined,
    dueToIso: toMs !== undefined ? new Date(toMs).toISOString() : undefined,
    createdFromIso,
    createdToIso,
  };
}

app.get("/api/tasks/branch", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_member_tasks",
      "view_group_tasks",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "delete_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
      "monitor_group_tasks",
      "add_group_tasks",
      "edit_group_tasks",
      "delete_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const orgWideRaw =
      typeof req.query.org_wide === "string" ? req.query.org_wide.trim().toLowerCase() : "";
    const orgWide = orgWideRaw === "1" || orgWideRaw === "true";
    if (orgWide && !permCtx.isOrgOwner) {
      return res.status(403).json({
        error: "Organization-wide task list is only available to organization owners.",
      });
    }

    const statusParam =
      typeof req.query.status === "string" && req.query.status.trim().length > 0
        ? req.query.status.trim()
        : "open";
    const assigneeRaw =
      typeof req.query.assignee_profile_id === "string" ? req.query.assignee_profile_id.trim() : "";
    const assigneeProfileId = isUuidString(assigneeRaw) ? assigneeRaw : undefined;
    const createdByRaw =
      typeof req.query.created_by_profile_id === "string" ? req.query.created_by_profile_id.trim() : "";
    const createdByProfileId = isUuidString(createdByRaw) ? createdByRaw : undefined;
    const range = parseBranchTasksRangeFromQuery(req.query as Record<string, unknown | undefined>);

    const branchFilters = {
      statusParam,
      assigneeProfileId,
      createdByProfileId,
      dueFromIso: range.dueFromIso,
      dueToIso: range.dueToIso,
      createdFromIso: range.createdFromIso,
      createdToIso: range.createdToIso,
    };

    const [memberList, groupList] = await Promise.all([
      actorCanSeeMemberBranchTasks(permCtx)
        ? (orgWide
            ? listMemberTasksForOrgWideMonitoring(orgId, branchFilters)
            : listMemberTasksForBranchMonitoring(orgId, viewerBranch, branchFilters))
        : Promise.resolve([] as Awaited<ReturnType<typeof listMemberTasksForBranchMonitoring>>),
      actorCanSeeGroupBranchTasks(permCtx)
        ? (orgWide
            ? listGroupTasksForOrgWideMonitoring(orgId, branchFilters)
            : listGroupTasksForBranchMonitoring(orgId, viewerBranch, branchFilters)
          ).catch((e: unknown) => {
            if (!groupTasksTableMissing(e)) throw e;
            return [] as Awaited<ReturnType<typeof listGroupTasksForBranchMonitoring>>;
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof listGroupTasksForBranchMonitoring>>),
    ]);

    const list = [
      ...memberList.map((t) => ({ ...t, task_type: "member" as const })),
      ...groupList.map((t) => ({ ...t, task_type: "group" as const })),
    ].sort(
      (a, b) =>
        new Date(a.due_at || a.created_at).getTime() - new Date(b.due_at || b.created_at).getTime(),
    );

    const profIds = [
      ...new Set(
        list.flatMap((t) => {
          const tt = t as { assignee_profile_id: string; assignee_profile_ids?: string[] | null; created_by_profile_id: string };
          return [...assigneeProfileIdsFromMemberTaskRow(tt as MemberTaskRow), tt.created_by_profile_id];
        }),
      ),
    ].filter((id): id is string => typeof id === "string" && isUuidString(id));
    const nameById = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", profIds);
      for (const p of profs || []) {
        const row = p as { id: string; first_name?: string | null; last_name?: string | null; email?: string | null };
        const n = `${row.first_name || ""} ${row.last_name || ""}`.trim();
        nameById.set(row.id, n || (row.email || "").trim() || "Staff");
      }
    }

    let tasks = list.map((t) => {
      const tt = t as { assignee_profile_id: string; assignee_profile_ids?: string[] | null; created_by_profile_id: string };
      const aids = assigneeProfileIdsFromMemberTaskRow(tt as MemberTaskRow);
      return {
        ...t,
        assignee_name: aids.map((id) => nameById.get(id) || "Staff").join(", "),
        created_by_name: nameById.get(tt.created_by_profile_id) || "Staff",
      };
    });
    const mScopeBr = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIdsBr = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScopeBr);
    if (allowedMemberIdsBr !== null) {
      tasks = tasks.filter((t) => {
        const tt = (t as { task_type?: string }).task_type;
        if (tt === "member") {
          const mid = (t as { member_id?: string }).member_id;
          if (mid && allowedMemberIdsBr.has(mid)) return true;
          for (const id of relatedIdsFromRow((t as { related_member_ids?: unknown }).related_member_ids)) {
            if (allowedMemberIdsBr.has(id)) return true;
          }
          return false;
        }
        if (tt === "group") {
          const gid = (t as { group_id?: string }).group_id;
          if (gid && groupIdVisibleUnderScope(gid, mScopeBr)) return true;
          for (const id of relatedIdsFromRow((t as { related_group_ids?: unknown }).related_group_ids)) {
            if (groupIdVisibleUnderScope(id, mScopeBr)) return true;
          }
          return false;
        }
        return true;
      });
    }

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const totalCount = tasks.length;
    const paged = tasks.slice(offset, offset + limit);
    res.json({ tasks: paged, total_count: totalCount });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (memberTasksTableMissing(error) || groupTasksTableMissing(error)) {
      return res.json({ tasks: [] });
    }
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load branch tasks" });
  }
});

app.get("/api/members/:memberId/tasks", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_member_tasks",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "delete_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const sel =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, checklist, related_member_ids";
    const selLegacy =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, member_id, assignee_profile_id, created_by_profile_id";
    let { data: rowsPrimary, error: err1 } = await supabaseAdmin
      .from("member_tasks")
      .select(sel)
      .eq("member_id", memberId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (err1 && /checklist|assignee_profile_ids/.test(String(err1.message || "").toLowerCase())) {
      const r = await supabaseAdmin
        .from("member_tasks")
        .select(selLegacy)
        .eq("member_id", memberId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      rowsPrimary = r.data as MemberTaskRow[] | null;
      err1 = r.error;
    }
    if (err1) {
      if (memberTasksTableMissing(err1)) return res.json({ tasks: [] });
      throw err1;
    }

    let rowsRelated: MemberTaskRow[] | null = null;
    const { data: relData, error: err2 } = await supabaseAdmin
      .from("member_tasks")
      .select(sel)
      .contains("related_member_ids", [memberId])
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (!err2) rowsRelated = relData as MemberTaskRow[] | null;
    else if (!/related_member|assignee_profile_ids/.test(String(err2.message || "").toLowerCase())) throw err2;

    const byTaskId = new Map<string, MemberTaskRow>();
    for (const r of rowsPrimary || []) byTaskId.set((r as MemberTaskRow).id, r as MemberTaskRow);
    for (const r of rowsRelated || []) byTaskId.set((r as MemberTaskRow).id, r as MemberTaskRow);
    const rows = [...byTaskId.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const profIds = [
      ...new Set(
        rows.flatMap((r) => [
          ...assigneeProfileIdsFromMemberTaskRow(r as MemberTaskRow),
          r.created_by_profile_id,
        ]),
      ),
    ].filter((id): id is string => typeof id === "string" && isUuidString(id));
    const nameById = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", profIds);
      for (const p of profs || []) {
        const row = p as { id: string; first_name?: string | null; last_name?: string | null; email?: string | null };
        const n = `${row.first_name || ""} ${row.last_name || ""}`.trim();
        nameById.set(row.id, n || (row.email || "").trim() || "Staff");
      }
    }

    const withNames = await attachMemberNamesToTasks(rows.map((r) => mapMemberTaskRowToJson(r)));
    let tasks = withNames.map((t) => ({
      ...t,
      assignee_name: assigneeProfileIdsFromMemberTaskRow(t as MemberTaskRow)
        .map((id) => nameById.get(id) || "Staff")
        .join(", "),
      created_by_name: nameById.get(t.created_by_profile_id) || "Staff",
    }));

    const canMonitorOrManage =
      permCtx.isOrgOwner ||
      permCtx.permissionSet.has("monitor_member_tasks") ||
      permCtx.permissionSet.has("add_member_tasks") ||
      permCtx.permissionSet.has("edit_member_tasks") ||
      permCtx.permissionSet.has("edit_member_task_checklist") ||
      permCtx.permissionSet.has("delete_member_tasks");
    if (!canMonitorOrManage) {
      tasks = tasks.filter((t) => {
        const aids = assigneeProfileIdsFromMemberTaskRow(t as MemberTaskRow);
        if (aids.includes(user.id)) return true;
        if (t.created_by_profile_id === user.id) return true;
        return false;
      });
    }

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const totalCount = tasks.length;
    const paged = tasks.slice(offset, offset + limit);
    res.json({ tasks: paged, total_count: totalCount });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load tasks" });
  }
});

app.post("/api/members/:memberId/tasks", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { memberId } = req.params;
  if (!isUuidString(memberId)) return res.status(400).json({ error: "Invalid member id" });

  try {
    const permCtx = await requirePermission(req, res, "add_member_tasks");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertMemberForOrgBranch(memberId, orgId, viewerBranch);
    await assertMemberVisibleUnderMinistryScope(memberId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) return res.status(400).json({ error: "title is required" });
    const description =
      typeof req.body?.description === "string" && req.body.description.trim().length > 0
        ? req.body.description.trim()
        : null;
    const parsedAssignees = parseAssigneeProfileIdsFromPostBody(req.body);
    if (parsedAssignees.error) return res.status(400).json({ error: parsedAssignees.error });
    const assigneeIds = parsedAssignees.ids;
    for (const aid of assigneeIds) {
      await assertAssigneeProfileForBranch(aid, orgId, viewerBranch);
    }
    const primaryAssigneeId = assigneeIds[0];

    let dueAt: string | null = null;
    if (req.body?.due_at != null && String(req.body.due_at).trim().length > 0) {
      const d = new Date(String(req.body.due_at));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
      dueAt = d.toISOString();
    }

    const { data: memRow } = await supabaseAdmin
      .from("members")
      .select("branch_id")
      .eq("id", memberId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const memBranch = (memRow as { branch_id?: string | null } | null)?.branch_id ?? null;

    const checklist = normalizeChecklistFromBody(req.body?.checklist, memberId);
    if (
      checklist.length > 0 &&
      !permCtx.isOrgOwner &&
      !permCtx.permissionSet.has("add_member_tasks") &&
      !permCtx.permissionSet.has("edit_member_tasks") &&
      !permCtx.permissionSet.has("edit_member_task_checklist")
    ) {
      return res.status(403).json({ error: "Missing permission to add task checklist items." });
    }
    const relatedRaw = Array.isArray(req.body?.related_member_ids) ? req.body.related_member_ids : [];
    const relatedIds = await assertRelatedMembersForTask(
      orgId,
      viewerBranch,
      memberId,
      relatedRaw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
      user.id,
      permCtx.isOrgOwner,
    );

    const insertPayload: Record<string, unknown> = {
      organization_id: orgId,
      branch_id: memBranch != null && String(memBranch).length > 0 ? String(memBranch) : null,
      member_id: memberId,
      title,
      description,
      status: "pending" as const,
      assignee_profile_id: primaryAssigneeId,
      assignee_profile_ids: assigneeIds,
      created_by_profile_id: user.id,
      due_at: dueAt,
      completed_at: null as string | null,
    };
    if (checklist.length > 0) insertPayload.checklist = checklist;
    if (relatedIds.length > 0) insertPayload.related_member_ids = relatedIds;

    let { data: inserted, error: insErr } = await supabaseAdmin
      .from("member_tasks")
      .insert(insertPayload)
      .select(MEMBER_TASK_DB_FIELDS)
      .single();

    if (insErr) {
      const fallback = { ...insertPayload };
      if (
        String(insErr.message || "").toLowerCase().includes("checklist") ||
        String(insErr.message || "").toLowerCase().includes("related_member")
      ) {
        delete fallback.checklist;
        delete fallback.related_member_ids;
      }
      if (taskAssigneeFilterColumnMissing(insErr)) delete fallback.assignee_profile_ids;
      if (
        String(insErr.message || "").toLowerCase().includes("checklist") ||
        String(insErr.message || "").toLowerCase().includes("related_member") ||
        taskAssigneeFilterColumnMissing(insErr)
      ) {
        const selFields = taskAssigneeFilterColumnMissing(insErr) ? MEMBER_TASK_DB_FIELDS_LEGACY : MEMBER_TASK_DB_FIELDS;
        const r2 = await supabaseAdmin.from("member_tasks").insert(fallback).select(selFields).single();
        inserted = r2.data;
        insErr = r2.error;
      }
    }

    if (insErr) {
      if (memberTasksTableMissing(insErr)) {
        return res.status(503).json({ error: "member_tasks table not installed. Run migrations/member_tasks.sql." });
      }
      throw insErr;
    }

    if (inserted && checklist.length > 0) {
      const stored = parseChecklistFromRow((inserted as MemberTaskRow).checklist ?? [], (inserted as MemberTaskRow).id);
      if (stored.length === 0) {
        const { data: patched, error: patchErr } = await supabaseAdmin
          .from("member_tasks")
          .update({ checklist })
          .eq("id", (inserted as MemberTaskRow).id)
          .select(MEMBER_TASK_DB_FIELDS)
          .single();
        if (patchErr) {
          console.error(
            "member_tasks checklist follow-up update failed for",
            (inserted as MemberTaskRow).id,
            patchErr,
          );
        }
        if (!patchErr && patched) {
          inserted = patched;
        }
      }
    }

    const taskJson = mapMemberTaskRowToJson(inserted as MemberTaskRow);
    const taskAssignedPayload: Record<string, unknown> = {
      task_id: taskJson.id,
      task_title: String(title || "Task").trim() || "Task",
      member_id: memberId,
    };
    Object.assign(taskAssignedPayload, await fetchMemberRichFieldsForPayload(memberId, orgId));
    await createNotificationsForRecipients(
      assigneeIds,
      {
        organization_id: orgId,
        branch_id: viewerBranch,
        type: "task_assigned",
        category: "tasks",
        title: "New task assigned",
        message: `You were assigned: ${title}`,
        severity: "medium",
        entity_type: "member_task",
        entity_id: taskJson.id,
        action_path: `/members/${memberId}`,
        payload: taskAssignedPayload,
      },
    );
    res.status(201).json({ task: taskJson });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to create task" });
  }
});

app.patch("/api/member-tasks/:taskId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { taskId } = req.params;
  if (!isUuidString(taskId)) return res.status(400).json({ error: "Invalid task id" });

  try {
    const permCtx = await requirePermission(req, res, "view_member_tasks");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    let { data: existing, error: exErr } = await supabaseAdmin
      .from("member_tasks")
      .select(MEMBER_TASK_DB_FIELDS)
      .eq("id", taskId)
      .maybeSingle();
    if (exErr && memberTasksSelectMissingColumn(exErr)) {
      const r2 = await supabaseAdmin
        .from("member_tasks")
        .select(
          "id, member_id, organization_id, title, description, status, due_at, completed_at, assignee_profile_id, assignee_profile_ids, created_by_profile_id, created_at, updated_at, branch_id",
        )
        .eq("id", taskId)
        .maybeSingle();
      existing = r2.data as MemberTaskRow | null;
      exErr = r2.error;
    }
    if (exErr) {
      if (memberTasksTableMissing(exErr)) return res.status(503).json({ error: "member_tasks table not installed." });
      throw exErr;
    }
    const row = existing as MemberTaskRow & { organization_id: string } | null;
    if (!row || row.organization_id !== orgId) return res.status(404).json({ error: "Task not found" });
    await assertMemberForOrgBranch(row.member_id, orgId, viewerBranch);

    const canManageAll = permCtx.isOrgOwner || permCtx.permissionSet.has("edit_member_tasks");
    const canEditChecklistStructure =
      permCtx.isOrgOwner ||
      permCtx.permissionSet.has("edit_member_tasks") ||
      permCtx.permissionSet.has("edit_member_task_checklist");
    const isAssignee = assigneeProfileIdsFromMemberTaskRow(row).includes(user.id);
    const isCreator = String(row.created_by_profile_id || "") === String(user.id);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const keys = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (canManageAll) {
      if (typeof body.title === "string" && body.title.trim().length > 0) update.title = body.title.trim();
      if (body.description !== undefined) {
        update.description =
          typeof body.description === "string" && body.description.trim().length > 0
            ? body.description.trim()
            : null;
      }
      if (typeof body.status === "string") {
        const st = body.status.trim();
        if (!["pending", "in_progress", "completed", "cancelled"].includes(st)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (body.due_at !== undefined) {
        if (body.due_at === null || String(body.due_at).trim().length === 0) {
          update.due_at = null;
        } else {
          const d = new Date(String(body.due_at));
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
          update.due_at = d.toISOString();
        }
      }
      const parsedPatchAssignees = parseAssigneeProfileIdsFromPatchBody(body);
      if (parsedPatchAssignees.error) return res.status(400).json({ error: parsedPatchAssignees.error });
      if (parsedPatchAssignees.ids !== undefined) {
        for (const aid of parsedPatchAssignees.ids) {
          await assertAssigneeProfileForBranch(aid, orgId, viewerBranch);
        }
        update.assignee_profile_id = parsedPatchAssignees.ids[0];
        update.assignee_profile_ids = parsedPatchAssignees.ids;
      }
      if (body.checklist !== undefined) {
        if (!canEditChecklistStructure) {
          return res.status(403).json({ error: "Missing permission to edit task checklist." });
        }
        update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
      }
      if (body.related_member_ids !== undefined) {
        const raw = Array.isArray(body.related_member_ids) ? body.related_member_ids : [];
        update.related_member_ids = await assertRelatedMembersForTask(
          orgId,
          viewerBranch,
          row.member_id,
          raw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
          user.id,
          permCtx.isOrgOwner,
        );
      }
    } else if (isCreator) {
      const assigneeKeys = keys.filter((k) => k === "assignee_profile_id" || k === "assignee_profile_ids");
      if (assigneeKeys.length > 0) {
        return res.status(403).json({ error: "Only managers can change task assignees." });
      }
      const creatorAllowed = new Set([
        "title",
        "description",
        "status",
        "due_at",
        "checklist",
        "related_member_ids",
      ]);
      const extra = keys.filter((k) => !creatorAllowed.has(k));
      if (extra.length > 0) {
        return res.status(403).json({ error: "You may not change that field on this task." });
      }
      if (typeof body.title === "string" && body.title.trim().length > 0) update.title = body.title.trim();
      if (body.description !== undefined) {
        update.description =
          typeof body.description === "string" && body.description.trim().length > 0
            ? body.description.trim()
            : null;
      }
      if (typeof body.status === "string") {
        const st = body.status.trim();
        if (!["pending", "in_progress", "completed", "cancelled"].includes(st)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (body.due_at !== undefined) {
        if (body.due_at === null || String(body.due_at).trim().length === 0) {
          update.due_at = null;
        } else {
          const d = new Date(String(body.due_at));
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
          update.due_at = d.toISOString();
        }
      }
      if (body.checklist !== undefined) {
        update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
      }
      if (body.related_member_ids !== undefined) {
        const raw = Array.isArray(body.related_member_ids) ? body.related_member_ids : [];
        update.related_member_ids = await assertRelatedMembersForTask(
          orgId,
          viewerBranch,
          row.member_id,
          raw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
          user.id,
          permCtx.isOrgOwner,
        );
      }
    } else if (isAssignee) {
      const allowedAssigneeKeys = new Set(["status", "checklist"]);
      const extra = keys.filter((k) => !allowedAssigneeKeys.has(k));
      if (extra.length > 0) {
        return res
          .status(403)
          .json({ error: "You may only update status or checklist on tasks assigned to you." });
      }
      const hasStatus = typeof body.status === "string";
      const hasCheck = body.checklist !== undefined;
      if (!hasStatus && !hasCheck) return res.status(400).json({ error: "Provide status and/or checklist" });
      if (hasStatus) {
        const st = String(body.status).trim();
        if (!["pending", "in_progress", "completed"].includes(st)) {
          return res.status(400).json({ error: "Invalid status for assignee" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (hasCheck) {
        const existingChecklist = parseChecklistFromRow(row.checklist ?? [], row.id);
        const assigneeMayEditStructure =
          String(row.created_by_profile_id || "") === String(user.id);
        if (assigneeMayEditStructure) {
          update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
        } else {
          const merged = mergeChecklistDoneOnly(existingChecklist, body.checklist);
          if (merged === null) return res.status(400).json({ error: "Invalid checklist update" });
          update.checklist = merged;
        }
      }
    } else if (canEditChecklistStructure) {
      const extra = keys.filter((k) => k !== "checklist");
      if (extra.length > 0) {
        return res.status(403).json({ error: "You may only update the task checklist." });
      }
      if (body.checklist === undefined) return res.status(400).json({ error: "checklist is required" });
      update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }

    const finalChecklist: TaskChecklistItem[] =
      update.checklist !== undefined
        ? (update.checklist as TaskChecklistItem[])
        : parseChecklistFromRow(row.checklist ?? [], row.id);
    const hadExplicitStatusInBody =
      typeof body.status === "string" && String(body.status).trim().length > 0;

    /**
     * Checklist updates should not auto-complete the whole task.
     * Move pending/completed -> in_progress once any checklist item is checked, unless caller explicitly set status.
     */
    if (body.checklist !== undefined && finalChecklist.length > 0 && !hadExplicitStatusInBody) {
      const anyDone = finalChecklist.some((i) => i.done);
      if (anyDone && row.status !== "cancelled" && row.status !== "in_progress") {
        update.status = "in_progress";
        update.completed_at = null;
      }
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("member_tasks")
      .update(update)
      .eq("id", taskId)
      .select(MEMBER_TASK_DB_FIELDS)
      .single();
    if (upErr) throw upErr;

    const taskJson = mapMemberTaskRowToJson(updated as MemberTaskRow);
    if (String(taskJson.status) === "completed") {
      const notifyIds = [
        ...new Set([
          ...assigneeProfileIdsFromMemberTaskRow(updated as MemberTaskRow),
          String(taskJson.created_by_profile_id || ""),
        ]),
      ].filter(isUuidString);
      const completedMid = String(row.member_id || "");
      const taskDonePayload: Record<string, unknown> = {
        task_id: taskJson.id,
        task_title: String(taskJson.title || "Task").trim() || "Task",
        member_id: completedMid,
      };
      if (completedMid && isUuidString(completedMid)) {
        Object.assign(taskDonePayload, await fetchMemberRichFieldsForPayload(completedMid, orgId));
      }
      await createNotificationsForRecipients(
        notifyIds,
        {
          organization_id: orgId,
          branch_id: viewerBranch,
          type: "task_completed",
          category: "leader_updates",
          title: "Task completed",
          message: `Task "${taskJson.title}" was marked completed.`,
          severity: "low",
          entity_type: "member_task",
          entity_id: taskJson.id,
          action_path: `/members/${row.member_id}`,
          payload: taskDonePayload,
        },
      );
    }
    res.json({ task: taskJson });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to update task" });
  }
});

app.delete("/api/member-tasks/:taskId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { taskId } = req.params;
  if (!isUuidString(taskId)) return res.status(400).json({ error: "Invalid task id" });

  try {
    const permCtx = await requireAnyPermission(req, res, [
      "delete_member_tasks",
      "view_member_tasks",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("member_tasks")
      .select("id, member_id, organization_id, created_by_profile_id")
      .eq("id", taskId)
      .maybeSingle();
    if (exErr) {
      if (memberTasksTableMissing(exErr)) return res.status(503).json({ error: "member_tasks table not installed." });
      throw exErr;
    }
    const ex = existing as {
      id: string;
      member_id: string;
      organization_id: string;
      created_by_profile_id?: string | null;
    } | null;
    if (!ex || ex.organization_id !== orgId) return res.status(404).json({ error: "Task not found" });
    await assertMemberForOrgBranch(ex.member_id, orgId, viewerBranch);

    const canDelete =
      permCtx.isOrgOwner ||
      permCtx.permissionSet.has("delete_member_tasks") ||
      String(ex.created_by_profile_id || "") === String(user.id);
    if (!canDelete) return res.status(403).json({ error: "Forbidden" });

    const { error: delErr } = await supabaseAdmin.from("member_tasks").delete().eq("id", taskId);
    if (delErr) throw delErr;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete task" });
  }
});

app.get("/api/groups/:groupId/task-target-options", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "add_group_tasks",
      "edit_group_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "monitor_group_tasks",
      "monitor_member_tasks",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    await assertGroupForOrgBranch(groupId, orgId, viewerBranch);

    const { data: grp, error: gErr } = await supabaseAdmin
      .from("groups")
      .select("id, name, parent_group_id")
      .eq("id", groupId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!grp) return res.status(404).json({ error: "Group not found" });

    const current = { id: (grp as { id: string }).id, name: (grp as { name: string | null }).name ?? null };
    const ancestors: { id: string; name: string | null }[] = [];
    let parentId: string | null = (grp as { parent_group_id?: string | null }).parent_group_id ?? null;
    const visited = new Set<string>([groupId]);
    for (let depth = 0; depth < 24 && parentId; depth += 1) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const { data: parent, error: pErr } = await supabaseAdmin
        .from("groups")
        .select("id, name, parent_group_id, branch_id")
        .eq("id", parentId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (pErr || !parent) break;
      try {
        assertEntityBranch((parent as { branch_id?: string | null }).branch_id, viewerBranch, "group");
      } catch {
        break;
      }
      ancestors.unshift({ id: parent.id, name: parent.name ?? null });
      parentId = parent.parent_group_id ?? null;
    }

    const subtreeIds = await collectSubtreeGroupIds(groupId, orgId);
    const descendantIds = subtreeIds.filter((id) => id !== groupId);
    const descendants: { id: string; name: string | null }[] = [];
    if (descendantIds.length > 0) {
      const { data: descRows, error: dErr } = await supabaseAdmin
        .from("groups")
        .select("id, name, branch_id")
        .eq("organization_id", orgId)
        .in("id", descendantIds);
      if (dErr) throw dErr;
      for (const r of descRows || []) {
        const row = r as { id: string; name: string | null; branch_id?: string | null };
        try {
          assertEntityBranch(row.branch_id, viewerBranch, "group");
          descendants.push({ id: row.id, name: row.name ?? null });
        } catch {
          /* skip out-of-scope */
        }
      }
      descendants.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    res.json({ current, ancestors, descendants });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load options" });
  }
});

app.get("/api/groups/:groupId/tasks", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });

  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_group_tasks",
      "view_member_tasks",
      "monitor_group_tasks",
      "add_group_tasks",
      "edit_group_tasks",
      "delete_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
      "monitor_member_tasks",
      "add_member_tasks",
      "edit_member_tasks",
      "edit_member_task_checklist",
      "complete_member_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertGroupForOrgBranch(groupId, orgId, viewerBranch);
    await assertGroupVisibleUnderMinistryScope(groupId, orgId, viewerBranch, user.id, permCtx.isOrgOwner);

    const sel =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, assignee_profile_ids, created_by_profile_id, checklist, related_group_ids";
    const selLegacy =
      "id, title, description, status, due_at, completed_at, created_at, updated_at, group_id, assignee_profile_id, created_by_profile_id";
    let { data: rowsPrimary, error: err1 } = await supabaseAdmin
      .from("group_tasks")
      .select(sel)
      .eq("group_id", groupId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (err1 && /checklist|assignee_profile_ids/.test(String(err1.message || "").toLowerCase())) {
      const r = await supabaseAdmin
        .from("group_tasks")
        .select(selLegacy)
        .eq("group_id", groupId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      rowsPrimary = r.data as GroupTaskRow[] | null;
      err1 = r.error;
    }
    if (err1) {
      if (groupTasksTableMissing(err1)) return res.json({ tasks: [] });
      throw err1;
    }

    let rowsRelated: GroupTaskRow[] | null = null;
    const { data: relData, error: err2 } = await supabaseAdmin
      .from("group_tasks")
      .select(sel)
      .contains("related_group_ids", [groupId])
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (!err2) rowsRelated = relData as GroupTaskRow[] | null;
    else if (!/related_group|assignee_profile_ids/.test(String(err2.message || "").toLowerCase())) throw err2;

    const byTaskId = new Map<string, GroupTaskRow>();
    for (const r of rowsPrimary || []) byTaskId.set((r as GroupTaskRow).id, r as GroupTaskRow);
    for (const r of rowsRelated || []) byTaskId.set((r as GroupTaskRow).id, r as GroupTaskRow);
    const rows = [...byTaskId.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const profIds = [
      ...new Set(
        rows.flatMap((r) => [
          ...assigneeProfileIdsFromGroupTaskRow(r as GroupTaskRow),
          r.created_by_profile_id,
        ]),
      ),
    ].filter((id): id is string => typeof id === "string" && isUuidString(id));
    const nameById = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", profIds);
      for (const p of profs || []) {
        const row = p as { id: string; first_name?: string | null; last_name?: string | null; email?: string | null };
        const n = `${row.first_name || ""} ${row.last_name || ""}`.trim();
        nameById.set(row.id, n || (row.email || "").trim() || "Staff");
      }
    }

    const withNames = await attachGroupNamesToTasks(rows.map((r) => mapGroupTaskRowToJson(r)));
    let tasks = withNames.map((t) => ({
      ...t,
      assignee_name: assigneeProfileIdsFromGroupTaskRow(t as GroupTaskRow)
        .map((id) => nameById.get(id) || "Staff")
        .join(", "),
      created_by_name: nameById.get(t.created_by_profile_id) || "Staff",
    }));

    const canMonitorOrManageGroup =
      permCtx.isOrgOwner ||
      permCtx.permissionSet.has("monitor_group_tasks") ||
      permCtx.permissionSet.has("add_group_tasks") ||
      permCtx.permissionSet.has("edit_group_tasks") ||
      permCtx.permissionSet.has("delete_group_tasks") ||
      permCtx.permissionSet.has("edit_group_task_checklist");
    if (!canMonitorOrManageGroup) {
      tasks = tasks.filter((t) => {
        const aids = assigneeProfileIdsFromGroupTaskRow(t as GroupTaskRow);
        if (aids.includes(user.id)) return true;
        if (t.created_by_profile_id === user.id) return true;
        return false;
      });
    }

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const totalCount = tasks.length;
    const paged = tasks.slice(offset, offset + limit);
    res.json({ tasks: paged, total_count: totalCount });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load tasks" });
  }
});

app.post("/api/groups/:groupId/tasks", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });

  try {
    const permCtx = await requirePermission(req, res, "add_group_tasks");
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    await assertGroupForOrgBranch(groupId, orgId, viewerBranch);

    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) return res.status(400).json({ error: "title is required" });
    const description =
      typeof req.body?.description === "string" && req.body.description.trim().length > 0
        ? req.body.description.trim()
        : null;
    const parsedGroupAssignees = parseAssigneeProfileIdsFromPostBody(req.body);
    if (parsedGroupAssignees.error) return res.status(400).json({ error: parsedGroupAssignees.error });
    const groupAssigneeIds = parsedGroupAssignees.ids;
    for (const aid of groupAssigneeIds) {
      await assertAssigneeProfileForBranch(aid, orgId, viewerBranch);
    }
    const primaryGroupAssigneeId = groupAssigneeIds[0];

    let dueAt: string | null = null;
    if (req.body?.due_at != null && String(req.body.due_at).trim().length > 0) {
      const d = new Date(String(req.body.due_at));
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
      dueAt = d.toISOString();
    }

    const { data: gRow } = await supabaseAdmin
      .from("groups")
      .select("branch_id")
      .eq("id", groupId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const gBranch = (gRow as { branch_id?: string | null } | null)?.branch_id ?? null;

    const checklist = normalizeChecklistFromBody(req.body?.checklist, groupId);
    if (checklist.length > 0 && !actorCanManageGroupTaskChecklistStructure(permCtx)) {
      return res.status(403).json({ error: "Missing permission to add task checklist items." });
    }
    const relatedRaw = Array.isArray(req.body?.related_group_ids) ? req.body.related_group_ids : [];
    const relatedIds = await assertRelatedGroupsForTask(
      orgId,
      viewerBranch,
      groupId,
      relatedRaw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
    );

    const insertPayload: Record<string, unknown> = {
      organization_id: orgId,
      branch_id: gBranch != null && String(gBranch).length > 0 ? String(gBranch) : null,
      group_id: groupId,
      title,
      description,
      status: "pending" as const,
      assignee_profile_id: primaryGroupAssigneeId,
      assignee_profile_ids: groupAssigneeIds,
      created_by_profile_id: user.id,
      due_at: dueAt,
      completed_at: null as string | null,
    };
    if (checklist.length > 0) insertPayload.checklist = checklist;
    if (relatedIds.length > 0) insertPayload.related_group_ids = relatedIds;

    let { data: inserted, error: insErr } = await supabaseAdmin
      .from("group_tasks")
      .insert(insertPayload)
      .select(GROUP_TASK_DB_FIELDS)
      .single();

    if (insErr) {
      const fallback = { ...insertPayload };
      if (
        String(insErr.message || "").toLowerCase().includes("checklist") ||
        String(insErr.message || "").toLowerCase().includes("related_group")
      ) {
        delete fallback.checklist;
        delete fallback.related_group_ids;
      }
      if (taskAssigneeFilterColumnMissing(insErr)) delete fallback.assignee_profile_ids;
      if (
        String(insErr.message || "").toLowerCase().includes("checklist") ||
        String(insErr.message || "").toLowerCase().includes("related_group") ||
        taskAssigneeFilterColumnMissing(insErr)
      ) {
        const selFields = taskAssigneeFilterColumnMissing(insErr) ? GROUP_TASK_DB_FIELDS_LEGACY : GROUP_TASK_DB_FIELDS;
        const r2 = await supabaseAdmin.from("group_tasks").insert(fallback).select(selFields).single();
        inserted = r2.data;
        insErr = r2.error;
      }
    }

    if (insErr) {
      if (groupTasksTableMissing(insErr)) {
        return res.status(503).json({ error: "group_tasks table not installed. Run migrations/group_tasks.sql." });
      }
      throw insErr;
    }

    res.status(201).json({ task: mapGroupTaskRowToJson(inserted as GroupTaskRow) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to create task" });
  }
});

app.patch("/api/group-tasks/:taskId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { taskId } = req.params;
  if (!isUuidString(taskId)) return res.status(400).json({ error: "Invalid task id" });

  try {
    const permCtx = await requireAnyPermission(req, res, ["view_member_tasks", "view_group_tasks"]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    let { data: existing, error: exErr } = await supabaseAdmin
      .from("group_tasks")
      .select(GROUP_TASK_DB_FIELDS)
      .eq("id", taskId)
      .maybeSingle();
    if (exErr && groupTasksSelectMissingColumn(exErr)) {
      const r2 = await supabaseAdmin
        .from("group_tasks")
        .select(
          "id, group_id, organization_id, title, description, status, due_at, completed_at, assignee_profile_id, assignee_profile_ids, created_by_profile_id, created_at, updated_at, branch_id, related_group_ids",
        )
        .eq("id", taskId)
        .maybeSingle();
      existing = r2.data as GroupTaskRow | null;
      exErr = r2.error;
    }
    if (exErr) {
      if (groupTasksTableMissing(exErr)) return res.status(503).json({ error: "group_tasks table not installed." });
      throw exErr;
    }
    const row = existing as GroupTaskRow & { organization_id: string } | null;
    if (!row || row.organization_id !== orgId) return res.status(404).json({ error: "Task not found" });
    await assertGroupForOrgBranch(row.group_id, orgId, viewerBranch);

    const canManageAll = actorCanManageGroupTasks(permCtx);
    const canEditChecklistStructure = actorCanManageGroupTaskChecklistStructure(permCtx);
    const isAssignee = assigneeProfileIdsFromGroupTaskRow(row).includes(user.id);
    const isCreator = String(row.created_by_profile_id || "") === String(user.id);

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const keys = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    if (keys.length === 0) return res.status(400).json({ error: "No fields to update" });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (canManageAll) {
      if (typeof body.title === "string" && body.title.trim().length > 0) update.title = body.title.trim();
      if (body.description !== undefined) {
        update.description =
          typeof body.description === "string" && body.description.trim().length > 0
            ? body.description.trim()
            : null;
      }
      if (typeof body.status === "string") {
        const st = body.status.trim();
        if (!["pending", "in_progress", "completed", "cancelled"].includes(st)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (body.due_at !== undefined) {
        if (body.due_at === null || String(body.due_at).trim().length === 0) {
          update.due_at = null;
        } else {
          const d = new Date(String(body.due_at));
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
          update.due_at = d.toISOString();
        }
      }
      const parsedPatchGroupAssignees = parseAssigneeProfileIdsFromPatchBody(body);
      if (parsedPatchGroupAssignees.error) return res.status(400).json({ error: parsedPatchGroupAssignees.error });
      if (parsedPatchGroupAssignees.ids !== undefined) {
        for (const aid of parsedPatchGroupAssignees.ids) {
          await assertAssigneeProfileForBranch(aid, orgId, viewerBranch);
        }
        update.assignee_profile_id = parsedPatchGroupAssignees.ids[0];
        update.assignee_profile_ids = parsedPatchGroupAssignees.ids;
      }
      if (body.checklist !== undefined) {
        if (!canEditChecklistStructure) {
          return res.status(403).json({ error: "Missing permission to edit task checklist." });
        }
        update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
      }
      if (body.related_group_ids !== undefined) {
        const raw = Array.isArray(body.related_group_ids) ? body.related_group_ids : [];
        update.related_group_ids = await assertRelatedGroupsForTask(
          orgId,
          viewerBranch,
          row.group_id,
          raw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
        );
      }
    } else if (isCreator) {
      const assigneeKeys = keys.filter((k) => k === "assignee_profile_id" || k === "assignee_profile_ids");
      if (assigneeKeys.length > 0) {
        return res.status(403).json({ error: "Only managers can change task assignees." });
      }
      const creatorAllowed = new Set([
        "title",
        "description",
        "status",
        "due_at",
        "checklist",
        "related_group_ids",
      ]);
      const extra = keys.filter((k) => !creatorAllowed.has(k));
      if (extra.length > 0) {
        return res.status(403).json({ error: "You may not change that field on this task." });
      }
      if (typeof body.title === "string" && body.title.trim().length > 0) update.title = body.title.trim();
      if (body.description !== undefined) {
        update.description =
          typeof body.description === "string" && body.description.trim().length > 0
            ? body.description.trim()
            : null;
      }
      if (typeof body.status === "string") {
        const st = body.status.trim();
        if (!["pending", "in_progress", "completed", "cancelled"].includes(st)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (body.due_at !== undefined) {
        if (body.due_at === null || String(body.due_at).trim().length === 0) {
          update.due_at = null;
        } else {
          const d = new Date(String(body.due_at));
          if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Invalid due_at" });
          update.due_at = d.toISOString();
        }
      }
      if (body.checklist !== undefined) {
        update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
      }
      if (body.related_group_ids !== undefined) {
        const raw = Array.isArray(body.related_group_ids) ? body.related_group_ids : [];
        update.related_group_ids = await assertRelatedGroupsForTask(
          orgId,
          viewerBranch,
          row.group_id,
          raw.filter((x: unknown): x is string => typeof x === "string" && isUuidString(x)),
        );
      }
    } else if (isAssignee) {
      const allowedAssigneeKeys = new Set(["status", "checklist"]);
      const extra = keys.filter((k) => !allowedAssigneeKeys.has(k));
      if (extra.length > 0) {
        return res
          .status(403)
          .json({ error: "You may only update status or checklist on tasks assigned to you." });
      }
      const hasStatus = typeof body.status === "string";
      const hasCheck = body.checklist !== undefined;
      if (!hasStatus && !hasCheck) return res.status(400).json({ error: "Provide status and/or checklist" });
      if (hasStatus) {
        const st = String(body.status).trim();
        if (!["pending", "in_progress", "completed"].includes(st)) {
          return res.status(400).json({ error: "Invalid status for assignee" });
        }
        update.status = st;
        update.completed_at = st === "completed" ? new Date().toISOString() : null;
      }
      if (hasCheck) {
        const existingChecklist = parseChecklistFromRow(row.checklist ?? [], row.id);
        const assigneeMayEditStructure =
          String(row.created_by_profile_id || "") === String(user.id);
        if (assigneeMayEditStructure) {
          update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
        } else {
          const merged = mergeChecklistDoneOnly(existingChecklist, body.checklist);
          if (merged === null) return res.status(400).json({ error: "Invalid checklist update" });
          update.checklist = merged;
        }
      }
    } else if (canEditChecklistStructure) {
      const extra = keys.filter((k) => k !== "checklist");
      if (extra.length > 0) {
        return res.status(403).json({ error: "You may only update the task checklist." });
      }
      if (body.checklist === undefined) return res.status(400).json({ error: "checklist is required" });
      update.checklist = normalizeChecklistFromBody(body.checklist, taskId);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }

    const finalChecklist: TaskChecklistItem[] =
      update.checklist !== undefined
        ? (update.checklist as TaskChecklistItem[])
        : parseChecklistFromRow(row.checklist ?? [], row.id);
    const explicitStatusRaw =
      typeof body.status === "string" && String(body.status).trim().length > 0
        ? String(body.status).trim()
        : null;
    /**
     * Keep checklist and task status decoupled for group tasks too.
     * Explicit status updates still work; checklist progress only moves to in_progress.
     */
    if (body.checklist !== undefined && finalChecklist.length > 0 && explicitStatusRaw == null) {
      const anyDone = finalChecklist.some((i) => i.done);
      if (anyDone && row.status !== "cancelled" && row.status !== "in_progress") {
        update.status = "in_progress";
        update.completed_at = null;
      }
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("group_tasks")
      .update(update)
      .eq("id", taskId)
      .select(GROUP_TASK_DB_FIELDS)
      .single();
    if (upErr) throw upErr;

    res.json({ task: mapGroupTaskRowToJson(updated as GroupTaskRow) });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to update task" });
  }
});

app.delete("/api/group-tasks/:taskId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { taskId } = req.params;
  if (!isUuidString(taskId)) return res.status(400).json({ error: "Invalid task id" });

  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_group_tasks",
      "view_member_tasks",
      "delete_group_tasks",
      "monitor_group_tasks",
      "add_group_tasks",
      "edit_group_tasks",
      "edit_group_task_checklist",
      "complete_group_task_checklist",
    ]);
    if (!permCtx) return;

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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("group_tasks")
      .select("id, group_id, organization_id, created_by_profile_id")
      .eq("id", taskId)
      .maybeSingle();
    if (exErr) {
      if (groupTasksTableMissing(exErr)) return res.status(503).json({ error: "group_tasks table not installed." });
      throw exErr;
    }
    const ex = existing as {
      id: string;
      group_id: string;
      organization_id: string;
      created_by_profile_id?: string | null;
    } | null;
    if (!ex || ex.organization_id !== orgId) return res.status(404).json({ error: "Task not found" });
    await assertGroupForOrgBranch(ex.group_id, orgId, viewerBranch);

    const canDelete =
      permCtx.isOrgOwner ||
      actorCanManageGroupTasks(permCtx) ||
      String(ex.created_by_profile_id || "") === String(user.id);
    if (!canDelete) return res.status(403).json({ error: "Forbidden" });

    const { error: delErr } = await supabaseAdmin.from("group_tasks").delete().eq("id", taskId);
    if (delErr) throw delErr;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete task" });
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const rawStatus = req.query.status;
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const statusFilter =
      typeof rawStatus === "string"
        ? rawStatus
        : Array.isArray(rawStatus) && typeof rawStatus[0] === "string"
          ? rawStatus[0]
          : undefined;

    const runMemberRequestsQuery = (db: ReturnType<typeof createClient>) => {
      let q = db
        .from("member_requests")
        .select("*", { count: "exact" })
        .eq("organization_id", userProfile.organization_id)
        .eq("branch_id", viewerBranch);

      if (statusFilter) {
        q = q.eq("status", statusFilter);
      } else {
        q = q.eq("status", "pending");
      }
      q = q.range(offset, offset + limit - 1);

      return q;
    };

    let { data: requests, error, count: reqCount } = await runMemberRequestsQuery(getSupabaseClient(token));

    if (error) {
      const { data: adminData, error: adminError, count: adminCount } = await runMemberRequestsQuery(supabaseAdmin);
      if (adminError) {
        return res.status(500).json({ error: adminError.message || "Failed to fetch member requests", details: adminError });
      }
      requests = adminData;
      reqCount = adminCount;
    } else if (!requests || requests.length === 0) {
      const { data: adminData, error: adminError, count: adminCount } = await runMemberRequestsQuery(supabaseAdmin);
      if (adminError) {
        return res.status(500).json({ error: adminError.message || "Failed to fetch member requests", details: adminError });
      }
      if (adminData && adminData.length > 0) {
        requests = adminData;
        reqCount = adminCount;
      }
    }

    res.status(200).json({ requests: requests ?? [], total_count: reqCount ?? (requests ?? []).length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("member_requests")
      .select("id, organization_id, branch_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Member request not found" });
    }

    if (existing.organization_id !== userProfile.organization_id) {
      return res.status(403).json({ error: "Unauthorized to update this request" });
    }

    assertEntityBranch((existing as { branch_id?: string | null }).branch_id, viewerBranch, "member_request");

    if (existing.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be edited" });
    }

    if (form_data === undefined || form_data === null || typeof form_data !== "object" || Array.isArray(form_data)) {
      return res.status(400).json({ error: "form_data must be a JSON object" });
    }

    const sanitizedFormData = { ...(form_data as Record<string, unknown>) };
    if (Object.prototype.hasOwnProperty.call(sanitizedFormData, "gender")) {
      sanitizedFormData.gender = normalizeBinaryGender(sanitizedFormData.gender, "lower") ?? "";
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("member_requests")
      .update({
        form_data: sanitizedFormData,
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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/member-requests/:id/approve", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;

  try {
    const permCtx = await requirePermission(req, res, "approve_member_requests");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

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

    assertEntityBranch((mreq as { branch_id?: string | null }).branch_id, viewerBranch, "member_request");

    if (mreq.status !== "pending") {
      return res.status(400).json({ error: "Only pending requests can be approved" });
    }

    const fd = (mreq.form_data && typeof mreq.form_data === "object" ? mreq.form_data : {}) as Record<string, any>;
    const defaultCountryApr = await getOrgDefaultPhoneCountryIso(mreq.organization_id as string);
    let phonesApr: ReturnType<typeof normalizeMemberPhonesForDb>;
    try {
      phonesApr = normalizeMemberPhonesForDb(
        {
          phone: firstNonEmptyString(fd.phoneNumber, fd.phone),
          phone_country_iso: fd.phoneCountryIso ?? fd.phone_country_iso ?? null,
          emergency_contact_phone: firstNonEmptyString(fd.emergencyContactPhone, fd.emergency_contact_phone),
          emergency_contact_phone_country_iso:
            fd.emergencyContactPhoneCountryIso ?? fd.emergency_contact_phone_country_iso ?? null,
        },
        defaultCountryApr,
      );
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 400) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid phone in request" });
      }
      throw e;
    }
    if (!phonesApr.phone_number) {
      return res.status(400).json({ error: "Member request is missing a valid phone number" });
    }
    const dbMemberData: any = {
      email: fd.email ?? null,
      phone_number: phonesApr.phone_number,
      phone_country_iso: phonesApr.phone_country_iso,
      address: fd.location ?? "",
      emergency_contact_name: fd.emergencyContactName ?? "",
      emergency_contact_phone: phonesApr.emergency_contact_phone,
      emergency_contact_phone_country_iso: phonesApr.emergency_contact_phone_country_iso,
      dob: fd.dateOfBirth ?? null,
      memberimage_url: fd.profileImage ?? null,
      organization_id: mreq.organization_id,
      branch_id: mreq.branch_id,
      date_joined: fd.dateJoined || new Date().toISOString().split("T")[0],
      member_id_string: "",
      status: "active",
      first_name: fd.firstName || "Unknown",
      last_name: fd.lastName || "",
      gender: normalizeBinaryGender(fd.gender, "title"),
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
    if (member?.id) {
      await ensureMemberInAllMembersGroup(
        supabaseAdmin,
        String(mreq.organization_id),
        String(mreq.branch_id),
        String(member.id),
      );
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

    const reviewers = await profileIdsWithAnyPermission(String(mreq.organization_id), String(mreq.branch_id || viewerBranch), [
      "approve_member_requests",
      "reject_member_requests",
    ]);
    const memberApprovalRecipients = recipientIdsExcludingActor(reviewers, user.id);
    const newMemberId = String((member as { id?: string } | null)?.id || "");
    const approvedName =
      `${String((member as { first_name?: string } | null)?.first_name || "").trim()} ${String((member as { last_name?: string } | null)?.last_name || "").trim()}`.trim() ||
      "A new member";
    const mrPayload: Record<string, unknown> = {
      request_id: id,
      member_id: newMemberId,
      openMemberId: newMemberId,
      member_display_name: approvedName,
    };
    const imgMr = member ? memberImageFromMemberRecord(member as Record<string, unknown>) : "";
    if (imgMr) mrPayload.member_image_url = imgMr;
    if (memberApprovalRecipients.length > 0) {
      await createNotificationsForRecipients(memberApprovalRecipients, {
        organization_id: String(mreq.organization_id),
        branch_id: String(mreq.branch_id || viewerBranch),
        type: "member_request_approved",
        category: "requests",
        title: "Member request approved",
        message: `${approvedName} was approved and added to the directory.`,
        severity: "medium",
        entity_type: "member_request",
        entity_id: String(id),
        action_path: newMemberId && isUuidString(newMemberId) ? `/members/${newMemberId}` : "/members",
        payload: mrPayload,
        dedupe_key: `member_request_approved:${String(id)}`,
        dedupe_window_minutes: 120,
      });
    }
    res.status(200).json({ message: "Member request approved", member, request: updatedReq });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

app.post("/api/member-requests/:id/reject", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;

  try {
    const permCtx = await requirePermission(req, res, "reject_member_requests");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: mreq, error: fetchError } = await supabaseAdmin
      .from("member_requests")
      .select("id, organization_id, branch_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !mreq) {
      return res.status(404).json({ error: "Member request not found" });
    }

    if (mreq.organization_id !== userProfile.organization_id) {
      return res.status(403).json({ error: "Unauthorized to reject this request" });
    }

    assertEntityBranch((mreq as { branch_id?: string | null }).branch_id, viewerBranch, "member_request");

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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to reject member request" });
  }
});

app.post("/api/members", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "add_members");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const memberData = req.body;
    const orgId = userProfile.organization_id as string;

    const limM = await assertOrgLimit(supabaseAdmin, orgId, "members");
    if (!limM.ok)
      return res.status(403).json({ error: limM.message, code: "ORG_LIMIT", current: limM.current, limit: limM.limit });

    const cfCreate = await validateAndMergeCustomFields(
      orgId,
      "member",
      viewerBranch,
      null,
      memberData.custom_fields !== undefined ? memberData.custom_fields : {},
      "create",
    );
    if (!cfCreate.ok) {
      return res.status(cfCreate.status).json({ error: cfCreate.error });
    }

    const defaultPhoneCountry = await getOrgDefaultPhoneCountryIso(orgId);
    let phonesNorm: ReturnType<typeof normalizeMemberPhonesForDb>;
    try {
      phonesNorm = normalizeMemberPhonesForDb(
        {
          phone: firstNonEmptyString(memberData.phone, memberData.phoneNumber, memberData.phone_national),
          phone_country_iso:
            memberData.phone_country_iso ?? memberData.phoneCountryIso ?? null,
          emergency_contact_phone: firstNonEmptyString(
            memberData.emergency_contact_phone,
            memberData.emergencyContactPhone,
            memberData.emergency_contact_phone_national,
          ),
          emergency_contact_phone_country_iso:
            memberData.emergency_contact_phone_country_iso ??
            memberData.emergencyContactPhoneCountryIso ??
            null,
        },
        defaultPhoneCountry,
      );
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 400) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid phone" });
      }
      throw e;
    }
    if (!phonesNorm.phone_number) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Map frontend fields to database columns
    const dbMemberData: any = {
      email: memberData.email,
      phone_number: phonesNorm.phone_number,
      phone_country_iso: phonesNorm.phone_country_iso,
      address: memberData.address || memberData.location || '',
      emergency_contact_name: memberData.emergency_contact_name || memberData.emergencyContactName || '',
      emergency_contact_phone: phonesNorm.emergency_contact_phone,
      emergency_contact_phone_country_iso: phonesNorm.emergency_contact_phone_country_iso,
      dob: memberData.dob || memberData.dateOfBirth || null,
      memberimage_url: memberData.member_url || memberData.memberUrl || memberData.profileImage || null,
      organization_id: orgId,
      branch_id: viewerBranch,
      date_joined: memberData.date_joined || memberData.dateJoined || new Date().toISOString().split('T')[0],
      member_id_string: memberData.member_id_string || memberData.memberIdString || '',
      status: memberData.status || 'active',
      first_name: memberData.first_name || (memberData.fullName ? memberData.fullName.split(' ')[0] : 'Unknown'),
      last_name: memberData.last_name || (memberData.fullName ? memberData.fullName.split(' ').slice(1).join(' ') : ''),
      gender: normalizeBinaryGender(memberData.gender, "title"),
      marital_status: memberData.marital_status || null,
      occupation: memberData.occupation || null,
      custom_fields: cfCreate.value,
    };

    const insertMember = async (omitCustomFields: boolean) => {
      const payload = { ...dbMemberData };
      if (omitCustomFields) delete payload.custom_fields;
      return supabaseAdmin.from("members").insert([payload]).select().single();
    };

    let { data: member, error } = await insertMember(false);
    if (error && jsonbCustomFieldsColumnMissing(error)) {
      ({ data: member, error } = await insertMember(true));
    }

    if (error) {
      return res.status(500).json({ 
        error: error.message, 
        details: error.details,
        hint: error.hint,
        code: error.code
      });
    }
    if (member?.id) {
      await ensureMemberInAllMembersGroup(supabaseAdmin, orgId, viewerBranch, String(member.id));
    }
    
    res.status(201).json(member);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.put("/api/members/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "edit_members");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { id } = req.params;

    const { data: existingMember, error: exM } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (exM) throw exM;
    if (!existingMember) {
      return res.status(404).json({ error: "Member not found" });
    }
    assertEntityBranch((existingMember as { branch_id?: string | null }).branch_id, viewerBranch, "member");

    const memberData = req.body;
    const orgIdPut = userProfile.organization_id as string;

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
    mapField('address', ['address', 'location']);
    mapField('emergency_contact_name', ['emergency_contact_name', 'emergencyContactName']);
    const phoneKeysTouched = [
      "phone",
      "phoneNumber",
      "phone_number",
      "phone_country_iso",
      "phoneCountryIso",
      "emergency_contact_phone",
      "emergencyContactPhone",
      "emergency_contact_phone_country_iso",
      "emergencyContactPhoneCountryIso",
    ].some((k) => memberData[k] !== undefined);

    if (phoneKeysTouched) {
      const { data: er } = await supabaseAdmin
        .from("members")
        .select("phone_number, phone_country_iso, emergency_contact_phone, emergency_contact_phone_country_iso")
        .eq("id", id)
        .eq("organization_id", orgIdPut)
        .maybeSingle();
      const existing = er as {
        phone_number?: string | null;
        phone_country_iso?: string | null;
        emergency_contact_phone?: string | null;
        emergency_contact_phone_country_iso?: string | null;
      } | null;
      const defPut = await getOrgDefaultPhoneCountryIso(orgIdPut);
      const mergedPhone =
        memberData.phone !== undefined
          ? String(memberData.phone)
          : memberData.phoneNumber !== undefined
            ? String(memberData.phoneNumber)
            : memberData.phone_number !== undefined
              ? String(memberData.phone_number)
              : (existing?.phone_number ?? "");
      const mergedPhoneCountry =
        memberData.phone_country_iso !== undefined
          ? memberData.phone_country_iso
          : memberData.phoneCountryIso !== undefined
            ? memberData.phoneCountryIso
            : existing?.phone_country_iso;
      const mergedEm =
        memberData.emergency_contact_phone !== undefined
          ? String(memberData.emergency_contact_phone)
          : memberData.emergencyContactPhone !== undefined
            ? String(memberData.emergencyContactPhone)
            : (existing?.emergency_contact_phone ?? "");
      const mergedEmCountry =
        memberData.emergency_contact_phone_country_iso !== undefined
          ? memberData.emergency_contact_phone_country_iso
          : memberData.emergencyContactPhoneCountryIso !== undefined
            ? memberData.emergencyContactPhoneCountryIso
            : existing?.emergency_contact_phone_country_iso;
      try {
        const n = normalizeMemberPhonesForDb(
          {
            phone: mergedPhone,
            phone_country_iso: mergedPhoneCountry,
            emergency_contact_phone: mergedEm,
            emergency_contact_phone_country_iso: mergedEmCountry,
          },
          defPut,
        );
        dbMemberData.phone_number = n.phone_number;
        dbMemberData.phone_country_iso = n.phone_country_iso;
        dbMemberData.emergency_contact_phone = n.emergency_contact_phone;
        dbMemberData.emergency_contact_phone_country_iso = n.emergency_contact_phone_country_iso;
      } catch (e: unknown) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 400) {
          return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid phone" });
        }
        throw e;
      }
    } else {
      mapField('phone_number', ['phone', 'phoneNumber', 'phone_number']);
      mapField('emergency_contact_phone', ['emergency_contact_phone', 'emergencyContactPhone']);
    }
    mapField('dob', ['dob', 'dateOfBirth', 'date_of_birth']);
    mapField('avatar_url', ['avatar_url']);
    mapField('memberimage_url', ['member_url', 'memberUrl', 'profileImage', 'memberimage_url']);
    mapField('date_joined', ['date_joined', 'dateJoined']);
    mapField('member_id_string', ['member_id_string', 'memberIdString']);
    mapField('status', ['status']);
    mapField('gender', ['gender']);
    mapField('marital_status', ['marital_status', 'maritalStatus']);
    mapField('occupation', ['occupation']);
    if (Object.prototype.hasOwnProperty.call(dbMemberData, "gender")) {
      dbMemberData.gender = normalizeBinaryGender(dbMemberData.gender, "title");
    }

    if (memberData.fullName || memberData.first_name || memberData.last_name) {
      if (memberData.first_name) dbMemberData.first_name = memberData.first_name;
      if (memberData.last_name) dbMemberData.last_name = memberData.last_name;
      if (memberData.fullName) {
        if (!dbMemberData.first_name) dbMemberData.first_name = memberData.fullName.split(' ')[0];
        if (!dbMemberData.last_name) dbMemberData.last_name = memberData.fullName.split(' ').slice(1).join(' ');
      }
    }

    if (memberData.custom_fields !== undefined) {
      const { data: prevRow } = await supabaseAdmin
        .from("members")
        .select("custom_fields")
        .eq("id", id)
        .eq("organization_id", orgIdPut)
        .maybeSingle();
      const prevCf =
        prevRow &&
        typeof (prevRow as { custom_fields?: unknown }).custom_fields === "object" &&
        !Array.isArray((prevRow as { custom_fields?: unknown }).custom_fields)
          ? ((prevRow as { custom_fields: Record<string, unknown> }).custom_fields as Record<string, unknown>)
          : {};
      const cfMerge = await validateAndMergeCustomFields(
        orgIdPut,
        "member",
        viewerBranch,
        prevCf,
        memberData.custom_fields,
        "merge",
      );
      if (!cfMerge.ok) {
        return res.status(cfMerge.status).json({ error: cfMerge.error });
      }
      dbMemberData.custom_fields = cfMerge.value;
    }

    const runMemberUpdate = async (omitCustomFields: boolean) => {
      const payload = { ...dbMemberData };
      if (omitCustomFields) delete payload.custom_fields;
      return supabaseAdmin
        .from("members")
        .update(payload)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .eq("branch_id", viewerBranch)
        .select()
        .single();
    };

    let { data: member, error } = await runMemberUpdate(false);
    if (error && jsonbCustomFieldsColumnMissing(error)) {
      ({ data: member, error } = await runMemberUpdate(true));
    }

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
        .eq("organization_id", userProfile.organization_id)
        .eq("branch_id", viewerBranch);

      if (delError) {
        return res.status(500).json({ error: delError.message });
      }

      const allMembersGroupId = await getAllMembersGroupIdForBranch(
        supabaseAdmin,
        userProfile.organization_id as string,
        viewerBranch,
      );

      if (groupIds.length > 0 || allMembersGroupId) {
        const queryIds = allMembersGroupId ? [...new Set([...groupIds, allMembersGroupId])] : groupIds;
        let { data: validGroups, error: vgError } = await supabaseAdmin
          .from("groups")
          .select("id, branch_id, is_system, system_kind")
          .eq("organization_id", userProfile.organization_id)
          .in("id", queryIds);

        if (vgError) {
          const msg = String(vgError.message || "").toLowerCase();
          if (msg.includes("is_system") || msg.includes("system_kind") || (vgError as { code?: string }).code === "42703") {
            const fb = await supabaseAdmin
              .from("groups")
              .select("id, branch_id")
              .eq("organization_id", userProfile.organization_id)
              .in("id", queryIds);
            validGroups = fb.data;
            vgError = fb.error;
          }
        }
        if (vgError) {
          return res.status(500).json({ error: vgError.message });
        }

        for (const g of validGroups || []) {
          const row = g as { is_system?: boolean | null; system_kind?: string | null };
          if (isRestrictedSystemGroup(row, { allowAllMembers: true }) && !isLockedAllMembersGroup(row)) {
            return res.status(400).json({ error: "Cannot assign members to system groups" });
          }
        }

        const allowed = new Set(
          (validGroups || [])
            .filter((g: { branch_id?: string | null }) => g.branch_id && String(g.branch_id) === viewerBranch)
            .map((g: { id: string }) => g.id),
        );
        const enforcedIds = allMembersGroupId ? [...new Set([...groupIds, allMembersGroupId])] : groupIds;
        const toInsert = enforcedIds
          .filter((gid) => allowed.has(gid))
          .map((group_id) => ({
            group_id,
            member_id: id,
            role_in_group: "member",
            organization_id: userProfile.organization_id,
            branch_id: viewerBranch,
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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.delete("/api/members/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "delete_members");
    if (!permCtx) return;

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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { id } = req.params;

    const { data: memRow, error: mErr } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!memRow) {
      return res.status(404).json({ error: "Member not found" });
    }
    assertEntityBranch((memRow as { branch_id?: string | null }).branch_id, viewerBranch, "member");

    const { error } = await supabaseAdmin
      .from("members")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.status(200).json({ message: "Member soft-deleted successfully" });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/members/:id/restore", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "delete_members");
    if (!permCtx) return;

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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { id } = req.params;

    const { data: memRow, error: mErr } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!memRow) {
      return res.status(404).json({ error: "Member not found" });
    }
    assertEntityBranch((memRow as { branch_id?: string | null }).branch_id, viewerBranch, "member");

    const { error } = await supabaseAdmin
      .from("members")
      .update({ is_deleted: false, deleted_at: null })
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await ensureMemberInAllMembersGroup(supabaseAdmin, userProfile.organization_id as string, viewerBranch, id);
    
    res.status(200).json({ message: "Member restored successfully" });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

async function hardPurgeSoftDeletedMember(
  memberId: string,
  organizationId: string,
  viewerBranch: string,
): Promise<void> {
  const { data: memRow, error: mErr } = await supabaseAdmin
    .from("members")
    .select("id, branch_id, is_deleted")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!memRow) throw new Error("Member not found");
  assertEntityBranch((memRow as { branch_id?: string | null }).branch_id, viewerBranch, "member");
  if (!(memRow as { is_deleted?: boolean | null }).is_deleted) {
    throw new Error("Member is not in trash; only soft-deleted members can be permanently removed");
  }

  const ignorable = (e: { message?: string; code?: string } | null) => {
    const m = String(e?.message || "").toLowerCase();
    const c = String(e?.code || "");
    return c === "42P01" || m.includes("does not exist") || m.includes("schema cache");
  };

  const safeDel = async (fn: () => Promise<{ error: { message?: string; code?: string } | null }>) => {
    const { error } = await fn();
    if (error && !ignorable(error)) throw error;
  };

  await safeDel(() =>
    supabaseAdmin.from("group_members").delete().eq("member_id", memberId).eq("organization_id", organizationId),
  );
  await safeDel(() => supabaseAdmin.from("member_families").delete().eq("member_id", memberId));
  await safeDel(() => supabaseAdmin.from("group_requests").delete().eq("member_id", memberId));
  await safeDel(() => supabaseAdmin.from("event_attendance").delete().eq("member_id", memberId));
  await safeDel(() => supabaseAdmin.from("event_assigned_members").delete().eq("member_id", memberId));

  const { error: delMem } = await supabaseAdmin
    .from("members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", organizationId);
  if (delMem) throw delMem;
}

app.post("/api/members/batch-purge", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "delete_members");
    if (!permCtx) return;

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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const orgId = userProfile.organization_id as string;
    const ids = normalizeUuidArray((req.body || {}).ids);
    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }

    let purged = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await hardPurgeSoftDeletedMember(id, orgId, viewerBranch);
        purged += 1;
      } catch (e: any) {
        errors.push(`${id}: ${e.message || "purge failed"}`);
      }
    }
    res.status(200).json({ purged, errors });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permFamList = await requirePermission(req, res, "view_families");
    if (!permFamList) return;

    const { branch_id } = req.query;
    const effectiveBranch = typeof branch_id === "string" && branch_id.trim() ? branch_id.trim() : viewerBranch;
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    let query = supabaseAdmin
      .from("families")
      .select("*", { count: "exact" })
      .eq("organization_id", userProfile.organization_id);
      
    if (effectiveBranch) {
      query = query.eq("branch_id", effectiveBranch);
    }
    query = query.range(offset, offset + limit - 1);

    const { data: families, error, count } = await query;

    if (error) throw error;
    res.json({ families: families || [], total_count: count ?? (families || []).length });
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

    const permFamCreate = await requirePermission(req, res, "add_families");
    if (!permFamCreate) return;

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
    const permFamPut = await requirePermission(req, res, "edit_families");
    if (!permFamPut) return;
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
    const permFamDel = await requirePermission(req, res, "delete_families");
    if (!permFamDel) return;
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

    const ctxMfPost = await getActorAuthContextFromToken(token);
    if (!ctxMfPost) return res.status(401).json({ error: "Unauthorized" });
    if (!ctxMfPost.isOrgOwner) {
      const okLink =
        ctxMfPost.permissionSet.has("add_families") ||
        (ctxMfPost.permissionSet.has("edit_members") && ctxMfPost.permissionSet.has("view_families"));
      if (!okLink) {
        return res.status(403).json({ error: "Missing permission to link members and families" });
      }
    }

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

    const ctxMfDel = await getActorAuthContextFromToken(token);
    if (!ctxMfDel) return res.status(401).json({ error: "Unauthorized" });
    if (!ctxMfDel.isOrgOwner) {
      const okUnlink =
        ctxMfDel.permissionSet.has("delete_families") ||
        (ctxMfDel.permissionSet.has("edit_members") && ctxMfDel.permissionSet.has("view_families"));
      if (!okUnlink) {
        return res.status(403).json({ error: "Missing permission to unlink members and families" });
      }
    }

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
    const permMfMember = await requireAnyPermission(req, res, ["view_members", "view_families"]);
    if (!permMfMember) return;

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

/** Members in a family (same mapped shape as GET `/api/members`). */
app.get("/api/member-families/family/:familyId", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requireAnyPermission(req, res, [
      "view_members",
      "view_families",
      ...ANY_MEMBER_OR_GROUP_TASK_PERM,
    ]);
    if (!permCtx) return;

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { familyId } = req.params;
    if (!isUuidString(familyId)) return res.status(400).json({ error: "Invalid family id" });

    const { data: famRow, error: famErr } = await supabaseAdmin
      .from("families")
      .select("id, organization_id, branch_id")
      .eq("id", familyId)
      .maybeSingle();
    if (famErr) throw famErr;
    if (!famRow || (famRow as { organization_id: string }).organization_id !== orgId) {
      return res.status(404).json({ error: "Family not found" });
    }
    const famBranch = (famRow as { branch_id?: string | null }).branch_id;
    if (famBranch != null && String(famBranch).trim() && String(famBranch) !== viewerBranch) {
      return res.status(404).json({ error: "Family not found" });
    }

    const { data: mfRows, error: mfErr } = await supabaseAdmin
      .from("member_families")
      .select("member_id")
      .eq("family_id", familyId);
    if (mfErr) throw mfErr;
    const memberIds = [
      ...new Set(
        (mfRows || [])
          .map((r) => (r as { member_id?: string }).member_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (memberIds.length === 0) {
      return res.json({ members: [] });
    }

    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("*")
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .in("id", memberIds)
      .or("is_deleted.eq.false,is_deleted.is.null")
      .order("created_at", { ascending: false });
    if (memErr) throw memErr;

    const { data: memberFamilies, error: mffErr } = await supabaseAdmin
      .from("member_families")
      .select("member_id, family_id");
    if (mffErr) throw mffErr;
    const { data: memberGroupRows, error: mgListError } = await supabaseAdmin
      .from("group_members")
      .select("member_id, group_id")
      .eq("organization_id", orgId);
    if (mgListError) throw mgListError;

    let mappedMembers = (members || []).map((m) => ({
      ...m,
      phoneNumber: m.phone_number,
      dateOfBirth: m.dob,
      dateJoined: m.date_joined,
      memberIdString: m.member_id_string,
      profileImage: m.avatar_url || m.memberimage_url || m.member_url || null,
      fullName: `${m.first_name} ${m.last_name}`,
      location: m.address,
      emergencyContactName: m.emergency_contact_name,
      emergencyContactPhone: m.emergency_contact_phone,
      status: m.status,
      familyIds: (memberFamilies || []).filter((mf) => mf.member_id === m.id).map((mf) => mf.family_id),
      groupIds: (memberGroupRows || []).filter((mg) => mg.member_id === m.id).map((mg) => mg.group_id),
    }));

    const mScope = await ministryScopeForActor(user.id, orgId, viewerBranch, permCtx.isOrgOwner);
    const allowedMemberIds = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, mScope);
    if (allowedMemberIds !== null) {
      mappedMembers = mappedMembers.filter((m) => allowedMemberIds.has(m.id as string));
    }

    res.json({ members: mappedMembers });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load family members" });
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const deletedOnly =
      String(req.query.deleted_only || req.query.trash || "").trim() === "1" ||
      String(req.query.deleted_only || "").toLowerCase() === "true";
    if (deletedOnly) {
      const permGrpTrash = await requireAnyPermission(req, res, [
        "view_groups",
        "archive_groups",
        "restore_groups",
        "purge_groups",
      ]);
      if (!permGrpTrash) return;
    } else {
      const permGrpList = await requirePermission(req, res, "view_groups");
      if (!permGrpList) return;
    }

    const { parent_group_id, member_id, tree } = req.query;
    const treeAll =
      tree === "1" ||
      tree === "true" ||
      (typeof tree === "string" && tree.toLowerCase() === "yes");
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));

    let query = supabaseAdmin
      .from("groups")
      .select("*, profiles!leader_id(first_name, last_name, email, avatar_url)") // Disambiguate embed (multiple FKs groups↔profiles)
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch);

    if (deletedOnly) {
      query = query.eq("is_deleted", true);
    } else {
      query = query.or("is_deleted.eq.false,is_deleted.is.null");
    }
      
    if (member_id) {
      const { data: memberGroups, error: memberGroupsError } = await supabaseAdmin
        .from("group_members")
        .select("group_id")
        .eq("member_id", member_id as string)
        .eq("organization_id", userProfile.organization_id);

      if (memberGroupsError) throw memberGroupsError;

      const existingGroupIds = memberGroups.map(mg => mg.group_id);

      if (existingGroupIds.length > 0) {
        query = query.not("id", "in", existingGroupIds);
      }
    }

    if (parent_group_id !== undefined && String(parent_group_id).length > 0) {
      const pid = String(parent_group_id).trim();
      if (!isUuidString(pid)) {
        return res.status(400).json({ error: "Invalid parent_group_id" });
      }
      const { data: parentG } = await supabaseAdmin
        .from("groups")
        .select("branch_id, organization_id")
        .eq("id", pid)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (!parentG) {
        return res.status(404).json({ error: "Parent group not found" });
      }
      assertEntityBranch((parentG as { branch_id?: string | null }).branch_id, viewerBranch, "parent");
      query = query.eq("parent_group_id", pid);
    } else if (!treeAll && !deletedOnly) {
      // Ministries list: top-level only (unless tree mode)
      query = query.is("parent_group_id", null);
    }

    const groupTypeFilter = typeof req.query.group_type === "string" ? req.query.group_type.trim() : "";
    if (groupTypeFilter) {
      query = query.eq("group_type", groupTypeFilter);
    }
    if (!treeAll) {
      query = query.range(offset, offset + limit - 1);
    }

    let treeRows: { id: string; parent_group_id: string | null }[] = [];
    if (deletedOnly) {
      const { data: tr } = await supabaseAdmin
        .from("groups")
        .select("id, parent_group_id")
        .eq("organization_id", userProfile.organization_id)
        .eq("branch_id", viewerBranch);
      treeRows = (tr || []) as { id: string; parent_group_id: string | null }[];
    }

    const { data: groups, error } = await query;

    if (error) {
      throw error;
    }

    const { data: profForScope } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerScope = (profForScope as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    const gScope = await ministryScopeForActor(
      user.id,
      userProfile.organization_id as string,
      viewerBranch,
      isOrgOwnerScope,
    );
    const includeSystem =
      String(req.query.include_system || "").trim() === "1" ||
      String(req.query.include_system || "").toLowerCase() === "true";

    let list = filterGroupRowsByMinistryScope(
      (groups || []) as { id: string; is_system?: boolean | null }[],
      gScope,
      includeSystem,
    );
    const groupIds = list.map((g: { id: string }) => g.id);

    if (groupIds.length === 0) {
      res.json({ groups: list, total_count: list.length });
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
      const base = {
        ...g,
        member_count: count,
        member_preview: preview,
      };
      if (deletedOnly && g.is_deleted) {
        return {
          ...base,
          days_until_permanent_removal: daysUntilTrashPurge((g as { deleted_at?: string | null }).deleted_at),
          descendant_subgroup_count: descendantCountFromRows(treeRows, g.id),
        };
      }
      return base;
    });

    res.json({ groups: enriched, total_count: enriched.length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    const msg = String(error?.message || "Request failed");
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: msg });
    }
    const authLike =
      msg === "Invalid token" ||
      msg === "User profile not found" ||
      msg.toLowerCase().includes("jwt") ||
      msg.toLowerCase().includes("invalid token");
    if (authLike) {
      return res.status(401).json({ error: msg });
    }
    console.error("[GET /api/groups]", error);
    res.status(500).json({ error: msg });
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpCreate = await requirePermission(req, res, "add_groups");
    if (!permGrpCreate) return;

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

    const autoSlug = req.body.public_link_slug
      ? String(req.body.public_link_slug).trim()
      : name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 72) || "ministry";

    const orgIdGrp = userProfile.organization_id as string;
    const limG = await assertOrgLimit(supabaseAdmin, orgIdGrp, "groups");
    if (!limG.ok)
      return res.status(403).json({ error: limG.message, code: "ORG_LIMIT", current: limG.current, limit: limG.limit });

    const cfGrp = await validateAndMergeCustomFields(
      orgIdGrp,
      "group",
      viewerBranch,
      null,
      req.body && (req.body as { custom_fields?: unknown }).custom_fields !== undefined
        ? (req.body as { custom_fields?: unknown }).custom_fields
        : {},
      "create",
    );
    if (!cfGrp.ok) {
      return res.status(cfGrp.status).json({ error: cfGrp.error });
    }

    const newGroupData: Record<string, unknown> = {
      organization_id: orgIdGrp,
      branch_id: viewerBranch,
      name,
      description: description || null,
      group_type,
      parent_group_id: parent_group_id || null,
      leader_id: leader_id || null,
      public_website_enabled: public_website_enabled === false ? false : true,
      public_link_slug: autoSlug,
      join_link_enabled: join_link_enabled || true,
      join_invite_token: generateJoinInviteToken(),
      custom_fields: cfGrp.value,
    };

    const insertGroup = async (omitCf: boolean) => {
      const payload = { ...newGroupData };
      if (omitCf) delete payload.custom_fields;
      return supabaseAdmin.from("groups").insert([payload]).select().single();
    };

    let { data: newGroup, error } = await insertGroup(false);
    if (error && jsonbCustomFieldsColumnMissing(error)) {
      ({ data: newGroup, error } = await insertGroup(true));
    }

    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("join_invite_token")
    ) {
      delete newGroupData.join_invite_token;
      ({ data: newGroup, error } = await insertGroup(false));
      if (error && jsonbCustomFieldsColumnMissing(error)) {
        ({ data: newGroup, error } = await insertGroup(true));
      }
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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpPut = await requirePermission(req, res, "edit_groups");
    if (!permGrpPut) return;

    const { id } = req.params;
    const groupData = req.body;

    let { data: exRow, error: exScopeErr } = await supabaseAdmin
      .from("groups")
      .select("branch_id, is_system, system_kind")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (exScopeErr) {
      const msg = String(exScopeErr.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (exScopeErr as { code?: string }).code === "42703") {
        const { data: fb, error: fbErr } = await supabaseAdmin
          .from("groups")
          .select("branch_id")
          .eq("id", id)
          .eq("organization_id", userProfile.organization_id)
          .maybeSingle();
        if (fbErr) return res.status(500).json({ error: fbErr.message });
        exRow = fb;
        exScopeErr = null;
      } else {
        return res.status(500).json({ error: exScopeErr.message });
      }
    }
    if (!exRow) {
      return res.status(404).json({ error: "Group not found" });
    }
    try {
      assertEntityBranch((exRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json({ error: "Group not found" });
      }
      throw e;
    }
    if (isRestrictedSystemGroup(exRow as { is_system?: boolean | null; system_kind?: string | null })) {
      return res.status(403).json({ error: "System groups cannot be modified" });
    }

    const orgIdGr = userProfile.organization_id as string;

    const updatedGroupData: any = {
      updated_at: new Date().toISOString(),
    };

    const contactPhoneTouched =
      groupData.contact_phone !== undefined || groupData.contact_phone_country_iso !== undefined;
    if (contactPhoneTouched) {
      const { data: gPrevPhone } = await supabaseAdmin
        .from("groups")
        .select("contact_phone, contact_phone_country_iso")
        .eq("id", id)
        .eq("organization_id", orgIdGr)
        .maybeSingle();
      const defG = await getOrgDefaultPhoneCountryIso(orgIdGr);
      const raw =
        groupData.contact_phone !== undefined
          ? String(groupData.contact_phone)
          : (gPrevPhone?.contact_phone ?? "");
      const cIso =
        groupData.contact_phone_country_iso !== undefined
          ? groupData.contact_phone_country_iso
          : gPrevPhone?.contact_phone_country_iso;
      try {
        const n = normalizeSinglePhoneField(raw, cIso, defG);
        updatedGroupData.contact_phone = n.e164;
        updatedGroupData.contact_phone_country_iso = n.country_iso;
      } catch (e: unknown) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 400) {
          return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid contact phone" });
        }
        throw e;
      }
    }

    const fieldsToUpdate = [
      "name", "description", "group_type", "parent_group_id", "leader_id",
      "public_website_enabled", "join_link_enabled",
      "public_link_slug", "cover_image_url", "announcements_content",
      "program_outline_content", "contact_email",
    ];

    for (const field of fieldsToUpdate) {
      if (groupData[field] !== undefined) {
        updatedGroupData[field] = groupData[field];
      }
    }
    if (groupData.custom_fields !== undefined) {
      const { data: gPrev } = await supabaseAdmin
        .from("groups")
        .select("custom_fields, branch_id")
        .eq("id", id)
        .eq("organization_id", orgIdGr)
        .maybeSingle();
      const prevCf =
        gPrev &&
        typeof (gPrev as { custom_fields?: unknown }).custom_fields === "object" &&
        !Array.isArray((gPrev as { custom_fields?: unknown }).custom_fields)
          ? ((gPrev as { custom_fields: Record<string, unknown> }).custom_fields as Record<string, unknown>)
          : {};
      const grpBranch =
        gPrev && (gPrev as { branch_id?: string | null }).branch_id != null
          ? String((gPrev as { branch_id?: string | null }).branch_id)
          : viewerBranch;
      const cfMerge = await validateAndMergeCustomFields(
        orgIdGr,
        "group",
        grpBranch,
        prevCf,
        groupData.custom_fields,
        "merge",
      );
      if (!cfMerge.ok) {
        return res.status(cfMerge.status).json({ error: cfMerge.error });
      }
      updatedGroupData.custom_fields = cfMerge.value;
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

    const runGroupUpdate = async (omitCf: boolean) => {
      const payload = { ...updatedGroupData };
      if (omitCf) delete payload.custom_fields;
      return supabaseAdmin
        .from("groups")
        .update(payload)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .select()
        .single();
    };

    let { data: updatedGroup, error } = await runGroupUpdate(false);
    if (error && jsonbCustomFieldsColumnMissing(error)) {
      ({ data: updatedGroup, error } = await runGroupUpdate(true));
    }

    if (
      error &&
      String(error.message || "")
        .toLowerCase()
        .includes("join_invite_token")
    ) {
      delete updatedGroupData.join_invite_token;
      ({ data: updatedGroup, error } = await runGroupUpdate(false));
      if (error && jsonbCustomFieldsColumnMissing(error)) {
        ({ data: updatedGroup, error } = await runGroupUpdate(true));
      }
    }

    if (error) {
      const msg = String(error.message || "");
      const hint42703 =
        error.code === "42703" || msg.toLowerCase().includes("does not exist")
          ? "If a column like public_link_slug is missing, run migrations/groups_public_site.sql in Supabase."
          : error.hint;
      return res.status(500).json({
        error: error.message,
        details: error.details,
        hint: hint42703,
        code: error.code
      });
    }

    res.status(200).json(updatedGroup);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.delete("/api/groups/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "archive_groups");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { id } = req.params;
    if (!isUuidString(id)) {
      return res.status(400).json({ error: "Invalid group id" });
    }

    type GroupDelRow = {
      id?: string;
      branch_id?: string | null;
      organization_id?: string;
      is_deleted?: boolean;
      is_system?: boolean | null;
      system_kind?: string | null;
    };
    const selFull = await supabaseAdmin
      .from("groups")
      .select("id, branch_id, organization_id, is_deleted, is_system, system_kind")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    let existing: GroupDelRow | null = selFull.data as GroupDelRow | null;
    if (selFull.error) {
      const msg = String(selFull.error.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (selFull.error as { code?: string }).code === "42703") {
        const fb = await supabaseAdmin
          .from("groups")
          .select("id, branch_id, organization_id, is_deleted")
          .eq("id", id)
          .eq("organization_id", userProfile.organization_id)
          .maybeSingle();
        if (fb.error || !fb.data) return res.status(404).json({ error: "Group not found" });
        existing = fb.data as GroupDelRow;
      } else {
        return res.status(500).json({ error: selFull.error.message });
      }
    }
    if (!existing) {
      return res.status(404).json({ error: "Group not found" });
    }
    if ((existing as { is_deleted?: boolean }).is_deleted) {
      return res.status(400).json({ error: "Group is already in trash" });
    }
    try {
      assertEntityBranch((existing as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Group not found" });
      throw e;
    }
    if (isRestrictedSystemGroup(existing as { is_system?: boolean | null; system_kind?: string | null })) {
      return res.status(403).json({ error: "System groups cannot be deleted" });
    }

    try {
      await detachGroupFromEvents(id, userProfile.organization_id);
    } catch (detachErr: any) {
      return res.status(500).json({
        error: detachErr.message || "Failed to unlink group from events before delete",
      });
    }

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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpRestore = await requirePermission(req, res, "restore_groups");
    if (!permGrpRestore) return;

    const { id } = req.params;
    if (!isUuidString(id)) {
      return res.status(400).json({ error: "Invalid group id" });
    }

    const { data: row } = await supabaseAdmin
      .from("groups")
      .select("id, branch_id, is_deleted")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (!row) {
      return res.status(404).json({ error: "Group not found" });
    }
    if (!(row as { is_deleted?: boolean }).is_deleted) {
      return res.status(400).json({ error: "Group is not in trash" });
    }
    try {
      assertEntityBranch((row as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Group not found" });
      throw e;
    }

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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/groups/batch-restore", async (req, res) => {
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpBatchRestore = await requirePermission(req, res, "restore_groups");
    if (!permGrpBatchRestore) return;

    const ids = normalizeUuidArray((req.body || {}).ids);
    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }

    let restored = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const { data: row } = await supabaseAdmin
        .from("groups")
        .select("id, branch_id, is_deleted")
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (!row) {
        errors.push(`${id}: not found`);
        continue;
      }
      if (!(row as { is_deleted?: boolean }).is_deleted) continue;
      try {
        assertEntityBranch((row as { branch_id?: string | null }).branch_id, viewerBranch, "group");
      } catch {
        errors.push(`${id}: branch scope`);
        continue;
      }
      const { error } = await supabaseAdmin
        .from("groups")
        .update({ is_deleted: false, deleted_at: null })
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id);
      if (error) errors.push(`${id}: ${error.message}`);
      else restored += 1;
    }
    res.status(200).json({ restored, errors });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

app.post("/api/groups/batch-purge", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const permCtx = await requirePermission(req, res, "purge_groups");
    if (!permCtx) return;

    const supabase = getSupabaseClient(token);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Invalid token");

    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const ids = normalizeUuidArray((req.body || {}).ids);
    if (ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }

    let purged = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const { data: row } = await supabaseAdmin
        .from("groups")
        .select("id, branch_id, is_deleted")
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (!row) {
        errors.push(`${id}: not found`);
        continue;
      }
      if (!(row as { is_deleted?: boolean }).is_deleted) {
        errors.push(`${id}: not in trash`);
        continue;
      }
      try {
        assertEntityBranch((row as { branch_id?: string | null }).branch_id, viewerBranch, "group");
      } catch {
        errors.push(`${id}: branch scope`);
        continue;
      }
      try {
        await hardDeleteGroupSubtree(id, userProfile.organization_id);
        purged += 1;
      } catch (e: any) {
        errors.push(`${id}: ${e.message || "purge failed"}`);
      }
    }
    res.status(200).json({ purged, errors });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpGet = await requirePermission(req, res, "view_groups");
    if (!permGrpGet) return;

    const { id } = req.params;
    
    const { data: group, error } = await supabaseAdmin
      .from("groups")
      .select("*, profiles!leader_id(first_name, last_name, email, avatar_url)") // Disambiguate embed (multiple FKs groups↔profiles)
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

    try {
      assertEntityBranch((group as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Group not found" });
      throw e;
    }

    const { data: profG } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerG = (profG as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    if ((group as { system_kind?: string | null }).system_kind === "all_members" && !isOrgOwnerG) {
      return res.status(403).json({ error: "This group is not accessible as a ministry page." });
    }
    const scopeG = await ministryScopeForActor(
      user.id,
      userProfile.organization_id as string,
      viewerBranch,
      isOrgOwnerG,
    );
    if (!groupIdVisibleUnderScope(id, scopeG)) {
      return res.status(403).json({ error: "You do not have access to this ministry." });
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

    const g = group as Record<string, unknown>;
    const rawSite =
      (g.public_website_enabled as boolean | null | undefined) ??
      (g.publicWebsiteEnabled as boolean | null | undefined);
    const publicWebsiteEnabled = rawSite === false ? false : true;

    /** Profiles with Settings → Staff ministry access to this group or an ancestor (same expansion rules as visibility). */
    let ministryScopeLeaderProfiles: Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }> = [];
    try {
      const scopeGroupIds = [id, ...breadcrumb.map((b) => b.id)].filter(
        (gid, idx, arr) => arr.indexOf(gid) === idx,
      );
      if (scopeGroupIds.length > 0) {
        const { data: scopeLinks } = await supabaseAdmin
          .from("profile_ministry_scope")
          .select("profile_id")
          .in("group_id", scopeGroupIds);
        const profileIds = [
          ...new Set(
            (scopeLinks || [])
              .map((r) => String((r as { profile_id?: string }).profile_id || "").trim())
              .filter(isUuidString),
          ),
        ];
        if (profileIds.length > 0) {
          const { data: profs } = await supabaseAdmin
            .from("profiles")
            .select("id, first_name, last_name, email, avatar_url, branch_id, is_org_owner, is_active")
            .in("id", profileIds)
            .eq("organization_id", userProfile.organization_id as string);
          const gBranch = String((group as { branch_id?: string | null }).branch_id || "");
          const rows = (profs || []).filter((p) => {
            const row = p as {
              branch_id?: string | null;
              is_org_owner?: boolean | null;
              is_active?: boolean | null;
            };
            if (row.is_org_owner === true) return true;
            if (row.is_active === false) return false;
            return String(row.branch_id || "") === gBranch;
          }) as Array<{
            id: string;
            first_name: string | null;
            last_name: string | null;
            email: string | null;
            avatar_url: string | null;
          }>;
          ministryScopeLeaderProfiles = [...rows].sort((a, b) => {
            const ln = (a.last_name || "").localeCompare(b.last_name || "");
            if (ln !== 0) return ln;
            return (a.first_name || "").localeCompare(b.first_name || "");
          });
        }
      }
    } catch {
      /* profile_ministry_scope optional */
    }

    res.status(200).json({
      ...group,
      public_link_slug: (g.public_link_slug as string | null | undefined) ?? (g.publicLinkSlug as string | null) ?? null,
      public_website_enabled: publicWebsiteEnabled,
      breadcrumb,
      ministry_scope_leader_profiles: ministryScopeLeaderProfiles,
    });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(401).json({ error: error.message || "Invalid token" });
  }
});

/** Events linked to a ministry (event_groups + legacy events.group_id), scoped to viewer branch. */
app.get("/api/groups/:groupId/events", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { groupId } = req.params;
  if (!isUuidString(groupId)) return res.status(400).json({ error: "Invalid group id" });

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

    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrpEv = await requirePermission(req, res, "view_events");
    if (!permGrpEv) return;

    const { data: grp, error: gErr } = await supabaseAdmin
      .from("groups")
      .select("id, branch_id")
      .eq("id", groupId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!grp) return res.status(404).json({ error: "Group not found" });
    try {
      assertEntityBranch((grp as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Group not found" });
      throw e;
    }

    const eventIds = await fetchEventIdsLinkedToGroup(groupId, orgId, viewerBranch);
    if (eventIds.length === 0) {
      return res.json({ events: [] });
    }

    const idList = eventIds.slice(0, 200);
    let query = supabaseAdmin
      .from("events")
      .select(EVENTS_SELECT)
      .in("id", idList)
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .order("start_time", { ascending: false });

    let { data: evRows, error: evErr } = await query;

    if (evErr) {
      const msg = String(evErr.message || "").toLowerCase();
      const code = (evErr as { code?: string }).code;
      if (
        msg.includes("cover_image_url") ||
        msg.includes("program_outline") ||
        msg.includes("attachments") ||
        msg.includes("custom_fields") ||
        code === "42703"
      ) {
        const retry = await supabaseAdmin
          .from("events")
          .select("id, title, start_time, end_time, event_type, group_id, groups!group_id(name)")
          .in("id", idList)
          .eq("organization_id", orgId)
          .eq("branch_id", viewerBranch)
          .order("start_time", { ascending: false });
        if (retry.error) throw retry.error;
        evRows = retry.data;
      } else {
        throw evErr;
      }
    }

    const events = (evRows || []) as Record<string, unknown>[];
    const payload = events.map((ev) => {
      const id = String(ev.id || "");
      const g = ev.groups as { name?: string | null } | null | undefined;
      const groupName =
        g && typeof g === "object" && !Array.isArray(g) && typeof g.name === "string"
          ? g.name.trim() || null
          : null;
      return {
        id,
        title: (ev.title as string) || "",
        start_time: ev.start_time as string,
        end_time: (ev.end_time as string | null) ?? null,
        event_type: (ev.event_type as string | null) ?? null,
        status: (ev.status as string | null) ?? null,
        group_name: groupName,
      };
    });

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const paged = payload.slice(offset, offset + limit);
    res.json({ events: paged });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load group events" });
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGmGet = await requireAnyPermission(req, res, ["view_members", "view_groups"]);
    if (!permGmGet) return;

    const { group_id } = req.query;

    if (!group_id) {
      return res.status(400).json({ error: "Missing required query parameter: group_id" });
    }

    const { data: gRow } = await supabaseAdmin
      .from("groups")
      .select("branch_id, organization_id")
      .eq("id", group_id as string)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (!gRow) {
      return res.status(404).json({ error: "Group not found" });
    }
    try {
      assertEntityBranch((gRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return res.status(404).json({ error: "Group not found" });
      throw e;
    }

    const { data: groupMembers, error } = await supabaseAdmin
      .from("group_members")
      .select("*, members(id, first_name, last_name, email, memberimage_url, is_deleted)")
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

    const rows = (groupMembers || []).filter((row) => {
      const mr = row.members as { id?: string; is_deleted?: boolean } | { id?: string; is_deleted?: boolean }[] | null;
      const m = Array.isArray(mr) ? mr[0] : mr;
      if (m && (m as { is_deleted?: boolean }).is_deleted === true) return false;
      return true;
    });
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

    const list = [...byMember.values()].sort((a, b) => {
      const ta = new Date(String((a as { created_at?: string | null }).created_at || 0)).getTime();
      const tb = new Date(String((b as { created_at?: string | null }).created_at || 0)).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
    res.status(200).json(list);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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

    const permGmPost = await requirePermission(req, res, "assign_groups");
    if (!permGmPost) return;

    const { group_id, member_id, role_in_group } = req.body;

    if (!group_id || !member_id || !role_in_group) {
      return res.status(400).json({ error: "Missing required fields: group_id, member_id, role_in_group" });
    }

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: memberRow, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, branch_id")
      .eq("id", member_id)
      .eq("organization_id", userProfile.organization_id)
      .single();

    if (memberError || !memberRow) {
      return res.status(404).json({ error: "Member not found or unauthorized" });
    }
    try {
      assertEntityBranch((memberRow as { branch_id?: string | null }).branch_id, viewerBranch, "member");
    } catch (e: any) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json({ error: "Member not found or unauthorized" });
      }
      throw e;
    }

    let { data: groupRow, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, branch_id, is_system, system_kind")
      .eq("id", group_id)
      .eq("organization_id", userProfile.organization_id)
      .single();

    if (groupError) {
      const msg = String(groupError.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (groupError as { code?: string }).code === "42703") {
        const { data: g2, error: g2e } = await supabaseAdmin
          .from("groups")
          .select("id, branch_id")
          .eq("id", group_id)
          .eq("organization_id", userProfile.organization_id)
          .single();
        if (g2e || !g2) {
          return res.status(404).json({ error: "Group not found or unauthorized" });
        }
        groupRow = g2;
        groupError = null;
      } else {
        return res.status(404).json({ error: "Group not found or unauthorized" });
      }
    }
    if (!groupRow) {
      return res.status(404).json({ error: "Group not found or unauthorized" });
    }
    try {
      assertEntityBranch((groupRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json({ error: "Group not found or unauthorized" });
      }
      throw e;
    }
    if (isRestrictedSystemGroup(groupRow as { is_system?: boolean | null; system_kind?: string | null })) {
      return res.status(403).json({ error: "Cannot modify membership for system groups" });
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
          branch_id: viewerBranch,
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

    const { data: mInfo, error: mInfoErr } = await supabaseAdmin
      .from("members")
      .select("first_name, last_name, email, memberimage_url")
      .eq("id", member_id)
      .maybeSingle();
    if (mInfoErr) throw mInfoErr;
    const memberFirst = String((mInfo as { first_name?: string } | null)?.first_name || "").trim();
    const memberLast = String((mInfo as { last_name?: string } | null)?.last_name || "").trim();
    const memberLabel = `${memberFirst} ${memberLast}`.trim() || "A member";
    const groupLabel = await fetchGroupDisplayName(String(group_id), String(userProfile.organization_id));
    const memberEmail = String((mInfo as { email?: string | null } | null)?.email || "")
      .trim()
      .toLowerCase();
    let memberStaffProfileId: string | null = null;
    if (memberEmail) {
      const { data: profMatch } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("organization_id", userProfile.organization_id)
        .ilike("email", memberEmail)
        .maybeSingle();
      const pid = (profMatch as { id?: string } | null)?.id;
      if (pid && isUuidString(pid)) memberStaffProfileId = pid;
    }
    const img = mInfo ? memberImageFromMemberRecord(mInfo as Record<string, unknown>) : "";
    const basePayload = {
      member_id: String(member_id),
      group_id: String(group_id),
      group_display_name: groupLabel,
      member_display_name: memberLabel,
      ...(img ? { member_image_url: img } : {}),
    };
    const memberProfilePath = `/members/${String(member_id)}`;
    if (memberStaffProfileId) {
      await createNotificationsForRecipients([memberStaffProfileId], {
        organization_id: String(userProfile.organization_id),
        branch_id: viewerBranch,
        type: "member_assigned_group",
        category: "assignments",
        title: "Added to a group",
        message: `You were added to "${groupLabel}".`,
        severity: "medium",
        entity_type: "member",
        entity_id: String(member_id),
        action_path: memberProfilePath,
        payload: basePayload,
      });
    }
    const staffWhoSee = await profileIdsStaffWhoSeeMinistryGroup(
      String(userProfile.organization_id),
      viewerBranch,
      String(group_id),
    );
    const staffAlertRecipients = new Set(staffWhoSee);
    if (memberStaffProfileId !== user.id) {
      staffAlertRecipients.add(user.id);
    }
    if (memberStaffProfileId) {
      staffAlertRecipients.delete(memberStaffProfileId);
    }
    if (staffAlertRecipients.size > 0) {
      await createNotificationsForRecipients([...staffAlertRecipients], {
        organization_id: String(userProfile.organization_id),
        branch_id: viewerBranch,
        type: "member_assigned_group",
        category: "assignments",
        title: "Member assigned to group",
        message: `${memberLabel} was added to "${groupLabel}".`,
        severity: "medium",
        entity_type: "member",
        entity_id: String(member_id),
        action_path: memberProfilePath,
        payload: { ...basePayload, openMemberId: String(member_id), highlight_member_ids: [String(member_id)] },
      });
    }
    res.status(201).json(newGroupMember);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    const msg = String(error?.message || "Invalid token");
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: msg });
    }
    if (msg === "Invalid token" || msg === "User profile not found") {
      return res.status(401).json({ error: msg });
    }
    console.error("[POST /api/group-members]", error);
    res.status(500).json({ error: msg });
  }
});

/** Batch add directory members to a ministry group; one actor notification + optional assignee notifications. */
app.post("/api/group-members/bulk", async (req, res) => {
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGmBulk = await requirePermission(req, res, "assign_groups");
    if (!permGmBulk) return;

    const orgId = String(userProfile.organization_id);
    const body = req.body || {};
    const group_id = typeof body.group_id === "string" ? body.group_id.trim() : "";
    const role_in_group =
      typeof body.role_in_group === "string" && body.role_in_group.trim()
        ? String(body.role_in_group).trim()
        : "member";
    const rawIds = Array.isArray(body.member_ids) ? body.member_ids : [];
    const member_ids: string[] = [];
    const seen = new Set<string>();
    for (const x of rawIds) {
      if (typeof x !== "string" || !isUuidString(x.trim())) continue;
      const id = x.trim();
      if (seen.has(id)) continue;
      seen.add(id);
      member_ids.push(id);
      if (member_ids.length >= 200) break;
    }
    if (!isUuidString(group_id) || member_ids.length === 0) {
      return res.status(400).json({ error: "group_id and a non-empty member_ids array (UUIDs, max 200) are required" });
    }

    let { data: groupRow, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, branch_id, is_system, system_kind")
      .eq("id", group_id)
      .eq("organization_id", orgId)
      .single();

    if (groupError) {
      const msg = String(groupError.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (groupError as { code?: string }).code === "42703") {
        const { data: g2, error: g2e } = await supabaseAdmin
          .from("groups")
          .select("id, branch_id")
          .eq("id", group_id)
          .eq("organization_id", orgId)
          .single();
        if (g2e || !g2) {
          return res.status(404).json({ error: "Group not found or unauthorized" });
        }
        groupRow = g2;
        groupError = null;
      } else {
        return res.status(404).json({ error: "Group not found or unauthorized" });
      }
    }
    if (!groupRow) {
      return res.status(404).json({ error: "Group not found or unauthorized" });
    }
    try {
      assertEntityBranch((groupRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    } catch (e: any) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json({ error: "Group not found or unauthorized" });
      }
      throw e;
    }
    if (isRestrictedSystemGroup(groupRow as { is_system?: boolean | null; system_kind?: string | null })) {
      return res.status(403).json({ error: "Cannot modify membership for system groups" });
    }

    const { data: memberRows, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, branch_id, first_name, last_name, email, memberimage_url")
      .eq("organization_id", orgId)
      .in("id", member_ids);
    if (memErr) throw memErr;

    const found = new Map<string, Record<string, unknown>>();
    for (const r of memberRows || []) {
      const id = String((r as { id?: string }).id || "");
      if (id) found.set(id, r as Record<string, unknown>);
    }

    type Skip = { member_id: string; reason: string };
    const skipped: Skip[] = [];
    const eligible: Record<string, unknown>[] = [];
    for (const mid of member_ids) {
      const row = found.get(mid);
      if (!row) {
        skipped.push({ member_id: mid, reason: "member_not_found" });
        continue;
      }
      try {
        assertEntityBranch((row as { branch_id?: string | null }).branch_id, viewerBranch, "member");
        eligible.push(row);
      } catch {
        skipped.push({ member_id: mid, reason: "member_branch_scope" });
      }
    }

    const eligibleIds = eligible.map((r) => String((r as { id: string }).id));
    if (eligibleIds.length === 0) {
      return res.status(200).json({ added: [], skipped, inserted_count: 0 });
    }

    const { data: existingGm } = await supabaseAdmin
      .from("group_members")
      .select("member_id")
      .eq("group_id", group_id)
      .eq("organization_id", orgId)
      .in("member_id", eligibleIds);

    const already = new Set(
      (existingGm || []).map((x) => String((x as { member_id?: string }).member_id || "")).filter(Boolean),
    );
    const toInsertIds = eligibleIds.filter((id) => !already.has(id));
    for (const id of eligibleIds) {
      if (already.has(id)) skipped.push({ member_id: id, reason: "already_in_group" });
    }

    if (toInsertIds.length === 0) {
      return res.status(200).json({ added: [], skipped, inserted_count: 0 });
    }

    const rowsToInsert = toInsertIds.map((member_id) => ({
      group_id,
      member_id,
      role_in_group,
      organization_id: orgId,
      branch_id: viewerBranch,
    }));

    const { data: insertedRows, error: insErr } = await supabaseAdmin
      .from("group_members")
      .insert(rowsToInsert)
      .select();

    if (insErr) {
      if (insErr.code === "23505") {
        return res.status(409).json({ error: "One or more members are already in this group.", code: "ALREADY_GROUP_MEMBER" });
      }
      return res.status(500).json({
        error: insErr.message,
        details: insErr.details,
        hint: insErr.hint,
        code: insErr.code,
      });
    }

    const inserted = (insertedRows || []) as Array<{ member_id?: string }>;
    const addedMemberIds = inserted.map((r) => String(r.member_id || "")).filter((x) => isUuidString(x));
    const groupLabel = await fetchGroupDisplayName(String(group_id), orgId);
    const highlightParam = addedMemberIds.join(",");

    const resolveProfile = async (emailRaw: string): Promise<string | null> => {
      const memberEmail = String(emailRaw || "")
        .trim()
        .toLowerCase();
      if (!memberEmail) return null;
      const { data: profMatch } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("email", memberEmail)
        .maybeSingle();
      const pid = (profMatch as { id?: string } | null)?.id;
      return pid && isUuidString(pid) ? pid : null;
    };

    for (const mid of addedMemberIds) {
      const row = found.get(mid);
      if (!row) continue;
      const memberFirst = String((row as { first_name?: string }).first_name || "").trim();
      const memberLast = String((row as { last_name?: string }).last_name || "").trim();
      const memberLabel = `${memberFirst} ${memberLast}`.trim() || "A member";
      const memberEmail = String((row as { email?: string | null }).email || "");
      const pid = await resolveProfile(memberEmail);
      const img = memberImageFromMemberRecord(row);
      const basePayload = {
        member_id: mid,
        group_id: String(group_id),
        group_display_name: groupLabel,
        member_display_name: memberLabel,
        ...(img ? { member_image_url: img } : {}),
      };
      const memberProfileAction = `/members/${mid}`;
      if (pid) {
        await createNotificationsForRecipients([pid], {
          organization_id: orgId,
          branch_id: viewerBranch,
          type: "member_assigned_group",
          category: "assignments",
          title: "Added to a group",
          message: `You were added to "${groupLabel}".`,
          severity: "medium",
          entity_type: "member",
          entity_id: mid,
          action_path: memberProfileAction,
          payload: basePayload,
        });
      }
    }

    let skipActor = false;
    if (addedMemberIds.length === 1) {
      const onlyRow = found.get(addedMemberIds[0]);
      const em = onlyRow ? String((onlyRow as { email?: string | null }).email || "").trim().toLowerCase() : "";
      if (em) {
        const { data: profMatch } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("organization_id", orgId)
          .ilike("email", em)
          .maybeSingle();
        const opid = (profMatch as { id?: string } | null)?.id;
        if (opid && isUuidString(opid) && opid === user.id) skipActor = true;
      }
    }

    if (addedMemberIds.length > 0) {
      const names: string[] = [];
      for (const mid of addedMemberIds) {
        const row = found.get(mid);
        if (!row) continue;
        const a = String((row as { first_name?: string }).first_name || "").trim();
        const b = String((row as { last_name?: string }).last_name || "").trim();
        names.push(`${a} ${b}`.trim() || "A member");
      }
      const n = addedMemberIds.length;
      const title = n === 1 ? "Member assigned to group" : "Members assigned to group";
      const message =
        n === 1
          ? `${names[0] || "A member"} was added to "${groupLabel}".`
          : `${n} members were added to "${groupLabel}".`;
      const bulkPath =
        n === 1 && addedMemberIds[0]
          ? `/members/${addedMemberIds[0]}`
          : `/groups/${String(group_id)}?tab=members&highlight=${encodeURIComponent(highlightParam)}`;
      const actorPayload: Record<string, unknown> = {
        group_id: String(group_id),
        group_display_name: groupLabel,
        added_member_ids: addedMemberIds,
        member_display_names: names,
        highlight_member_ids: addedMemberIds,
      };
      if (n === 1 && addedMemberIds[0]) {
        const fr = found.get(addedMemberIds[0]);
        actorPayload.member_id = addedMemberIds[0];
        actorPayload.member_display_name = names[0] || "A member";
        if (fr) {
          const pu = memberImageFromMemberRecord(fr as Record<string, unknown>);
          if (pu) actorPayload.member_image_url = pu;
        }
      }

      const staffWhoSee = await profileIdsStaffWhoSeeMinistryGroup(orgId, viewerBranch, String(group_id));
      const staffAlertRecipients = new Set(staffWhoSee);
      if (!skipActor) {
        staffAlertRecipients.add(user.id);
      }
      for (const mid of addedMemberIds) {
        const row = found.get(mid);
        if (!row) continue;
        const em = String((row as { email?: string | null }).email || "").trim().toLowerCase();
        if (!em) continue;
        const { data: profMatch } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("organization_id", orgId)
          .ilike("email", em)
          .maybeSingle();
        const apid = (profMatch as { id?: string } | null)?.id;
        if (apid && isUuidString(apid)) staffAlertRecipients.delete(apid);
      }
      if (skipActor) {
        staffAlertRecipients.delete(user.id);
      }

      if (staffAlertRecipients.size > 0) {
        await createNotificationsForRecipients([...staffAlertRecipients], {
          organization_id: orgId,
          branch_id: viewerBranch,
          type: "member_assigned_group",
          category: "assignments",
          title,
          message,
          severity: "medium",
          entity_type: n === 1 ? "member" : "group",
          entity_id: n === 1 && addedMemberIds[0] ? addedMemberIds[0] : String(group_id),
          action_path: bulkPath,
          payload: actorPayload,
          dedupe_key: `bulk_group_assign:${String(group_id)}:${user.id}`,
          dedupe_window_minutes: 2,
        });
      }
    }

    res.status(201).json({ added: addedMemberIds, skipped, inserted_count: addedMemberIds.length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    const msg = String(error?.message || "Invalid token");
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: msg });
    }
    if (msg === "Invalid token" || msg === "User profile not found") {
      return res.status(401).json({ error: msg });
    }
    console.error("[POST /api/group-members/bulk]", error);
    res.status(500).json({ error: msg });
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

    const permGmDel = await requirePermission(req, res, "assign_groups");
    if (!permGmDel) return;

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
    let { data: groupRow, error: groupErr } = await supabaseAdmin
      .from("groups")
      .select("id, is_system, system_kind")
      .eq("id", group_id as string)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (groupErr) {
      const msg = String(groupErr.message || "").toLowerCase();
      if (msg.includes("is_system") || msg.includes("system_kind") || (groupErr as { code?: string }).code === "42703") {
        const { data: g2, error: g2e } = await supabaseAdmin
          .from("groups")
          .select("id")
          .eq("id", group_id as string)
          .eq("organization_id", userProfile.organization_id)
          .maybeSingle();
        if (g2e) return res.status(500).json({ error: g2e.message });
        groupRow = g2;
        groupErr = null;
      } else {
        return res.status(500).json({ error: groupErr.message });
      }
    }
    if (!groupRow) {
      return res.status(404).json({ error: "Group not found or unauthorized" });
    }
    if (isRestrictedSystemGroup(groupRow as { is_system?: boolean | null; system_kind?: string | null })) {
      return res.status(403).json({ error: "Cannot modify membership for system groups" });
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permGrList = await requirePermission(req, res, "view_group_requests");
    if (!permGrList) return;

    const { status, group_id } = req.query;
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));

    const ministryScopeOnly =
      String(req.query.ministry_scope_only ?? "").trim() === "1" ||
      String(req.query.ministry_scope_only ?? "").toLowerCase() === "true";

    /** When set, restrict to these group ids (ministry assignments); empty array means no visible groups. */
    let ministryScopeGroupFilter: string[] | null = null;
    if (ministryScopeOnly) {
      const { data: profForScope } = await supabaseAdmin
        .from("profiles")
        .select("is_org_owner")
        .eq("id", user.id)
        .maybeSingle();
      const isOrgOwnerScope = (profForScope as { is_org_owner?: boolean } | null)?.is_org_owner === true;
      const gScope = await ministryScopeForActor(
        user.id,
        userProfile.organization_id as string,
        viewerBranch,
        isOrgOwnerScope,
      );
      if (gScope.kind === "groups") {
        ministryScopeGroupFilter = [...gScope.allowedGroupIds];
      }
    }

    const rawGid =
      typeof group_id === "string"
        ? group_id.trim()
        : Array.isArray(group_id) && typeof group_id[0] === "string"
          ? group_id[0].trim()
          : "";
    if (rawGid && isUuidString(rawGid)) {
      const { data: gRow, error: gErr } = await supabaseAdmin
        .from("groups")
        .select("id, branch_id")
        .eq("id", rawGid)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      if (gErr) throw gErr;
      if (!gRow) {
        return res.status(404).json({ error: "Group not found" });
      }
      assertEntityBranch((gRow as { branch_id?: string | null }).branch_id, viewerBranch, "group");
    }

    let query = supabaseAdmin
      .from("group_requests")
      .select("*, groups(name)", { count: "exact" })
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch);

    if (ministryScopeGroupFilter !== null) {
      if (ministryScopeGroupFilter.length === 0) {
        return res.json({ requests: [], total_count: 0 });
      }
      query = query.in("group_id", ministryScopeGroupFilter);
    }

    if (status) {
      query = query.eq("status", status);
    }
    if (rawGid && isUuidString(rawGid)) {
      query = query.eq("group_id", rawGid);
    }
    query = query.range(offset, offset + limit - 1);

    const { data: requests, error, count } = await query;

    if (error) throw error;
    res.json({ requests: requests || [], total_count: count ?? (requests || []).length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch group requests" });
  }
});

app.post("/api/group-requests/:id/approve", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permGrApprove = await requirePermission(req, res, "approve_group_requests");
    if (!permGrApprove) return;

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

    const viewerBranch = await assertViewerBranchScope(req, userProfileResponse.data as OrgProfile, user.id);

    if (request.organization_id !== userProfileResponse.data.organization_id) {
      return res.status(403).json({ error: "Unauthorized to approve this request" });
    }
    assertEntityBranch((request as { branch_id?: string | null }).branch_id, viewerBranch, "group_request");

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
        const reviewers = await profileIdsWithAnyPermission(
          String(request.organization_id),
          String(request.branch_id || viewerBranch),
          ["approve_group_requests", "reject_group_requests"],
        );
        const approvalRecipients = recipientIdsExcludingActor(reviewers, user.id);
        const gid = String(request.group_id || "");
        const groupLabel = gid && isUuidString(gid) ? await fetchGroupDisplayName(gid, String(request.organization_id)) : "a ministry";
        const who =
          `${String((memberRow as { first_name?: string } | null)?.first_name || "").trim()} ${String((memberRow as { last_name?: string } | null)?.last_name || "").trim()}`.trim() ||
          "A member";
        const grpImg = memberRow ? memberImageFromMemberRecord(memberRow as Record<string, unknown>) : "";
        if (approvalRecipients.length > 0) {
          const memberProfilePath =
            linkedMemberId && isUuidString(linkedMemberId)
              ? `/members/${linkedMemberId}`
              : gid && isUuidString(gid)
                ? `/groups/${gid}`
                : "/groups";
          await createNotificationsForRecipients(approvalRecipients, {
            organization_id: String(request.organization_id),
            branch_id: String(request.branch_id || viewerBranch),
            type: "group_request_approved",
            category: "requests",
            title: "Group request approved",
            message: `${who} was approved to join "${groupLabel}".`,
            severity: "medium",
            entity_type: "group_request",
            entity_id: String(id),
            action_path: memberProfilePath,
            payload: {
              request_id: id,
              group_id: gid,
              member_id: linkedMemberId,
              openMemberId: linkedMemberId,
              group_display_name: groupLabel,
              member_display_name: who,
              ...(grpImg ? { member_image_url: grpImg } : {}),
            },
            dedupe_key: `group_request_approved:${String(id)}`,
            dedupe_window_minutes: 120,
          });
        }
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
      const reviewers = await profileIdsWithAnyPermission(
        String(request.organization_id),
        String(request.branch_id || viewerBranch),
        ["approve_group_requests", "reject_group_requests"],
      );
      const approvalRecipientsGuest = recipientIdsExcludingActor(reviewers, user.id);
      const gid2 = String(request.group_id || "");
      const groupLabel2 =
        gid2 && isUuidString(gid2) ? await fetchGroupDisplayName(gid2, String(request.organization_id)) : "a ministry";
      const who2 =
        `${String((newMember as { first_name?: string }).first_name || "").trim()} ${String((newMember as { last_name?: string }).last_name || "").trim()}`.trim() ||
        "A new member";
      const nmId = String((newMember as { id?: string }).id || "");
      const grpImg2 = newMember ? memberImageFromMemberRecord(newMember as Record<string, unknown>) : "";
      if (approvalRecipientsGuest.length > 0) {
        const memberProfilePathGuest =
          nmId && isUuidString(nmId)
            ? `/members/${nmId}`
            : gid2 && isUuidString(gid2)
              ? `/groups/${gid2}`
              : "/groups";
        await createNotificationsForRecipients(approvalRecipientsGuest, {
          organization_id: String(request.organization_id),
          branch_id: String(request.branch_id || viewerBranch),
          type: "group_request_approved",
          category: "requests",
          title: "Group request approved",
          message: `${who2} was approved to join "${groupLabel2}".`,
          severity: "medium",
          entity_type: "group_request",
          entity_id: String(id),
          action_path: memberProfilePathGuest,
          payload: {
            request_id: id,
            group_id: gid2,
            member_id: nmId,
            openMemberId: nmId,
            group_display_name: groupLabel2,
            member_display_name: who2,
            ...(grpImg2 ? { member_image_url: grpImg2 } : {}),
          },
          dedupe_key: `group_request_approved:${String(id)}`,
          dedupe_window_minutes: 120,
        });
      }
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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
    const permGrReject = await requirePermission(req, res, "reject_group_requests");
    if (!permGrReject) return;

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

    const viewerBranch = await assertViewerBranchScope(req, userProfileResponse.data as OrgProfile, user.id);

    if (request.organization_id !== userProfileResponse.data.organization_id) {
      return res.status(403).json({ error: "Unauthorized to reject this request" });
    }
    assertEntityBranch((request as { branch_id?: string | null }).branch_id, viewerBranch, "group_request");

    const result = await finalizeGroupRequestStatus(id, user.id, "rejected");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(200).json({ message: "Group join request rejected", request: result.request });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to reject member request" });
  }
});

app.post("/api/group-requests/:id/ignore", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const permGrIgnore = await requirePermission(req, res, "reject_group_requests");
    if (!permGrIgnore) return;

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

    const viewerBranch = await assertViewerBranchScope(req, userProfileResponse.data as OrgProfile, user.id);

    if (request.organization_id !== userProfileResponse.data.organization_id) {
      return res.status(403).json({ error: "Unauthorized to ignore this request" });
    }
    assertEntityBranch((request as { branch_id?: string | null }).branch_id, viewerBranch, "group_request");

    const result = await finalizeGroupRequestStatus(id, user.id, "ignored");
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.status(200).json({ message: "Join request ignored", request: result.request });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to ignore join request" });
  }
});

// Events (org calendar — matches public.events + optional groups FK)
/** `groups!group_id` — required so PostgREST does not confuse this with `event_groups` → `groups`. */
const EVENTS_SELECT =
  "id, organization_id, branch_id, group_id, title, start_time, end_time, event_type, location_type, location_details, online_meeting_url, notes, cover_image_url, program_outline, attachments, custom_fields, created_at, updated_at, groups!group_id(name)";

async function fetchAssignedMemberIdsForEvent(eventId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("event_assigned_members")
    .select("member_id")
    .eq("event_id", eventId);
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("event_assigned_members") || error.code === "42P01") {
      return [];
    }
    throw error;
  }
  return [
    ...new Set(
      (data || [])
        .map((r: { member_id?: string }) => r.member_id)
        .filter((id): id is string => typeof id === "string" && isUuidString(id)),
    ),
  ];
}

async function fetchEventGroupIdsForEvent(
  eventId: string,
  legacyGroupId: string | null | undefined,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("event_groups")
    .select("group_id")
    .eq("event_id", eventId);

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("event_groups") || error.code === "42P01") {
      if (legacyGroupId && isUuidString(String(legacyGroupId))) return [String(legacyGroupId)];
      return [];
    }
    throw error;
  }

  if (data?.length) {
    const ids = [
      ...new Set(
        (data || [])
          .map((r: { group_id?: string }) => r.group_id)
          .filter((id): id is string => typeof id === "string" && isUuidString(id)),
      ),
    ];
    return ids;
  }

  if (legacyGroupId && isUuidString(String(legacyGroupId))) {
    return [String(legacyGroupId)];
  }
  return [];
}

async function fetchRosterMemberIdsFromGroupIds(
  groupIds: string[],
  organizationId: string,
  eventStartTime: string | null | undefined,
): Promise<string[]> {
  const scopedGroupIds = [...new Set(groupIds.filter((id) => isUuidString(id)))];
  if (scopedGroupIds.length === 0) return [];

  const eventStartMs = new Date(String(eventStartTime || "")).getTime();

  const filterByJoinMoment = (
    rows: Array<{ member_id?: string | null; created_at?: string | null }>,
  ): string[] => {
    const out = new Set<string>();
    for (const row of rows) {
      const memberId = typeof row.member_id === "string" ? row.member_id : "";
      if (!isUuidString(memberId)) continue;
      if (Number.isFinite(eventStartMs)) {
        const joinedMs = new Date(String(row.created_at || "")).getTime();
        if (Number.isFinite(joinedMs) && joinedMs > eventStartMs) {
          continue;
        }
      }
      out.add(memberId);
    }
    return [...out];
  };

  const fallbackWithoutCreatedAt = async (): Promise<string[]> => {
    const { data: rows, error: fallbackErr } = await supabaseAdmin
      .from("group_members")
      .select("member_id")
      .in("group_id", scopedGroupIds)
      .eq("organization_id", organizationId);
    if (fallbackErr) throw fallbackErr;
    return filterByJoinMoment((rows || []) as Array<{ member_id?: string | null }>);
  };

  try {
    const { data: rows, error } = await supabaseAdmin
      .from("group_members")
      .select("member_id, created_at")
      .in("group_id", scopedGroupIds)
      .eq("organization_id", organizationId);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("created_at") || error.code === "42703") {
        return await fallbackWithoutCreatedAt();
      }
      throw error;
    }
    return filterByJoinMoment(
      (rows || []) as Array<{ member_id?: string | null; created_at?: string | null }>,
    );
  } catch (e) {
    const msg = String((e as { message?: string })?.message || "").toLowerCase();
    if (msg.includes("created_at")) {
      return await fallbackWithoutCreatedAt();
    }
    throw e;
  }
}

async function assertEventVisibleUnderMinistryScope(
  orgId: string,
  viewerBranch: string,
  userId: string,
  isOrgOwner: boolean,
  eventId: string,
  legacyGroupId: string | null | undefined,
): Promise<boolean> {
  const scope = await ministryScopeForActor(userId, orgId, viewerBranch, isOrgOwner);
  if (scope.kind === "bypass" || scope.kind === "branch_all") return true;
  const gids = await fetchEventGroupIdsForEvent(eventId, legacyGroupId);
  const assigned = await fetchAssignedMemberIdsForEvent(eventId);
  const visible = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, scope);
  return eventAudienceVisibleUnderScope(scope, gids, assigned, visible);
}

async function filterEventsRowsByMinistryScope(
  rows: Record<string, unknown>[],
  orgId: string,
  viewerBranch: string,
  userId: string,
  isOrgOwner: boolean,
): Promise<Record<string, unknown>[]> {
  const scope = await ministryScopeForActor(userId, orgId, viewerBranch, isOrgOwner);
  if (scope.kind === "bypass" || scope.kind === "branch_all") return rows;
  const visible = await memberIdsVisibleUnderScope(supabaseAdmin, orgId, viewerBranch, scope);
  const eventIds = rows.map((r) => String(r.id)).filter((id) => isUuidString(id));
  const egByEvent = new Map<string, string[]>();
  if (eventIds.length > 0) {
    try {
      const { data: eg } = await supabaseAdmin
        .from("event_groups")
        .select("event_id, group_id")
        .in("event_id", eventIds);
      for (const r of eg || []) {
        const eid = (r as { event_id?: string }).event_id;
        const gid = (r as { group_id?: string }).group_id;
        if (!eid || !gid || !isUuidString(gid)) continue;
        if (!egByEvent.has(eid)) egByEvent.set(eid, []);
        const arr = egByEvent.get(eid)!;
        if (!arr.includes(gid)) arr.push(gid);
      }
    } catch {
      /* event_groups missing */
    }
  }
  const amByEvent = new Map<string, string[]>();
  if (eventIds.length > 0) {
    try {
      const { data: am } = await supabaseAdmin
        .from("event_assigned_members")
        .select("event_id, member_id")
        .in("event_id", eventIds);
      for (const r of am || []) {
        const eid = (r as { event_id?: string }).event_id;
        const mid = (r as { member_id?: string }).member_id;
        if (!eid || !mid) continue;
        if (!amByEvent.has(eid)) amByEvent.set(eid, []);
        amByEvent.get(eid)!.push(mid);
      }
    } catch {
      /* */
    }
  }
  return rows.filter((row) => {
    const id = String(row.id);
    const legacy = (row.group_id as string | null | undefined) ?? null;
    let gids = egByEvent.get(id) || [];
    if (gids.length === 0 && legacy && isUuidString(String(legacy))) {
      gids = [String(legacy)];
    }
    const assigns = amByEvent.get(id) || [];
    return eventAudienceVisibleUnderScope(scope, gids, assigns, visible);
  });
}

function isRestrictedSystemGroup(
  g: { is_system?: boolean | null; system_kind?: string | null },
  opts?: { allowAllMembers?: boolean },
): boolean {
  const allowAllMembers = opts?.allowAllMembers === true;
  if (!allowAllMembers && g.system_kind === "all_members") return true;
  if (g.is_system === true && (!allowAllMembers || g.system_kind !== "all_members")) return true;
  return false;
}

function isLockedAllMembersGroup(g: { system_kind?: string | null }): boolean {
  return g.system_kind === "all_members";
}

/** Events whose roster includes this member (via linked ministries + legacy group_id + explicit assigns). */
async function fetchEventIdsForMember(
  memberId: string,
  organizationId: string,
  viewerBranch: string,
): Promise<string[]> {
  const idSet = new Set<string>();

  let gmRows: Array<{ group_id?: string; created_at?: string | null }> = [];
  try {
    const { data, error } = await supabaseAdmin
      .from("group_members")
      .select("group_id, created_at")
      .eq("member_id", memberId)
      .eq("organization_id", organizationId);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("created_at") || error.code === "42703") {
        const fallback = await supabaseAdmin
          .from("group_members")
          .select("group_id")
          .eq("member_id", memberId)
          .eq("organization_id", organizationId);
        if (fallback.error) throw fallback.error;
        gmRows = (fallback.data || []) as Array<{ group_id?: string }>;
      } else {
        throw error;
      }
    } else {
      gmRows = (data || []) as Array<{ group_id?: string; created_at?: string | null }>;
    }
  } catch {
    gmRows = [];
  }

  const groupJoinedMsById = new Map<string, number>();
  for (const row of gmRows) {
    const gid = typeof row.group_id === "string" ? row.group_id : "";
    if (!isUuidString(gid)) continue;
    const joinedMs = new Date(String(row.created_at || "")).getTime();
    const existing = groupJoinedMsById.get(gid);
    if (!Number.isFinite(joinedMs)) {
      if (existing === undefined) groupJoinedMsById.set(gid, Number.NaN);
      continue;
    }
    if (!Number.isFinite(existing ?? Number.NaN) || joinedMs < Number(existing)) {
      groupJoinedMsById.set(gid, joinedMs);
    }
  }

  const groupIds = [
    ...new Set(
      (gmRows || [])
        .map((r: { group_id?: string }) => r.group_id)
        .filter((id): id is string => typeof id === "string" && isUuidString(id)),
    ),
  ];

  if (groupIds.length > 0) {
    try {
      const { data: eg } = await supabaseAdmin
        .from("event_groups")
        .select("event_id, group_id")
        .in("group_id", groupIds);

      const eventIdsFromGroups = [
        ...new Set(
          (eg || [])
            .map((r: { event_id?: string }) => r.event_id)
            .filter((id): id is string => typeof id === "string" && isUuidString(id)),
        ),
      ];

      const eventStartMsById = new Map<string, number>();
      if (eventIdsFromGroups.length > 0) {
        const { data: evRows } = await supabaseAdmin
          .from("events")
          .select("id, start_time")
          .in("id", eventIdsFromGroups)
          .eq("organization_id", organizationId)
          .eq("branch_id", viewerBranch);
        for (const ev of evRows || []) {
          const eid = (ev as { id?: string }).id;
          if (!eid || !isUuidString(eid)) continue;
          eventStartMsById.set(eid, new Date(String((ev as { start_time?: string | null }).start_time || "")).getTime());
        }
      }

      for (const r of eg || []) {
        const eid = (r as { event_id?: string }).event_id;
        const gid = (r as { group_id?: string }).group_id;
        if (typeof eid !== "string" || !isUuidString(eid) || typeof gid !== "string" || !isUuidString(gid)) continue;
        const joinedMs = groupJoinedMsById.get(gid);
        const eventStartMs = eventStartMsById.get(eid);
        if (Number.isFinite(joinedMs ?? Number.NaN) && Number.isFinite(eventStartMs ?? Number.NaN) && Number(joinedMs) > Number(eventStartMs)) {
          continue;
        }
        idSet.add(eid);
      }
    } catch {
      /* event_groups missing */
    }

    const { data: evLegacy } = await supabaseAdmin
      .from("events")
      .select("id, group_id, start_time")
      .in("group_id", groupIds)
      .eq("organization_id", organizationId)
      .eq("branch_id", viewerBranch);
    for (const r of (evLegacy || []) as Array<{ id?: string; group_id?: string; start_time?: string | null }>) {
      const eid = r.id;
      const gid = r.group_id;
      if (typeof eid === "string" && isUuidString(eid)) idSet.add(eid);
      if (!eid || !gid) continue;
      const joinedMs = groupJoinedMsById.get(gid);
      const eventStartMs = new Date(String(r.start_time || "")).getTime();
      if (Number.isFinite(joinedMs ?? Number.NaN) && Number.isFinite(eventStartMs) && Number(joinedMs) > eventStartMs) {
        idSet.delete(eid);
      }
    }
  }

  try {
    const { data: am } = await supabaseAdmin
      .from("event_assigned_members")
      .select("event_id")
      .eq("member_id", memberId);
    for (const r of am || []) {
      const eid = (r as { event_id?: string }).event_id;
      if (typeof eid === "string" && isUuidString(eid)) idSet.add(eid);
    }
  } catch {
    /* table missing */
  }

  return [...idSet];
}

/** Event IDs linked to a single group: `event_groups` junction + legacy `events.group_id` (scoped). */
async function fetchEventIdsLinkedToGroup(
  groupId: string,
  organizationId: string,
  viewerBranch: string,
): Promise<string[]> {
  const idSet = new Set<string>();

  try {
    const { data: eg } = await supabaseAdmin
      .from("event_groups")
      .select("event_id")
      .eq("group_id", groupId);
    for (const r of eg || []) {
      const eid = (r as { event_id?: string }).event_id;
      if (typeof eid === "string" && isUuidString(eid)) idSet.add(eid);
    }
  } catch {
    /* event_groups may be missing */
  }

  try {
    const { data: leg } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("group_id", groupId)
      .eq("organization_id", organizationId)
      .eq("branch_id", viewerBranch);
    for (const r of leg || []) {
      const id = (r as { id?: string }).id;
      if (typeof id === "string" && isUuidString(id)) idSet.add(id);
    }
  } catch {
    /* */
  }

  return [...idSet];
}

async function replaceEventGroups(
  eventId: string,
  organizationId: string,
  groupIds: string[],
): Promise<void> {
  const ids = [...new Set(groupIds.filter((id) => isUuidString(id)))];
  const { error: delErr } = await supabaseAdmin.from("event_groups").delete().eq("event_id", eventId);
  if (delErr) {
    const msg = String(delErr.message || "").toLowerCase();
    if (msg.includes("event_groups") || delErr.code === "42P01") {
      throw new Error(
        "event_groups table is missing. Run migrations/event_groups.sql in Supabase, then reload the API schema.",
      );
    }
    throw delErr;
  }
  if (ids.length === 0) return;

  const rows = ids.map((group_id) => ({
    event_id: eventId,
    organization_id: organizationId,
    group_id,
  }));

  const { error: insErr } = await supabaseAdmin.from("event_groups").insert(rows);
  if (insErr) throw insErr;
}

async function enrichEventAudience(row: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!row || !row.id) return row;
  const orgId = row.organization_id as string | undefined;
  try {
    row.assigned_member_ids = await fetchAssignedMemberIdsForEvent(String(row.id));
  } catch {
    row.assigned_member_ids = [];
  }
  try {
    const gids = await fetchEventGroupIdsForEvent(
      String(row.id),
      (row.group_id as string | null | undefined) ?? null,
    );
    row.group_ids = gids;
    if (orgId && gids.length > 0) {
      const { data: gn, error: gnErr } = await supabaseAdmin
        .from("groups")
        .select("id, name")
        .in("id", gids)
        .eq("organization_id", orgId);
      if (gnErr) throw gnErr;
      const order = new Map(gids.map((id, i) => [id, i]));
      row.linked_groups = [...(gn || [])]
        .map((g: { id: string; name: string | null }) => ({
          id: g.id,
          name: (g.name || "").trim() || "Ministry",
        }))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else {
      row.linked_groups = [];
    }
  } catch {
    const fallbackGid = row.group_id as string | null | undefined;
    row.group_ids =
      fallbackGid && isUuidString(String(fallbackGid)) ? [String(fallbackGid)] : [];
    row.linked_groups = [];
  }
  return row;
}

function normalizeUuidArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (isUuidString(s)) out.push(s);
  }
  return [...new Set(out)];
}

function parseGroupIdsFromBody(body: Record<string, unknown>): string[] {
  const fromArr = normalizeUuidArray(body.group_ids);
  let ids = [...new Set(fromArr)];
  if (
    ids.length === 0 &&
    typeof body.group_id === "string" &&
    isUuidString(body.group_id.trim())
  ) {
    ids = [body.group_id.trim()];
  }
  return ids;
}

const CANONICAL_LOCATION_TYPES = new Set(["InPerson", "Online", "Hybrid"]);

/** Accepts API input and legacy DB values; returns canonical slug or null. */
function normalizeLocationTypeInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (CANONICAL_LOCATION_TYPES.has(t)) return t;
  const compact = t.toLowerCase().replace(/[\s_-]/g, "");
  if (compact === "inperson" || compact === "onsite" || compact === "physical") return "InPerson";
  if (compact === "online") return "Online";
  if (compact === "hybrid") return "Hybrid";
  return null;
}

function normalizeOnlineMeetingUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  return u || null;
}

async function replaceEventAssignedMembers(
  eventId: string,
  organizationId: string,
  groupBranchId: string | null | undefined,
  rawMemberIds: unknown,
): Promise<void> {
  const memberIds = normalizeUuidArray(rawMemberIds);
  await supabaseAdmin.from("event_assigned_members").delete().eq("event_id", eventId);
  if (memberIds.length === 0) return;

  const { data: mems, error: memErr } = await supabaseAdmin
    .from("members")
    .select("id, branch_id, organization_id, is_deleted")
    .in("id", memberIds)
    .eq("organization_id", organizationId);

  if (memErr) throw memErr;

  const branchKey = groupBranchId != null && String(groupBranchId).length > 0 ? String(groupBranchId) : null;
  const allowed = new Set<string>();
  for (const m of mems || []) {
    const row = m as { id: string; branch_id?: string | null; is_deleted?: boolean };
    if (row.is_deleted) continue;
    if (branchKey !== null && row.branch_id !== branchKey) continue;
    allowed.add(row.id);
  }

  const toInsert = memberIds
    .filter((id) => allowed.has(id))
    .map((member_id) => ({
      event_id: eventId,
      organization_id: organizationId,
      member_id,
    }));

  if (toInsert.length === 0) return;

  const { error: insErr } = await supabaseAdmin.from("event_assigned_members").insert(toInsert);
  if (insErr) throw insErr;
}

const GROUP_TRASH_RETENTION_DAYS = 30;

function daysUntilTrashPurge(deletedAtIso: string | null | undefined): number {
  if (!deletedAtIso) return GROUP_TRASH_RETENTION_DAYS;
  const t = new Date(deletedAtIso).getTime();
  if (Number.isNaN(t)) return GROUP_TRASH_RETENTION_DAYS;
  const elapsedDays = Math.floor((Date.now() - t) / 86400000);
  return Math.max(0, GROUP_TRASH_RETENTION_DAYS - elapsedDays);
}

async function getMemberIdsInGroup(groupId: string, organizationId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("group_members")
    .select("member_id")
    .eq("group_id", groupId)
    .eq("organization_id", organizationId);
  if (error) throw error;
  return [
    ...new Set(
      (data || [])
        .map((r: { member_id?: string }) => r.member_id)
        .filter((id): id is string => typeof id === "string" && isUuidString(id)),
    ),
  ];
}

async function findEventIdsLinkedToGroup(groupId: string, organizationId: string): Promise<string[]> {
  const { data: eg } = await supabaseAdmin
    .from("event_groups")
    .select("event_id")
    .eq("group_id", groupId)
    .eq("organization_id", organizationId);
  const fromJunction = [
    ...new Set(
      (eg || [])
        .map((r: { event_id?: string }) => r.event_id)
        .filter((id): id is string => typeof id === "string" && isUuidString(id)),
    ),
  ];
  const { data: evLegacy } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("group_id", groupId);
  const fromLegacy = (evLegacy || [])
    .map((r: { id?: string }) => r.id)
    .filter((id): id is string => typeof id === "string" && isUuidString(id));
  return [...new Set([...fromJunction, ...fromLegacy])];
}

/** Remove ministry from event audience: unlink group, drop explicit assigns that were rostered via this group, trim attendance rows. Event row is kept. */
async function detachGroupFromEvents(groupId: string, organizationId: string): Promise<void> {
  const memberIdsInGroup = await getMemberIdsInGroup(groupId, organizationId);
  const memberSet = new Set(memberIdsInGroup);
  const eventIds = await findEventIdsLinkedToGroup(groupId, organizationId);

  for (const eventId of eventIds) {
    const { data: evRow } = await supabaseAdmin
      .from("events")
      .select("group_id, branch_id")
      .eq("id", eventId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!evRow) continue;

    const legacyGid = (evRow as { group_id?: string | null }).group_id ?? null;
    const currentGidsFull = await fetchEventGroupIdsForEvent(eventId, legacyGid);
    const nextGids = currentGidsFull.filter((g) => g !== groupId);

    await replaceEventGroups(eventId, organizationId, nextGids);

    const nextPrimary = nextGids[0] ?? null;
    await supabaseAdmin
      .from("events")
      .update({ group_id: nextPrimary, updated_at: new Date().toISOString() })
      .eq("id", eventId)
      .eq("organization_id", organizationId);

    if (memberIdsInGroup.length > 0) {
      const assigned = await fetchAssignedMemberIdsForEvent(eventId);
      const filtered = assigned.filter((id) => !memberSet.has(id));
      const evBranch = (evRow as { branch_id?: string | null }).branch_id;
      await replaceEventAssignedMembers(eventId, organizationId, evBranch ?? null, filtered);

      const { error: attDelErr } = await supabaseAdmin
        .from("event_attendance")
        .delete()
        .eq("event_id", eventId)
        .eq("organization_id", organizationId)
        .in("member_id", memberIdsInGroup);
      if (attDelErr) {
        const msg = String(attDelErr.message || "").toLowerCase();
        if (!msg.includes("event_attendance") && attDelErr.code !== "42P01") throw attDelErr;
      }
    }
  }
}

async function collectSubtreeGroupIds(rootId: string, organizationId: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const { data: kids, error } = await supabaseAdmin
      .from("groups")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("parent_group_id", id);
    if (error) throw error;
    for (const k of kids || []) {
      const kid = (k as { id: string }).id;
      if (!seen.has(kid)) queue.push(kid);
    }
  }
  return out;
}

async function hardDeleteGroupSubtree(rootId: string, organizationId: string): Promise<void> {
  const ids = await collectSubtreeGroupIds(rootId, organizationId);
  for (const gid of ids) {
    await detachGroupFromEvents(gid, organizationId);
  }
  const order = [...ids].reverse();
  for (const gid of order) {
    const { error: egErr } = await supabaseAdmin
      .from("event_groups")
      .delete()
      .eq("group_id", gid)
      .eq("organization_id", organizationId);
    if (egErr) {
      const msg = String(egErr.message || "").toLowerCase();
      if (!msg.includes("event_groups") && egErr.code !== "42P01") throw egErr;
    }

    const { error: gmErr } = await supabaseAdmin
      .from("group_members")
      .delete()
      .eq("group_id", gid)
      .eq("organization_id", organizationId);
    if (gmErr) throw gmErr;

    const { error: grErr } = await supabaseAdmin
      .from("group_requests")
      .delete()
      .eq("group_id", gid)
      .eq("organization_id", organizationId);
    if (grErr) {
      const msg = String(grErr.message || "").toLowerCase();
      if (!msg.includes("group_requests") && grErr.code !== "42P01") throw grErr;
    }

    const { error: delG } = await supabaseAdmin.from("groups").delete().eq("id", gid).eq("organization_id", organizationId);
    if (delG) throw new Error(delG.message || "Failed to delete group");
  }
}

function descendantCountFromRows(
  allRows: { id: string; parent_group_id: string | null }[],
  rootId: string,
): number {
  const childrenByParent = new Map<string, string[]>();
  for (const g of allRows) {
    const p = g.parent_group_id;
    if (!p || typeof p !== "string") continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(g.id);
  }
  let n = 0;
  const stack = [...(childrenByParent.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    n += 1;
    for (const c of childrenByParent.get(id) || []) stack.push(c);
  }
  return n;
}

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

const MAX_EVENT_ATTACHMENTS = 30;

function isPublicHttpUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate `events.attachments` JSON array from API body. */
function parseEventAttachmentsField(raw: unknown): unknown[] | "invalid" {
  if (raw === undefined) return [];
  if (raw === null) return [];
  if (!Array.isArray(raw)) return "invalid";
  if (raw.length > MAX_EVENT_ATTACHMENTS) return "invalid";
  const out: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "invalid";
    const o = item as Record<string, unknown>;
    const storage_path = typeof o.storage_path === "string" ? o.storage_path.trim() : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    let name = typeof o.name === "string" ? o.name.trim() : "";
    const hasPath = Boolean(storage_path && isSafeEventFileStoragePath(storage_path));
    const hasUrl = Boolean(url && isPublicHttpUrl(url));
    if (!hasPath && !hasUrl) return "invalid";
    if (!name) {
      if (hasPath) {
        name = storage_path.split("/").pop() || "file";
      } else {
        try {
          const path = new URL(url).pathname.split("/").filter(Boolean).pop() || "file";
          name = path.slice(0, MAX_ATTACHMENT_NAME_LEN);
        } catch {
          return "invalid";
        }
      }
    }
    if (name.length > MAX_ATTACHMENT_NAME_LEN) name = name.slice(0, MAX_ATTACHMENT_NAME_LEN);
    let size_bytes: number | undefined;
    if (o.size_bytes !== undefined && o.size_bytes !== null) {
      const n = typeof o.size_bytes === "number" ? o.size_bytes : Number(o.size_bytes);
      if (!Number.isFinite(n) || n < 0 || n > EVENT_FILE_MAX_BYTES) return "invalid";
      size_bytes = Math.floor(n);
    }
    const content_type =
      typeof o.content_type === "string" && o.content_type.trim()
        ? o.content_type.trim().slice(0, 200)
        : null;
    let uploaded_at: string | null = null;
    if (typeof o.uploaded_at === "string" && o.uploaded_at.trim()) {
      const d = new Date(o.uploaded_at.trim());
      if (!Number.isNaN(d.getTime())) uploaded_at = d.toISOString();
    }
    const row: Record<string, unknown> = { name };
    if (hasPath) row.storage_path = storage_path;
    if (hasUrl) row.url = url;
    if (size_bytes !== undefined) row.size_bytes = size_bytes;
    if (content_type) row.content_type = content_type;
    if (uploaded_at) row.uploaded_at = uploaded_at;
    out.push(row);
  }
  return out;
}

async function assertEventTypeInOrgScoped(
  eventTypeId: string,
  organizationId: string,
  viewerBranch: string,
  mainBranchId: string | null,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("event_types")
    .select("id, branch_id")
    .eq("id", eventTypeId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return false;
  try {
    assertConfigRowInBranchScope(data as { branch_id?: string | null }, viewerBranch, mainBranchId);
    return true;
  } catch {
    return false;
  }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const permEtGet = await requireAnyPermission(req, res, [
      "view_events",
      "add_events",
      "edit_events",
      "delete_events",
      "view_event_types",
      "add_event_types",
      "edit_event_types",
      "delete_event_types",
    ]);
    if (!permEtGet) return;

    const { data: rows, error } = await supabaseAdmin
      .from("event_types")
      .select("*")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });
    if (error) throw error;
    res.json(filterRowsByBranchScope(rows || [], viewerBranch, mainBranchId));
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permEtPost = await requirePermission(req, res, "add_event_types");
    if (!permEtPost) return;

    const branch_id: string | null = viewerBranch;

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
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const permEtPatch = await requirePermission(req, res, "edit_event_types");
    if (!permEtPatch) return;

    const { data: existing } = await supabaseAdmin
      .from("event_types")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.slug === "string") patch.slug = slugifyLabel(body.slug.trim()) || null;
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (typeof body.color === "string") patch.color = body.color.trim() || null;
    if (body.is_active === true || body.is_active === false) patch.is_active = body.is_active;
    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin
      .from("event_types")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) throw error;
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const permEtDel = await requirePermission(req, res, "delete_event_types");
    if (!permEtDel) return;

    const { data: existing } = await supabaseAdmin
      .from("event_types")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error } = await supabaseAdmin
      .from("event_types")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete event type" });
  }
});

function memberStatusOptionsTableMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = String(o.message || "");
  return o.code === "42P01" || m.includes("member_status_options");
}

function groupTypeOptionsTableMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = String(o.message || "");
  return o.code === "42P01" || m.includes("group_type_options");
}

const DEFAULT_MEMBER_STATUS_LABELS = ["Active", "Not active", "Travelled", "Transferred", "Deceased", "New"];

const DEFAULT_GROUP_TYPE_LABELS = ["Ministry", "Subgroup", "Team"];

/** Group-type labels; same elevated staff surfaces as legacy `manage_groups` + settings. */
const GROUP_TYPE_OPTION_WRITE_PERMS: string[] = [
  "add_groups",
  "edit_groups",
  "archive_groups",
  "restore_groups",
  "purge_groups",
  "system_settings",
  ...SETTINGS_ELEVATED_STAFF_PERMS,
];

/** Member status labels; same elevated staff surfaces as legacy `manage_member_statuses` + settings. */
const MEMBER_STATUS_OPTION_WRITE_PERMS: string[] = [
  "add_member_status_options",
  "edit_member_status_options",
  "delete_member_status_options",
  "system_settings",
  ...SETTINGS_ELEVATED_STAFF_PERMS,
];

app.get("/api/member-status-options", async (req, res) => {
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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: rows, error } = await supabaseAdmin
      .from("member_status_options")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) {
      if (memberStatusOptionsTableMissing(error)) return res.json([]);
      throw error;
    }
    res.json(filterRowsByBranchScope(rows || [], viewerBranch, mainBranchId));
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch member status options" });
  }
});

app.post("/api/member-status-options/seed-defaults", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, [...MEMBER_STATUS_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: allRows, error: listErr } = await supabaseAdmin
      .from("member_status_options")
      .select("id, branch_id")
      .eq("organization_id", orgId);
    if (listErr) {
      if (memberStatusOptionsTableMissing(listErr)) {
        return res.status(503).json({ error: "member_status_options table not installed." });
      }
      throw listErr;
    }
    const scoped = filterRowsByBranchScope(allRows || [], viewerBranch, mainBranchId);
    if (scoped.length > 0) {
      return res.status(409).json({ error: "This branch already has member status options" });
    }

    const now = new Date().toISOString();
    const toInsert = DEFAULT_MEMBER_STATUS_LABELS.map((label, i) => ({
      organization_id: orgId,
      branch_id: viewerBranch,
      label,
      color: null,
      sort_order: i,
      created_at: now,
      updated_at: now,
    }));
    const { data: created, error: insErr } = await supabaseAdmin
      .from("member_status_options")
      .insert(toInsert)
      .select("*");
    if (insErr) {
      if (memberStatusOptionsTableMissing(insErr)) {
        return res.status(503).json({ error: "member_status_options table not installed." });
      }
      throw insErr;
    }
    res.status(201).json({ options: created || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to seed member status options" });
  }
});

app.post("/api/member-status-options", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, [...MEMBER_STATUS_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);

    const body = req.body || {};
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return res.status(400).json({ error: "label is required" });
    const color = typeof body.color === "string" ? body.color.trim() || null : null;
    let sort_order = 0;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) sort_order = Math.floor(n);
    }

    const row = {
      organization_id: userProfile.organization_id,
      branch_id: viewerBranch,
      label,
      color,
      sort_order,
      updated_at: new Date().toISOString(),
    };

    const { data: created, error } = await supabaseAdmin
      .from("member_status_options")
      .insert([row])
      .select("*")
      .single();
    if (error) {
      if (memberStatusOptionsTableMissing(error)) {
        return res.status(503).json({ error: "member_status_options table not installed." });
      }
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "A status with this label already exists" });
      }
      throw error;
    }
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create member status option" });
  }
});

app.patch("/api/member-status-options/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...MEMBER_STATUS_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: existing } = await supabaseAdmin
      .from("member_status_options")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") {
      const L = body.label.trim();
      if (!L) return res.status(400).json({ error: "label cannot be empty" });
      patch.label = L;
    }
    if (typeof body.color === "string") patch.color = body.color.trim() || null;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) patch.sort_order = Math.floor(n);
    }

    const { data: updated, error } = await supabaseAdmin
      .from("member_status_options")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) {
      if (memberStatusOptionsTableMissing(error)) {
        return res.status(503).json({ error: "member_status_options table not installed." });
      }
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "A status with this label already exists" });
      }
      throw error;
    }
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update member status option" });
  }
});

app.delete("/api/member-status-options/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...MEMBER_STATUS_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: existing } = await supabaseAdmin
      .from("member_status_options")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error } = await supabaseAdmin
      .from("member_status_options")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) {
      if (memberStatusOptionsTableMissing(error)) {
        return res.status(503).json({ error: "member_status_options table not installed." });
      }
      throw error;
    }
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete member status option" });
  }
});

app.get("/api/group-type-options", async (req, res) => {
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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: rows, error } = await supabaseAdmin
      .from("group_type_options")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (error) {
      if (groupTypeOptionsTableMissing(error)) {
        return res.status(503).json({
          error: "group_type_options table not installed.",
          hint:
            "Open Supabase → SQL Editor, paste and run migrations/group_type_options.sql. Or from the project root run: npm run migrate:group-type-options (requires DATABASE_URL in .env).",
        });
      }
      throw error;
    }
    res.json(filterRowsByBranchScope(rows || [], viewerBranch, mainBranchId));
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch group type options" });
  }
});

app.post("/api/group-type-options/seed-defaults", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, [...GROUP_TYPE_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: allRows, error: listErr } = await supabaseAdmin
      .from("group_type_options")
      .select("id, branch_id")
      .eq("organization_id", orgId);
    if (listErr) {
      if (groupTypeOptionsTableMissing(listErr)) {
        return res.status(503).json({ error: "group_type_options table not installed." });
      }
      throw listErr;
    }
    const scoped = filterRowsByBranchScope(allRows || [], viewerBranch, mainBranchId);
    if (scoped.length > 0) {
      return res.status(409).json({ error: "This branch already has group type options" });
    }

    const now = new Date().toISOString();
    const toInsert = DEFAULT_GROUP_TYPE_LABELS.map((label, i) => ({
      organization_id: orgId,
      branch_id: viewerBranch,
      label,
      sort_order: i,
      created_at: now,
      updated_at: now,
    }));
    const { data: created, error: insErr } = await supabaseAdmin
      .from("group_type_options")
      .insert(toInsert)
      .select("*");
    if (insErr) {
      if (groupTypeOptionsTableMissing(insErr)) {
        return res.status(503).json({ error: "group_type_options table not installed." });
      }
      throw insErr;
    }
    res.status(201).json({ options: created || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to seed group type options" });
  }
});

app.post("/api/group-type-options", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, [...GROUP_TYPE_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);

    const body = req.body || {};
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return res.status(400).json({ error: "label is required" });
    let sort_order = 0;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) sort_order = Math.floor(n);
    }

    const row = {
      organization_id: userProfile.organization_id,
      branch_id: viewerBranch,
      label,
      sort_order,
      updated_at: new Date().toISOString(),
    };

    const { data: created, error } = await supabaseAdmin
      .from("group_type_options")
      .insert([row])
      .select("*")
      .single();
    if (error) {
      if (groupTypeOptionsTableMissing(error)) {
        return res.status(503).json({ error: "group_type_options table not installed." });
      }
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "A group type with this label already exists" });
      }
      throw error;
    }
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create group type option" });
  }
});

app.patch("/api/group-type-options/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...GROUP_TYPE_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: existing } = await supabaseAdmin
      .from("group_type_options")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") {
      const L = body.label.trim();
      if (!L) return res.status(400).json({ error: "label cannot be empty" });
      patch.label = L;
    }
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) patch.sort_order = Math.floor(n);
    }

    const { data: updated, error } = await supabaseAdmin
      .from("group_type_options")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) {
      if (groupTypeOptionsTableMissing(error)) {
        return res.status(503).json({ error: "group_type_options table not installed." });
      }
      if ((error as { code?: string }).code === "23505") {
        return res.status(409).json({ error: "A group type with this label already exists" });
      }
      throw error;
    }
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update group type option" });
  }
});

app.delete("/api/group-type-options/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...GROUP_TYPE_OPTION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);

    const { data: existing } = await supabaseAdmin
      .from("group_type_options")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error } = await supabaseAdmin
      .from("group_type_options")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) {
      if (groupTypeOptionsTableMissing(error)) {
        return res.status(503).json({ error: "group_type_options table not installed." });
      }
      throw error;
    }
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete group type option" });
  }
});

type CustomFieldScope = "member" | "event" | "group";

const CUSTOM_FIELD_TYPES = new Set([
  "text",
  "number",
  "email",
  "phone",
  "date",
  "dropdown",
  "checkbox",
  "textarea",
  "file",
]);

function customFieldDefinitionsTableMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string; details?: string };
  const m = String(o.message || "").toLowerCase();
  const d = String(o.details || "").toLowerCase();
  const combined = `${m} ${d}`;
  if (o.code === "42P01") return true;
  if (o.code === "PGRST205") return true;
  if (
    combined.includes("does not exist") &&
    combined.includes("custom_field_definitions")
  ) {
    return true;
  }
  if (combined.includes("schema cache") && combined.includes("custom_field_definitions")) {
    return true;
  }
  return false;
}

/** Shipped with the app at migrations/custom_fields.sql — or set DATABASE_URL and restart / run npm run migrate:custom-fields. */
const CUSTOM_FIELD_DEFINITIONS_INSTALL_HINT =
  "Add DATABASE_URL to .env (Supabase → Project Settings → Database → Connection string URI), restart the server, or run npm run migrate:custom-fields. Alternatively paste migrations/custom_fields.sql into the Supabase SQL Editor and run it.";

function jsonbCustomFieldsColumnMissing(err: unknown): boolean {
  const o = err as { code?: string; message?: string };
  const m = String(o.message || "").toLowerCase();
  return o.code === "42703" || m.includes("custom_fields");
}

function parseOptionsArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return [];
}

function slugifyFieldKeyBase(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (s || "field").slice(0, 64);
}

function coerceCustomFieldValue(
  def: { field_type: string; options: unknown },
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const ft = def.field_type;
  if (ft === "file") {
    return { ok: false, error: "File type is not supported yet" };
  }
  if (ft === "checkbox") {
    if (raw === true || raw === false) return { ok: true, value: raw };
    if (raw === null || raw === undefined || raw === "") return { ok: true, value: false };
    if (raw === "true" || raw === 1) return { ok: true, value: true };
    if (raw === "false" || raw === 0) return { ok: true, value: false };
    return { ok: false, error: "Invalid value for checkbox" };
  }
  if (ft === "number") {
    if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return { ok: false, error: "Invalid number" };
    return { ok: true, value: n };
  }
  if (ft === "dropdown") {
    const opts = parseOptionsArray(def.options);
    if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
    const s = String(raw).trim();
    if (!opts.length) return { ok: true, value: s };
    if (!opts.includes(s)) return { ok: false, error: `Invalid option for dropdown` };
    return { ok: true, value: s };
  }
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const s = String(raw).trim();
  return { ok: true, value: s === "" ? null : s };
}

function isEmptyCustomValue(ft: string, v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (ft === "checkbox") return false;
  if (typeof v === "string" && !v.trim()) return true;
  if (ft === "number" && typeof v === "number" && !Number.isFinite(v)) return true;
  return false;
}

async function fetchCustomFieldDefinitionsForOrgScope(
  orgId: string,
  scope: CustomFieldScope,
  entityBranchId?: string | null,
): Promise<
  {
    id: string;
    field_key: string;
    label: string;
    field_type: string;
    required: boolean;
    placeholder: string | null;
    options: unknown;
    default_value: string | null;
    sort_order: number;
    applies_to: string[];
    show_on_public: boolean;
    branch_id?: string | null;
  }[]
> {
  const { data, error } = await supabaseAdmin
    .from("custom_field_definitions")
    .select("*")
    .eq("organization_id", orgId)
    .contains("applies_to", [scope])
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    if (customFieldDefinitionsTableMissing(error)) return [];
    throw error;
  }
  const raw = (data || []) as {
    id: string;
    field_key: string;
    label: string;
    field_type: string;
    required: boolean;
    placeholder: string | null;
    options: unknown;
    default_value: string | null;
    sort_order: number;
    applies_to: string[];
    show_on_public: boolean;
    branch_id?: string | null;
  }[];
  const eb =
    entityBranchId != null && String(entityBranchId).trim().length > 0 ? String(entityBranchId).trim() : null;
  if (!eb) return raw;
  const mainBranchId = await getMainBranchIdForOrg(orgId);
  return filterRowsByBranchScope(raw, eb, mainBranchId) as typeof raw;
}

async function validateAndMergeCustomFields(
  orgId: string,
  scope: CustomFieldScope,
  entityBranchId: string | null | undefined,
  existingJson: Record<string, unknown> | null | undefined,
  incoming: unknown,
  mode: "create" | "merge",
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const defs = await fetchCustomFieldDefinitionsForOrgScope(orgId, scope, entityBranchId);
  const defByKey = new Map(defs.map((d) => [d.field_key, d]));
  const existing =
    existingJson && typeof existingJson === "object" && !Array.isArray(existingJson)
      ? { ...(existingJson as Record<string, unknown>) }
      : {};
  if (incoming !== undefined && incoming !== null && (typeof incoming !== "object" || Array.isArray(incoming))) {
    return { ok: false, status: 400, error: "custom_fields must be an object" };
  }
  const incomingObj =
    incoming !== undefined && incoming !== null && typeof incoming === "object" && !Array.isArray(incoming)
      ? (incoming as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = {};
  if (mode === "merge") {
    for (const def of defs) {
      const k = def.field_key;
      if (k in existing) merged[k] = existing[k];
    }
  }
  for (const k of Object.keys(incomingObj)) {
    if (!defByKey.has(k)) continue;
    const def = defByKey.get(k)!;
    const coerced = coerceCustomFieldValue(def, incomingObj[k]);
    if (!coerced.ok) return { ok: false, status: 400, error: coerced.error };
    merged[k] = coerced.value;
  }
  if (mode === "create") {
    for (const def of defs) {
      const k = def.field_key;
      if (!(k in merged) && def.default_value != null && String(def.default_value).length) {
        const coerced = coerceCustomFieldValue(def, def.default_value);
        if (coerced.ok) merged[k] = coerced.value;
      }
    }
  }
  for (const def of defs) {
    const v = merged[def.field_key];
    if (def.required && isEmptyCustomValue(def.field_type, v)) {
      return { ok: false, status: 400, error: `Required custom field: ${def.label}` };
    }
  }
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const k = def.field_key;
    if (k in merged) out[k] = merged[k];
  }
  return { ok: true, value: out };
}

function buildPublicCustomFieldRows(
  values: Record<string, unknown> | null | undefined,
  defs: { field_key: string; label: string; field_type: string; options: unknown }[],
): { field_key: string; label: string; field_type: string; value: unknown }[] {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const keySet = new Set(defs.map((d) => d.field_key));
  const out: { field_key: string; label: string; field_type: string; value: unknown }[] = [];
  for (const def of defs) {
    if (!keySet.has(def.field_key)) continue;
    if (!Object.prototype.hasOwnProperty.call(v, def.field_key)) continue;
    const val = v[def.field_key];
    if (val === null || val === undefined || val === "") continue;
    if (typeof val === "string" && !val.trim()) continue;
    out.push({
      field_key: def.field_key,
      label: def.label,
      field_type: def.field_type,
      value: val,
    });
  }
  return out;
}

async function fetchPublicDefinitionsForScope(
  orgId: string,
  scope: CustomFieldScope,
  branchId?: string | null,
): Promise<{ field_key: string; label: string; field_type: string; options: unknown }[]> {
  const rows = await fetchCustomFieldDefinitionsForOrgScope(orgId, scope, branchId);
  return rows
    .filter((d) => d.show_on_public)
    .map((d) => ({
      field_key: d.field_key,
      label: d.label,
      field_type: d.field_type,
      options: d.options,
    }));
}

const CUSTOM_FIELD_DEFINITION_WRITE_PERMS: string[] = ["system_settings", ...SETTINGS_ELEVATED_STAFF_PERMS];

app.get("/api/custom-field-definitions", async (req, res) => {
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
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgId);
    const appliesRaw = typeof req.query.applies_to === "string" ? req.query.applies_to.trim() : "";
    let q = supabaseAdmin
      .from("custom_field_definitions")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (appliesRaw === "member" || appliesRaw === "event" || appliesRaw === "group") {
      q = q.contains("applies_to", [appliesRaw]);
    }
    const { data: rows, error } = await q;
    if (error) {
      if (customFieldDefinitionsTableMissing(error)) {
        return res.status(503).json({
          error: "custom_field_definitions table not installed.",
          hint: CUSTOM_FIELD_DEFINITIONS_INSTALL_HINT,
        });
      }
      throw error;
    }
    res.json(filterRowsByBranchScope(rows || [], viewerBranch, mainBranchId));
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch custom field definitions" });
  }
});

app.post("/api/custom-field-definitions", async (req, res) => {
  const permCtx = await requireAnyPermission(req, res, [...CUSTOM_FIELD_DEFINITION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const body = req.body || {};
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return res.status(400).json({ error: "label is required" });
    const field_type =
      typeof body.field_type === "string" && CUSTOM_FIELD_TYPES.has(body.field_type.trim())
        ? body.field_type.trim()
        : "";
    if (!field_type) return res.status(400).json({ error: "Invalid or missing field_type" });
    if (field_type === "file") return res.status(400).json({ error: "File type is not supported yet" });
    const appliesToRaw = body.applies_to;
    const applies_to: string[] = Array.isArray(appliesToRaw)
      ? [...new Set(appliesToRaw.map((x: unknown) => String(x).trim()).filter(Boolean))].filter((x) =>
          ["member", "event", "group"].includes(x),
        )
      : [];
    if (applies_to.length === 0) {
      return res.status(400).json({ error: "applies_to must include at least one of member, event, group" });
    }
    let field_key =
      typeof body.field_key === "string" && body.field_key.trim()
        ? body.field_key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64)
        : slugifyFieldKeyBase(label);
    if (!field_key) field_key = "field";
    const { count } = await supabaseAdmin
      .from("custom_field_definitions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", viewerBranch)
      .eq("field_key", field_key);
    if ((count ?? 0) > 0) {
      field_key = `${field_key}_${Math.random().toString(36).slice(2, 8)}`;
    }
    const required = Boolean(body.required);
    const placeholder =
      typeof body.placeholder === "string" && body.placeholder.trim() ? body.placeholder.trim() : null;
    let options: unknown = [];
    if (Array.isArray(body.options)) options = body.options;
    else if (typeof body.options === "string") {
      options = body.options.split(",").map((x: string) => x.trim()).filter(Boolean);
    }
    const default_value =
      typeof body.default_value === "string" && body.default_value.trim()
        ? body.default_value.trim()
        : null;
    let sort_order = 0;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) sort_order = Math.floor(n);
    }
    const show_on_public = Boolean(body.show_on_public);
    const row = {
      organization_id: orgId,
      branch_id: viewerBranch,
      field_key,
      label,
      field_type,
      required,
      placeholder,
      options,
      default_value,
      sort_order,
      applies_to,
      show_on_public,
      updated_at: new Date().toISOString(),
    };
    const { data: created, error } = await supabaseAdmin
      .from("custom_field_definitions")
      .insert([row])
      .select("*")
      .single();
    if (error) {
      if (customFieldDefinitionsTableMissing(error)) {
        return res.status(503).json({
          error: "custom_field_definitions table not installed.",
          hint: CUSTOM_FIELD_DEFINITIONS_INSTALL_HINT,
        });
      }
      throw error;
    }
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to create custom field definition" });
  }
});

app.patch("/api/custom-field-definitions/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...CUSTOM_FIELD_DEFINITION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);
    const { data: existing } = await supabaseAdmin
      .from("custom_field_definitions")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") {
      const L = body.label.trim();
      if (!L) return res.status(400).json({ error: "label cannot be empty" });
      patch.label = L;
    }
    if (typeof body.field_type === "string" && CUSTOM_FIELD_TYPES.has(body.field_type.trim())) {
      if (body.field_type.trim() === "file") return res.status(400).json({ error: "File type is not supported yet" });
      patch.field_type = body.field_type.trim();
    }
    if (typeof body.required === "boolean") patch.required = body.required;
    if (typeof body.placeholder === "string") patch.placeholder = body.placeholder.trim() || null;
    if (body.options !== undefined) {
      if (Array.isArray(body.options)) patch.options = body.options;
      else if (typeof body.options === "string") {
        patch.options = body.options.split(",").map((x: string) => x.trim()).filter(Boolean);
      }
    }
    if (typeof body.default_value === "string") patch.default_value = body.default_value.trim() || null;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
      if (Number.isFinite(n)) patch.sort_order = Math.floor(n);
    }
    if (typeof body.show_on_public === "boolean") patch.show_on_public = body.show_on_public;
    if (body.applies_to !== undefined) {
      const appliesToRaw = body.applies_to;
      const applies_to: string[] = Array.isArray(appliesToRaw)
        ? [...new Set(appliesToRaw.map((x: unknown) => String(x).trim()).filter(Boolean))].filter((x) =>
            ["member", "event", "group"].includes(x),
          )
        : [];
      if (applies_to.length === 0) {
        return res.status(400).json({ error: "applies_to must include at least one of member, event, group" });
      }
      patch.applies_to = applies_to;
    }
    if (Object.keys(patch).length === 1) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    const { data: updated, error } = await supabaseAdmin
      .from("custom_field_definitions")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", orgId)
      .select("*")
      .single();
    if (error) {
      if (customFieldDefinitionsTableMissing(error)) {
        return res.status(503).json({
          error: "custom_field_definitions table not installed.",
          hint: CUSTOM_FIELD_DEFINITIONS_INSTALL_HINT,
        });
      }
      throw error;
    }
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update custom field definition" });
  }
});

app.delete("/api/custom-field-definitions/:id", async (req, res) => {
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const permCtx = await requireAnyPermission(req, res, [...CUSTOM_FIELD_DEFINITION_WRITE_PERMS]);
  if (!permCtx) return;
  try {
    const { data: userProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id, branch_id")
      .eq("id", permCtx.userId)
      .single();
    if (!userProfile) return res.status(401).json({ error: "User profile not found" });
    const orgId = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, permCtx.userId);
    const mainBranchId = await getMainBranchIdForOrg(orgId);
    const { data: existing } = await supabaseAdmin
      .from("custom_field_definitions")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(existing as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error } = await supabaseAdmin
      .from("custom_field_definitions")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) {
      if (customFieldDefinitionsTableMissing(error)) {
        return res.status(503).json({
          error: "custom_field_definitions table not installed.",
          hint: CUSTOM_FIELD_DEFINITIONS_INSTALL_HINT,
        });
      }
      throw error;
    }
    res.status(200).json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete custom field definition" });
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgIdEo = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgIdEo);

    const permEoGet = await requireAnyPermission(req, res, [
      "view_events",
      "add_events",
      "edit_events",
      "delete_events",
      "add_program_templates",
      "edit_program_templates",
      "delete_program_templates",
    ]);
    if (!permEoGet) return;

    const eventTypeId = typeof req.query.event_type_id === "string" ? req.query.event_type_id.trim() : "";
    let q = supabaseAdmin
      .from("event_outline")
      .select(OUTLINE_TEMPLATE_SELECT)
      .eq("organization_id", orgIdEo)
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
          .eq("organization_id", orgIdEo)
          .order("name", { ascending: true });
        if (eventTypeId && isUuidString(eventTypeId)) {
          q2 = q2.eq("event_type_id", eventTypeId);
        }
        let r2 = await q2;
        if (r2.error && isPostgrestMissingEventOutlineEventTypeId(r2.error)) {
          r2 = await supabaseAdmin
            .from("event_outline")
            .select("*")
            .eq("organization_id", orgIdEo)
            .order("name", { ascending: true });
        }
        if (r2.error) throw r2.error;
        return res.json(filterRowsByBranchScope((r2.data || []) as { branch_id?: string | null }[], viewerBranch, mainBranchId));
      }
      throw error;
    }
    res.json(filterRowsByBranchScope((rows || []) as { branch_id?: string | null }[], viewerBranch, mainBranchId));
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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
    const orgIdTpl = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgIdTpl);

    const permEoPost = await requirePermission(req, res, "add_program_templates");
    if (!permEoPost) return;

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const eventTypeId = typeof body.event_type_id === "string" ? body.event_type_id.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    if (!isUuidString(eventTypeId)) return res.status(400).json({ error: "event_type_id is required" });
    if (!(await assertEventTypeInOrgScoped(eventTypeId, orgIdTpl, viewerBranch, mainBranchId))) {
      return res.status(400).json({ error: "Invalid event type" });
    }

    let program_outline: Record<string, unknown> = {};
    const po = parseProgramOutlineBody(body as Record<string, unknown>);
    if (po === "invalid") return res.status(400).json({ error: "Invalid program_outline JSON" });
    if (po) program_outline = po;

    const branch_id: string | null = viewerBranch;
    const description = typeof body.description === "string" ? body.description.trim() || null : null;

    const insertRow: Record<string, unknown> = {
      organization_id: orgIdTpl,
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgIdPatch = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgIdPatch);

    const permEoPatch = await requirePermission(req, res, "edit_program_templates");
    if (!permEoPatch) return;

    const { data: tplExisting } = await supabaseAdmin
      .from("event_outline")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgIdPatch)
      .maybeSingle();
    if (!tplExisting) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(tplExisting as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (body.is_active === true || body.is_active === false) patch.is_active = body.is_active;
    if (typeof body.event_type_id === "string" && isUuidString(body.event_type_id.trim())) {
      const et = body.event_type_id.trim();
      if (!(await assertEventTypeInOrgScoped(et, orgIdPatch, viewerBranch, mainBranchId))) {
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
        .eq("organization_id", orgIdPatch)
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();
    if (!userProfile) throw new Error("User profile not found");
    const orgIdDel = userProfile.organization_id as string;
    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);
    const mainBranchId = await getMainBranchIdForOrg(orgIdDel);

    const permEoDel = await requirePermission(req, res, "delete_program_templates");
    if (!permEoDel) return;

    const { data: tplRow } = await supabaseAdmin
      .from("event_outline")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", orgIdDel)
      .maybeSingle();
    if (!tplRow) return res.status(404).json({ error: "Not found" });
    assertConfigRowInBranchScope(tplRow as { branch_id?: string | null }, viewerBranch, mainBranchId);

    const { error } = await supabaseAdmin
      .from("event_outline")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgIdDel);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permEvList = await requirePermission(req, res, "view_events");
    if (!permEvList) return;

    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));

    let query = supabaseAdmin
      .from("events")
      .select(EVENTS_SELECT, { count: "exact" })
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: rows, error, count: eventsCount } = await query;
    const { data: profEvList } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerEvList = (profEvList as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (
        msg.includes("cover_image_url") ||
        msg.includes("program_outline") ||
        msg.includes("attachments") ||
        msg.includes("custom_fields") ||
        code === "42703"
      ) {
        const retry = await supabaseAdmin
          .from("events")
          .select(
            "id, organization_id, branch_id, group_id, title, start_time, end_time, event_type, location_type, location_details, notes, created_at, updated_at, groups!group_id(name)",
            { count: "exact" }
          )
          .eq("organization_id", userProfile.organization_id)
          .eq("branch_id", viewerBranch)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (retry.error) throw retry.error;
        const filteredRetry = await filterEventsRowsByMinistryScope(
          (retry.data || []) as Record<string, unknown>[],
          userProfile.organization_id as string,
          viewerBranch,
          user.id,
          isOrgOwnerEvList,
        );
        const enrichedRetry = await Promise.all(
          filteredRetry.map((r) => enrichEventAudience(r as Record<string, unknown>)),
        );
        return res.json({ events: enrichedRetry, total_count: retry.count ?? enrichedRetry.length });
      }
      throw error;
    }
    const filteredRows = await filterEventsRowsByMinistryScope(
      (rows || []) as Record<string, unknown>[],
      userProfile.organization_id as string,
      viewerBranch,
      user.id,
      isOrgOwnerEvList,
    );
    const enrichedRows = await Promise.all(
      filteredRows.map((r) => enrichEventAudience(r as Record<string, unknown>)),
    );
    res.json({ events: enrichedRows, total_count: eventsCount ?? enrichedRows.length });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch events" });
  }
});

app.get("/api/events/:id", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid event id" });

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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permEvDetail = await requirePermission(req, res, "view_events");
    if (!permEvDetail) return;

    const runSelect = (select: string) =>
      supabaseAdmin
        .from("events")
        .select(select)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();

    let { data: row, error } = await runSelect(EVENTS_SELECT);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (
        msg.includes("cover_image_url") ||
        msg.includes("program_outline") ||
        msg.includes("attachments") ||
        msg.includes("custom_fields") ||
        code === "42703"
      ) {
        const retry = await runSelect(
          "id, organization_id, branch_id, group_id, title, start_time, end_time, event_type, location_type, location_details, notes, created_at, updated_at, groups!group_id(name)",
        );
        if (retry.error) throw retry.error;
        row = retry.data;
      } else {
        throw error;
      }
    }

    if (!row) return res.status(404).json({ error: "Event not found" });
    try {
      assertEntityBranch((row as { branch_id?: string | null }).branch_id, viewerBranch, "event");
    } catch (e: any) {
      if ((e as { statusCode?: number }).statusCode === 404) {
        return res.status(404).json({ error: "Event not found" });
      }
      throw e;
    }
    const { data: profEvDetail } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerEvDetail = (profEvDetail as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    const canSeeEv = await assertEventVisibleUnderMinistryScope(
      userProfile.organization_id as string,
      viewerBranch,
      user.id,
      isOrgOwnerEvDetail,
      id,
      (row as { group_id?: string | null }).group_id,
    );
    if (!canSeeEv) return res.status(403).json({ error: "Not allowed to view this event" });
    const enriched = await enrichEventAudience(row as Record<string, unknown>);
    res.json(enriched);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to fetch event" });
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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permEvCreate = await requirePermission(req, res, "add_events");
    if (!permEvCreate) return;

    const orgIdEv = userProfile.organization_id as string;
    const limE = await assertOrgLimit(supabaseAdmin, orgIdEv, "events_month");
    if (!limE.ok)
      return res.status(403).json({ error: limE.message, code: "ORG_LIMIT", current: limE.current, limit: limE.limit });

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

    const groupIds = parseGroupIdsFromBody(body);
    const assignedPreview = normalizeUuidArray(body.assigned_member_ids);
    if (assignedPreview.length > 0) {
      const actorCtx = await getActorAuthContextFromToken(token);
      if (!actorCtx) return res.status(401).json({ error: "Unauthorized" });
      if (
        !actorCtx.isOrgOwner &&
        !actorCtx.permissionSet.has("assign_event_members") &&
        !actorCtx.permissionSet.has("add_events")
      ) {
        return res.status(403).json({ error: "Not allowed to assign members to events" });
      }
    }
    if (groupIds.length === 0 && assignedPreview.length === 0) {
      return res.status(400).json({
        error: "Choose at least one ministry and/or at least one specific member.",
      });
    }

    for (const gid of groupIds) {
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
      const gb = (g as { branch_id?: string | null }).branch_id;
      if (!gb || String(gb) !== viewerBranch) {
        return res.status(403).json({ error: "Linked ministries must belong to your selected branch." });
      }
    }

    const primaryGroupId: string | null = groupIds[0] ?? null;

    const row: Record<string, unknown> = {
      organization_id: userProfile.organization_id,
      branch_id: viewerBranch,
      group_id: primaryGroupId,
      title,
      start_time: startTime.toISOString(),
      end_time: endTime ? endTime.toISOString() : null,
      event_type: typeof body.event_type === "string" ? body.event_type.trim() || null : null,
      location_type: normalizeLocationTypeInput(body.location_type),
      location_details: typeof body.location_details === "string" ? body.location_details.trim() || null : null,
      online_meeting_url: normalizeOnlineMeetingUrl(body.online_meeting_url),
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    };

    const poParsed = parseProgramOutlineBody(body as Record<string, unknown>);
    if (poParsed === "invalid") {
      return res.status(400).json({ error: "Invalid program_outline JSON" });
    }
    if (poParsed) row.program_outline = poParsed;

    const attParsed = parseEventAttachmentsField(body.attachments);
    if (attParsed === "invalid") {
      return res.status(400).json({ error: "Invalid attachments" });
    }
    row.attachments = attParsed;

    const cover = typeof body.cover_image_url === "string" ? body.cover_image_url.trim() : "";
    if (cover) row.cover_image_url = cover;

    const cfEv = await validateAndMergeCustomFields(
      orgIdEv,
      "event",
      viewerBranch,
      null,
      body.custom_fields !== undefined ? body.custom_fields : {},
      "create",
    );
    if (!cfEv.ok) return res.status(cfEv.status).json({ error: cfEv.error });
    row.custom_fields = cfEv.value;

    const insertEventRow = async (
      omitCover: boolean,
      omitProgramOutline: boolean,
      omitAttachments: boolean,
      omitCustomFields: boolean,
      omitOnlineMeetingUrl: boolean,
    ) => {
      const payload: Record<string, unknown> = { ...row };
      if (omitCover) delete payload.cover_image_url;
      if (omitProgramOutline) delete payload.program_outline;
      if (omitAttachments) delete payload.attachments;
      if (omitCustomFields) delete payload.custom_fields;
      if (omitOnlineMeetingUrl) delete payload.online_meeting_url;
      return supabaseAdmin.from("events").insert([payload]).select(EVENTS_SELECT).single();
    };

    let omitCover = false;
    let omitProgramOutline = false;
    let omitAttachments = false;
    let omitCustomFields = false;
    let omitOnlineMeetingUrl = false;
    let created: Record<string, unknown> | null = null;
    let lastError: { message?: string; code?: string } | null = null;
    for (let i = 0; i < 12; i++) {
      const r = await insertEventRow(omitCover, omitProgramOutline, omitAttachments, omitCustomFields, omitOnlineMeetingUrl);
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
      if (msg.includes("attachments")) {
        omitAttachments = true;
        continue;
      }
      if (msg.includes("custom_fields")) {
        omitCustomFields = true;
        continue;
      }
      if (msg.includes("online_meeting_url")) {
        omitOnlineMeetingUrl = true;
        continue;
      }
      break;
    }

    if (lastError || !created) {
      return res.status(500).json({ error: lastError?.message || "Failed to create event" });
    }

    const createdId = String((created as { id: string }).id);
    try {
      await replaceEventGroups(createdId, userProfile.organization_id, groupIds);
    } catch (egErr: any) {
      return res.status(500).json({
        error: egErr.message || "Event created but failed to save linked ministries",
      });
    }
    try {
      await replaceEventAssignedMembers(
        createdId,
        userProfile.organization_id,
        viewerBranch,
        body.assigned_member_ids,
      );
    } catch (amErr: any) {
      return res.status(500).json({
        error: amErr.message || "Event created but failed to save assigned members",
      });
    }

    const createdEnriched = await enrichEventAudience(created as Record<string, unknown>);
    const eventIdForNotif = String((created as { id: string }).id);
    const eventCreatedAt = String((created as { created_at?: string }).created_at || "");
    const eventCreatedMs = eventCreatedAt ? new Date(eventCreatedAt).getTime() : Number.NaN;
    let recipients = await profileIdsWithPermission(orgIdEv, viewerBranch, "view_events");
    if (Number.isFinite(eventCreatedMs)) {
      const pc = await mapProfileCreatedAtMsById(recipients);
      recipients = filterRecipientsProfileCreatedNotAfterEntity(recipients, pc, eventCreatedMs);
    }
    const coverUrl = String((created as { cover_image_url?: string | null }).cover_image_url || "").trim();
    const eventTitleDisp = String(title || "Event").trim() || "Event";
    await createNotificationsForRecipients(recipients, {
      organization_id: orgIdEv,
      branch_id: viewerBranch,
      type: "event_created",
      category: "events",
      title: "New event created",
      message: `Event "${title}" was created.`,
      severity: "low",
      entity_type: "event",
      entity_id: eventIdForNotif,
      action_path: `/events/${eventIdForNotif}`,
      payload: {
        event_id: eventIdForNotif,
        event_display_name: eventTitleDisp,
        ...(coverUrl ? { event_cover_image_url: coverUrl } : {}),
      },
    });
    res.status(201).json(createdEnriched);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to create event" });
  }
});

app.patch("/api/events/:id", async (req, res) => {
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: existing, error: exErr } = await supabaseAdmin
      .from("events")
      .select("id, organization_id, branch_id")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .single();
    if (exErr || !existing) {
      return res.status(404).json({ error: "Event not found" });
    }
    assertEntityBranch((existing as { branch_id?: string | null }).branch_id, viewerBranch, "event");

    const body = req.body || {};
    if (body.group_scope === "organization") {
      return res.status(400).json({
        error: "Link at least one ministry or specific members — not organization-wide only.",
      });
    }

    let nextGroupIds: string[] | null = null;
    if (body.group_ids !== undefined) {
      nextGroupIds = normalizeUuidArray(body.group_ids);
    } else if (body.group_id !== undefined) {
      if (body.group_id === null || (typeof body.group_id === "string" && !body.group_id.trim())) {
        nextGroupIds = [];
      } else if (typeof body.group_id === "string" && isUuidString(body.group_id.trim())) {
        nextGroupIds = [body.group_id.trim()];
      } else if (typeof body.group_id === "string" && body.group_id.trim()) {
        return res.status(400).json({ error: "Invalid group_id" });
      } else {
        nextGroupIds = [];
      }
    }

    const patch: Record<string, unknown> = {};

    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.start_time === "string" && body.start_time.trim()) {
      const startTime = new Date(body.start_time.trim());
      if (Number.isNaN(startTime.getTime())) {
        return res.status(400).json({ error: "Invalid start_time" });
      }
      patch.start_time = startTime.toISOString();
    }
    if (body.end_time !== undefined) {
      if (body.end_time === null || (typeof body.end_time === "string" && !body.end_time.trim())) {
        patch.end_time = null;
      } else if (typeof body.end_time === "string") {
        const endTime = new Date(body.end_time.trim());
        if (Number.isNaN(endTime.getTime())) {
          return res.status(400).json({ error: "Invalid end_time" });
        }
        patch.end_time = endTime.toISOString();
      }
    }
    if (typeof body.event_type === "string") patch.event_type = body.event_type.trim() || null;
    if (body.location_type !== undefined) {
      patch.location_type = normalizeLocationTypeInput(body.location_type);
    }
    if (typeof body.location_details === "string") patch.location_details = body.location_details.trim() || null;
    if (body.online_meeting_url !== undefined) {
      patch.online_meeting_url = normalizeOnlineMeetingUrl(body.online_meeting_url);
    }
    if (typeof body.notes === "string") patch.notes = body.notes.trim() || null;

    if (typeof body.cover_image_url === "string") {
      const cover = body.cover_image_url.trim();
      if (cover) patch.cover_image_url = cover;
      else patch.cover_image_url = null;
    }

    const poParsed = parseProgramOutlineBody(body as Record<string, unknown>);
    if (poParsed === "invalid") {
      return res.status(400).json({ error: "Invalid program_outline JSON" });
    }
    if (poParsed) patch.program_outline = poParsed;

    if (body.attachments !== undefined) {
      const attParsed = parseEventAttachmentsField(body.attachments);
      if (attParsed === "invalid") {
        return res.status(400).json({ error: "Invalid attachments" });
      }
      patch.attachments = attParsed;
    }

    if (body.custom_fields !== undefined) {
      const { data: evPrev } = await supabaseAdmin
        .from("events")
        .select("custom_fields, branch_id")
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .maybeSingle();
      const prevCf =
        evPrev &&
        typeof (evPrev as { custom_fields?: unknown }).custom_fields === "object" &&
        !Array.isArray((evPrev as { custom_fields?: unknown }).custom_fields)
          ? ((evPrev as { custom_fields: Record<string, unknown> }).custom_fields as Record<string, unknown>)
          : {};
      const evBranch =
        evPrev && (evPrev as { branch_id?: string | null }).branch_id != null
          ? String((evPrev as { branch_id?: string | null }).branch_id)
          : viewerBranch;
      const cfMerge = await validateAndMergeCustomFields(
        userProfile.organization_id as string,
        "event",
        evBranch,
        prevCf,
        body.custom_fields,
        "merge",
      );
      if (!cfMerge.ok) return res.status(cfMerge.status).json({ error: cfMerge.error });
      patch.custom_fields = cfMerge.value;
    }

    if (nextGroupIds !== null) {
      for (const gid of nextGroupIds) {
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
        const gb = (g as { branch_id?: string | null }).branch_id;
        if (!gb || String(gb) !== viewerBranch) {
          return res.status(403).json({ error: "Linked ministries must belong to your selected branch." });
        }
      }
      patch.group_id = nextGroupIds[0] ?? null;
      patch.branch_id = viewerBranch;
    }

    const hasAssignedUpdate = body.assigned_member_ids !== undefined;
    const hasAudienceFieldUpdate = nextGroupIds !== null || hasAssignedUpdate;

    const actorPatch = await getActorAuthContextFromToken(token);
    if (!actorPatch) return res.status(401).json({ error: "Unauthorized" });
    const structuralUpdate = Object.keys(patch).length > 0 || nextGroupIds !== null;
    if (structuralUpdate) {
      if (!actorPatch.isOrgOwner && !actorPatch.permissionSet.has("edit_events")) {
        return res.status(403).json({ error: "Missing permission: edit_events" });
      }
    } else if (hasAssignedUpdate) {
      if (
        !actorPatch.isOrgOwner &&
        !actorPatch.permissionSet.has("edit_events") &&
        !actorPatch.permissionSet.has("assign_event_members")
      ) {
        return res.status(403).json({ error: "Not allowed to update event roster" });
      }
    }

    let updated: Record<string, unknown> | null = null;
    let lastError: { message?: string; code?: string } | null = null;

    if (Object.keys(patch).length === 0) {
      if (!hasAssignedUpdate) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const fullQ = await supabaseAdmin
        .from("events")
        .select(EVENTS_SELECT)
        .eq("id", id)
        .eq("organization_id", userProfile.organization_id)
        .single();
      if (fullQ.error || !fullQ.data) {
        return res.status(500).json({ error: fullQ.error?.message || "Failed to load event" });
      }
      updated = fullQ.data as Record<string, unknown>;
    } else {
      const runUpdate = async (
        omitCover: boolean,
        omitProgramOutline: boolean,
        omitAttachments: boolean,
        omitCustomFields: boolean,
        omitOnlineMeetingUrl: boolean,
      ) => {
        const payload = { ...patch };
        if (omitCover) delete payload.cover_image_url;
        if (omitProgramOutline) delete payload.program_outline;
        if (omitAttachments) delete payload.attachments;
        if (omitCustomFields) delete payload.custom_fields;
        if (omitOnlineMeetingUrl) delete payload.online_meeting_url;
        return supabaseAdmin.from("events").update(payload).eq("id", id).select(EVENTS_SELECT).single();
      };

      let omitCover = false;
      let omitProgramOutline = false;
      let omitAttachments = false;
      let omitCustomFields = false;
      let omitOnlineMeetingUrl = false;

      for (let i = 0; i < 12; i++) {
        const r = await runUpdate(omitCover, omitProgramOutline, omitAttachments, omitCustomFields, omitOnlineMeetingUrl);
        if (!r.error && r.data) {
          updated = r.data as Record<string, unknown>;
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
        if (msg.includes("attachments")) {
          omitAttachments = true;
          continue;
        }
        if (msg.includes("custom_fields")) {
          omitCustomFields = true;
          continue;
        }
        if (msg.includes("online_meeting_url")) {
          omitOnlineMeetingUrl = true;
          continue;
        }
        break;
      }

      if (lastError || !updated) {
        return res.status(500).json({ error: lastError?.message || "Failed to update event" });
      }
    }

    const updatedRow = updated as Record<string, unknown>;

    try {
      if (nextGroupIds !== null) {
        await replaceEventGroups(id, userProfile.organization_id, nextGroupIds);
      }
      if (hasAssignedUpdate) {
        await replaceEventAssignedMembers(
          id,
          userProfile.organization_id,
          viewerBranch,
          body.assigned_member_ids,
        );
      }
    } catch (amErr: any) {
      return res.status(500).json({
        error: amErr.message || "Event updated but failed to sync ministries or assigned members",
      });
    }

    const out = await enrichEventAudience(updatedRow);
    let recipientsEv = await profileIdsWithPermission(String(userProfile.organization_id), viewerBranch, "view_events");
    const evUpdatedAt = String((updatedRow as { updated_at?: string }).updated_at || "");
    const evUpdatedMs = evUpdatedAt ? new Date(evUpdatedAt).getTime() : Number.NaN;
    if (Number.isFinite(evUpdatedMs)) {
      const pcEv = await mapProfileCreatedAtMsById(recipientsEv);
      recipientsEv = filterRecipientsProfileCreatedNotAfterEntity(recipientsEv, pcEv, evUpdatedMs);
    }
    const coverEv = String((updatedRow as { cover_image_url?: string | null }).cover_image_url || "").trim();
    const updatedEvTitle = String((updatedRow as { title?: string }).title || "Untitled event").trim() || "Event";
    await createNotificationsForRecipients(recipientsEv, {
      organization_id: String(userProfile.organization_id),
      branch_id: viewerBranch,
      type: "event_updated",
      category: "events",
      title: "Event updated",
      message: `Event "${String((updatedRow as { title?: string }).title || "Untitled event")}" was updated.`,
      severity: "low",
      entity_type: "event",
      entity_id: id,
      action_path: `/events/${id}`,
      payload: {
        event_id: id,
        event_display_name: updatedEvTitle,
        ...(coverEv ? { event_cover_image_url: coverEv } : {}),
      },
    });
    res.json(out);
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to update event" });
  }
});

const ATTENDANCE_STATUSES = ["not_marked", "present", "absent", "unsure"] as const;

function isAttendanceStatus(v: unknown): v is (typeof ATTENDANCE_STATUSES)[number] {
  return typeof v === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(v);
}

/**
 * Persist attendance without `upsert(..., onConflict: event_id,member_id)` — older databases may
 * lack that UNIQUE constraint, which causes: "no unique or exclusion constraint matching ON CONFLICT".
 */
async function saveEventAttendanceRows(rows: Record<string, unknown>[]): Promise<void> {
  for (const row of rows) {
    const event_id = row.event_id as string;
    const member_id = row.member_id as string;

    const { data: existingList, error: selErr } = await supabaseAdmin
      .from("event_attendance")
      .select("id")
      .eq("event_id", event_id)
      .eq("member_id", member_id);

    if (selErr) throw selErr;

    const ids = (existingList || [])
      .map((r: { id?: string }) => r.id)
      .filter((id): id is string => typeof id === "string" && isUuidString(id));

    if (ids.length > 1) {
      const [, ...dupIds] = ids;
      const { error: delErr } = await supabaseAdmin.from("event_attendance").delete().in("id", dupIds);
      if (delErr) throw delErr;
    }

    const keepId = ids[0];
    const patch: Record<string, unknown> = { ...row };
    delete patch.id;

    if (keepId) {
      const { error: upErr } = await supabaseAdmin.from("event_attendance").update(patch).eq("id", keepId);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await supabaseAdmin.from("event_attendance").insert(row);
      if (insErr) throw insErr;
    }
  }
}

/** Roster + attendance: union of all linked group rosters and event_assigned_members. */
app.get("/api/events/:id/attendance", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid event id" });

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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: event, error: evErr } = await supabaseAdmin
      .from("events")
      .select("id, organization_id, branch_id, group_id, start_time")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (evErr) throw evErr;
    if (!event) return res.status(404).json({ error: "Event not found" });
    assertEntityBranch((event as { branch_id?: string | null }).branch_id, viewerBranch, "event");

    const { data: profAttGet } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerAttGet = (profAttGet as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    const canSeeAttGet = await assertEventVisibleUnderMinistryScope(
      userProfile.organization_id as string,
      viewerBranch,
      user.id,
      isOrgOwnerAttGet,
      id,
      (event as { group_id?: string | null }).group_id,
    );
    if (!canSeeAttGet) return res.status(403).json({ error: "Not allowed to view this event" });

    const attCtx = await getActorAuthContextFromToken(token);
    if (!attCtx) return res.status(401).json({ error: "Unauthorized" });
    if (
      !attCtx.isOrgOwner &&
      !attCtx.permissionSet.has("view_events") &&
      !attCtx.permissionSet.has("view_event_attendance") &&
      !attCtx.permissionSet.has("record_event_attendance")
    ) {
      return res.status(403).json({ error: "Not allowed to view attendance" });
    }

    const eventGroupIds = await fetchEventGroupIdsForEvent(id, event.group_id);
    const assignedExplicit = await fetchAssignedMemberIdsForEvent(id);

    const groupMemberIdUnique = await fetchRosterMemberIdsFromGroupIds(
      eventGroupIds,
      String(userProfile.organization_id),
      (event as { start_time?: string | null }).start_time ?? null,
    );

    const assignedExplicitSet = new Set(assignedExplicit);
    const rosterMemberIds = [...new Set([...groupMemberIdUnique, ...assignedExplicit])];

    let assigned_groups: { id: string; name: string }[] = [];
    if (eventGroupIds.length > 0) {
      const { data: gmeta, error: metaErr } = await supabaseAdmin
        .from("groups")
        .select("id, name")
        .in("id", eventGroupIds)
        .eq("organization_id", userProfile.organization_id);
      if (metaErr) throw metaErr;
      const byId = new Map(
        (gmeta || []).map((g: { id: string; name: string | null }) => [g.id, g]),
      );
      assigned_groups = eventGroupIds.map((gid) => {
        const row = byId.get(gid) as { id: string; name: string | null } | undefined;
        return row
          ? { id: row.id, name: (row.name || "").trim() || "Ministry" }
          : { id: gid, name: "Ministry" };
      });
    }

    const { data: attendanceEarly, error: attEarlyErr } = await supabaseAdmin
      .from("event_attendance")
      .select(
        "id, member_id, status, check_in_time, check_in_method, notes, recorded_by_user_id, created_at, updated_at",
      )
      .eq("event_id", id)
      .eq("organization_id", userProfile.organization_id);
    if (attEarlyErr) throw attEarlyErr;

    if (rosterMemberIds.length === 0) {
      return res.json({
        event_id: event.id,
        assigned_groups,
        filter_groups: [],
        members: [],
        attendance: attendanceEarly || [],
      });
    }

    const { data: members, error: memErr } = await supabaseAdmin
      .from("members")
      .select("id, first_name, last_name, memberimage_url, is_deleted")
      .in("id", rosterMemberIds)
      .eq("organization_id", userProfile.organization_id);

    if (memErr) throw memErr;

    const activeMembers = (members || []).filter((m: { is_deleted?: boolean }) => !m.is_deleted);

    const { data: allGm, error: agErr } = await supabaseAdmin
      .from("group_members")
      .select("member_id, group_id")
      .in("member_id", rosterMemberIds)
      .eq("organization_id", userProfile.organization_id);

    if (agErr) throw agErr;

    const groupIdSet = new Set(
      (allGm || [])
        .map((r: { group_id?: string }) => r.group_id)
        .filter((gid): gid is string => typeof gid === "string" && isUuidString(gid)),
    );
    for (const gid of eventGroupIds) {
      if (isUuidString(gid)) groupIdSet.add(gid);
    }

    const { data: groupNames, error: gnErr } = await supabaseAdmin
      .from("groups")
      .select("id, name")
      .in("id", [...groupIdSet])
      .eq("organization_id", userProfile.organization_id);

    if (gnErr) throw gnErr;

    const groupNameById = new Map<string, string>(
      (groupNames || []).map((g: { id: string; name: string }) => [g.id, g.name || "Group"]),
    );

    const memberToGroups = new Map<string, string[]>();
    for (const row of allGm || []) {
      const mid = row.member_id as string;
      const gid = row.group_id as string;
      if (!mid || !gid) continue;
      const arr = memberToGroups.get(mid) || [];
      arr.push(gid);
      memberToGroups.set(mid, arr);
    }

    const eventGroupFilterIds = eventGroupIds.filter((gid) => groupNameById.has(gid));
    const rosterMembers = activeMembers.map((m: { id: string; first_name?: string; last_name?: string; memberimage_url?: string | null }) => {
      const fromMembership = [...new Set(memberToGroups.get(m.id) || [])].filter((gid) => groupNameById.has(gid));
      const ids =
        assignedExplicitSet.has(m.id) && eventGroupFilterIds.length > 0
          ? [...new Set([...fromMembership, ...eventGroupFilterIds])]
          : fromMembership;
      return {
        id: m.id,
        first_name: m.first_name || "",
        last_name: m.last_name || "",
        memberimage_url: m.memberimage_url || null,
        group_ids: ids,
      };
    });

    const filterGroups = [...groupIdSet]
      .map((gid) => ({ id: gid, name: groupNameById.get(gid) || "Group" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      event_id: event.id,
      assigned_groups,
      filter_groups: filterGroups,
      members: rosterMembers,
      attendance: attendanceEarly || [],
    });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to load attendance" });
  }
});

/** Batch upsert attendance for members (manual marking). */
app.put("/api/events/:id/attendance", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid event id" });

  try {
    const permCtx = await requirePermission(req, res, "record_event_attendance");
    if (!permCtx) return;

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

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const { data: event, error: evErr } = await supabaseAdmin
      .from("events")
      .select("id, organization_id, branch_id, group_id, start_time")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();

    if (evErr) throw evErr;
    if (!event) return res.status(404).json({ error: "Event not found" });
    assertEntityBranch((event as { branch_id?: string | null }).branch_id, viewerBranch, "event");

    const { data: profAttPut } = await supabaseAdmin
      .from("profiles")
      .select("is_org_owner")
      .eq("id", user.id)
      .maybeSingle();
    const isOrgOwnerAttPut = (profAttPut as { is_org_owner?: boolean } | null)?.is_org_owner === true;
    const canSeeAttPut = await assertEventVisibleUnderMinistryScope(
      userProfile.organization_id as string,
      viewerBranch,
      user.id,
      isOrgOwnerAttPut,
      id,
      (event as { group_id?: string | null }).group_id,
    );
    if (!canSeeAttPut) return res.status(403).json({ error: "Not allowed to update attendance for this event" });

    const body = req.body || {};
    const updates = Array.isArray(body.updates) ? body.updates : null;
    if (!updates?.length) {
      return res.status(400).json({ error: "updates array required" });
    }

    const eventGroupIdsPut = await fetchEventGroupIdsForEvent(id, event.group_id);
    const groupMemberIdSet = new Set<string>(
      await fetchRosterMemberIdsFromGroupIds(
        eventGroupIdsPut,
        String(userProfile.organization_id),
        (event as { start_time?: string | null }).start_time ?? null,
      ),
    );

    const assignedPutIds = await fetchAssignedMemberIdsForEvent(id);

    const allowedMemberIds = new Set<string>([...groupMemberIdSet, ...assignedPutIds]);

    if (allowedMemberIds.size === 0) {
      return res.status(400).json({
        error: "This event has no attendance roster (no linked ministries or members).",
      });
    }

    const nowIso = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];

    for (const u of updates) {
      const member_id = typeof u?.member_id === "string" ? u.member_id.trim() : "";
      if (!isUuidString(member_id) || !allowedMemberIds.has(member_id)) {
        return res.status(400).json({ error: "Invalid or non-roster member_id in updates" });
      }
      const status = u?.status;
      if (!isAttendanceStatus(status)) {
        return res.status(400).json({
          error: `status must be one of: ${ATTENDANCE_STATUSES.join(", ")}`,
        });
      }
      const notes =
        typeof u?.notes === "string" && u.notes.trim() ? u.notes.trim().slice(0, 500) : null;

      const row: Record<string, unknown> = {
        organization_id: event.organization_id,
        branch_id: viewerBranch,
        event_id: id,
        member_id,
        status,
        notes,
        recorded_by_user_id: user.id,
        updated_at: nowIso,
      };

      if (status === "present") {
        row.check_in_method = "manual";
        row.check_in_time = nowIso;
      } else {
        row.check_in_method = null;
        row.check_in_time = null;
      }

      rows.push(row);
    }

    await saveEventAttendanceRows(rows);

    const { data: attendance } = await supabaseAdmin
      .from("event_attendance")
      .select(
        "id, member_id, status, check_in_time, check_in_method, notes, recorded_by_user_id, created_at, updated_at",
      )
      .eq("event_id", id)
      .eq("organization_id", userProfile.organization_id);

    res.json({ ok: true, attendance: attendance || [] });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to save attendance" });
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
      .select("organization_id, branch_id")
      .eq("id", user.id)
      .single();

    if (!userProfile) throw new Error("User profile not found");

    const viewerBranch = await assertViewerBranchScope(req, userProfile as OrgProfile, user.id);

    const permEvDel = await requirePermission(req, res, "delete_events");
    if (!permEvDel) return;

    const { data: evRow, error: evLoadErr } = await supabaseAdmin
      .from("events")
      .select("id, branch_id")
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .maybeSingle();
    if (evLoadErr) throw evLoadErr;
    if (!evRow) return res.status(404).json({ error: "Event not found" });
    assertEntityBranch((evRow as { branch_id?: string | null }).branch_id, viewerBranch, "event");

    const { error } = await supabaseAdmin
      .from("events")
      .delete()
      .eq("id", id)
      .eq("organization_id", userProfile.organization_id)
      .eq("branch_id", viewerBranch);

    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (error: any) {
    const code = (error as { statusCode?: number }).statusCode;
    if (typeof code === "number" && code >= 400 && code < 500) {
      return res.status(code).json({ error: error.message || "Request failed" });
    }
    res.status(500).json({ error: error.message || "Failed to delete event" });
  }
});

/**
 * Events linked to a group (event_groups + legacy events.group_id) for public ministry pages.
 * Returns cover, title, schedule, and program outline — upcoming first (soonest), then past (newest first).
 */
async function fetchPublicEventsForGroupId(
  groupId: string,
  organizationId: string,
  branchId: string,
): Promise<
  {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    cover_image_url: string | null;
    program_outline: string | null;
    public_custom_fields: { field_key: string; label: string; field_type: string; value: unknown }[];
  }[]
> {
  const ids = await fetchEventIdsLinkedToGroup(groupId, organizationId, branchId);
  if (ids.length === 0) return [];

  const idList = ids.slice(0, 200);
  const now = Date.now();

  const eventPubDefs = await fetchPublicDefinitionsForScope(organizationId, "event", branchId);

  const runSelect = (cols: string) =>
    supabaseAdmin
      .from("events")
      .select(cols)
      .in("id", idList)
      .eq("organization_id", organizationId)
      .eq("branch_id", branchId)
      .order("start_time", { ascending: true })
      .limit(80);

  let { data: rows, error } = await runSelect(
    "id, title, start_time, end_time, cover_image_url, program_outline, custom_fields",
  );

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    const code = (error as { code?: string }).code;
    if (msg.includes("custom_fields")) {
      const retry = await runSelect("id, title, start_time, end_time, cover_image_url, program_outline");
      if (retry.error) {
        const retry2 = await runSelect("id, title, start_time, end_time, cover_image_url");
        if (retry2.error) {
          const retry3 = await runSelect("id, title, start_time, end_time");
          if (retry3.error) return [];
          rows = retry3.data;
        } else {
          rows = retry2.data;
        }
      } else {
        rows = retry.data;
      }
    } else if (
      msg.includes("cover_image_url") ||
      msg.includes("program_outline") ||
      code === "42703"
    ) {
      const retry = await runSelect("id, title, start_time, end_time, cover_image_url");
      if (retry.error) {
        const retry2 = await runSelect("id, title, start_time, end_time");
        if (retry2.error) return [];
        rows = retry2.data;
      } else {
        rows = retry.data;
      }
    } else {
      return [];
    }
  }

  const mapped = ((rows || []) as {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    cover_image_url?: string | null;
    program_outline?: string | null;
    custom_fields?: Record<string, unknown> | null;
  }[]).map((ev) => {
    const cf =
      ev.custom_fields && typeof ev.custom_fields === "object" && !Array.isArray(ev.custom_fields)
        ? (ev.custom_fields as Record<string, unknown>)
        : {};
    return {
      id: ev.id,
      title: ev.title,
      start_time: ev.start_time,
      end_time: ev.end_time ?? null,
      cover_image_url: ev.cover_image_url ?? null,
      program_outline:
        typeof ev.program_outline === "string" && ev.program_outline.trim() ? ev.program_outline.trim() : null,
      public_custom_fields: buildPublicCustomFieldRows(cf, eventPubDefs),
    };
  });

  mapped.sort((a, b) => {
    const ta = new Date(a.start_time).getTime();
    const tb = new Date(b.start_time).getTime();
    const aUp = ta >= now;
    const bUp = tb >= now;
    if (aUp !== bUp) return aUp ? -1 : 1;
    if (aUp) return ta - tb;
    return tb - ta;
  });

  return mapped;
}

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
    const slug = String(req.params.slug || "").trim();
    if (!slug) {
      return res.status(400).json({ error: "Invalid slug" });
    }

    // Default-on: treat null as public (opt-out only when explicitly false).
    const publicOnFilter = "public_website_enabled.eq.true,public_website_enabled.is.null";

    let query = supabaseAdmin
      .from("groups")
      .select("*, profiles!leader_id(first_name, last_name, email, avatar_url)")
      .eq("public_link_slug", slug)
      .or(publicOnFilter)
      .eq("is_deleted", false);

    let { data: group, error } = await query.maybeSingle();

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const code = (error as { code?: string }).code;
      if (msg.includes("is_deleted") || code === "42703") {
        ({ data: group, error } = await supabaseAdmin
          .from("groups")
          .select("*, profiles!leader_id(first_name, last_name, email, avatar_url)")
          .eq("public_link_slug", slug)
          .or(publicOnFilter)
          .maybeSingle());
      } else {
        return res.status(500).json({ error: error.message });
      }
    }

    if (!group) {
      return res.status(404).json({ error: "Public group not found or not enabled" });
    }

    const g = group as { id: string; join_invite_token?: string | null; join_link_enabled?: boolean };
    const inviteToken =
      g.join_link_enabled && g.join_invite_token ? g.join_invite_token : null;

    let member_count = 0;
    try {
      const { count } = await supabaseAdmin
        .from("group_members")
        .select("id", { count: "exact", head: true })
        .eq("group_id", g.id);
      if (typeof count === "number") member_count = count;
    } catch {
      member_count = 0;
    }

    const orgId = String((group as { organization_id?: string }).organization_id || "");
    const brId = String((group as { branch_id?: string | null }).branch_id || "");
    const events =
      orgId && brId
        ? await fetchPublicEventsForGroupId(g.id, orgId, brId)
        : [];

    const groupPubDefs =
      orgId && brId ? await fetchPublicDefinitionsForScope(orgId, "group", brId) : [];
    const gcfRaw =
      (group as { custom_fields?: unknown }).custom_fields &&
      typeof (group as { custom_fields?: unknown }).custom_fields === "object" &&
      !Array.isArray((group as { custom_fields?: unknown }).custom_fields)
        ? ((group as { custom_fields: Record<string, unknown> }).custom_fields as Record<string, unknown>)
        : {};
    const public_group_custom_fields = buildPublicCustomFieldRows(gcfRaw, groupPubDefs);

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
      member_count,
      public_group_custom_fields,
      events,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch public group" });
  }
});

// --- SuperAdmin (cross-tenant; service role) ---
app.get("/api/superadmin/stats", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  try {
    const [
      orgs,
      members,
      branches,
      staff,
      groups,
      events30,
    ] = await Promise.all([
      supabaseAdmin.from("organizations").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("members")
        .select("id", { count: "exact", head: true })
        .or("is_deleted.eq.false,is_deleted.is.null"),
      supabaseAdmin.from("branches").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("groups")
        .select("id", { count: "exact", head: true })
        .or("is_deleted.eq.false,is_deleted.is.null"),
      supabaseAdmin
        .from("events")
        .select("id", { count: "exact", head: true })
        .gte(
          "created_at",
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        ),
    ]);
    const { data: orgTierRows } = await supabaseAdmin.from("organizations").select("subscription_tier");
    const orgs_by_tier: Record<string, number> = {};
    for (const r of orgTierRows || []) {
      const t = normalizeSubscriptionTier(String((r as { subscription_tier?: string | null }).subscription_tier ?? "free"));
      orgs_by_tier[t] = (orgs_by_tier[t] || 0) + 1;
    }

    res.json({
      total_organizations: orgs.count ?? 0,
      total_members: members.count ?? 0,
      total_branches: branches.count ?? 0,
      total_staff: staff.count ?? 0,
      total_groups: groups.count ?? 0,
      events_last_30_days: events30.count ?? 0,
      orgs_by_tier,
      plan_tiers: Object.fromEntries(
        (Object.keys(SUBSCRIPTION_PLANS) as (keyof typeof SUBSCRIPTION_PLANS)[]).map((k) => [
          k,
          SUBSCRIPTION_PLANS[k].label,
        ]),
      ),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load stats" });
  }
});

app.get("/api/superadmin/orgs", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(String(req.query.pageSize || "20"), 10) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const tierFilter = typeof req.query.tier === "string" ? req.query.tier.trim().toLowerCase() : "";

    const fullOrgSelect =
      "id, name, slug, logo_url, subscription_tier, created_at, hubtel_subscription_id, max_members, max_groups, max_branches, max_events_per_month, max_staff";
    const minimalOrgSelect = "id, name, slug, logo_url, subscription_tier, created_at";
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const buildOrgListQuery = (sel: string) => {
      let q = supabaseAdmin.from("organizations").select(sel, { count: "exact" });
      if (search) {
        q = q.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
      }
      if (tierFilter && tierFilter !== "all") {
        q = q.eq("subscription_tier", tierFilter);
      }
      return q.order("created_at", { ascending: false }).range(from, to);
    };

    let { data: rows, error, count } = await buildOrgListQuery(fullOrgSelect);
    if (error) {
      const r2 = await buildOrgListQuery(minimalOrgSelect);
      if (r2.error) throw r2.error;
      rows = r2.data;
      count = r2.count;
    }
    const list = rows || [];
    const enriched = await Promise.all(
      list.map(async (o) => {
        const id = (o as { id: string }).id;
        const usage = await getOrgUsage(supabaseAdmin, id);
        const row = await fetchOrgLimitRow(supabaseAdmin, id);
        const ol = row || ({} as OrgLimitRow);
        return {
          id,
          name: (o as { name: string }).name,
          slug: (o as { slug: string }).slug,
          logo_url: (o as { logo_url?: string | null }).logo_url ?? null,
          subscription_tier: (o as { subscription_tier?: string | null }).subscription_tier ?? "free",
          created_at: (o as { created_at?: string }).created_at,
          hubtel_subscription_id: (o as { hubtel_subscription_id?: string | null }).hubtel_subscription_id ?? null,
          usage,
          limits: {
            max_members: effectiveLimit(ol, "max_members"),
            max_groups: effectiveLimit(ol, "max_groups"),
            max_branches: effectiveLimit(ol, "max_branches"),
            max_events_per_month: effectiveLimit(ol, "max_events_per_month"),
            max_staff: effectiveLimit(ol, "max_staff"),
          },
          overrides: {
            max_members: (o as { max_members?: number | null }).max_members ?? null,
            max_groups: (o as { max_groups?: number | null }).max_groups ?? null,
            max_branches: (o as { max_branches?: number | null }).max_branches ?? null,
            max_events_per_month: (o as { max_events_per_month?: number | null }).max_events_per_month ?? null,
            max_staff: (o as { max_staff?: number | null }).max_staff ?? null,
          },
        };
      }),
    );
    res.json({ organizations: enriched, page, pageSize, total: typeof count === "number" ? count : enriched.length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list organizations" });
  }
});

app.get("/api/superadmin/orgs/:id", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!org) return res.status(404).json({ error: "Organization not found" });
    const usage = await getOrgUsage(supabaseAdmin, id);
    const row = await fetchOrgLimitRow(supabaseAdmin, id);
    const ol = row || ({} as OrgLimitRow);
    const { data: branchRows } = await supabaseAdmin.from("branches").select("*").eq("organization_id", id);
    const profFull = await supabaseAdmin
      .from("profiles")
      .select("id, email, first_name, last_name, branch_id, role_id, is_org_owner, is_active")
      .eq("organization_id", id);
    let profRows: Record<string, unknown>[] = [];
    if (profFull.error && String(profFull.error.message || "").toLowerCase().includes("is_active")) {
      const profShort = await supabaseAdmin
        .from("profiles")
        .select("id, email, first_name, last_name, branch_id, role_id, is_org_owner")
        .eq("organization_id", id);
      if (profShort.error) throw profShort.error;
      profRows = (profShort.data || []) as Record<string, unknown>[];
    } else if (profFull.error) {
      throw profFull.error;
    } else {
      profRows = (profFull.data || []) as Record<string, unknown>[];
    }
    res.json({
      organization: org,
      usage,
      limits: {
        max_members: effectiveLimit(ol, "max_members"),
        max_groups: effectiveLimit(ol, "max_groups"),
        max_branches: effectiveLimit(ol, "max_branches"),
        max_events_per_month: effectiveLimit(ol, "max_events_per_month"),
        max_staff: effectiveLimit(ol, "max_staff"),
      },
      branches: branchRows || [],
      staff: profRows || [],
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to load organization" });
  }
});

app.patch("/api/superadmin/orgs/:id", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  const { id } = req.params;
  if (!isUuidString(id)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body || {};
  try {
    const patch: Record<string, unknown> = {};
    if (typeof body.subscription_tier === "string" && body.subscription_tier.trim()) {
      patch.subscription_tier = normalizeSubscriptionTier(body.subscription_tier);
    }
    const numOrNull = (v: unknown): number | null => {
      if (v === null || v === "") return null;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : null;
    };
    if (body.max_members !== undefined) patch.max_members = numOrNull(body.max_members);
    if (body.max_groups !== undefined) patch.max_groups = numOrNull(body.max_groups);
    if (body.max_branches !== undefined) patch.max_branches = numOrNull(body.max_branches);
    if (body.max_events_per_month !== undefined) patch.max_events_per_month = numOrNull(body.max_events_per_month);
    if (body.max_staff !== undefined) patch.max_staff = numOrNull(body.max_staff);
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });
    const { data: updated, error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ organization: updated });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update organization" });
  }
});

app.get("/api/superadmin/branches", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  const orgId = typeof req.query.org_id === "string" ? req.query.org_id.trim() : "";
  try {
    let q = supabaseAdmin.from("branches").select("*");
    if (orgId && isUuidString(orgId)) q = q.eq("organization_id", orgId);
    const { data: branches, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) throw error;
    const ids = [...new Set((branches || []).map((b) => String((b as { organization_id?: string }).organization_id || "")))].filter(
      isUuidString,
    );
    let orgNameById: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: orgRows } = await supabaseAdmin.from("organizations").select("id, name, slug").in("id", ids);
      for (const r of orgRows || []) {
        orgNameById[(r as { id: string }).id] = (r as { name: string }).name;
      }
    }
    const out = (branches || []).map((b) => ({
      ...b,
      organization_name: orgNameById[String((b as { organization_id?: string }).organization_id || "")] ?? null,
    }));
    res.json({ branches: out });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list branches" });
  }
});

app.get("/api/superadmin/users", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  const orgId = typeof req.query.org_id === "string" ? req.query.org_id.trim() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  try {
    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_active, is_super_admin");
    if (orgId && isUuidString(orgId)) q = q.eq("organization_id", orgId);
    if (search) {
      q = q.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }
    const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("is_super_admin")) {
        const { data: d2, error: e2 } = await supabaseAdmin
          .from("profiles")
          .select("id, email, first_name, last_name, organization_id, branch_id, role_id, is_org_owner, is_active")
          .order("created_at", { ascending: false })
          .limit(500);
        if (e2) throw e2;
        return res.json({ users: d2 || [] });
      }
      throw error;
    }
    res.json({ users: data || [] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list users" });
  }
});

app.patch("/api/superadmin/users/:profileId", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  const { profileId } = req.params;
  if (!isUuidString(profileId)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body || {};
  try {
    const patch: Record<string, unknown> = {};
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields" });
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", profileId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to update user" });
  }
});

app.get("/api/superadmin/growth", async (req, res) => {
  const sa = await requireSuperAdmin(req, res);
  if (!sa) return;
  try {
    const { data: orgs } = await supabaseAdmin.from("organizations").select("id, created_at").order("created_at", { ascending: true });
    const months: Record<string, number> = {};
    for (const o of orgs || []) {
      const c = (o as { created_at?: string }).created_at;
      if (!c) continue;
      const d = new Date(c);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      months[key] = (months[key] || 0) + 1;
    }
    res.json({ new_orgs_by_month: months });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

let notificationsJobRunning = false;
let lastMemberCareRunMs = 0;
let lastImportantDatesRunMs = 0;

async function runAttendanceAutomation(now: Date): Promise<void> {
  const nowMs = now.getTime();
  const lookbackIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
  const lookaheadIso = new Date(nowMs + 2 * 60 * 60 * 1000).toISOString();

  const { data: events } = await supabaseAdmin
    .from("events")
    .select("id, organization_id, branch_id, title, start_time, end_time, created_at, cover_image_url")
    .gte("start_time", lookbackIso)
    .lte("start_time", lookaheadIso)
    .limit(500);
  const list = (events || []) as Array<{
    id: string;
    organization_id: string;
    branch_id: string | null;
    title?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    created_at?: string | null;
    cover_image_url?: string | null;
  }>;
  for (const ev of list) {
    if (!isUuidString(ev.id) || !isUuidString(ev.organization_id) || !isUuidString(String(ev.branch_id || ""))) continue;
    const startMs = new Date(String(ev.start_time || "")).getTime();
    if (!Number.isFinite(startMs)) continue;
    const endMs = ev.end_time ? new Date(ev.end_time).getTime() : Number.NaN;
    const createdMs = ev.created_at ? new Date(String(ev.created_at)).getTime() : startMs;
    const retroMs = Number.isFinite(createdMs) ? Math.min(createdMs, startMs) : startMs;

    let recipients = await profileIdsWithAnyPermission(ev.organization_id, ev.branch_id, [
      "view_event_attendance",
      "record_event_attendance",
    ]);
    if (recipients.length === 0) continue;
    const pcAtt = await mapProfileCreatedAtMsById(recipients);
    recipients = filterRecipientsProfileCreatedNotAfterEntity(recipients, pcAtt, retroMs);
    if (recipients.length === 0) continue;

    const attendanceRows = await supabaseAdmin
      .from("event_attendance")
      .select("id")
      .eq("event_id", ev.id)
      .limit(1);
    const hasAttendance = !attendanceRows.error && Array.isArray(attendanceRows.data) && attendanceRows.data.length > 0;

    const evTitle = String(ev.title || "Event").trim() || "Event";
    const evCover = String(ev.cover_image_url || "").trim();
    const attendanceEventPayload: Record<string, unknown> = {
      event_id: ev.id,
      event_display_name: evTitle,
      ...(evCover ? { event_cover_image_url: evCover } : {}),
    };

    if (nowMs >= startMs - 5 * 60 * 1000 && nowMs <= startMs + 10 * 60 * 1000) {
      await createNotificationsForRecipients(recipients, {
        organization_id: ev.organization_id,
        branch_id: ev.branch_id,
        type: "attendance_start_reminder",
        category: "attendance",
        title: "Attendance starts in 5 minutes",
        message: `Get ready to mark attendance for "${String(ev.title || "Event")}".`,
        severity: "high",
        entity_type: "event",
        entity_id: ev.id,
        action_path: `/events/${ev.id}`,
        payload: { ...attendanceEventPayload },
        dedupe_key: `attendance_start_${ev.id}`,
        dedupe_window_minutes: 60,
      });
    }

    if (Number.isFinite(endMs) && nowMs >= endMs - 10 * 60 * 1000 && nowMs <= endMs + 10 * 60 * 1000) {
      await createNotificationsForRecipients(recipients, {
        organization_id: ev.organization_id,
        branch_id: ev.branch_id,
        type: "attendance_close_reminder",
        category: "attendance",
        title: "Attendance closes in 10 minutes",
        message: `Finalize attendance for "${String(ev.title || "Event")}" before closing.`,
        severity: "high",
        entity_type: "event",
        entity_id: ev.id,
        action_path: `/events/${ev.id}`,
        payload: { ...attendanceEventPayload },
        dedupe_key: `attendance_close_${ev.id}`,
        dedupe_window_minutes: 60,
      });
    }

    if (!hasAttendance && nowMs >= startMs + 5 * 60 * 1000 && nowMs <= startMs + 60 * 60 * 1000) {
      await createNotificationsForRecipients(recipients, {
        organization_id: ev.organization_id,
        branch_id: ev.branch_id,
        type: "attendance_missed",
        category: "attendance",
        title: "Attendance not marked yet",
        message: `Attendance has not been marked for "${String(ev.title || "Event")}".`,
        severity: "high",
        entity_type: "event",
        entity_id: ev.id,
        action_path: `/events/${ev.id}`,
        payload: { ...attendanceEventPayload },
        dedupe_key: `attendance_missed_${ev.id}`,
        dedupe_window_minutes: 120,
      });
    }
  }
}

async function runTaskAutomation(now: Date): Promise<void> {
  const nowMs = now.getTime();
  const lookbackIso = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: tasks } = await supabaseAdmin
    .from("member_tasks")
    .select("id, organization_id, branch_id, member_id, title, due_at, status, assignee_profile_id, assignee_profile_ids, created_at")
    .in("status", ["pending", "in_progress"])
    .gte("due_at", lookbackIso)
    .limit(1500);
  const list = (tasks || []) as Array<{
    id: string;
    organization_id: string;
    branch_id: string | null;
    member_id?: string | null;
    title?: string | null;
    due_at?: string | null;
    status?: string | null;
    assignee_profile_id?: string | null;
    assignee_profile_ids?: string[] | null;
    created_at?: string | null;
  }>;
  const timezoneByBranchCache = new Map<string, string>();
  const branchTimezone = async (organizationId: string, branchId: string | null): Promise<string> => {
    const key = `${organizationId}:${branchId || "default"}`;
    const cached = timezoneByBranchCache.get(key);
    if (cached) return cached;
    const cfg = await branchImportantDateConfig(organizationId, branchId);
    timezoneByBranchCache.set(key, cfg.timezone);
    return cfg.timezone;
  };
  for (const t of list) {
    let assigneeIds = assigneeProfileIdsFromMemberTaskRow(t as MemberTaskRow);
    if (!isUuidString(t.id) || assigneeIds.length === 0) continue;
    const taskCreatedMs = t.created_at ? new Date(String(t.created_at)).getTime() : Number.NaN;
    if (Number.isFinite(taskCreatedMs)) {
      const pcT = await mapProfileCreatedAtMsById(assigneeIds);
      assigneeIds = filterRecipientsProfileCreatedNotAfterEntity(assigneeIds, pcT, taskCreatedMs);
    }
    if (assigneeIds.length === 0) continue;
    const dueMs = new Date(String(t.due_at || "")).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const dueInMs = dueMs - nowMs;
    const taskTimezone = await branchTimezone(String(t.organization_id), t.branch_id ?? null);
    const todayYmd = ymdInTimezone(now, taskTimezone);
    const dueYmd = ymdInTimezone(new Date(dueMs), taskTimezone);
    const dueInDays = ymdDiffDays(todayYmd, dueYmd);
    const taskMemberId = String(t.member_id || "");
    const memberPath =
      taskMemberId && isUuidString(taskMemberId) ? `/members/${taskMemberId}` : "/tasks";
    const taskTitleStr = String(t.title || "Untitled task").trim() || "Task";
    const taskPayloadBase: Record<string, unknown> = {
      task_id: t.id,
      task_title: taskTitleStr,
      ...(taskMemberId && isUuidString(taskMemberId) ? { member_id: taskMemberId } : {}),
    };
    if (taskMemberId && isUuidString(taskMemberId)) {
      Object.assign(taskPayloadBase, await fetchMemberRichFieldsForPayload(taskMemberId, String(t.organization_id)));
    }
    if (dueInDays === 1 && dueInMs > 0) {
      await createNotificationsForRecipients(assigneeIds, {
        organization_id: String(t.organization_id),
        branch_id: t.branch_id ?? null,
        type: "task_pending_reminder",
        category: "tasks",
        title: "Task due in 24 hours",
        message: `Task "${String(t.title || "Untitled task")}" is due soon.`,
        severity: "medium",
        entity_type: "member_task",
        entity_id: t.id,
        action_path: memberPath,
        payload: { ...taskPayloadBase },
        dedupe_key: `task_due_24h_${t.id}`,
        dedupe_window_minutes: 60 * 24,
      });
    }
    if (dueInDays < 0) {
      await createNotificationsForRecipients(assigneeIds, {
        organization_id: String(t.organization_id),
        branch_id: t.branch_id ?? null,
        type: "task_overdue",
        category: "tasks",
        title: "Task overdue",
        message: `Task "${String(t.title || "Untitled task")}" is overdue. Please take action.`,
        severity: "high",
        entity_type: "member_task",
        entity_id: t.id,
        action_path: memberPath,
        payload: { ...taskPayloadBase },
        dedupe_key: `task_overdue_${t.id}`,
        dedupe_window_minutes: 60 * 24 * 7,
      });
    }
  }
}

async function runMemberCareAutomation(now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (nowMs - lastMemberCareRunMs < 6 * 60 * 60 * 1000) return;
  lastMemberCareRunMs = nowMs;
  const memberMinAgeMs = MEMBER_CARE_NEW_MEMBER_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const attendanceLookback = new Date(nowMs - 120 * 24 * 60 * 60 * 1000).toISOString();
  const { data: presentRows } = await supabaseAdmin
    .from("event_attendance")
    .select("member_id, updated_at")
    .eq("status", "present")
    .gte("updated_at", attendanceLookback)
    .order("updated_at", { ascending: false })
    .limit(20000);
  const lastPresentByMember = new Map<string, number>();
  for (const row of (presentRows || []) as Array<{ member_id?: string; updated_at?: string }>) {
    const memberId = String(row.member_id || "");
    const whenMs = new Date(String(row.updated_at || "")).getTime();
    if (!isUuidString(memberId) || !Number.isFinite(whenMs)) continue;
    if (!lastPresentByMember.has(memberId)) lastPresentByMember.set(memberId, whenMs);
  }

  const { data: members } = await supabaseAdmin
    .from("members")
    .select("id, organization_id, branch_id, first_name, last_name, is_deleted, created_at, memberimage_url")
    .eq("is_deleted", false)
    .limit(4000);
  const list = (members || []) as Array<{
    id: string;
    organization_id: string;
    branch_id: string | null;
    first_name?: string | null;
    last_name?: string | null;
    is_deleted?: boolean;
    created_at?: string | null;
    memberimage_url?: string | null;
  }>;
  for (const m of list) {
    if (!isUuidString(m.id) || !isUuidString(String(m.organization_id || "")) || !isUuidString(String(m.branch_id || ""))) continue;
    const memberCreatedMs = m.created_at ? new Date(String(m.created_at)).getTime() : Number.NaN;
    if (Number.isFinite(memberCreatedMs) && nowMs - memberCreatedMs < memberMinAgeMs) continue;
    const lastPresentMs = lastPresentByMember.get(m.id);
    if (lastPresentMs && nowMs - lastPresentMs < 14 * 24 * 60 * 60 * 1000) continue;
    let recipients = await profileIdsWithPermission(m.organization_id, m.branch_id, "view_members");
    if (recipients.length === 0) continue;
    if (Number.isFinite(memberCreatedMs)) {
      const pcM = await mapProfileCreatedAtMsById(recipients);
      recipients = filterRecipientsForMemberCareMember(recipients, pcM, memberCreatedMs);
    }
    if (recipients.length === 0) continue;
    const fullName = `${String(m.first_name || "")} ${String(m.last_name || "")}`.trim() || "This member";
    const memImg = String(m.memberimage_url || "").trim();
    await createNotificationsForRecipients(recipients, {
      organization_id: m.organization_id,
      branch_id: m.branch_id,
      type: "low_attendance_alert",
      category: "member_care",
      title: "Member needs follow-up",
      message: `${fullName} has not attended for a while. Please check up.`,
      severity: "high",
      entity_type: "member",
      entity_id: m.id,
      action_path: `/members/${m.id}`,
      payload: {
        openMemberId: m.id,
        member_id: m.id,
        member_display_name: fullName,
        ...(memImg ? { member_image_url: memImg } : {}),
      },
      dedupe_key: `low_attendance_${m.id}`,
      dedupe_window_minutes: 60 * 24 * 14,
    });
  }
}

async function runImportantDatesAutomation(now: Date): Promise<void> {
  const nowMs = now.getTime();
  if (nowMs - lastImportantDatesRunMs < 5 * 60 * 1000) return;
  lastImportantDatesRunMs = nowMs;

  const { data: branches } = await supabaseAdmin
    .from("branches")
    .select("id, organization_id, timezone, important_dates_default_reminder_time");
  const branchRows = (branches || []) as Array<{
    id?: string;
    organization_id?: string;
    timezone?: string | null;
    important_dates_default_reminder_time?: string | null;
  }>;

  for (const b of branchRows) {
    const branchId = String(b.id || "");
    const orgId = String(b.organization_id || "");
    if (!isUuidString(branchId) || !isUuidString(orgId)) continue;

    const cfg = await branchImportantDateConfig(orgId, branchId);
    const localYmd = ymdInTimezone(now, cfg.timezone);
    const localHms = hmsInTimezone(now, cfg.timezone);
    if (localHms < cfg.reminderTime) continue;

    const { data: members } = await supabaseAdmin
      .from("members")
      .select("id, first_name, last_name, memberimage_url, dob")
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .or("is_deleted.eq.false,is_deleted.is.null");
    const memberRows = (members || []) as Array<{
      id: string;
      first_name?: string | null;
      last_name?: string | null;
      memberimage_url?: string | null;
      dob?: string | null;
    }>;
    if (memberRows.length === 0) continue;
    const memberById = new Map<string, (typeof memberRows)[number]>();
    for (const m of memberRows) memberById.set(String(m.id), m);

    const { data: importantRows } = await supabaseAdmin
      .from("member_important_dates")
      .select("id, member_id, title, description, date_value, date_type, is_recurring_yearly, reminder_offsets, default_alert_enabled")
      .eq("organization_id", orgId)
      .eq("branch_id", branchId);

    const notifications: Array<{
      memberId: string;
      dateType: "birthday" | "anniversary" | "custom";
      title: string;
      description: string | null;
      occursOn: string;
      offset: string;
      defaultAlert: boolean;
    }> = [];

    for (const row of (importantRows || []) as Array<{
      member_id?: string | null;
      title?: string | null;
      description?: string | null;
      date_value?: string | null;
      date_type?: "birthday" | "anniversary" | "custom" | null;
      is_recurring_yearly?: boolean | null;
      reminder_offsets?: string[] | null;
      default_alert_enabled?: boolean | null;
    }>) {
      const memberId = String(row.member_id || "");
      if (!isUuidString(memberId) || !memberById.has(memberId)) continue;
      const dateType = (row.date_type || "custom") as "birthday" | "anniversary" | "custom";
      const occursOn = nextOccurrenceYmd(
        String(row.date_value || ""),
        row.is_recurring_yearly === true,
        localYmd,
      );
      if (!occursOn) continue;
      const offsets = normalizeImportantReminderOffsets(row.reminder_offsets);
      if (dateType === "birthday" && row.default_alert_enabled !== false && !offsets.includes("day_morning")) {
        offsets.push("day_morning");
      }
      for (const offset of offsets) {
        if (reminderTargetDateYmd(occursOn, offset) !== localYmd) continue;
        notifications.push({
          memberId,
          dateType,
          title:
            String(row.title || "").trim() ||
            (dateType === "birthday" ? "Birthday" : "Important Date"),
          description: row.description || null,
          occursOn,
          offset,
          defaultAlert: row.default_alert_enabled === true,
        });
      }
    }

    // Birthday defaults from member DOB even when no row exists.
    for (const m of memberRows) {
      const dob = normalizeImportantDateInput(m.dob);
      if (!dob) continue;
      const occursOn = nextOccurrenceYmd(dob, true, localYmd);
      if (!occursOn || occursOn !== localYmd) continue;
      notifications.push({
        memberId: m.id,
        dateType: "birthday",
        title: "Birthday",
        description: null,
        occursOn,
        offset: "day_morning",
        defaultAlert: true,
      });
    }

    for (const n of notifications) {
      const m = memberById.get(n.memberId);
      if (!m) continue;
      const recipients = await resolveImportantDateRecipients(orgId, branchId, n.memberId);
      if (recipients.length === 0) continue;
      const memberDisplay =
        `${String(m.first_name || "").trim()} ${String(m.last_name || "").trim()}`.trim() || "Member";
      const dedupeKey = `important_date:${n.memberId}:${n.occursOn}:${n.offset}:${n.dateType}`;
      await createNotificationsForRecipients(recipients, {
        organization_id: orgId,
        branch_id: branchId,
        type: "important_date_reminder",
        category: "member_care",
        title: n.dateType === "birthday" ? "Birthday reminder" : "Important date reminder",
        message:
          n.dateType === "birthday"
            ? `${memberDisplay} has a birthday today.`
            : `${memberDisplay}: ${n.title} is coming up (${n.occursOn}).`,
        severity: "medium",
        entity_type: "member",
        entity_id: n.memberId,
        action_path: `/members/${n.memberId}`,
        payload: {
          member_id: n.memberId,
          openMemberId: n.memberId,
          member_display_name: memberDisplay,
          important_date_type: n.dateType,
          important_date_title: n.title,
          important_date_occurs_on: n.occursOn,
          reminder_offset: n.offset,
          default_alert_enabled: n.defaultAlert,
          ...(m.memberimage_url ? { member_image_url: m.memberimage_url } : {}),
        },
        dedupe_key: dedupeKey,
        dedupe_window_minutes: 60 * 24,
      });
    }
  }
}

async function runAutomatedNotificationJobs(): Promise<void> {
  if (notificationsJobRunning) return;
  notificationsJobRunning = true;
  try {
    const now = new Date();
    await runAttendanceAutomation(now);
    await runTaskAutomation(now);
    await runMemberCareAutomation(now);
    await runImportantDatesAutomation(now);
  } catch (e) {
    console.warn("[notifications-job] error:", e);
  } finally {
    notificationsJobRunning = false;
  }
}

/**
 * Keep API errors JSON-only even for unknown endpoints.
 * This prevents HTML/text fallback bodies that break `res.json()` callers in the web UI.
 */
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

async function startServer() {
  const mig = await runCustomFieldsMigrationFromEnv();
  if (mig.skipped) {
    console.log(`[custom-fields] ${mig.message}`);
  } else if (mig.ok) {
    console.log(`[custom-fields] ${mig.message}`);
  } else {
    console.warn(`[custom-fields] ${mig.message}`);
  }

  if (process.env.NODE_ENV !== "production") {
    /** Single HTTP server so Vite HMR reuses port ${PORT} instead of a separate WS port (e.g. 24678), avoiding EADDRINUSE when another dev server is running. */
    const httpServer = http.createServer(app);
    /**
     * Vite `middlewareMode` does not reliably apply SPA HTML fallback; without these rewrites, routes like
     * `/cms` or hard-refreshes on client routes can return an empty document (blank page).
     * - `/` and unknown non-asset GETs → marketing shell (`index.html`)
     * - `/cms` and `/cms/*` → main app shell (`app.html`)
     */
    app.use((req, _res, next) => {
      if (req.method !== "GET") return next();
      const p = req.path || "/";
      const raw = req.url || "/";
      const q = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";

      if (
        p.startsWith("/@") ||
        p.startsWith("/__vite") ||
        p.startsWith("/node_modules/") ||
        p.startsWith("/src/") ||
        p.startsWith("/@fs") ||
        p.startsWith("/@id") ||
        p.startsWith("/.well-known")
      ) {
        return next();
      }

      if (
        /\.(js|mjs|ts|tsx|jsx|css|map|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|txt|csv|html|vue|svelte)$/i.test(
          p,
        )
      ) {
        return next();
      }

      if (p === "/cms" || p.startsWith("/cms/")) {
        req.url = `/app.html${q}`;
        return next();
      }

      req.url = `/index.html${q}`;
      return next();
    });
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    /**
     * Do not pass `/api/*` through Vite — unmatched API paths should 404, not return the SPA shell
     * (which can look like a blank page in the browser when opened directly).
     */
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      return vite.middlewares(req, res, next);
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] dev http://localhost:${PORT}`);
    });
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[server] Port ${PORT} is already in use. Stop the other process or set PORT=3001 in .env and restart.`,
        );
      } else {
        console.error("[server] listen error:", err);
      }
      process.exit(1);
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexPath = path.join(distPath, "index.html");
    const appPath = path.join(distPath, "app.html");
    /** `/cms` and `/cms/*` must serve the CMS shell before `express.static` would otherwise miss. */
    app.get(["/cms", "/cms/*"], (_req, res, next) => {
      res.sendFile(appPath, (err) => {
        if (err) next();
      });
    });
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(indexPath);
    });

    const httpServer = http.createServer(app);
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] production http://localhost:${PORT}`);
    });
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[server] Port ${PORT} is already in use.`);
      } else {
        console.error("[server] listen error:", err);
      }
      process.exit(1);
    });
  }

  void runAutomatedNotificationJobs();
  setInterval(() => {
    void runAutomatedNotificationJobs();
  }, 60 * 1000);
}

export { app };

const isServerlessRuntime = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
);

if (!isServerlessRuntime) {
  startServer();
}
