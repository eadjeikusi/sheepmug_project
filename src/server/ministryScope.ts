import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export type MinistryScopeResult =
  | { kind: "bypass" }
  | { kind: "branch_all" }
  | { kind: "groups"; allowedGroupIds: Set<string> };

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

async function loadGroupTreeRowsForBranch(
  sb: SupabaseClient,
  organizationId: string,
  branchId: string,
): Promise<{ id: string; parent_group_id: string | null }[]> {
  const { data, error } = await sb
    .from("groups")
    .select("id, parent_group_id")
    .eq("organization_id", organizationId)
    .eq("branch_id", branchId)
    .or("is_deleted.eq.false,is_deleted.is.null");
  if (error) throw error;
  return (data || []) as { id: string; parent_group_id: string | null }[];
}

/**
 * Who can see which ministries/members/tasks/events for this user in this branch.
 * - bypass: org owner or super admin (full branch as today).
 * - branch_all: no profile_ministry_scope rows (backward compat), or assigned "All Members" system group.
 * - groups: explicit assignments expanded to descendants (subgroups inherit).
 */
export async function resolveMinistryScope(
  sb: SupabaseClient,
  userId: string,
  orgId: string,
  viewerBranch: string,
  isOrgOwner: boolean,
): Promise<MinistryScopeResult> {
  if (isOrgOwner) return { kind: "bypass" };

  let superAdmin = false;
  try {
    const { data: prof } = await sb.from("profiles").select("is_super_admin").eq("id", userId).maybeSingle();
    if (prof && (prof as { is_super_admin?: boolean }).is_super_admin === true) superAdmin = true;
  } catch {
    /* column missing */
  }
  if (superAdmin) return { kind: "bypass" };

  let scopeRows: { group_id: string }[] = [];
  try {
    const { data, error } = await sb.from("profile_ministry_scope").select("group_id").eq("profile_id", userId);
    if (error) {
      const m = String(error.message || "").toLowerCase();
      if (m.includes("profile_ministry_scope") || m.includes("42p01") || m.includes("does not exist")) {
        return { kind: "branch_all" };
      }
      throw error;
    }
    scopeRows = (data || []) as { group_id: string }[];
  } catch {
    return { kind: "branch_all" };
  }

  if (scopeRows.length === 0) return { kind: "branch_all" };

  const rawIds = [...new Set(scopeRows.map((r) => r.group_id).filter(Boolean))];
  const { data: gRows, error: gErr } = await sb
    .from("groups")
    .select("id, system_kind, branch_id, organization_id")
    .in("id", rawIds)
    .eq("organization_id", orgId);
  if (gErr) throw gErr;

  for (const g of gRows || []) {
    const row = g as { system_kind?: string | null; branch_id?: string | null };
    if (row.system_kind === "all_members" && String(row.branch_id || "") === viewerBranch) {
      return { kind: "branch_all" };
    }
  }

  const treeRows = await loadGroupTreeRowsForBranch(sb, orgId, viewerBranch);
  const validRoots = rawIds.filter((id) => {
    const gr = (gRows || []).find((x) => (x as { id: string }).id === id);
    if (!gr) return false;
    const sk = (gr as { system_kind?: string | null }).system_kind;
    if (sk === "all_members") return false;
    const bid = (gr as { branch_id?: string | null }).branch_id;
    return String(bid || "") === viewerBranch;
  });
  if (validRoots.length === 0) return { kind: "groups", allowedGroupIds: new Set() };

  const expanded = expandGroupIdsWithDescendants(treeRows, validRoots);
  return { kind: "groups", allowedGroupIds: new Set(expanded) };
}

