import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  FilterResultsChips,
  HeaderCountTile,
  type FilterResultChip,
} from "../../components/FilterResultsSection";
import { FormModalShell } from "../../components/FormModalShell";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import { GroupCreateTaskModal } from "../../components/GroupCreateTaskModal";
import { MemberCreateTaskModal } from "../../components/MemberCreateTaskModal";
import { TaskListSkeleton } from "../../components/DataSkeleton";
import { TaskAssignmentList } from "../../components/TaskAssignmentList";
import type { Group, TaskItem } from "@sheepmug/shared-api";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";
import { usePermissions } from "../../hooks/usePermissions";
import { buildGroupTreeSelection, buildMinistryTreeRows } from "../../lib/ministryGroupTree";
import {
  getOfflineResourceCache,
  setDashboardLastSeenCounts,
  setOfflineResourceCache,
} from "../../lib/storage";
import { colors, radius, sizes, type } from "../../theme";

type StatusScope = "all" | "pending" | "completed";
type TaskTypeFilter = "all" | "member" | "group";
type UrgencyFilter = "all" | "low" | "urgent" | "high";

function taskUrgencyValue(t: TaskItem): "low" | "urgent" | "high" {
  const r = t as Record<string, unknown>;
  const u = String(r.urgency ?? "").trim().toLowerCase();
  if (u === "urgent" || u === "high") return u;
  return "low";
}

function urgencyFilterLabel(u: Exclude<UrgencyFilter, "all">): string {
  if (u === "high") return "High";
  if (u === "urgent") return "Urgent";
  return "Low";
}
const PAGE_SIZE = 10;
const TASKS_CACHE_KEY = "tasks:list";
const MOBILE_TASK_SEARCH_PREFETCH_MAX = 5000;

function taskSearchBlob(t: TaskItem): string {
  const r = t as Record<string, unknown>;
  const tt = r.task_type;
  const parts: string[] = [];
  for (const x of [t.title, t.description, t.status, tt, r.assignee_name, r.created_by_name]) {
    if (x != null && String(x).trim()) parts.push(String(x).toLowerCase());
  }
  const members = r.members;
  if (Array.isArray(members)) {
    for (const m of members) {
      const row = m as { first_name?: unknown; last_name?: unknown };
      const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim().toLowerCase();
      if (name) parts.push(name);
    }
  }
  const groups = r.groups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      const name = String((g as { name?: unknown })?.name ?? "")
        .trim()
        .toLowerCase();
      if (name) parts.push(name);
    }
  }
  return parts.join(" ");
}

function isGroupTask(t: TaskItem): boolean {
  const r = t as { task_type?: string; group_id?: string | null };
  if (r.task_type === "group") return true;
  if (r.task_type === "member") return false;
  return Boolean(r.group_id);
}

function taskStatusValue(t: TaskItem): "pending" | "completed" | "other" {
  const s = String(t.status || "").trim().toLowerCase();
  if (s === "completed") return "completed";
  if (s === "pending") return "pending";
  return "other";
}

function taskAssignedToViewer(t: TaskItem, viewerId: string | null): boolean {
  if (!viewerId) return false;
  const row = t as { assignee_profile_ids?: unknown; assignee_profile_id?: unknown };
  if (Array.isArray(row.assignee_profile_ids)) {
    return row.assignee_profile_ids.some((x) => String(x ?? "").trim() === viewerId);
  }
  const one = String(row.assignee_profile_id ?? "").trim();
  if (one) return one === viewerId;
  return true;
}

function taskGroupIds(t: TaskItem): string[] {
  const row = t as {
    group_id?: unknown;
    groups?: { id?: unknown }[] | unknown;
  };
  const out = new Set<string>();
  const one = String(row.group_id ?? "").trim();
  if (one) out.add(one);
  if (Array.isArray(row.groups)) {
    for (const g of row.groups) {
      const id = String((g as { id?: unknown })?.id ?? "").trim();
      if (id) out.add(id);
    }
  }
  return [...out];
}

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: "", label: "Any month" }];
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const value = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleString(undefined, { month: "long", year: "numeric" }) });
  }
  return out;
}

