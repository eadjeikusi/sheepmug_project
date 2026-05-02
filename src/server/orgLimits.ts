import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveLimit, type OrgLimitRow } from "../app/config/subscriptionPlans";

export type OrgLimitResource = "members" | "groups" | "branches" | "events_month" | "staff";

function startOfUtcMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

export async function fetchOrgLimitRow(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgLimitRow | null> {
  const full = await supabase
    .from("organizations")
    .select(
      "subscription_tier, max_members, max_groups, max_branches, max_events_per_month, max_staff",
    )
    .eq("id", orgId)
    .maybeSingle();
  if (!full.error && full.data) return full.data as OrgLimitRow;
  const tierOnly = await supabase.from("organizations").select("subscription_tier").eq("id", orgId).maybeSingle();
  if (tierOnly.error || !tierOnly.data) return null;
  return tierOnly.data as OrgLimitRow;
}

export async function countMembersForOrg(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .or("is_deleted.eq.false,is_deleted.is.null");
  if (error) return 0;
  return count ?? 0;
}

export async function countGroupsForOrg(supabase: SupabaseClient, orgId: string): Promise<number> {
  const base = () =>
    supabase
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .or("is_deleted.eq.false,is_deleted.is.null");
  let { count, error } = await base().or("is_system.is.null,is_system.eq.false");
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("is_system") || (error as { code?: string }).code === "42703") {
      const fb = await base();
      count = fb.count;
      error = fb.error;
    }
  }
  if (error) return 0;
  return count ?? 0;
}

export async function countBranchesForOrg(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) return 0;
  return count ?? 0;
}

export async function countEventsThisMonthForOrg(
  supabase: SupabaseClient,
  orgId: string,
): Promise<number> {
  const from = startOfUtcMonth();
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("created_at", from);
  if (error) return 0;
  return count ?? 0;
}

export async function countStaffForOrg(supabase: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) return 0;
  return count ?? 0;
}

export async function getOrgUsage(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  members: number;
  groups: number;
  branches: number;
  events_this_month: number;
  staff: number;
}> {
  const [members, groups, branches, events_this_month, staff] = await Promise.all([
    countMembersForOrg(supabase, orgId),
    countGroupsForOrg(supabase, orgId),
    countBranchesForOrg(supabase, orgId),
    countEventsThisMonthForOrg(supabase, orgId),
    countStaffForOrg(supabase, orgId),
  ]);
  return { members, groups, branches, events_this_month, staff };
}

/** Superadmin dashboard: tasks (member + group), distinct group leaders, report runs (optional tables). */
export async function getSuperadminExtendedOrgMetrics(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ tasks: number; leaders: number; reports: number }> {
  const [mt, gt, rr] = await Promise.all([
    supabase
      .from("member_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("group_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("report_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
  ]);
  let tasks = 0;
  if (!mt.error) tasks += mt.count ?? 0;
  if (!gt.error) tasks += gt.count ?? 0;

  let leaders = 0;
  const gl = await supabase.from("groups").select("leader_id").eq("organization_id", orgId).not("leader_id", "is", null);
  if (!gl.error && gl.data) {
    const set = new Set<string>();
    for (const r of gl.data as { leader_id?: string | null }[]) {
      const id = r.leader_id;
      if (id && String(id).length > 0) set.add(String(id));
    }
    leaders = set.size;
  }

  let reports = 0;
  if (!rr.error) reports = rr.count ?? 0;

  return { tasks, leaders, reports };
}

export type SuperadminBranchStats = {
  members: number;
  groups: number;
  events_this_month: number;
  tasks: number;
  leaders: number;
  reports: number;
};

async function countGroupsForBranch(supabase: SupabaseClient, orgId: string, branchId: string): Promise<number> {
  const base = () =>
    supabase
      .from("groups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .or("is_deleted.eq.false,is_deleted.is.null");
  let { count, error } = await base().or("is_system.is.null,is_system.eq.false");
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("is_system") || (error as { code?: string }).code === "42703") {
      const fb = await base();
      count = fb.count;
      error = fb.error;
    }
  }
  if (error) return 0;
  return count ?? 0;
}

export async function getSuperadminBranchStats(
  supabase: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<SuperadminBranchStats> {
  const from = startOfUtcMonth();
  const [mem, grpN, ev, mt, gtask, rr, gl] = await Promise.all([
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .or("is_deleted.eq.false,is_deleted.is.null"),
    countGroupsForBranch(supabase, orgId, branchId),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId)
      .gte("created_at", from),
    supabase
      .from("member_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId),
    supabase
      .from("group_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId),
    supabase
      .from("report_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("branch_id", branchId),
    supabase.from("groups").select("leader_id").eq("organization_id", orgId).eq("branch_id", branchId).not("leader_id", "is", null),
  ]);

  let tasks = 0;
  if (!mt.error) tasks += mt.count ?? 0;
  if (!gtask.error) tasks += gtask.count ?? 0;

  let leaders = 0;
  if (!gl.error && gl.data) {
    const set = new Set<string>();
    for (const r of gl.data as { leader_id?: string | null }[]) {
      const id = r.leader_id;
      if (id) set.add(String(id));
    }
    leaders = set.size;
  }

  return {
    members: mem.error ? 0 : mem.count ?? 0,
    groups: grpN,
    events_this_month: ev.error ? 0 : ev.count ?? 0,
    tasks,
    leaders,
    reports: rr.error ? 0 : rr.count ?? 0,
  };
}

export async function assertOrgLimit(
  supabase: SupabaseClient,
  orgId: string,
  resource: OrgLimitResource,
): Promise<{ ok: true } | { ok: false; message: string; current: number; limit: number }> {
  const row = await fetchOrgLimitRow(supabase, orgId);
  if (!row) {
    return { ok: false, message: "Organization not found", current: 0, limit: 0 };
  }

  const usage = await getOrgUsage(supabase, orgId);
  let current = 0;
  let limit = 0;
  let label = "resource";
  switch (resource) {
    case "members":
      current = usage.members;
      limit = effectiveLimit(row, "max_members");
      label = "Members";
      break;
    case "groups":
      current = usage.groups;
      limit = effectiveLimit(row, "max_groups");
      label = "Ministries/groups";
      break;
    case "branches":
      current = usage.branches;
      limit = effectiveLimit(row, "max_branches");
      label = "Branches";
      break;
    case "events_month":
      current = usage.events_this_month;
      limit = effectiveLimit(row, "max_events_per_month");
      label = "Events this month";
      break;
    case "staff":
      current = usage.staff;
      limit = effectiveLimit(row, "max_staff");
      label = "Staff accounts";
      break;
  }

  if (current >= limit) {
    return {
      ok: false,
      message: `${label} limit reached (${current}/${limit}). Contact your administrator to upgrade your plan.`,
      current,
      limit,
    };
  }
  return { ok: true };
}
