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
import { Calendar } from "lucide-react-native";
import {
  FilterResultsChips,
  HeaderCountTile,
  type FilterResultChip,
} from "../../components/FilterResultsSection";
import { FormModalShell } from "../../components/FormModalShell";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import { GroupCreateTaskModal } from "../../components/GroupCreateTaskModal";
import { MemberCreateTaskModal } from "../../components/MemberCreateTaskModal";
import { TaskAssignmentList } from "../../components/TaskAssignmentList";
import type { TaskItem } from "@sheepmug/shared-api";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";
import { usePermissions } from "../../hooks/usePermissions";
import { displayMemberWords } from "../../lib/memberDisplayFormat";
import {
  getOfflineResourceCache,
  setDashboardLastSeenCounts,
  setOfflineResourceCache,
} from "../../lib/storage";
import { colors, radius, sizes, type } from "../../theme";

type StatusScope = "open" | "all";
type TaskTypeFilter = "all" | "member" | "group";
type DueMonthMode = "single" | "range";
const PAGE_SIZE = 10;
const TASKS_CACHE_KEY = "tasks:list";

type StaffRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  branch_id: string | null;
};

function staffLabel(s: StaffRow): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  if (s.email?.trim()) return s.email.trim();
  return s.id.slice(0, 8);
}

function taskSearchBlob(t: TaskItem): string {
  const r = t as Record<string, unknown>;
  const tt = r.task_type;
  const parts: string[] = [];
  for (const x of [t.title, t.description, t.status, tt, r.assignee_name, r.created_by_name]) {
    if (x != null && String(x).trim()) parts.push(String(x).toLowerCase());
  }
  return parts.join(" ");
}

function isGroupTask(t: TaskItem): boolean {
  const r = t as { task_type?: string; group_id?: string | null };
  if (r.task_type === "group") return true;
  if (r.task_type === "member") return false;
  return Boolean(r.group_id);
}

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [{ value: "", label: "Any month" }];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
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