function monthLabelFromValue(value: string): string {
  const [y, m] = value.split("-");
  const year = Number(y);
  const month = Number(m);
  if (!year || !month) return value;
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function monthStartIso(value: string): string | undefined {
  const [y, m] = value.split("-");
  const year = Number(y);
  const month = Number(m);
  if (!year || !month) return undefined;
  return new Date(year, month - 1, 1, 0, 0, 0, 0).toISOString();
}

function monthEndIso(value: string): string | undefined {
  const [y, m] = value.split("-");
  const year = Number(y);
  const month = Number(m);
  if (!year || !month) return undefined;
  return new Date(year, month, 0, 23, 59, 59, 999).toISOString();
}

function taskDueMonthValue(task: TaskItem): string | null {
  const row = task as Record<string, unknown>;
  const dueRaw = row.due_date ?? row.due_at ?? row.due_on ?? row.due_month;
  if (typeof dueRaw === "string" && dueRaw.trim()) {
    const raw = dueRaw.trim();
    const ym = /^(\d{4})-(\d{2})/.exec(raw);
    if (ym) {
      const monthNum = Number(ym[2]);
      if (monthNum >= 1 && monthNum <= 12) {
        return `${ym[1]}-${ym[2]}`;
      }
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof dueRaw !== "number") return null;
  const date = new Date(dueRaw);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function filterMobileTasks(
  list: TaskItem[],
  opts: {
    search: string;
    pendingOnly: boolean;
    statusScope: StatusScope;
    typeFilter: TaskTypeFilter;
    selectedGroupWithDescendants: Set<string>;
    dueMonths: string[];
    urgencyFilter: UrgencyFilter;
  },
): TaskItem[] {
  const q = opts.search.trim().toLowerCase();
  let out = list;
  if (opts.pendingOnly) {
    out = out.filter((t) => taskStatusValue(t) === "pending");
  }
  if (opts.statusScope !== "all") {
    out = out.filter((t) => taskStatusValue(t) === opts.statusScope);
  }
  if (opts.urgencyFilter !== "all") {
    out = out.filter((t) => taskUrgencyValue(t) === opts.urgencyFilter);
  }
  if (opts.typeFilter !== "all") {
    out = out.filter((t) => (opts.typeFilter === "group" ? isGroupTask(t) : !isGroupTask(t)));
  }
  if (opts.typeFilter === "group" && opts.selectedGroupWithDescendants.size > 0) {
    out = out.filter((t) =>
      taskGroupIds(t).some((gid) => opts.selectedGroupWithDescendants.has(gid)),
    );
  }
  if (opts.dueMonths.length > 0) {
    const selectedMonths = new Set(opts.dueMonths);
    out = out.filter((t) => {
      const dueMonth = taskDueMonthValue(t);
      return dueMonth ? selectedMonths.has(dueMonth) : false;
    });
  }
  if (!q) return out;
  return out.filter((t) => taskSearchBlob(t).includes(q));
}

export default function TaskScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useOfflineSync();
  const { can } = usePermissions();
  const isElevatedTaskViewer = user?.is_org_owner === true || user?.is_super_admin === true;
  const canSeeMine = can("view_member_tasks") || can("view_group_tasks");
  const canSeeTaskList = isElevatedTaskViewer || canSeeMine;
  const canCreateMemberTask = can("add_member_tasks");
  const canCreateGroupTask = can("add_group_tasks");
  const canCreateTask = canCreateMemberTask || canCreateGroupTask;

  const params = useLocalSearchParams<{ pending?: string }>();
  const pendingOnly =
    params.pending === "1" || String(params.pending || "").toLowerCase() === "true";

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusScope, setStatusScope] = useState<StatusScope>("pending");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all");
  const [groupFilterId, setGroupFilterId] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>("all");

  const [dueMonths, setDueMonths] = useState<string[]>([]);
  const [draftStatusScope, setDraftStatusScope] = useState<StatusScope>("pending");
  const [draftTypeFilter, setDraftTypeFilter] = useState<TaskTypeFilter>("all");
  const [draftGroupFilterId, setDraftGroupFilterId] = useState("");
  const [draftDueMonths, setDraftDueMonths] = useState<string[]>([]);
  const [draftUrgencyFilter, setDraftUrgencyFilter] = useState<UrgencyFilter>("all");
  const [dueMonthPickerOpen, setDueMonthPickerOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const [showSearch, setShowSearch] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tasksTotalCount, setTasksTotalCount] = useState(0);
  const [memberCreateOpen, setMemberCreateOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const months = useMemo(() => monthOptions(), []);
  const groupsById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groups) m.set(String(g.id), g);
    return m;
  }, [groups]);
  const groupTree = useMemo(() => buildGroupTreeSelection(groups), [groups]);
  const ministryTreeRows = useMemo(() => buildMinistryTreeRows(groups), [groups]);

  const assignedGroupIds = useMemo(() => {
    const out = new Set<string>();
    for (const t of tasks) {
      if (!isGroupTask(t) || !taskAssignedToViewer(t, user?.id ?? null)) continue;
      for (const gid of taskGroupIds(t)) out.add(gid);
    }
    return out;
  }, [tasks, user?.id]);

  const assignedGroupRows = useMemo(
    () => ministryTreeRows.filter((row) => assignedGroupIds.has(row.id)),
    [ministryTreeRows, assignedGroupIds]
  );
  const groupFilterName = useMemo(() => {
    if (!groupFilterId) return "";
    return String(groupsById.get(groupFilterId)?.name || "").trim() || "Selected group";
  }, [groupFilterId, groupsById]);
  const selectedGroupWithDescendants = useMemo(() => {
    if (!groupFilterId) return new Set<string>();
    const out = new Set<string>([groupFilterId]);
    for (const childId of groupTree.descendantsByGroupId.get(groupFilterId) ?? []) {
      out.add(childId);
    }
    return out;
  }, [groupFilterId, groupTree]);

  const fetchTaskPage = useCallback(
    async (offset: number) => {
      if (!canSeeTaskList) return { tasks: [] as TaskItem[], total_count: 0 };
      const wantAll = statusScope !== "pending" || pendingOnly;
      const normalizedDueMonths = [...new Set(dueMonths.filter((m) => m.trim()))].sort();
      const dueFromMonth = normalizedDueMonths[0] ?? "";
      const dueToMonth = normalizedDueMonths[normalizedDueMonths.length - 1] ?? "";
      const urg =
        urgencyFilter !== "all" ? (urgencyFilter as "low" | "urgent" | "high") : ("all" as const);
      if (isElevatedTaskViewer) {
        return api.tasks.branch({
          status: wantAll ? "all" : "open",
          orgWide: true,
          month: undefined,
          dueFromIso: monthStartIso(dueFromMonth.trim()),
          dueToIso: monthEndIso(dueToMonth.trim()),
          urgency: urg,
          offset,
          limit: PAGE_SIZE,
        });
      }
      return api.tasks.mine({
        status: wantAll ? "all" : "open",
        urgency: urg,
        offset,
        limit: PAGE_SIZE,
      });
    },
    [
      canSeeTaskList,
      dueMonths,
      isElevatedTaskViewer,
      pendingOnly,
      statusScope,
      urgencyFilter,
    ]
  );

  const loadTasks = useCallback(async () => {
    if (!canSeeTaskList) {
      setLoadError(null);
      setTasks([]);
      setTasksTotalCount(0);
      setHasMore(false);
      return;
    }
    let hasCachedRows = false;
    try {
      const cacheKey = `${TASKS_CACHE_KEY}:${isElevatedTaskViewer ? "branch" : "mine"}:${statusScope}:${[...dueMonths].sort().join(",")}:${pendingOnly ? "pending" : "all"}:u:${urgencyFilter}`;
      const cached = await getOfflineResourceCache<{ tasks: TaskItem[]; total_count: number }>(cacheKey);
      const fallbackCached = await getOfflineResourceCache<{ tasks: TaskItem[]; total_count: number }>(
        "tasks:list:bootstrap"
      );
      const legacyCached = await getOfflineResourceCache<{ tasks: TaskItem[]; total_count: number }>("tasks:list");
      const cacheToUse = cached?.data ? cached : fallbackCached?.data ? fallbackCached : legacyCached;
      hasCachedRows = Boolean(
        cacheToUse?.data && Array.isArray(cacheToUse.data.tasks) && cacheToUse.data.tasks.length > 0
      );
      if (cacheToUse?.data) {
        setTasks(Array.isArray(cacheToUse.data.tasks) ? cacheToUse.data.tasks : []);
        setTasksTotalCount(Number(cacheToUse.data.total_count || 0));
        const cachedLength = Array.isArray(cacheToUse.data.tasks) ? cacheToUse.data.tasks.length : 0;
        const cachedTotal = Number(cacheToUse.data.total_count || cachedLength);
        setHasMore(cachedLength < cachedTotal);
      }
        const { tasks: data, total_count } = await fetchTaskPage(0);
        setTasks(data);
        setTasksTotalCount(total_count);
        setHasMore(data.length === PAGE_SIZE);
        setLoadError(null);
        await setOfflineResourceCache(cacheKey, { tasks: data, total_count });
    } catch (e) {
      if (!hasCachedRows) {
        setLoadError(e instanceof Error ? e.message : "Could not load tasks");
      }
    }
  }, [
    canSeeTaskList,
    fetchTaskPage,
    pendingOnly,
    statusScope,
    dueMonths,
    urgencyFilter,
    isElevatedTaskViewer,
  ]);

  const loadMoreTasks = useCallback(async () => {
    if (!canSeeTaskList || loading || refreshing || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const payload = await fetchTaskPage(tasks.length).catch(() => null);
      if (!payload) return;
      const { tasks: next, total_count } = payload;
      setTasks((prev) => {
        const merged = [...prev, ...next];
        const cacheKey = `${TASKS_CACHE_KEY}:${isElevatedTaskViewer ? "branch" : "mine"}:${statusScope}:${[...dueMonths].sort().join(",")}:${pendingOnly ? "pending" : "all"}:u:${urgencyFilter}`;
        void setOfflineResourceCache(cacheKey, { tasks: merged, total_count });
        return merged;
      });
      setTasksTotalCount(total_count);
      setHasMore(next.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [
    canSeeTaskList,
    dueMonths,
    fetchTaskPage,
    hasMore,
    isElevatedTaskViewer,
    loading,
    loadingMore,
    pendingOnly,
    refreshing,
    statusScope,
    tasks.length,
    urgencyFilter,
  ]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        if (!canSeeTaskList) {
          setTasks([]);
          setTasksTotalCount(0);
          return;
        }
        await loadTasks();
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [canSeeTaskList, loadTasks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]);
      if (!cancelled) setGroups(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    setDraftStatusScope(statusScope);
    setDraftTypeFilter(typeFilter);
    setDraftGroupFilterId(groupFilterId);
    setDraftDueMonths(dueMonths);
    setDraftUrgencyFilter(urgencyFilter);
  }, [filtersOpen, statusScope, typeFilter, groupFilterId, dueMonths, urgencyFilter]);

  useEffect(() => {
    if (draftTypeFilter !== "group" && draftGroupFilterId) {
      setDraftGroupFilterId("");
    }
  }, [draftTypeFilter, draftGroupFilterId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadTasks();
    } finally {
      setRefreshing(false);
    }
  }, [loadTasks]);

  useFocusEffect(
    useCallback(() => {
      if (!canSeeTaskList || !pendingOnly) return;
      const pendingCount = tasks.filter((t) => String(t.status || "").toLowerCase() === "pending").length;
      void setDashboardLastSeenCounts({ pendingTasks: pendingCount });
    }, [canSeeTaskList, pendingOnly, tasks])
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        setFiltersOpen(false);
        setDueMonthPickerOpen(false);
        setGroupPickerOpen(false);
      };
    }, [])
  );

  const filteredTasks = useMemo(
    () =>
      filterMobileTasks(tasks, {
        search,
        pendingOnly,
        statusScope,
        typeFilter,
        selectedGroupWithDescendants,
        dueMonths,
        urgencyFilter,
      }),
    [tasks, search, statusScope, typeFilter, pendingOnly, selectedGroupWithDescendants, dueMonths, urgencyFilter],
  );

  useEffect(() => {
    if (!canSeeTaskList) return;
    if (!search.trim()) return;
    if (loading || refreshing || loadingMore) return;
    if (filteredTasks.length > 0) return;
    if (!hasMore) return;
    if (tasks.length >= MOBILE_TASK_SEARCH_PREFETCH_MAX) return;
    void loadMoreTasks();
  }, [
    canSeeTaskList,
    search,
    loading,
    refreshing,
    loadingMore,
    filteredTasks.length,
    hasMore,
    tasks.length,
    loadMoreTasks,
  ]);

  const taskHeaderCount = useMemo(() => {
    if (!canSeeTaskList) return 0;
    if (
      search.trim() ||
      statusScope !== "all" ||
      typeFilter !== "all" ||
      groupFilterId ||
      pendingOnly ||
      dueMonths.length > 0 ||
      urgencyFilter !== "all"
    ) {
      return filteredTasks.length;
    }
    return tasksTotalCount;
  }, [
    canSeeTaskList,
    search,
    statusScope,
    typeFilter,
    groupFilterId,
    pendingOnly,
    dueMonths.length,
    urgencyFilter,
    filteredTasks.length,
    tasksTotalCount,
  ]);

  const filterChips = useMemo((): FilterResultChip[] => {
    const chips: FilterResultChip[] = [];
    if (statusScope !== "all") {
      chips.push({
        key: "status",
        label: statusScope === "pending" ? "Pending" : "Completed",
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (typeFilter !== "all") {
      chips.push({
        key: "type",
        label: typeFilter === "member" ? "Member" : "Group",
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (typeFilter === "group" && groupFilterId) {
      chips.push({
        key: "group",
        label: groupFilterName,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (dueMonths.length > 0) {
      const preview = dueMonths
        .slice(0, 2)
        .map((m) => monthLabelFromValue(m))
        .join(", ");
      const extraCount = dueMonths.length - 2;
      chips.push({
        key: "dueMonths",
        label: extraCount > 0 ? `${preview} +${extraCount}` : preview,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (pendingOnly) {
      chips.push({ key: "pending", label: "Pending", onLabelPress: () => router.setParams({ pending: undefined }) });
    }
    if (urgencyFilter !== "all") {
      chips.push({
        key: "urgency",
        label: `Urgency: ${urgencyFilterLabel(urgencyFilter)}`,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    return chips;
  }, [
    statusScope,
    typeFilter,
    groupFilterId,
    groupFilterName,
    dueMonths,
    pendingOnly,
    urgencyFilter,
    router,
  ]);

  const clearAppliedFilters = useCallback(() => {
    setStatusScope("all");
    setTypeFilter("all");
    setGroupFilterId("");
    setDueMonths([]);
    setUrgencyFilter("all");
    router.setParams({ pending: undefined });
  }, [router]);

  const removeFilterByKey = useCallback(
    (key: string) => {
      if (key === "status") setStatusScope("all");
      else if (key === "type") setTypeFilter("all");
      else if (key === "group") setGroupFilterId("");
      else if (key === "dueMonths") setDueMonths([]);
      else if (key === "pending") router.setParams({ pending: undefined });
      else if (key === "urgency") setUrgencyFilter("all");
    },
    [router]
  );

  function toggleSearch() {
    if (showSearch) {
      setShowSearch(false);
      setSearch("");
      Keyboard.dismiss();
    } else {
      setShowSearch(true);
    }
  }

  function toggleFilters() {
    setFiltersOpen((v) => !v);
  }

  function openCreateTask() {
    if (!canCreateTask) return;
    if (!isOnline) {
      Alert.alert("Offline limitation", "Creating tasks is only available online.");
      return;
    }
    if (canCreateMemberTask && canCreateGroupTask) {
      Alert.alert("Create task", "Choose task type.", [
        { text: "Member task", onPress: () => setMemberCreateOpen(true) },
        { text: "Group task", onPress: () => setGroupCreateOpen(true) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    if (canCreateMemberTask) {
      setMemberCreateOpen(true);
      return;
    }
    if (canCreateGroupTask) {
      setGroupCreateOpen(true);
    }
  }

  function clearDraftFilters() {
    setDraftStatusScope("all");
    setDraftTypeFilter("all");
    setDraftGroupFilterId("");
    setDraftDueMonths([]);
    setDraftUrgencyFilter("all");
    setDueMonthPickerOpen(false);
    setGroupPickerOpen(false);
  }

  function applyDraftFilters() {
    setStatusScope(draftStatusScope);
    setTypeFilter(draftTypeFilter);
    setGroupFilterId(draftTypeFilter === "group" ? draftGroupFilterId : "");
    setDueMonths([...new Set(draftDueMonths)].sort());
    setUrgencyFilter(draftUrgencyFilter);
    setDueMonthPickerOpen(false);
    setGroupPickerOpen(false);
    setFiltersOpen(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Tasks</Text>
              <HeaderCountTile count={taskHeaderCount} />
            </View>
          </View>
          {canSeeTaskList ? (
            <View style={styles.headerActions}>
              {canCreateTask ? (
                <HeaderIconCircleButton accessibilityLabel="Create task" onPress={openCreateTask}>
                  <Ionicons name="add-outline" size={sizes.headerIcon} color={colors.textPrimary} />
                </HeaderIconCircleButton>
              ) : null}
              <HeaderIconCircleButton
                accessibilityLabel={filtersOpen ? "Close filters" : "Open filters"}
                active={filtersOpen}
                onPress={toggleFilters}
              >
                <Ionicons
                  name={filtersOpen ? "options" : "options-outline"}
                  size={sizes.headerIcon}
                  color={colors.textPrimary}
                />
              </HeaderIconCircleButton>
              <HeaderIconCircleButton
                accessibilityLabel={showSearch ? "Close search" : "Search tasks"}
                active={showSearch}
                onPress={toggleSearch}
              >
                <Ionicons
                  name={showSearch ? "close-outline" : "search-outline"}
                  size={sizes.headerIcon}
                  color={colors.textPrimary}
                />
              </HeaderIconCircleButton>
            </View>
          ) : null}
        </View>
      </View>

      {memberCreateOpen ? (
        <MemberCreateTaskModal
          visible
          onClose={() => setMemberCreateOpen(false)}
          onSuccess={() => void loadTasks()}
        />
      ) : null}
      {groupCreateOpen ? (
        <GroupCreateTaskModal
          visible
          onClose={() => setGroupCreateOpen(false)}
          onSuccess={() => void loadTasks()}
        />
      ) : null}

      {!canSeeTaskList ? (
        <Text style={styles.helper}>You do not have permission to view tasks.</Text>
      ) : (
        <>
          {showSearch ? (
            <View style={styles.searchRow}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Filter results by text"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              <HeaderIconCircleButton accessibilityLabel="Trim search text" onPress={() => setSearch((v) => v.trim())}>
                <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textPrimary} />
              </HeaderIconCircleButton>
            </View>
          ) : null}

          <View style={styles.filterResultsWrap}>
            <FilterResultsChips chips={filterChips} onRemoveChip={removeFilterByKey} onClearAll={clearAppliedFilters} />
          </View>

          <FormModalShell
            visible={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            title={`Filters (${taskHeaderCount})`}
            variant="compact"
            footer={
              <View style={styles.filterFooter}>
                <Pressable style={styles.filterClearBtn} onPress={clearDraftFilters}>
                  <Text style={styles.filterClearBtnText}>Clear</Text>
                </Pressable>
                <Pressable style={styles.filterApplyBtn} onPress={applyDraftFilters}>
                  <Text style={styles.filterApplyBtnText}>Apply</Text>
                </Pressable>
              </View>
            }
          >
            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Status</Text>
              <View style={styles.choiceRow}>
                {(["all", "pending", "completed"] as StatusScope[]).map((val) => {
                  const active = draftStatusScope === val;
                  return (
                    <Pressable
                      key={val}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() => setDraftStatusScope(val)}
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {val === "all" ? "All" : val === "pending" ? "Pending" : "Completed"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Type</Text>
              <View style={styles.choiceRow}>
                {(["all", "member", "group"] as TaskTypeFilter[]).map((val) => {
                  const active = draftTypeFilter === val;
                  return (
                    <Pressable
                      key={val}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() => setDraftTypeFilter(val)}
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {val === "all" ? "All types" : val === "member" ? "Member" : "Group"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Urgency</Text>
              <View style={styles.choiceRow}>
                {(["all", "low", "urgent", "high"] as UrgencyFilter[]).map((val) => {
                  const active = draftUrgencyFilter === val;
                  return (
                    <Pressable
                      key={val}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() => setDraftUrgencyFilter(val)}
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {val === "all" ? "Any" : urgencyFilterLabel(val)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {draftTypeFilter === "group" ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Group</Text>
                <Pressable style={styles.duePickerTrigger} onPress={() => setGroupPickerOpen(true)}>
                  <Text style={styles.duePickerTriggerText} numberOfLines={1}>
                    {draftGroupFilterId
                      ? String(groupsById.get(draftGroupFilterId)?.name || "").trim() || "Selected group"
                      : "Any group"}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </Pressable>
                <Text style={styles.filterHint}>Only groups assigned to you are shown.</Text>
              </View>
            ) : null}

            <View style={styles.filterBlock}>
              <Text style={styles.filterLabel}>Due month</Text>
              <Pressable
                style={styles.duePickerTrigger}
                onPress={() => setDueMonthPickerOpen((prev) => !prev)}
              >
                <Text style={styles.duePickerTriggerText} numberOfLines={1}>
                  {draftDueMonths.length > 0
                    ? `${draftDueMonths.length} selected`
                    : "Any month"}
                </Text>
                <Ionicons
                  name={dueMonthPickerOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.textSecondary}
                />
              </Pressable>
              {dueMonthPickerOpen ? (
                <>
                  <Text style={styles.filterHint}>Select one or more months</Text>
                  <ScrollView style={styles.inlineMonthList} contentContainerStyle={styles.monthListContent}>
                    {months
                      .filter((opt) => opt.value.trim().length > 0)
                      .map((opt) => {
                        const active = draftDueMonths.includes(opt.value);
                        return (
                          <Pressable
                            key={`due-month-inline-${opt.value}`}
                            style={({ pressed }) => [
                              styles.monthListRow,
                              active && styles.monthListRowActive,
                              pressed && styles.monthListRowPressed,
                            ]}
                            onPress={() =>
                              setDraftDueMonths((prev) =>
                                prev.includes(opt.value)
                                  ? prev.filter((v) => v !== opt.value)
                                  : [...prev, opt.value]
                              )
                            }
                          >
                            <Text style={[styles.monthListLabel, active && styles.monthListLabelActive]}>
                              {opt.label}
                            </Text>
                            <Ionicons
                              name={active ? "checkbox-outline" : "square-outline"}
                              size={18}
                              color={active ? colors.accent : colors.textSecondary}
                            />
                          </Pressable>
                        );
                      })}
                  </ScrollView>
                </>
              ) : null}
            </View>
          </FormModalShell>

          <Modal
            visible={groupPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setGroupPickerOpen(false)}
          >
            <Pressable style={styles.dueModalBackdrop} onPress={() => setGroupPickerOpen(false)}>
              <Pressable style={styles.dueModalCard} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.dueModalTitle}>Group</Text>
                <Text style={styles.filterHint}>Select one group. Child groups appear indented.</Text>
                <ScrollView style={styles.monthList} contentContainerStyle={styles.monthListContent}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.monthListRow,
                      !draftGroupFilterId && styles.monthListRowActive,
                      pressed && styles.monthListRowPressed,
                    ]}
                    onPress={() => setDraftGroupFilterId("")}
                  >
                    <Text style={[styles.monthListLabel, !draftGroupFilterId && styles.monthListLabelActive]}>
                      Any group
                    </Text>
                    <Ionicons
                      name={!draftGroupFilterId ? "radio-button-on-outline" : "radio-button-off-outline"}
                      size={18}
                      color={!draftGroupFilterId ? colors.accent : colors.textSecondary}
                    />
                  </Pressable>
                  {assignedGroupRows.map((row) => {
                    const active = draftGroupFilterId === row.id;
                    const depthPad = row.depth > 0 ? "  ".repeat(Math.min(row.depth, 5)) : "";
                    return (
                      <Pressable
                        key={`task-group-${row.id}`}
                        style={({ pressed }) => [
                          styles.monthListRow,
                          active && styles.monthListRowActive,
                          pressed && styles.monthListRowPressed,
                        ]}
                        onPress={() => setDraftGroupFilterId(row.id)}
                      >
                        <Text style={[styles.monthListLabel, active && styles.monthListLabelActive]} numberOfLines={2}>
                          {`${depthPad}${row.name}`}
                        </Text>
                        <Ionicons
                          name={active ? "radio-button-on-outline" : "radio-button-off-outline"}
                          size={18}
                          color={active ? colors.accent : colors.textSecondary}
                        />
                      </Pressable>
                    );
                  })}
                  {assignedGroupRows.length === 0 ? (
                    <Text style={styles.helper}>No assigned groups found.</Text>
                  ) : null}
                </ScrollView>
                <View style={styles.dueModalActions}>
                  <Pressable
                    style={styles.filterClearBtn}
                    onPress={() => {
                      setDraftGroupFilterId("");
                      setGroupPickerOpen(false);
                    }}
                  >
                    <Text style={styles.filterClearBtnText}>Clear</Text>
                  </Pressable>
                  <Pressable style={styles.filterApplyBtn} onPress={() => setGroupPickerOpen(false)}>
                    <Text style={styles.filterApplyBtnText}>Done</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          {loading && tasks.length === 0 ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              <TaskListSkeleton count={7} />
            </ScrollView>
          ) : loadError ? (
            <Text style={styles.helper}>{loadError}</Text>
          ) : filteredTasks.length === 0 ? (
            <Text style={styles.helper}>
              {tasks.length === 0 ? "No tasks yet." : "No tasks match your search or filters."}
            </Text>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
              onScroll={(e) => {
                const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 220;
                if (nearBottom) void loadMoreTasks();
              }}
              scrollEventThrottle={120}
            >
              <TaskAssignmentList variant="mine" tasks={filteredTasks} setTasks={setTasks} pageLoading={false} />
              {loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  headerTitleWrap: { flex: 1, paddingRight: 10, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 8 },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
  },
  filterFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
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
  filterBlock: { marginBottom: 14, gap: 8 },
  filterLabel: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    paddingBottom: 2,
  },
  choiceChip: {
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  choiceChipText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.body.weight,
  },
  choiceChipTextActive: {
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  duePickerTrigger: {
    minHeight: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  duePickerTriggerText: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.body.weight,
  },
  dueModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dueModalCard: {
    maxHeight: "78%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  dueModalTitle: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  monthList: {
    maxHeight: 360,
  },
  inlineMonthList: {
    maxHeight: 220,
  },
  monthListContent: {
    gap: 8,
    paddingVertical: 2,
  },
  monthListRow: {
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  monthListRowActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  monthListRowPressed: {
    opacity: 0.9,
  },
  monthListLabel: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.body.weight,
  },
  monthListLabelActive: {
    fontWeight: type.bodyStrong.weight,
  },
  dueModalActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 4,
  },
  filterHint: { fontSize: type.caption.size, lineHeight: type.caption.lineHeight, color: colors.textSecondary },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
    letterSpacing: type.pageTitle.letterSpacing,
  },
  filterResultsWrap: {
    paddingHorizontal: 16,
  },
  loadingBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  scroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  helper: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: 16,
    letterSpacing: type.body.letterSpacing,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  footerLoader: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