/** Member ids that appear in group_members for at least one allowed group (branch + org). Null = all members in branch. */
export async function memberIdsVisibleUnderScope(
  sb: SupabaseClient,
  orgId: string,
  viewerBranch: string,
  scope: MinistryScopeResult,
): Promise<Set<string> | null> {
  if (scope.kind === "bypass" || scope.kind === "branch_all") return null;

  const ids = [...scope.allowedGroupIds];
  if (ids.length === 0) return new Set();

  const { data, error } = await sb
    .from("group_members")
    .select("member_id")
    .eq("organization_id", orgId)
    .in("group_id", ids);
  if (error) throw error;

  const { data: memRows } = await sb
    .from("members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("branch_id", viewerBranch);

  const branchMember = new Set((memRows || []).map((m) => (m as { id: string }).id));

  const out = new Set<string>();
  for (const r of data || []) {
    const mid = (r as { member_id?: string }).member_id;
    if (mid && branchMember.has(mid)) out.add(mid);
  }
  return out;
}

export function groupIdVisibleUnderScope(groupId: string, scope: MinistryScopeResult): boolean {
  if (scope.kind === "bypass" || scope.kind === "branch_all") return true;
  return scope.allowedGroupIds.has(groupId);
}

/** Event visible if any linked ministry is allowed, or any explicitly assigned member is in the scoped member set. */
export function eventAudienceVisibleUnderScope(
  scope: MinistryScopeResult,
  eventGroupIds: string[],
  assignedMemberIds: string[],
  visibleMemberIds: Set<string> | null,
): boolean {
  if (scope.kind === "bypass" || scope.kind === "branch_all") return true;
  if (scope.kind !== "groups") return false;
  for (const gid of eventGroupIds) {
    if (scope.allowedGroupIds.has(gid)) return true;
  }
  if (visibleMemberIds && assignedMemberIds.length > 0) {
    for (const mid of assignedMemberIds) {
      if (visibleMemberIds.has(mid)) return true;
    }
  }
  return false;
}

/** After POST branch — idempotent system group row. */
export async function ensureAllMembersGroupForBranch(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<{ id: string } | null> {
  const { data: existing } = await sb
    .from("groups")
    .select("id")
    .eq("branch_id", branchId)
    .eq("system_kind", "all_members")
    .maybeSingle();
  if (existing && (existing as { id: string }).id) {
    return { id: (existing as { id: string }).id };
  }

  const slug = `all-members-${branchId}`;
  const token = crypto.randomBytes(16).toString("hex");
  const row: Record<string, unknown> = {
    organization_id: orgId,
    branch_id: branchId,
    name: "All Members",
    description:
      "System: full-branch visibility for staff assigned here. Do not add members to this group.",
    group_type: "ministry",
    parent_group_id: null,
    public_website_enabled: false,
    join_link_enabled: false,
    public_link_slug: slug,
    join_invite_token: token,
    is_system: true,
    system_kind: "all_members",
    is_deleted: false,
  };

  const { data: ins, error } = await sb.from("groups").insert([row]).select("id").single();
  if (error) {
    const m = String(error.message || "").toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      const { data: again } = await sb
        .from("groups")
        .select("id")
        .eq("branch_id", branchId)
        .eq("system_kind", "all_members")
        .maybeSingle();
      if (again && (again as { id: string }).id) return { id: (again as { id: string }).id };
    }
    console.warn("[ensureAllMembersGroupForBranch]", error.message);
    return null;
  }
  return ins ? { id: (ins as { id: string }).id } : null;
}

export async function getAllMembersGroupIdForBranch(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("groups")
    .select("id")
    .eq("organization_id", orgId)
    .eq("branch_id", branchId)
    .eq("system_kind", "all_members")
    .maybeSingle();
  if (error) return null;
  const id = (data as { id?: string } | null)?.id;
  if (id && id.length > 0) return id;
  const created = await ensureAllMembersGroupForBranch(sb, orgId, branchId);
  return created?.id ?? null;
}

export async function ensureMemberInAllMembersGroup(
  sb: SupabaseClient,
  orgId: string,
  branchId: string,
  memberId: string,
): Promise<void> {
  const allMembersGroupId = await getAllMembersGroupIdForBranch(sb, orgId, branchId);
  if (!allMembersGroupId) return;

  const { data: existing, error: exErr } = await sb
    .from("group_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("group_id", allMembersGroupId)
    .eq("member_id", memberId)
    .maybeSingle();
  if (exErr) return;
  if (existing) return;

  await sb.from("group_members").insert([
    {
      organization_id: orgId,
      branch_id: branchId,
      group_id: allMembersGroupId,
      member_id: memberId,
      role_in_group: "member",
    },
  ]);
}