export default function TaskScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isOnline } = useOfflineSync();
  const { can } = usePermissions();
  const isElevatedTaskViewer = user?.is_org_owner === true || user?.is_super_admin === true;
  const canSeeMine = can("view_member_tasks") || can("view_group_tasks");
  const canSeeTaskList = isElevatedTaskViewer || canSeeMine;
  const canCreateMemberTask = can("manage_member_tasks");
  const canCreateGroupTask = can("manage_group_tasks");
  const canCreateTask = canCreateMemberTask || canCreateGroupTask;

  const params = useLocalSearchParams<{ pending?: string }>();
  const pendingOnly =
    params.pending === "1" || String(params.pending || "").toLowerCase() === "true";

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusScope, setStatusScope] = useState<StatusScope>("open");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all");

  const [branchMonth, setBranchMonth] = useState("");
  const [dueFromMonth, setDueFromMonth] = useState("");
  const [dueToMonth, setDueToMonth] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [createdById, setCreatedById] = useState("");
  const [draftStatusScope, setDraftStatusScope] = useState<StatusScope>("open");
  const [draftTypeFilter, setDraftTypeFilter] = useState<TaskTypeFilter>("all");
  const [draftBranchMonth, setDraftBranchMonth] = useState("");
  const [draftDueMode, setDraftDueMode] = useState<DueMonthMode>("single");
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [draftDueFromMonth, setDraftDueFromMonth] = useState("");
  const [draftDueToMonth, setDraftDueToMonth] = useState("");
  const [draftAssigneeId, setDraftAssigneeId] = useState("");
  const [draftCreatedById, setDraftCreatedById] = useState("");
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([]);

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

  const fetchTaskPage = useCallback(
    async (offset: number) => {
      if (!canSeeTaskList) return { tasks: [] as TaskItem[], total_count: 0 };
      const wantAll = statusScope === "all" || pendingOnly;
      if (isElevatedTaskViewer) {
        return api.tasks.branch({
          status: wantAll ? "all" : "open",
          orgWide: true,
          month: branchMonth.trim() || undefined,
          dueFromIso: monthStartIso(dueFromMonth.trim()),
          dueToIso: monthEndIso(dueToMonth.trim()),
          assigneeProfileId: assigneeId.trim() || undefined,
          createdByProfileId: createdById.trim() || undefined,
          offset,
          limit: PAGE_SIZE,
        });
      }
      return api.tasks.mine({ status: wantAll ? "all" : "open", offset, limit: PAGE_SIZE });
    },
    [
      assigneeId,
      branchMonth,
      canSeeTaskList,
      createdById,
      dueFromMonth,
      dueToMonth,
      isElevatedTaskViewer,
      pendingOnly,
      statusScope,
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
      const cacheKey = `${TASKS_CACHE_KEY}:${isElevatedTaskViewer ? "branch" : "mine"}:${statusScope}:${branchMonth}:${dueFromMonth}:${dueToMonth}:${assigneeId}:${createdById}:${pendingOnly ? "pending" : "all"}`;
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
        const cacheKey = `${TASKS_CACHE_KEY}:${isElevatedTaskViewer ? "branch" : "mine"}:${statusScope}:${branchMonth}:${dueFromMonth}:${dueToMonth}:${assigneeId}:${createdById}:${pendingOnly ? "pending" : "all"}`;
        void setOfflineResourceCache(cacheKey, { tasks: merged, total_count });
        return merged;
      });
      setTasksTotalCount(total_count);
      setHasMore(next.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [canSeeTaskList, fetchTaskPage, hasMore, loading, loadingMore, refreshing, tasks.length]);

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
    if (!canSeeTaskList) {
      setStaffOptions([]);
      return;
    }
    let c = false;
    void (async () => {
      const staff = await api.org.staff().catch(() => []);
      if (!c) setStaffOptions(staff as StaffRow[]);
    })();
    return () => {
      c = true;
    };
  }, [canSeeTaskList]);

  useEffect(() => {
    if (!filtersOpen) return;
    setDraftStatusScope(statusScope);
    setDraftTypeFilter(typeFilter);
    setDraftBranchMonth(branchMonth);
    setDraftDueMode(dueToMonth.trim() ? "range" : "single");
    setDraftDueFromMonth(dueFromMonth);
    setDraftDueToMonth(dueToMonth);
    setDraftAssigneeId(assigneeId);
    setDraftCreatedById(createdById);
  }, [filtersOpen, statusScope, typeFilter, branchMonth, dueFromMonth, dueToMonth, assigneeId, createdById]);

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

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks;
    if (pendingOnly) {
      list = list.filter((t) => String(t.status || "").toLowerCase() === "pending");
    }
    if (typeFilter !== "all") {
      list = list.filter((t) =>
        typeFilter === "group" ? isGroupTask(t) : !isGroupTask(t)
      );
    }
    if (!q) return list;
    return list.filter((t) => taskSearchBlob(t).includes(q));
  }, [tasks, search, typeFilter, pendingOnly]);

  const taskHeaderCount = useMemo(() => {
    if (!canSeeTaskList) return 0;
    if (search.trim() || typeFilter !== "all" || pendingOnly) return filteredTasks.length;
    return tasksTotalCount;
  }, [canSeeTaskList, search, typeFilter, pendingOnly, filteredTasks.length, tasksTotalCount]);

  const filterChips = useMemo((): FilterResultChip[] => {
    const chips: FilterResultChip[] = [];
    if (statusScope === "all") {
      chips.push({
        key: "status",
        label: "All tasks",
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
    if (isElevatedTaskViewer && branchMonth.trim()) {
      chips.push({
        key: "month",
        label: months.find((o) => o.value === branchMonth.trim())?.label ?? branchMonth,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (isElevatedTaskViewer && assigneeId.trim()) {
      const s = staffOptions.find((x) => x.id === assigneeId);
      chips.push({
        key: "assignee",
        label: `Assignee: ${displayMemberWords(s ? staffLabel(s) : assigneeId.slice(0, 8))}`,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (isElevatedTaskViewer && createdById.trim()) {
      const s = staffOptions.find((x) => x.id === createdById);
      chips.push({
        key: "createdBy",
        label: `By: ${displayMemberWords(s ? staffLabel(s) : createdById.slice(0, 8))}`,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (isElevatedTaskViewer && dueFromMonth.trim()) {
      chips.push({
        key: "dueFrom",
        label: `Due from ${monthLabelFromValue(dueFromMonth)}`,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (isElevatedTaskViewer && dueToMonth.trim()) {
      chips.push({
        key: "dueTo",
        label: `Due to ${monthLabelFromValue(dueToMonth)}`,
        onLabelPress: () => setFiltersOpen(true),
      });
    }
    if (pendingOnly) {
      chips.push({ key: "pending", label: "Pending", onLabelPress: () => router.setParams({ pending: undefined }) });
    }
    return chips;
  }, [
    statusScope,
    typeFilter,
    isElevatedTaskViewer,
    branchMonth,
    assigneeId,
    createdById,
    dueFromMonth,
    dueToMonth,
    months,
    staffOptions,
    pendingOnly,
    router,
  ]);

  const clearAppliedFilters = useCallback(() => {
    setStatusScope("open");
    setTypeFilter("all");
    setBranchMonth("");
    setDueFromMonth("");
    setDueToMonth("");
    setAssigneeId("");
    setCreatedById("");
    router.setParams({ pending: undefined });
  }, [router]);

  const removeFilterByKey = useCallback(
    (key: string) => {
      if (key === "status") setStatusScope("open");
      else if (key === "type") setTypeFilter("all");
      else if (key === "month") setBranchMonth("");
      else if (key === "assignee") setAssigneeId("");
      else if (key === "createdBy") setCreatedById("");
      else if (key === "dueFrom") setDueFromMonth("");
      else if (key === "dueTo") setDueToMonth("");
      else if (key === "pending") router.setParams({ pending: undefined });
    },
    [router]
  );

  const staffPickerOptions = useMemo(() => {
    const o = [{ value: "", label: "Anyone" }];
    for (const s of staffOptions) o.push({ value: s.id, label: displayMemberWords(staffLabel(s)) });
    return o;
  }, [staffOptions]);

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
    setDraftStatusScope("open");
    setDraftTypeFilter("all");
    setDraftBranchMonth("");
    setDraftDueMode("single");
    setDuePickerOpen(false);
    setDraftDueFromMonth("");
    setDraftDueToMonth("");
    setDraftAssigneeId("");
    setDraftCreatedById("");
  }

  function applyDraftFilters() {
    const from = draftDueFromMonth.trim();
    const to = draftDueMode === "range" ? draftDueToMonth.trim() : "";
    const validRange = from && to && from > to;
    if (validRange) {
      Alert.alert("Invalid due range", "From month cannot be later than To month.");
      return;
    }
    setStatusScope(draftStatusScope);
    setTypeFilter(draftTypeFilter);
    setBranchMonth(draftBranchMonth);
    setDueFromMonth(from);
    setDueToMonth(to);
    setAssigneeId(draftAssigneeId);
    setCreatedById(draftCreatedById);
    setDuePickerOpen(false);
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
            title="Filters"
            subtitle="Refine task list"
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
                {(["open", "all"] as StatusScope[]).map((val) => {
                  const active = draftStatusScope === val;
                  return (
                    <Pressable
                      key={val}
                      style={[styles.choiceChip, active && styles.choiceChipActive]}
                      onPress={() => setDraftStatusScope(val)}
                    >
                      <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                        {val === "open" ? "Open" : "All"}
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

            {isElevatedTaskViewer ? (
              <>
                <View style={styles.filterBlock}>
                  <Text style={styles.filterLabel}>Due month</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                    {months.map((opt) => {
                      const active = draftBranchMonth === opt.value;
                      return (
                        <Pressable
                          key={opt.value || "any"}
                          style={[styles.choiceChip, active && styles.choiceChipActive]}
                          onPress={() => setDraftBranchMonth(opt.value)}
                        >
                          <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.filterBlock}>
                  <Text style={styles.filterLabel}>Assignee</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                    {staffPickerOptions.map((opt) => {
                      const active = draftAssigneeId === opt.value;
                      return (
                        <Pressable
                          key={`assignee-${opt.value || "any"}`}
                          style={[styles.choiceChip, active && styles.choiceChipActive]}
                          onPress={() => setDraftAssigneeId(opt.value)}
                        >
                          <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.filterBlock}>
                  <Text style={styles.filterLabel}>Assigned by</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                    {staffPickerOptions.map((opt) => {
                      const active = draftCreatedById === opt.value;
                      return (
                        <Pressable
                          key={`creator-${opt.value || "any"}`}
                          style={[styles.choiceChip, active && styles.choiceChipActive]}
                          onPress={() => setDraftCreatedById(opt.value)}
                        >
                          <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View style={styles.filterBlock}>
                  <Text style={styles.filterLabel}>Due date</Text>
                  <Pressable style={styles.duePickerTrigger} onPress={() => setDuePickerOpen(true)}>
                    <Calendar size={sizes.headerIcon} color={colors.textSecondary} strokeWidth={2} />
                    <Text style={styles.duePickerTriggerText} numberOfLines={1}>
                      {draftDueFromMonth.trim()
                        ? draftDueMode === "range" && draftDueToMonth.trim()
                          ? `${monthLabelFromValue(draftDueFromMonth)} → ${monthLabelFromValue(draftDueToMonth)}`
                          : monthLabelFromValue(draftDueFromMonth)
                        : "Any month"}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </>
            ) : null}
          </FormModalShell>

          <Modal visible={duePickerOpen} transparent animationType="fade" onRequestClose={() => setDuePickerOpen(false)}>
            <Pressable style={styles.dueModalBackdrop} onPress={() => setDuePickerOpen(false)}>
              <Pressable style={styles.dueModalCard} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.dueModalTitle}>Due date</Text>
                <Text style={styles.filterHint}>Pick one month or switch to range</Text>

                <View style={styles.dueModeRow}>
                  <Pressable
                    style={[styles.choiceChip, draftDueMode === "single" && styles.choiceChipActive]}
                    onPress={() => {
                      setDraftDueMode("single");
                      setDraftDueToMonth("");
                    }}
                  >
                    <Text style={[styles.choiceChipText, draftDueMode === "single" && styles.choiceChipTextActive]}>
                      One way
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.choiceChip, draftDueMode === "range" && styles.choiceChipActive]}
                    onPress={() => setDraftDueMode("range")}
                  >
                    <Text style={[styles.choiceChipText, draftDueMode === "range" && styles.choiceChipTextActive]}>
                      Round trip
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.filterBlock}>
                  <Text style={styles.dueLab}>From</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                    {months.map((opt) => {
                      const active = draftDueFromMonth === opt.value;
                      return (
                        <Pressable
                          key={`duefrom-popup-${opt.value || "any"}`}
                          style={[styles.choiceChip, active && styles.choiceChipActive]}
                          onPress={() => setDraftDueFromMonth(opt.value)}
                        >
                          <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {draftDueMode === "range" ? (
                  <View style={styles.filterBlock}>
                    <Text style={styles.dueLab}>To</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                      {months.map((opt) => {
                        const active = draftDueToMonth === opt.value;
                        return (
                          <Pressable
                            key={`dueto-popup-${opt.value || "any"}`}
                            style={[styles.choiceChip, active && styles.choiceChipActive]}
                            onPress={() => setDraftDueToMonth(opt.value)}
                          >
                            <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{opt.label}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.dueModalActions}>
                  <Pressable
                    style={styles.filterClearBtn}
                    onPress={() => {
                      setDraftDueFromMonth("");
                      setDraftDueToMonth("");
                      setDuePickerOpen(false);
                    }}
                  >
                    <Text style={styles.filterClearBtnText}>Clear</Text>
                  </Pressable>
                  <Pressable style={styles.filterApplyBtn} onPress={() => setDuePickerOpen(false)}>
                    <Text style={styles.filterApplyBtnText}>Done</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          {loading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.helper}>Loading tasks…</Text>
            </View>
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
  dueModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  dueModalActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 4,
  },
  dueLab: { fontSize: type.caption.size - 1, fontWeight: "600", color: colors.textSecondary, marginBottom: 2 },
  clearDue: { fontSize: type.caption.size, color: colors.accent, fontWeight: "600", paddingVertical: 4 },
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
