import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  RefreshControl,
  Image,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import {
  ApiError,
  type CustomFieldDefinition,
  type Family,
  type Group,
  type Member,
  type MemberStatusOption,
  type TaskItem,
} from "@sheepmug/shared-api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { DatePickerField } from "../../components/datetime/DatePickerField";
import { HeaderCountTile } from "../../components/FilterResultsSection";
import { FormModalShell } from "../../components/FormModalShell";
import { MemberAddModal } from "../../components/MemberAddModal";
import { MemberJoinQrModal } from "../../components/MemberJoinQrModal";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { api } from "../../lib/api";
import { useBranch } from "../../contexts/BranchContext";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import { colors, radius, sizes, type } from "../../theme";
import { ymdToDueAtIso } from "../../lib/dateTimeFormat";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import { getMemberJoinRegisterUrl } from "../../lib/memberJoinRegisterUrl";

function firstValidImageUri(member: Member): string | null {
  const candidates = [
    member.avatar_url,
    member.member_url,
    member.profileImage as string | null | undefined,
    member.profile_image as string | null | undefined,
    member.memberimage_url as string | null | undefined,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeImageUri(rawUri: string | null): string | null {
  if (!rawUri) return null;
  const trimmed = rawUri.trim();
  if (!trimmed) return null;

  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
  let apiUrl: URL | null = null;
  try {
    if (apiBase) apiUrl = new URL(apiBase);
  } catch {
    apiUrl = null;
  }

  // Relative URL from API
  if (trimmed.startsWith("/")) {
    if (!apiUrl) return trimmed;
    return `${apiUrl.protocol}//${apiUrl.host}${trimmed}`;
  }

  // Protocol-relative URL
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    // iPhone cannot load image from localhost on your PC.
    if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && apiUrl) {
      parsed.protocol = apiUrl.protocol;
      parsed.host = apiUrl.host;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function memberAgeFromDob(member: Member): number | null {
  const raw = (
    (member as { dob?: string | null }).dob ??
    (member as { date_of_birth?: string | null }).date_of_birth ??
    (member as { dateOfBirth?: string | null }).dateOfBirth ??
    null
  ) as string | null;
  const v = String(raw || "").trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

const GROUP_FILTER_ALL_TOKEN = "__all_groups__";
const AGE_FILTER_MIN = 0;
const AGE_FILTER_MAX = 100;
const PAGE_SIZE = 10;

function parseAgeBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < AGE_FILTER_MIN || n > AGE_FILTER_MAX) return null;
  return n;
}

function normalizeAgeRange(minAge: number | null, maxAge: number | null): { min: number | null; max: number | null } {
  if (minAge == null && maxAge == null) return { min: null, max: null };
  if (minAge == null && maxAge != null) return { min: AGE_FILTER_MIN, max: maxAge };
  if (minAge != null && maxAge == null) return { min: minAge, max: AGE_FILTER_MAX };
  const min = minAge as number;
  const max = maxAge as number;
  return min <= max ? { min, max } : { min: max, max: min };
}

function memberMatchesFilters(
  member: Member,
  statuses: Set<string>,
  ageMin: number | null,
  ageMax: number | null,
  pendingOnly: boolean,
  selectedGroupIds: Set<string>,
  memberPendingTaskIds: Set<string>
): boolean {
  const memberStatus = String(member.status || "active").trim().toLowerCase();
  const statusAll = statuses.has("All") || statuses.size === 0;
  if (!statusAll) {
    const includeByStatus = Array.from(statuses).some((s) => s.toLowerCase() === memberStatus);
    if (!includeByStatus) return false;
  }

  const groupsAll = selectedGroupIds.has(GROUP_FILTER_ALL_TOKEN) || selectedGroupIds.size === 0;
  if (!groupsAll) {
    const idsOnly = Array.from(selectedGroupIds).filter((x) => x !== GROUP_FILTER_ALL_TOKEN);
    const groupIds = ((member as { groupIds?: string[] }).groupIds || []).map((x) => String(x));
    const hasMatch = idsOnly.some((gid) => groupIds.includes(gid));
    if (!hasMatch) return false;
  }

  if (ageMin != null || ageMax != null) {
    const age = memberAgeFromDob(member);
    if (age == null) return false;
    if (ageMin != null && age < ageMin) return false;
    if (ageMax != null && age > ageMax) return false;
  }

  if (pendingOnly && !memberPendingTaskIds.has(String(member.id))) return false;
  return true;
}

export default function MembersScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ status?: string }>();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { selectedBranch } = useBranch();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["All"]));
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterAgeMin, setFilterAgeMin] = useState<number | null>(null);
  const [filterAgeMax, setFilterAgeMax] = useState<number | null>(null);
  const [filterPendingOnly, setFilterPendingOnly] = useState(false);
  const [selectedFilterGroupIds, setSelectedFilterGroupIds] = useState<Set<string>>(
    new Set([GROUP_FILTER_ALL_TOKEN])
  );
  const [draftFilterStatus, setDraftFilterStatus] = useState<Set<string>>(new Set(["All"]));
  const [draftAgeMinInput, setDraftAgeMinInput] = useState("");
  const [draftAgeMaxInput, setDraftAgeMaxInput] = useState("");
  const ageRangeAnim = useRef(new Animated.Value(0)).current;
  const [draftFilterPendingOnly, setDraftFilterPendingOnly] = useState(false);
  const [draftSelectedFilterGroupIds, setDraftSelectedFilterGroupIds] = useState<Set<string>>(
    new Set([GROUP_FILTER_ALL_TOKEN])
  );
  const [showAllFilterGroups, setShowAllFilterGroups] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [deletedTrashCount, setDeletedTrashCount] = useState(0);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [memberStatusOptionsForAdd, setMemberStatusOptionsForAdd] = useState<MemberStatusOption[]>([]);
  const [memberFieldDefsForAdd, setMemberFieldDefsForAdd] = useState<CustomFieldDefinition[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignStep, setAssignStep] = useState<"picker" | "details">("picker");
  const [assignType, setAssignType] = useState<"ministries" | "families" | "tasks">("ministries");
  const [expandedMinistryNodes, setExpandedMinistryNodes] = useState<Set<string>>(new Set());
  const [ministrySearchQuery, setMinistrySearchQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedFamilyIds, setSelectedFamilyIds] = useState<Set<string>>(new Set());
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueYmd, setTaskDueYmd] = useState("");
  /** One row per optional to-do line (labels sent as task checklist on create). */
  const [taskChecklistLines, setTaskChecklistLines] = useState<string[]>([""]);
  /** `${groupId}:${memberId}` for members already in each selected group (from GET /api/group-members). */
  const [existingMembershipPairKeys, setExistingMembershipPairKeys] = useState<Set<string>>(() => new Set());
  const [ministryOverlapLoading, setMinistryOverlapLoading] = useState(false);
  const ministrySearchInputRef = useRef<TextInput>(null);
  const [memberPendingTaskIds, setMemberPendingTaskIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [hasMoreMembers, setHasMoreMembers] = useState(true);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);
  const [membersTotalCount, setMembersTotalCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const { members: list, total_count } = await api.members.list({ offset: 0, limit: PAGE_SIZE });
        if (!mounted) return;
        setMembers(list);
        setMembersTotalCount(total_count);
        setHasMoreMembers(list.length === PAGE_SIZE);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [opts, defs, taskRes] = await Promise.all([
        api.memberStatusOptions().catch(() => []),
        api.customFieldDefinitions("member").catch(() => []),
        api.tasks.mine({ status: "all", limit: 100 }).catch(() => ({ tasks: [] as TaskItem[], total_count: 0 })),
      ]);
      if (!mounted) return;
      setMemberStatusOptionsForAdd(opts);
      setMemberFieldDefsForAdd(defs);
      const pendingIds = new Set<string>();
      for (const t of taskRes.tasks as Record<string, unknown>[]) {
        if (String(t.status || "").toLowerCase() !== "pending") continue;
        const mid = t.member_id;
        if (typeof mid === "string" && mid) pendingIds.add(mid);
      }
      setMemberPendingTaskIds(pendingIds);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const raw = routeParams.status;
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (typeof s !== "string" || !s.trim()) return;
    const normalized = s.trim();
    const label = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
    setStatusFilter(new Set([label]));
    setDraftFilterStatus(new Set([label]));
  }, [routeParams.status]);

  useEffect(() => {
    if (!showAssignModal && !filterOpen) return;
    let mounted = true;
    (async () => {
      const [groupRows, familyRows] = await Promise.all([
        api.groups.list({ tree: true, limit: 100 }).catch(() => []),
        showAssignModal ? api.families.list({ branch_id: selectedBranch?.id || undefined, limit: 100 }).catch(() => []) : Promise.resolve([]),
      ]);
      if (!mounted) return;
      setGroups(groupRows);
      if (showAssignModal) setFamilies(familyRows);
    })();
    return () => {
      mounted = false;
    };
  }, [showAssignModal, filterOpen, selectedBranch?.id]);

  useEffect(() => {
    if (!filterOpen) return;
    setDraftFilterStatus(new Set(statusFilter));
    setDraftAgeMinInput(filterAgeMin != null ? String(filterAgeMin) : "");
    setDraftAgeMaxInput(filterAgeMax != null ? String(filterAgeMax) : "");
    setDraftFilterPendingOnly(filterPendingOnly);
    setDraftSelectedFilterGroupIds(new Set(selectedFilterGroupIds));
    setShowAllFilterGroups(false);
  }, [filterOpen, statusFilter, filterAgeMin, filterAgeMax, filterPendingOnly, selectedFilterGroupIds]);

  useEffect(() => {
    const min = parseAgeBound(draftAgeMinInput);
    const max = parseAgeBound(draftAgeMaxInput);
    const active = min != null || max != null;
    Animated.timing(ageRangeAnim, {
      toValue: active ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [draftAgeMinInput, draftAgeMaxInput, ageRangeAnim]);

  const toggleDraftStatus = useCallback((label: string) => {
    setDraftFilterStatus((prev) => {
      if (label === "All") return new Set(["All"]);
      const next = new Set(prev);
      next.delete("All");
      if (next.has(label)) next.delete(label);
      else next.add(label);
      if (next.size === 0) return new Set(["All"]);
      return next;
    });
  }, []);

  const toggleDraftGroup = useCallback((gid: string) => {
    setDraftSelectedFilterGroupIds((prev) => {
      if (gid === GROUP_FILTER_ALL_TOKEN) return new Set([GROUP_FILTER_ALL_TOKEN]);
      const next = new Set(prev);
      next.delete(GROUP_FILTER_ALL_TOKEN);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      if (next.size === 0) return new Set([GROUP_FILTER_ALL_TOKEN]);
      return next;
    });
  }, []);

  const groupHierarchy = useMemo(() => {
    const parentByChild = new Map<string, string>();
    for (const g of groups) {
      const id = String(g.id);
      const parentRaw = (g.parent_group_id ?? g.parent_id ?? null) as string | null;
      if (parentRaw && String(parentRaw).trim()) {
        parentByChild.set(id, String(parentRaw));
      }
    }
    return { parentByChild };
  }, [groups]);

  const disabledGroupIdsByParentSelection = useMemo(() => {
    const selectedNoAll = new Set(
      Array.from(draftSelectedFilterGroupIds).filter((x) => x !== GROUP_FILTER_ALL_TOKEN)
    );
    const disabled = new Set<string>();
    for (const g of groups) {
      const gid = String(g.id);
      if (selectedNoAll.has(gid)) continue;
      let p = groupHierarchy.parentByChild.get(gid);
      while (p) {
        if (selectedNoAll.has(p)) {
          disabled.add(gid);
          break;
        }
        p = groupHierarchy.parentByChild.get(p);
      }
    }
    return disabled;
  }, [draftSelectedFilterGroupIds, groups, groupHierarchy.parentByChild]);

  function parseAgeBound(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > 120) return null;
    return n;
  }

  function normalizeAgeRange(minAge: number | null, maxAge: number | null): { min: number | null; max: number | null } {
    if (minAge == null && maxAge == null) return { min: null, max: null };
    if (minAge == null && maxAge != null) return { min: 0, max: maxAge };
    if (minAge != null && maxAge == null) return { min: minAge, max: 120 };
    const min = minAge as number;
    const max = maxAge as number;
    return min <= max ? { min, max } : { min: max, max: min };
  }

  /** Descendants + parent links for ministry multi-select (parent selects whole subtree). */
  const groupTreeSelection = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    const parentByChildId = new Map<string, string>();
    for (const g of groups) {
      const cid = String(g.id);
      const r = g as Record<string, unknown>;
      const pr = r.parent_group_id ?? r.parent_id;
      const pid = pr != null && String(pr).length > 0 ? String(pr) : null;
      if (pid) {
        parentByChildId.set(cid, pid);
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
        childrenByParent.get(pid)!.push(cid);
      }
    }
    const descendantsByGroupId = new Map<string, string[]>();
    function collect(gid: string): string[] {
      if (descendantsByGroupId.has(gid)) return descendantsByGroupId.get(gid)!;
      const kids = childrenByParent.get(gid) || [];
      const out: string[] = [];
      for (const k of kids) {
        out.push(k, ...collect(k));
      }
      descendantsByGroupId.set(gid, out);
      return out;
    }
    for (const g of groups) collect(String(g.id));
    return { descendantsByGroupId, parentByChildId };
  }, [groups]);

  function toggleMinistryGroupSelection(row: { id: string; hasChildren: boolean }) {
    const id = row.id;
    const desc = groupTreeSelection.descendantsByGroupId.get(id) ?? [];
    if (row.hasChildren) {
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        const on = next.has(id);
        const ids = [id, ...desc];
        if (on) ids.forEach((x) => next.delete(x));
        else ids.forEach((x) => next.add(x));
        return next;
      });
      return;
    }
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      const on = next.has(id);
      if (on) {
        next.delete(id);
        const p = groupTreeSelection.parentByChildId.get(id);
        if (p) next.delete(p);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const statusOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    map.set("all", { label: "All", count: membersTotalCount });
    for (const member of members) {
      const raw = String(member.status || "").trim();
      if (!raw) continue;
      const label = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const key = raw.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        map.set(key, { label: existing.label, count: existing.count + 1 });
      } else {
        map.set(key, { label, count: 1 });
      }
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value }));
  }, [members, membersTotalCount]);

  const statusFilterOptions = useMemo(
    () => ["All", ...statusOptions.filter((x) => x.label !== "All").map((x) => x.label)],
    [statusOptions]
  );

  const ministryTreeRows = useMemo(() => {
    type TreeRow = {
      id: string;
      nodeKey: string;
      name: string;
      subtitle: string;
      /** Lowercased name + subtitle + description + group_type for filtering */
      searchBlob: string;
      depth: number;
      hasChildren: boolean;
      ancestorKeys: string[];
    };
    const byId = new Map<string, Group>();
    for (const g of groups) byId.set(String(g.id), g);

    const childrenByParent = new Map<string, Group[]>();
    const roots: Group[] = [];
    for (const g of groups) {
      const parentRaw = (g.parent_group_id ?? g.parent_id ?? null) as string | null;
      const parentId = parentRaw ? String(parentRaw) : "";
      if (!parentId || !byId.has(parentId)) {
        roots.push(g);
      } else {
        const arr = childrenByParent.get(parentId) || [];
        arr.push(g);
        childrenByParent.set(parentId, arr);
      }
    }

    const sortByName = (a: Group, b: Group) =>
      String(a.name || "").localeCompare(String(b.name || ""));
    roots.sort(sortByName);
    for (const [, arr] of childrenByParent) arr.sort(sortByName);

    const memberCountLabel = (g: Group) => {
      const count = (g.member_count ?? g.members_count ?? null) as number | null;
      if (count != null) return `${count} member${count === 1 ? "" : "s"}`;
      return "";
    };
    const groupTypeLabel = (g: Group) => {
      const gt = String(g.group_type || "ministry").toLowerCase();
      return gt.charAt(0).toUpperCase() + gt.slice(1);
    };

    const flatRows: TreeRow[] = [];
    const walk = (node: Group, depth: number, ancestorKeys: string[]) => {
      const id = String(node.id);
      const nodeKey = `group:${id}`;
      const kids = childrenByParent.get(id) || [];
      const parentId = (node.parent_group_id ?? node.parent_id ?? null) as string | null;
      const parentName = parentId ? String(byId.get(String(parentId))?.name || "") : "";
      const isSubgroup = depth > 0;
      const parts: string[] = [];
      if (isSubgroup) {
        parts.push("Subgroup");
        if (parentName) parts.push(parentName);
      } else {
        parts.push(groupTypeLabel(node));
        parts.push("main group");
      }
      const mc = memberCountLabel(node);
      if (mc) parts.push(mc);
      const nameStr = String(node.name || "Ministry");
      const subtitleStr = parts.join(" · ");
      const descStr = String(node.description ?? "").trim();
      const typeRaw = String(node.group_type ?? "").trim();
      const searchBlob = `${nameStr} ${subtitleStr} ${descStr} ${typeRaw}`.toLowerCase();
      flatRows.push({
        id,
        nodeKey,
        name: nameStr,
        subtitle: subtitleStr,
        searchBlob,
        depth,
        hasChildren: kids.length > 0,
        ancestorKeys,
      });
      for (const child of kids) walk(child, depth + 1, [...ancestorKeys, nodeKey]);
    };
    for (const root of roots) walk(root, 0, []);
    return flatRows;
  }, [groups]);

  const visibleMinistryRows = useMemo(() => {
    const q = ministrySearchQuery.trim().toLowerCase();
    if (!q) {
      return ministryTreeRows.filter(
        (row) => row.depth === 0 || row.ancestorKeys.every((k) => expandedMinistryNodes.has(k))
      );
    }
    const includeKeys = new Set<string>();
    for (const row of ministryTreeRows) {
      if (row.searchBlob.includes(q)) {
        includeKeys.add(row.nodeKey);
        for (const k of row.ancestorKeys) includeKeys.add(k);
      }
    }
    return ministryTreeRows.filter((row) => includeKeys.has(row.nodeKey));
  }, [ministryTreeRows, expandedMinistryNodes, ministrySearchQuery]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (
        !memberMatchesFilters(
          m,
          statusFilter,
          filterAgeMin,
          filterAgeMax,
          filterPendingOnly,
          selectedFilterGroupIds,
          memberPendingTaskIds
        )
      ) {
        return false;
      }
      const full = `${m.first_name || ""} ${m.last_name || ""}`.toLowerCase();
      if (!q) return true;
      return full.includes(q);
    });
  }, [members, query, statusFilter, selectedFilterGroupIds, filterAgeMin, filterAgeMax, filterPendingOnly, memberPendingTaskIds]);

  const liveApplyCount = useMemo(() => {
    const q = query.trim().toLowerCase();
    const draftMin = parseAgeBound(draftAgeMinInput);
    const draftMax = parseAgeBound(draftAgeMaxInput);
    const normalized = normalizeAgeRange(draftMin, draftMax);
    return members.filter((m) => {
      if (
        !memberMatchesFilters(
          m,
          draftFilterStatus,
          normalized.min,
          normalized.max,
          draftFilterPendingOnly,
          draftSelectedFilterGroupIds,
          memberPendingTaskIds
        )
      ) {
        return false;
      }
      if (!q) return true;
      const full = `${m.first_name || ""} ${m.last_name || ""}`.toLowerCase();
      return full.includes(q);
    }).length;
  }, [
    members,
    query,
    draftFilterStatus,
    draftAgeMinInput,
    draftAgeMaxInput,
    draftFilterPendingOnly,
    draftSelectedFilterGroupIds,
    memberPendingTaskIds,
  ]);

  const visibleFilterGroups = useMemo(
    () => (showAllFilterGroups ? groups : groups.slice(0, 8)),
    [groups, showAllFilterGroups]
  );

  const activeFilterLabels = useMemo(() => {
    const labels: Array<{ key: string; label: string }> = [];
    const hasAllStatus = statusFilter.has("All") || statusFilter.size === 0;
    if (!hasAllStatus) {
      Array.from(statusFilter)
        .sort((a, b) => a.localeCompare(b))
        .forEach((s) => labels.push({ key: `status:${s}`, label: s }));
    }
    if (filterAgeMin != null || filterAgeMax != null) {
      labels.push({
        key: "age",
        label: `Age ${filterAgeMin ?? 0}-${filterAgeMax ?? 120}`,
      });
    }
    const groupsAll = selectedFilterGroupIds.has(GROUP_FILTER_ALL_TOKEN) || selectedFilterGroupIds.size === 0;
    if (!groupsAll) {
      const groupById = new Map(groups.map((g) => [String(g.id), String(g.name || "Group")]));
      Array.from(selectedFilterGroupIds)
        .filter((id) => id !== GROUP_FILTER_ALL_TOKEN)
        .sort((a, b) => {
          const an = groupById.get(a) || a;
          const bn = groupById.get(b) || b;
          return an.localeCompare(bn);
        })
        .forEach((gid) => {
          labels.push({ key: `group:${gid}`, label: groupById.get(gid) || "Group" });
        });
    }
    if (filterPendingOnly) labels.push({ key: "pending", label: "Pending tasks" });
    return labels;
  }, [statusFilter, filterAgeMin, filterAgeMax, selectedFilterGroupIds, filterPendingOnly, groups]);

  const hasAppliedFilters = activeFilterLabels.length > 0;

  const headerListCount = useMemo(() => {
    return !hasAppliedFilters && !query.trim() ? membersTotalCount : filtered.length;
  }, [hasAppliedFilters, query, membersTotalCount, filtered.length]);

  const filteredCountLabel = useMemo(() => {
    const n = headerListCount;
    return `${n} result${n === 1 ? "" : "s"}`;
  }, [headerListCount]);

  const clearAppliedFilters = useCallback(() => {
    setStatusFilter(new Set(["All"]));
    setFilterAgeMin(null);
    setFilterAgeMax(null);
    setFilterPendingOnly(false);
    setSelectedFilterGroupIds(new Set([GROUP_FILTER_ALL_TOKEN]));
  }, []);

  const removeFilterByKey = useCallback((key: string) => {
    if (key.startsWith("status:")) {
      const label = key.slice("status:".length);
      setStatusFilter((prev) => {
        const next = new Set(prev);
        next.delete(label);
        if (next.size === 0) return new Set(["All"]);
        return next;
      });
      return;
    }
    if (key === "age") {
      setFilterAgeMin(null);
      setFilterAgeMax(null);
      return;
    }
    if (key.startsWith("group:")) {
      const gid = key.slice("group:".length);
      setSelectedFilterGroupIds((prev) => {
        const next = new Set(Array.from(prev).filter((x) => x !== GROUP_FILTER_ALL_TOKEN));
        next.delete(gid);
        if (next.size === 0) return new Set([GROUP_FILTER_ALL_TOKEN]);
        return next;
      });
      return;
    }
    if (key === "pending") {
      setFilterPendingOnly(false);
    }
  }, []);

  useEffect(() => {
    if (!showAssignModal) {
      setExistingMembershipPairKeys(new Set());
      setMinistryOverlapLoading(false);
      setMinistrySearchQuery("");
    }
  }, [showAssignModal]);

  useEffect(() => {
    if (assignStep === "picker") {
      setMinistrySearchQuery("");
    }
  }, [assignStep]);

  useEffect(() => {
    if (!showAssignModal || assignStep !== "details" || assignType !== "ministries") {
      return;
    }
    const groupIds = Array.from(selectedGroupIds);
    if (groupIds.length === 0) {
      setExistingMembershipPairKeys(new Set());
      return;
    }
    let cancelled = false;
    setMinistryOverlapLoading(true);
    (async () => {
      const results = await Promise.all(groupIds.map((gid) => api.groups.members(gid).catch(() => [])));
      if (cancelled) return;
      const next = new Set<string>();
      for (let i = 0; i < groupIds.length; i++) {
        const gid = groupIds[i];
        const rows = results[i];
        for (const row of rows) {
          const r = row as Record<string, unknown>;
          const mid = r.member_id;
          if (typeof mid === "string" && mid.length > 0) next.add(`${gid}:${mid}`);
        }
      }
      setExistingMembershipPairKeys(next);
      setMinistryOverlapLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [showAssignModal, assignStep, assignType, selectedGroupIds]);

  const ministryOverlapPreview = useMemo(() => {
    const entries: { groupName: string; memberName: string }[] = [];
    const groupById = new Map(groups.map((g) => [String(g.id), g]));
    const memberById = new Map(members.map((m) => [String(m.id), m]));
    for (const gid of selectedGroupIds) {
      for (const mid of selectedMembers) {
        const key = `${gid}:${mid}`;
        if (existingMembershipPairKeys.has(key)) {
          const g = groupById.get(String(gid));
          const m = memberById.get(String(mid));
          const groupName = g?.name || String(gid);
          const memberName =
            m ? `${m.first_name || ""} ${m.last_name || ""}`.trim() || String(mid) : String(mid);
          entries.push({ groupName, memberName });
        }
      }
    }
    return entries;
  }, [existingMembershipPairKeys, selectedGroupIds, selectedMembers, groups, members]);

  const selectedCount = selectedMembers.size;

  const refreshMembers = useCallback(async () => {
    const [listPayload, taskRes] = await Promise.all([
      api.members.list({ offset: 0, limit: PAGE_SIZE }).catch(() => ({ members: [] as Member[], total_count: 0 })),
      api.tasks.mine({ status: "all", limit: 100 }).catch(() => ({ tasks: [] as TaskItem[], total_count: 0 })),
    ]);
    const list = listPayload.members;
    setMembers(list);
    setMembersTotalCount(listPayload.total_count);
    setHasMoreMembers(list.length === PAGE_SIZE);
    const pendingIds = new Set<string>();
    for (const t of taskRes.tasks as Record<string, unknown>[]) {
      if (String(t.status || "").toLowerCase() !== "pending") continue;
      const mid = t.member_id;
      if (typeof mid === "string" && mid) pendingIds.add(mid);
    }
    setMemberPendingTaskIds(pendingIds);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshMembers();
    } finally {
      setRefreshing(false);
    }
  }, [refreshMembers]);

  const loadMoreMembers = useCallback(async () => {
    if (loading || refreshing || loadingMoreMembers || !hasMoreMembers) return;
    setLoadingMoreMembers(true);
    try {
      const { members: next, total_count } = await api.members
        .list({ offset: members.length, limit: PAGE_SIZE })
        .catch(() => ({ members: [] as Member[], total_count: 0 }));
      setMembers((prev) => [...prev, ...next]);
      setMembersTotalCount(total_count);
      setHasMoreMembers(next.length === PAGE_SIZE);
    } finally {
      setLoadingMoreMembers(false);
    }
  }, [hasMoreMembers, loading, loadingMoreMembers, members.length, refreshing]);

  function toggleMemberSelection(memberId: string) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const resetBulkSelection = useCallback(() => {
    setSelectedMembers(new Set());
    setSelectedGroupIds(new Set());
    setSelectedFamilyIds(new Set());
    setShowAssignModal(false);
    setAssignStep("picker");
    setAssignType("ministries");
    setTaskTitle("");
    setTaskDescription("");
    setTaskDueYmd("");
    setTaskChecklistLines([""]);
    setMinistrySearchQuery("");
    setExpandedMinistryNodes(new Set());
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        resetBulkSelection();
      };
    }, [resetBulkSelection])
  );

  useFocusEffect(
    useCallback(() => {
      if (!can("view_deleted_members")) {
        setDeletedTrashCount(0);
        return;
      }
      let cancelled = false;
      void api.members
        .list({ deleted_only: true, limit: 1, offset: 0 })
        .then((r) => {
          if (!cancelled) setDeletedTrashCount(r.total_count);
        })
        .catch(() => {
          if (!cancelled) setDeletedTrashCount(0);
        });
      return () => {
        cancelled = true;
      };
    }, [can])
  );

  async function handleAssignSelected() {
    if (selectedCount === 0) return;
    const memberIds = Array.from(selectedMembers);
    /** When exactly one ministry was chosen and assign had no hard errors, open that group’s profile. */
    let navigateToMinistryId: string | null = null;
    setAssigning(true);
    try {
      if (assignType === "ministries") {
        const groupIds = Array.from(selectedGroupIds);
        if (groupIds.length === 0) {
          Alert.alert("Select ministry", "Choose at least one ministry to assign.");
          return;
        }
        let added = 0;
        let skippedAlready = 0;
        let failed = 0;
        for (const groupId of groupIds) {
          const memberIdsForGroup = memberIds.filter((mid) => {
            const pairKey = `${groupId}:${mid}`;
            return !existingMembershipPairKeys.has(pairKey);
          });
          skippedAlready += memberIds.length - memberIdsForGroup.length;
          if (memberIdsForGroup.length === 0) continue;
          try {
            const res = await api.members.assignToGroupBulk({
              group_id: groupId,
              member_ids: memberIdsForGroup,
              role_in_group: "member",
            });
            added += res.inserted_count ?? res.added?.length ?? 0;
            const skipCount =
              res.skipped?.filter((s) => s.reason === "already_in_group").length ?? 0;
            skippedAlready += skipCount;
          } catch (error: unknown) {
            const det = error instanceof ApiError ? error.details : null;
            const payloadCode =
              typeof det === "object" && det !== null && "code" in det
                ? (det as { code?: string }).code
                : undefined;
            const isAlready =
              error instanceof ApiError &&
              (error.status === 409 || payloadCode === "ALREADY_GROUP_MEMBER");
            if (isAlready) {
              skippedAlready += memberIdsForGroup.length;
            } else {
              failed += 1;
            }
          }
        }
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} membership${added === 1 ? "" : "s"} added`);
        if (skippedAlready > 0) {
          parts.push(
            `${skippedAlready} skipped (already in group${skippedAlready === 1 ? "" : "s"})`
          );
        }
        if (failed > 0) parts.push(`${failed} failed`);
        Alert.alert("Assignment complete", parts.length > 0 ? `${parts.join(". ")}.` : "No changes.");
        if (groupIds.length === 1 && failed === 0) {
          navigateToMinistryId = groupIds[0];
        }
      }

      if (assignType === "families") {
        const familyIds = Array.from(selectedFamilyIds);
        if (familyIds.length === 0) {
          Alert.alert("Select family", "Choose at least one family group to assign.");
          return;
        }
        let failed = 0;
        for (const memberId of memberIds) {
          for (const familyId of familyIds) {
            try {
              await api.members.assignToFamily(memberId, familyId);
            } catch {
              failed += 1;
            }
          }
        }
        Alert.alert(
          "Assignment complete",
          failed > 0
            ? `${memberIds.length} member(s) processed with ${failed} failed operation(s).`
            : `${memberIds.length} member(s) assigned to selected family groups.`
        );
      }

      if (assignType === "tasks") {
        if (!can("manage_member_tasks")) {
          Alert.alert("Permission denied", "You do not have permission to assign member tasks.");
          return;
        }
        const title = taskTitle.trim();
        if (!title) {
          Alert.alert("Task title required", "Enter a task title before assigning.");
          return;
        }
        if (!user?.id) {
          Alert.alert("User not ready", "Please re-login and try again.");
          return;
        }
        try {
          const primaryId = memberIds[0];
          const related = memberIds.length > 1 ? memberIds.slice(1) : undefined;
          const checklist = taskChecklistLines
            .map((s) => s.trim())
            .filter(Boolean)
            .map((label) => ({ label, done: false as const }));
          await api.members.createTask(primaryId, {
            title,
            description: taskDescription.trim() || undefined,
            assignee_profile_id: user.id,
            due_at: ymdToDueAtIso(taskDueYmd),
            ...(related && related.length > 0 ? { related_member_ids: related } : {}),
            ...(checklist.length > 0 ? { checklist } : {}),
          });
          Alert.alert(
            "Task assignment complete",
            memberIds.length > 1
              ? `One task assigned linking ${memberIds.length} members.`
              : "Task assigned to 1 member."
          );
        } catch (e: unknown) {
          const msg =
            e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not assign task";
          Alert.alert("Task assignment", msg);
          return;
        }
      }

      resetBulkSelection();
      const { members: list, total_count } = await api.members
        .list({ offset: 0, limit: PAGE_SIZE })
        .catch(() => ({ members: [] as Member[], total_count: 0 }));
      setMembers(list);
      setMembersTotalCount(total_count);
      setHasMoreMembers(list.length === PAGE_SIZE);

      if (navigateToMinistryId) {
        router.push(`/ministry/${encodeURIComponent(navigateToMinistryId)}`);
      }
    } finally {
      setAssigning(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Members</Text>
              <HeaderCountTile count={headerListCount} accessibilityLabel={filteredCountLabel} />
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.iconButton, showSearch && styles.iconButtonActive]}
              onPress={() => {
                if (showSearch) {
                  setShowSearch(false);
                  setQuery("");
                  return;
                }
                resetBulkSelection();
                setShowSearch(true);
              }}
            >
              <Ionicons
                name={showSearch ? "close-outline" : "search-outline"}
                size={sizes.headerIcon}
                color={colors.textPrimary}
              />
            </Pressable>
            <Pressable
              style={[styles.iconButton, hasAppliedFilters && styles.iconButtonActive]}
              onPress={() => setFilterOpen(true)}
            >
              <Ionicons
                name={hasAppliedFilters ? "filter" : "filter-outline"}
                size={sizes.headerIcon}
                color={hasAppliedFilters ? colors.accent : colors.textPrimary}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Member list options"
              style={styles.iconButton}
              onPress={() => {
                resetBulkSelection();
                setHeaderMenuOpen(true);
              }}
            >
              <Ionicons name="ellipsis-vertical" size={sizes.headerIcon} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>
        {showSearch && (
          <View style={styles.searchRow}>
            <TextInput
              placeholder="Filter results by name"
              value={query}
              onChangeText={setQuery}
              style={styles.input}
              returnKeyType="search"
            />
            <Pressable
              style={styles.searchAction}
              onPress={() => setQuery((v) => v.trim())}
            >
              <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textPrimary} />
            </Pressable>
          </View>
        )}
        <View style={styles.filtersBlock}>
          {hasAppliedFilters ? (
            <View style={styles.filtersChipSection}>
              <Text style={styles.filtersSectionTitle}>Filter results</Text>
              <View style={styles.filterChipsWrap}>
                {activeFilterLabels.map((chip) => (
                  <View key={chip.key} style={[styles.filterChip, styles.filterChipActive]}>
                    <Pressable
                      onPress={() => setFilterOpen(true)}
                      style={styles.filterChipLabelPress}
                    >
                      <Text style={[styles.filterChipText, styles.filterChipTextActive]} numberOfLines={2}>
                        {chip.label}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Remove filter ${chip.label}`}
                      onPress={() => removeFilterByKey(chip.key)}
                      style={styles.filterChipRemoveBtn}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 6 }}
                    >
                      <Ionicons name="close" size={14} color={colors.accent} />
                    </Pressable>
                  </View>
                ))}
                <Pressable style={[styles.filterChip, styles.filterChipMuted]} onPress={clearAppliedFilters}>
                  <Ionicons name="close" size={13} color={colors.accent} />
                  <Text style={[styles.filterChipText, styles.filterChipTextMuted, styles.filterChipClearText]}>
                    Clear all
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {loading ? (
          <Text style={styles.helper}>Loading members...</Text>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
            onEndReached={() => void loadMoreMembers()}
            onEndReachedThreshold={0.35}
            contentContainerStyle={[
              styles.listContent,
              selectedCount > 0 && styles.listContentWithStickyAssign,
            ]}
            renderItem={({ item }) => {
              const imageUri = normalizeImageUri(firstValidImageUri(item));
              const selected = selectedMembers.has(item.id);
              return (
                <Pressable
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => {
                    if (selectedCount > 0) {
                      toggleMemberSelection(item.id);
                      return;
                    }
                    router.push({
                      pathname: "/member/[id]",
                      params: { id: item.id },
                    });
                  }}
                  onLongPress={() => toggleMemberSelection(item.id)}
                >
                  <View style={styles.rowTop}>
                    {imageUri ? (
                      <Image source={{ uri: imageUri }} style={styles.avatarImage} />
                    ) : (
                      <MemberInitialAvatar initial={item.first_name?.[0] || "M"} size={40} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>
                        {displayMemberWords(
                          `${item.first_name || ""} ${item.last_name || ""}`.trim()
                        )}
                      </Text>
                      <Text style={styles.meta}>
                        {displayMemberWords(
                          String(item.status || "active").replace(/_/g, " ")
                        )}
                      </Text>
                    </View>
                    {selectedCount > 0 ? (
                      <View style={[styles.selectCircle, selected && styles.selectCircleActive]}>
                        {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.helper}>No members found</Text>}
            ListFooterComponent={
              loadingMoreMembers ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null
            }
          />
        )}
      </View>

      {selectedCount > 0 && (
        <View style={styles.assignStickyBar}>
          <View style={styles.assignStickyLeft}>
            <Text style={styles.assignStickyText}>{selectedCount} member(s) selected</Text>
            {(selectedGroupIds.size > 0 || selectedFamilyIds.size > 0) && (
              <Text style={styles.assignStickySubtext}>
                {[
                  selectedGroupIds.size > 0 ? `${selectedGroupIds.size} group(s)` : null,
                  selectedFamilyIds.size > 0 ? `${selectedFamilyIds.size} family` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>
          <View style={styles.assignStickyActions}>
            <Pressable
              style={styles.assignStickyClearBtn}
              onPress={() => resetBulkSelection()}
              accessibilityLabel="Clear selection"
            >
              <Text style={styles.assignStickyClearText}>Clear</Text>
            </Pressable>
            <Pressable
              style={styles.assignStickyBtn}
              onPress={() => {
                setAssignStep("picker");
                setShowAssignModal(true);
              }}
            >
              <Text style={styles.assignStickyBtnText}>Assign</Text>
            </Pressable>
          </View>
        </View>
      )}

      <MemberJoinQrModal visible={showQrModal} onClose={() => setShowQrModal(false)} />

      <Modal
        visible={headerMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHeaderMenuOpen(false)}
      >
        <View style={styles.headerMenuRoot}>
          <Pressable style={styles.headerMenuBackdrop} onPress={() => setHeaderMenuOpen(false)} />
          <View style={styles.headerMenuCard} pointerEvents="box-none">
            {can("add_members") ? (
              <Pressable
                style={styles.headerMenuRow}
                onPress={() => {
                  setHeaderMenuOpen(false);
                  resetBulkSelection();
                  setShowAddMemberModal(true);
                }}
              >
                <Ionicons name="person-add-outline" size={22} color={colors.textPrimary} />
                <Text style={styles.headerMenuRowText}>Add member</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.headerMenuRow}
              onPress={() => {
                setHeaderMenuOpen(false);
                if (!getMemberJoinRegisterUrl(selectedBranch?.id, user?.branch_id)) {
                  Alert.alert("Branch required", "Select a branch first to generate member join QR.");
                  return;
                }
                resetBulkSelection();
                setShowQrModal(true);
              }}
            >
              <Ionicons name="qr-code-outline" size={22} color={colors.textPrimary} />
              <Text style={styles.headerMenuRowText}>Member join QR</Text>
            </Pressable>
            <Pressable
              style={styles.headerMenuRow}
              onPress={() => {
                setHeaderMenuOpen(false);
                router.push("/important-dates");
              }}
            >
              <Ionicons name="calendar-outline" size={22} color={colors.textPrimary} />
              <Text style={styles.headerMenuRowText}>All Important Dates</Text>
            </Pressable>
            {can("view_deleted_members") ? (
              <Pressable
                style={styles.headerMenuRow}
                onPress={() => {
                  setHeaderMenuOpen(false);
                  router.push("/members-deleted");
                }}
              >
                <Ionicons name="archive-outline" size={22} color={colors.textPrimary} />
                <Text style={styles.headerMenuRowText}>Deleted</Text>
                {deletedTrashCount > 0 ? (
                  <View style={styles.headerMenuBadge}>
                    <Text style={styles.headerMenuBadgeText}>
                      {deletedTrashCount > 99 ? "99+" : String(deletedTrashCount)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAssignModal}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setShowAssignModal(false);
          setAssignStep("picker");
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.assignModalCard}>
            {assignStep === "picker" ? (
              <>
                <Text style={styles.assignTitle}>Assign {selectedCount} members</Text>
                <View style={styles.assignTypeRow}>
                  {(["ministries", "families", "tasks"] as const)
                    .filter((typeItem) => typeItem !== "tasks" || can("manage_member_tasks"))
                    .map((typeItem) => {
                    const label =
                      typeItem === "ministries" ? "Ministries" : typeItem === "families" ? "Family" : "Tasks";
                    const iconName =
                      typeItem === "ministries"
                        ? "layers-outline"
                        : typeItem === "families"
                          ? "people-outline"
                          : "checkbox-outline";
                    return (
                      <Pressable
                        key={typeItem}
                        style={[
                          styles.assignTypeChip,
                          typeItem === "ministries"
                            ? styles.assignTypeChipMinistries
                            : typeItem === "families"
                              ? styles.assignTypeChipFamily
                              : styles.assignTypeChipTask,
                        ]}
                        onPress={() => {
                          setAssignType(typeItem);
                          setAssignStep("details");
                        }}
                      >
                        <Ionicons
                          name={iconName}
                          size={22}
                          color={colors.accent}
                        />
                        <Text style={styles.assignTypeChipText}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Pressable
                  style={styles.closeBtn}
                  onPress={() => {
                    setShowAssignModal(false);
                    setAssignStep("picker");
                  }}
                >
                  <Text style={styles.closeBtnText}>Close</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.assignDetailsHeader}>
                  <Pressable style={styles.backBtn} onPress={() => setAssignStep("picker")}>
                    <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
                    <Text style={styles.backBtnText}>Back</Text>
                  </Pressable>
                  <View style={styles.assignHeaderRight}>
                    <Text style={styles.assignSubtitle}>
                      {assignType === "ministries" ? "Assign to ministries" : assignType === "families" ? "Assign to family" : "Assign task"}
                    </Text>
                    {assignType === "ministries" ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Focus ministry search"
                        onPress={() => ministrySearchInputRef.current?.focus()}
                        style={[styles.assignSearchIconBtn, styles.assignSearchIconBtnActive]}
                      >
                        <Ionicons name="search-outline" size={16} color={colors.textPrimary} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {assignType === "ministries" && (
                  <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.assignKeyboardAvoid}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 48 : 0}
                  >
                    <View style={styles.assignContentCard}>
                      {ministryOverlapLoading ? (
                        <ActivityIndicator style={styles.assignOverlapSpinner} color={colors.accent} />
                      ) : null}
                      {ministryOverlapPreview.length > 0 ? (
                        <View style={styles.assignOverlapBox}>
                          <Text style={styles.assignOverlapTitle}>Already in selected groups</Text>
                          <ScrollView
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            style={styles.assignOverlapScroll}
                            contentContainerStyle={styles.assignOverlapScrollContent}
                          >
                            {ministryOverlapPreview.slice(0, 12).map((entry, idx) => (
                              <Text
                                key={`${entry.groupName}-${entry.memberName}-${idx}`}
                                style={styles.assignOverlapLine}
                                numberOfLines={2}
                              >
                                {entry.memberName} — {entry.groupName}
                              </Text>
                            ))}
                          </ScrollView>
                          {ministryOverlapPreview.length > 12 ? (
                            <Text style={styles.assignOverlapMore}>
                              + {ministryOverlapPreview.length - 12} more
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      <View style={styles.assignSearchRow}>
                        <TextInput
                          ref={ministrySearchInputRef}
                          value={ministrySearchQuery}
                          onChangeText={setMinistrySearchQuery}
                          placeholder="Search ministry name"
                          style={[styles.input, styles.assignSearchInput]}
                          returnKeyType="search"
                          clearButtonMode="while-editing"
                          autoCorrect={false}
                          autoCapitalize="none"
                        />
                      </View>
                      <ScrollView
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        style={styles.assignOptionsList}
                        contentContainerStyle={styles.assignOptionsContent}
                      >
                      {visibleMinistryRows.map((row) => {
                        const selected = selectedGroupIds.has(row.id);
                        const expanded = expandedMinistryNodes.has(row.nodeKey);
                        return (
                          <View
                            key={row.nodeKey}
                            style={[styles.assignOptionRow, row.depth === 0 && styles.assignOptionRowMain]}
                          >
                            <Pressable
                              style={styles.assignOptionRowPress}
                              onPress={() => toggleMinistryGroupSelection(row)}
                            >
                              <View style={styles.assignOptionLeft}>
                                <View style={{ width: row.depth * 20 }} />
                                <View style={styles.ministryIconCircle}>
                                  <Ionicons name="people-outline" size={16} color={colors.accent} />
                                </View>
                                <View style={styles.ministryTextWrap}>
                                  <Text
                                    numberOfLines={2}
                                    ellipsizeMode="tail"
                                    style={[styles.assignOptionNameText, row.depth === 0 && styles.assignOptionMainText]}
                                  >
                                    {row.name}
                                  </Text>
                                  <Text
                                    numberOfLines={2}
                                    ellipsizeMode="tail"
                                    style={styles.assignOptionSubtext}
                                  >
                                    {row.subtitle}
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.assignOptionRight}>
                                <View style={[styles.selectCircle, selected && styles.selectCircleActive]}>
                                  {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                                </View>
                              </View>
                            </Pressable>
                            {row.hasChildren ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={expanded ? "Collapse subgroups" : "Expand subgroups"}
                                style={styles.expandChevronBtn}
                                onPress={() =>
                                  setExpandedMinistryNodes((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.nodeKey)) next.delete(row.nodeKey);
                                    else next.add(row.nodeKey);
                                    return next;
                                  })
                                }
                              >
                                <Ionicons
                                  name={expanded ? "chevron-down" : "chevron-forward"}
                                  size={18}
                                  color="#9ca3af"
                                />
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                    </ScrollView>
                    </View>
                  </KeyboardAvoidingView>
                )}

                {assignType === "families" && (
                  <View style={styles.assignContentCard}>
                    <ScrollView style={styles.assignOptionsList} contentContainerStyle={styles.assignOptionsContent}>
                      {families.map((f) => {
                        const selected = selectedFamilyIds.has(f.id);
                        return (
                          <Pressable
                            key={f.id}
                            style={styles.assignOptionRow}
                            onPress={() =>
                              setSelectedFamilyIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(f.id)) next.delete(f.id);
                                else next.add(f.id);
                                return next;
                              })
                            }
                          >
                            <Text style={styles.assignOptionText}>{String(f.family_name || "Family")}</Text>
                            <View style={[styles.selectCircle, selected && styles.selectCircleActive]}>
                              {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                            </View>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {assignType === "tasks" && (
                  <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.assignKeyboardAvoid}
                    keyboardVerticalOffset={Platform.OS === "ios" ? 48 : 0}
                  >
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="on-drag"
                      style={styles.assignTaskScroll}
                      contentContainerStyle={styles.assignTaskScrollContent}
                    >
                      <View style={styles.assignContentCard}>
                        <Text style={styles.assignTaskHint}>
                          Task is assigned to you as staff; selected members are linked to this task.
                        </Text>
                        <View style={styles.taskForm}>
                          <TextInput
                            value={taskTitle}
                            onChangeText={setTaskTitle}
                            placeholder="Task title"
                            placeholderTextColor={colors.textSecondary}
                            style={styles.taskAssignInput}
                          />
                          <TextInput
                            value={taskDescription}
                            onChangeText={setTaskDescription}
                            placeholder="Task description (optional)"
                            placeholderTextColor={colors.textSecondary}
                            style={[styles.taskAssignInput, styles.taskAssignInputMultiline]}
                            multiline
                            textAlignVertical="top"
                          />
                          <Text style={styles.taskDueLabel}>Due date (optional)</Text>
                          <DatePickerField value={taskDueYmd} onChange={setTaskDueYmd} placeholder="Select date" />
                          <Text style={styles.assignTaskChecklistHeading}>To-do items (optional)</Text>
                          <Text style={styles.assignTaskChecklistSub}>
                            Add checklist steps assignees can check off on this task.
                          </Text>
                          {taskChecklistLines.map((line, idx) => (
                            <View key={`todo-${idx}`} style={styles.taskChecklistRow}>
                              <TextInput
                                value={line}
                                onChangeText={(t) => {
                                  setTaskChecklistLines((prev) =>
                                    prev.map((x, j) => (j === idx ? t : x))
                                  );
                                }}
                                placeholder={`To-do ${idx + 1}`}
                                placeholderTextColor={colors.textSecondary}
                                style={[styles.taskAssignInput, styles.taskChecklistLineInput]}
                              />
                              {taskChecklistLines.length > 1 ? (
                                <Pressable
                                  accessibilityLabel={`Remove to-do ${idx + 1}`}
                                  onPress={() =>
                                    setTaskChecklistLines((prev) =>
                                      prev.length <= 1 ? [""] : prev.filter((_, j) => j !== idx)
                                    )
                                  }
                                  style={styles.taskChecklistRemoveBtn}
                                  hitSlop={8}
                                >
                                  <Ionicons name="close-circle" size={22} color="#9ca3af" />
                                </Pressable>
                              ) : null}
                            </View>
                          ))}
                          <Pressable
                            onPress={() => setTaskChecklistLines((prev) => [...prev, ""])}
                            style={styles.taskChecklistAddBtn}
                          >
                            <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                            <Text style={styles.taskChecklistAddText}>Add to-do</Text>
                          </Pressable>
                        </View>
                      </View>
                    </ScrollView>
                  </KeyboardAvoidingView>
                )}

                <Pressable
                  style={[styles.verifyBtn, assigning && { opacity: 0.7 }]}
                  onPress={() => void handleAssignSelected()}
                  disabled={assigning}
                >
                  {assigning ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.verifyBtnText}>Assign selected</Text>
                      <Ionicons name="arrow-forward" size={16} color="#fff" />
                    </>
                  )}
                </Pressable>

                <Pressable
                  style={styles.closeBtn}
                  onPress={() => {
                    setShowAssignModal(false);
                    setAssignStep("picker");
                  }}
                >
                  <Text style={styles.closeBtnText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <MemberAddModal
        visible={showAddMemberModal}
        onClose={() => setShowAddMemberModal(false)}
        memberStatusOptions={memberStatusOptionsForAdd}
        fieldDefs={memberFieldDefsForAdd}
        onCreated={(m) => {
          setMembers((prev) => [m, ...prev]);
          router.push({ pathname: "/member/[id]", params: { id: m.id } });
        }}
      />

      <FormModalShell
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        subtitle="Refine member list"
        variant="compact"
        footer={
          <View style={styles.filterFooter}>
            <Pressable
              style={styles.filterClearBtn}
              onPress={() => {
                setDraftFilterStatus(new Set(["All"]));
                setDraftAgeMinInput("");
                setDraftAgeMaxInput("");
                setDraftFilterPendingOnly(false);
                setDraftSelectedFilterGroupIds(new Set([GROUP_FILTER_ALL_TOKEN]));
                setShowAllFilterGroups(false);
              }}
            >
              <Text style={styles.filterClearBtnText}>Clear</Text>
            </Pressable>
            <Pressable
              style={styles.filterApplyBtn}
              onPress={() => {
                const parsedMin = parseAgeBound(draftAgeMinInput);
                const parsedMax = parseAgeBound(draftAgeMaxInput);
                const normalized = normalizeAgeRange(parsedMin, parsedMax);
                setStatusFilter(new Set(draftFilterStatus));
                setFilterAgeMin(normalized.min);
                setFilterAgeMax(normalized.max);
                setFilterPendingOnly(draftFilterPendingOnly);
                setSelectedFilterGroupIds(new Set(draftSelectedFilterGroupIds));
                setFilterOpen(false);
              }}
            >
              <Text style={styles.filterApplyBtnText}>Apply ({liveApplyCount})</Text>
            </Pressable>
          </View>
        }
      >
        <View style={styles.liveCountRow}>
          <Text style={styles.liveCountText}>{liveApplyCount} members match current selection</Text>
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>Member status</Text>
          <View style={styles.statusGrid}>
            {statusFilterOptions.map((label) => {
              const active = draftFilterStatus.has(label);
              return (
                <Pressable
                  key={label}
                  style={[styles.statusCard, active && styles.statusCardActive]}
                  onPress={() => toggleDraftStatus(label)}
                >
                  <View style={styles.statusCardTopRow}>
                    <Ionicons name="person-outline" size={16} color={active ? colors.accent : "#6b7280"} />
                    {active ? (
                      <View style={styles.statusCardCheck}>
                        <Ionicons name="checkmark" size={10} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.statusCardText, active && styles.statusCardTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.filterSectionDivider} />

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>Age range</Text>
          <Text style={styles.filterHint}>Choose your own min and max age</Text>
          <View style={styles.ageRangeRow}>
            <View style={styles.ageRangeInputCell}>
              <Text style={styles.ageRangeLabel}>Min age</Text>
              <TextInput
                value={draftAgeMinInput}
                onChangeText={(t) => setDraftAgeMinInput(t.replace(/[^\d]/g, ""))}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>
            <View style={styles.ageRangeConnectorWrap}>
              <Text style={styles.ageRangeConnector}>to</Text>
            </View>
            <View style={styles.ageRangeInputCell}>
              <Text style={styles.ageRangeLabel}>Max age</Text>
              <TextInput
                value={draftAgeMaxInput}
                onChangeText={(t) => setDraftAgeMaxInput(t.replace(/[^\d]/g, ""))}
                placeholder="120"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                style={styles.input}
              />
            </View>
          </View>
          <Animated.View
            style={[
              styles.ageRangePreview,
              {
                borderColor: ageRangeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["#e5e7eb", "#3b82f6"],
                }),
                backgroundColor: ageRangeAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["#f8fafc", "#eff6ff"],
                }),
                transform: [
                  {
                    scale: ageRangeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.02],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.ageRangePreviewText}>
              {(() => {
                const parsedMin = parseAgeBound(draftAgeMinInput);
                const parsedMax = parseAgeBound(draftAgeMaxInput);
                const normalized = normalizeAgeRange(parsedMin, parsedMax);
                if (normalized.min == null && normalized.max == null) return "All ages";
                return `${normalized.min ?? 0} - ${normalized.max ?? 120} years`;
              })()}
            </Text>
          </Animated.View>
        </View>
        <View style={styles.filterSectionDivider} />

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>Groups and subgroups</Text>
          <View style={styles.groupListWrap}>
            {(() => {
              const groupsAllSelected = draftSelectedFilterGroupIds.has(GROUP_FILTER_ALL_TOKEN);
              return (
                <Pressable
                  key={GROUP_FILTER_ALL_TOKEN}
                  onPress={() => toggleDraftGroup(GROUP_FILTER_ALL_TOKEN)}
                  style={[styles.filterPill, groupsAllSelected && styles.filterPillActive]}
                >
                  <View style={[styles.pillDot, groupsAllSelected && styles.pillDotActive]}>
                    {groupsAllSelected ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.filterPillText, groupsAllSelected && styles.filterPillTextActive]}>
                    All groups
                  </Text>
                </Pressable>
              );
            })()}
            {visibleFilterGroups.map((g) => {
              const gid = String(g.id);
              const active = draftSelectedFilterGroupIds.has(gid);
              const isDisabledByParent = disabledGroupIdsByParentSelection.has(gid);
              const visuallySelected = active || isDisabledByParent;
              return (
                <Pressable
                  key={gid}
                  onPress={() => {
                    if (isDisabledByParent) return;
                    toggleDraftGroup(gid);
                  }}
                  style={[
                    styles.filterPill,
                    visuallySelected && styles.filterPillActive,
                    isDisabledByParent && styles.filterOptionDisabled,
                  ]}
                >
                  <View style={[styles.pillDot, visuallySelected && styles.pillDotActive]}>
                    {visuallySelected ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.filterPillText, visuallySelected && styles.filterPillTextActive]} numberOfLines={1}>
                    {String(g.name || "Group")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {groups.length > 8 ? (
            <Pressable onPress={() => setShowAllFilterGroups((v) => !v)} style={styles.showMoreBtn}>
              <Text style={styles.showMoreText}>{showAllFilterGroups ? "Show less" : "Show more..."}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.filterSectionDivider} />

        <View style={styles.filterTaskCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.filterSectionTitle}>Task options</Text>
            <Text style={styles.filterHint}>Show members that currently have pending tasks</Text>
          </View>
          <Switch value={draftFilterPendingOnly} onValueChange={setDraftFilterPendingOnly} />
        </View>
      </FormModalShell>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitleWrap: { flex: 1, paddingRight: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
    letterSpacing: type.pageTitle.letterSpacing,
  },
  iconButton: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  headerMenuRoot: { flex: 1 },
  headerMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17, 17, 17, 0.32)",
  },
  headerMenuCard: {
    position: "absolute",
    top: 52,
    right: 12,
    minWidth: 216,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 8,
  },
  headerMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  headerMenuRowText: {
    flex: 1,
    fontSize: type.body.size,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  headerMenuBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  headerMenuBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
  },
  searchAction: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  filtersBlock: {
    backgroundColor: colors.bg,
    paddingBottom: 8,
    marginTop: 4,
  },
  filtersChipSection: {
    gap: 10,
  },
  filtersSectionTitle: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    color: colors.accent,
    fontWeight: type.subtitle.weight,
  },
  filtersCarousel: { marginBottom: 2 },
  filterChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "flex-start",
  },
  filterChipLabelPress: {
    flexShrink: 1,
    maxWidth: 200,
    paddingVertical: 2,
    paddingLeft: 2,
  },
  filterChipRemoveBtn: {
    paddingLeft: 2,
    paddingRight: 4,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 24,
  },
  filterChipClearText: {
    fontSize: type.caption.size,
  },
  listContent: { paddingTop: 14, paddingBottom: 24 },
  listContentWithStickyAssign: { paddingBottom: 108 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minHeight: 28,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 2,
    maxWidth: "100%",
  },
  filterChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  filterChipMuted: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSurface,
  },
  filterChipText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight + 1,
    color: colors.textSecondary,
    fontWeight: "600",
    letterSpacing: type.body.letterSpacing,
    textAlign: "left",
    textAlignVertical: "center",
  },
  filterChipTextActive: {
    color: colors.accent,
  },
  filterChipTextMuted: {
    color: colors.accent,
    opacity: 0.85,
  },
  filterFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  liveCountRow: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 10,
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  liveCountText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
  },
  filterClearBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  filterClearBtnText: {
    color: colors.textPrimary,
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
  },
  filterApplyBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  filterApplyBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
  },
  filterBlock: { marginBottom: 16, gap: 8 },
  filterLabel: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  filterSectionTitle: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  filterSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.accentBorder,
    marginBottom: 14,
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statusCard: {
    minWidth: "31%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    borderRadius: 12,
    backgroundColor: "#fff",
    minHeight: 74,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "space-between",
  },
  statusCardActive: {
    borderColor: colors.accent,
    borderWidth: 1.5,
    backgroundColor: colors.accentSurface,
  },
  statusCardText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  statusCardTextActive: {
    color: colors.accent,
  },
  statusCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusCardCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    minHeight: 36,
    paddingHorizontal: 12,
    maxWidth: "100%",
  },
  filterPillActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  pillDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pillDotActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  filterPillText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.body.weight,
  },
  filterPillTextActive: {
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
  },
  filterOptionDisabled: {
    opacity: 0.75,
  },
  filterHint: {
    marginTop: 4,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
  },
  ageRangeRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  ageRangeInputCell: {
    flex: 1,
    gap: 6,
  },
  ageRangeLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
  },
  ageRangeConnectorWrap: {
    height: 46,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  ageRangeConnector: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.bodyStrong.weight,
  },
  ageRangePreview: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ageRangePreviewText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
    textAlign: "center",
  },
  groupListWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  showMoreBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  showMoreText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: "#0ea5e9",
    fontWeight: type.bodyStrong.weight,
  },
  groupChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.card,
    maxWidth: "100%",
  },
  groupChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  groupChipText: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
  },
  groupChipTextActive: {
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  filterSwitchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  filterTaskCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 74,
    padding: 14,
    marginBottom: 4,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  selectCircle: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  selectCircleActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
  },
  avatarStub: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: "#3b3b3f",
  },
  name: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  meta: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginTop: 4,
    letterSpacing: type.caption.letterSpacing,
  },
  helper: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: 8,
    letterSpacing: type.body.letterSpacing,
  },
  footerLoader: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  assignStickyBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 86,
    minHeight: 80,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fdba74",
    backgroundColor: "#fff7ed",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    zIndex: 12,
  },
  assignStickyLeft: {
    flex: 1,
    marginRight: 10,
    gap: 2,
  },
  assignStickyText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  assignStickySubtext: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
  },
  assignStickyActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  assignStickyClearBtn: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  assignStickyClearText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  assignStickyBtn: {
    minHeight: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  assignStickyBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  assignModalCard: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "96%",
    borderRadius: 20,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: "#eceff3",
  },
  assignTitle: {
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
    letterSpacing: type.title.letterSpacing,
  },
  assignSubtitle: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
  },
  assignDetailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  assignHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  assignSearchIconBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  assignSearchIconBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backBtnText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  assignTypeRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  assignTypeChip: {
    flex: 1,
    minHeight: 112,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  assignTypeChipMinistries: {
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  assignTypeChipFamily: {
    borderColor: "#93c5fd",
    backgroundColor: "#dbeafe",
  },
  assignTypeChipTask: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSurface,
  },
  assignTypeChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  assignTypeChipText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  assignTypeChipTextActive: {
    color: colors.accent,
  },
  assignContentCard: {
    marginTop: 10,
    minHeight: 200,
    borderWidth: 1,
    borderColor: "#edf0f4",
    borderRadius: radius.md,
    backgroundColor: "#fff",
    padding: 10,
  },
  assignKeyboardAvoid: {
    width: "100%",
  },
  assignSearchRow: {
    marginBottom: 8,
    width: "100%",
    zIndex: 2,
  },
  assignSearchInput: {
    flex: 0,
    alignSelf: "stretch",
    width: "100%",
    minHeight: 44,
  },
  assignOverlapSpinner: {
    marginBottom: 10,
  },
  assignOverlapBox: {
    marginBottom: 10,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  assignOverlapTitle: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  assignOverlapScroll: {
    maxHeight: 120,
  },
  assignOverlapScrollContent: {
    gap: 4,
    paddingBottom: 2,
  },
  assignOverlapLine: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
  },
  assignOverlapMore: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginTop: 4,
  },
  assignOptionsList: {
    minHeight: 160,
    maxHeight: 380,
  },
  assignOptionsContent: {
    padding: 8,
    gap: 8,
  },
  assignOptionRow: {
    minHeight: 62,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    paddingLeft: 4,
    paddingRight: 0,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "space-between",
  },
  assignOptionRowPress: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 56,
    minWidth: 0,
  },
  expandChevronBtn: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    borderLeftWidth: 1,
    borderLeftColor: "#f1f5f9",
  },
  assignOptionRowMain: {
    backgroundColor: "#fafafb",
  },
  assignOptionLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 10,
    minWidth: 0,
  },
  assignOptionRight: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
  },
  ministryIconCircle: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  ministryTextWrap: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  assignOptionNameText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    letterSpacing: type.body.letterSpacing,
    flexShrink: 1,
  },
  assignOptionMainText: {
    fontWeight: type.bodyStrong.weight,
  },
  assignOptionSubtext: {
    fontSize: type.caption.size - 1,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  assignOptionText: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    letterSpacing: type.body.letterSpacing,
  },
  taskForm: {
    marginTop: 8,
    gap: 10,
    width: "100%",
  },
  assignTaskScroll: {
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    maxHeight: 520,
    minHeight: 280,
  },
  assignTaskScrollContent: {
    paddingBottom: 8,
  },
  assignTaskHint: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  taskDueLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginTop: 10,
    marginBottom: 4,
  },
  /** Do not use global `input` (flex:1) here — it collapses to 0 height on Android inside the assign modal. */
  taskAssignInput: {
    alignSelf: "stretch",
    width: "100%",
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  taskAssignInputMultiline: {
    minHeight: 88,
  },
  assignTaskChecklistHeading: {
    marginTop: 14,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  assignTaskChecklistSub: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  taskChecklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  taskChecklistLineInput: {
    flex: 1,
    minWidth: 0,
  },
  taskChecklistRemoveBtn: {
    padding: 4,
  },
  taskChecklistAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 8,
  },
  taskChecklistAddText: {
    fontSize: type.body.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
  },
  verifyBtn: {
    width: "100%",
    marginTop: 14,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  verifyBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  downloadBtn: {
    width: "100%",
    marginTop: 10,
    minHeight: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  downloadBtnText: {
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  closeBtn: {
    marginTop: 10,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  closeBtnText: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
});
