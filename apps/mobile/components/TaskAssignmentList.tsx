import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FormModalShell } from "./FormModalShell";
import { DatePickerField } from "./datetime/DatePickerField";
import { GroupCreateTaskModal } from "./GroupCreateTaskModal";
import { MemberCreateTaskModal } from "./MemberCreateTaskModal";
import { Ionicons } from "@expo/vector-icons";
import type { Member, TaskItem } from "@sheepmug/shared-api";
import { FilterPickerModal, type AnchorRect } from "./FilterPickerModal";
import { FilterTriggerButton } from "./FilterTriggerButton";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { useBranch } from "../contexts/BranchContext";
import { toYmd } from "../lib/dateTimeFormat";
import {
  displayMemberWords,
  formatCalendarCountdown,
  formatLongWeekdayDateTime,
} from "../lib/memberDisplayFormat";
import { usePermissions } from "../hooks/usePermissions";
import { colors, radius, type } from "../theme";
import { useOfflineSync } from "../contexts/OfflineSyncContext";

type ChecklistItem = { id: string; label: string; done: boolean };

type StaffRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  branch_id: string | null;
};

function staffDisplayName(s: StaffRow): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  if (s.email?.trim()) return s.email.trim();
  return s.id.slice(0, 8);
}

function readRelatedMemberIds(t: TaskItem): string[] {
  const raw = (t as { related_member_ids?: unknown }).related_member_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function leaderIdsFromTaskItem(t: TaskItem): string[] {
  const raw = (t as { assignee_profile_ids?: unknown }).assignee_profile_ids;
  if (Array.isArray(raw) && raw.length > 0) {
    const ids = raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (ids.length) return [...new Set(ids)];
  }
  const one = String((t as { assignee_profile_id?: string | null }).assignee_profile_id ?? "").trim();
  return one ? [one] : [];
}

function replaceAssigneeNamesWithSelf(rawName: string, t: TaskItem, viewerId: string | null): string {
  if (!viewerId) return rawName;
  const ids = leaderIdsFromTaskItem(t);
  if (ids.length === 0) return rawName;
  const parts = rawName
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) return rawName;
  const out = parts.map((name, i) => (ids[i] && ids[i] === viewerId ? "Self" : name));
  return out.join(", ");
}

function isTaskCreator(t: TaskItem, viewerId: string | null): boolean {
  if (!viewerId) return false;
  const createdBy = String((t as { created_by_profile_id?: string | null }).created_by_profile_id ?? "").trim();
  return Boolean(createdBy && createdBy === viewerId);
}

function taskMembersLine(
  ms: { id: string; first_name: string | null; last_name: string | null }[] | undefined
): string {
  if (!ms?.length) return "";
  return ms
    .map((m) => [m.first_name, m.last_name].filter(Boolean).join(" ").trim())
    .filter(Boolean)
    .join(", ");
}

function readChecklist(t: TaskItem): ChecklistItem[] {
  const raw = (t as { checklist?: unknown }).checklist;
  if (!Array.isArray(raw)) return [];
  const out: ChecklistItem[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && "id" in x) {
      const o = x as { id?: string; label?: string; done?: boolean };
      if (typeof o.id === "string") {
        out.push({
          id: o.id,
          label: typeof o.label === "string" ? o.label : "",
          done: Boolean(o.done),
        });
      }
    }
  }
  return out;
}

function statusBadgeColors(status: string): { bg: string; text: string } {
  switch (status) {
    case "completed":
      return { bg: colors.accentSurface, text: "#1d4ed8" };
    case "in_progress":
      return { bg: "#eff6ff", text: "#1e40af" };
    case "cancelled":
      return { bg: "#f3f4f6", text: "#4b5563" };
    default:
      return { bg: "#fffbeb", text: "#92400e" };
  }
}

function formatStatusLabel(status: string): string {
  return displayMemberWords(status.replace(/_/g, " "));
}

/** Comma-separated API names (assignees, groups); each segment title-cased. */
function formatCommaSeparatedDisplay(line: string): string {
  const t = line.trim();
  if (!t) return t;
  return t
    .split(",")
    .map((p) => displayMemberWords(p.trim()))
    .filter(Boolean)
    .join(", ");
}

/** Date-only due_at as ISO (noon local) for stable API parsing. */
function dueDateToIso(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  return x.toISOString();
}

type TaskStatusFilterId = "all" | "pending" | "in_progress" | "completed" | "cancelled";
type TaskDueFilterId = "all" | "upcoming" | "past" | "none";

const TASK_STATUS_FILTER_OPTIONS: { id: TaskStatusFilterId; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Pending" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

const TASK_DUE_FILTER_OPTIONS: { id: TaskDueFilterId; label: string }[] = [
  { id: "all", label: "All due dates" },
  { id: "upcoming", label: "Due upcoming" },
  { id: "past", label: "Past due" },
  { id: "none", label: "No due date" },
];

function taskDueCategory(t: TaskItem): "upcoming" | "past" | "none" {
  const raw = (t as { due_at?: string | null }).due_at;
  if (!raw || !String(raw).trim()) return "none";
  const ms = new Date(String(raw)).getTime();
  if (Number.isNaN(ms)) return "none";
  return ms >= Date.now() ? "upcoming" : "past";
}

function isGroupTask(t: TaskItem): boolean {
  return (t as { task_type?: string }).task_type === "group";
}

function taskGroupsLine(gs: { id?: string; name?: string | null }[] | undefined): string {
  if (!gs?.length) return "";
  return gs
    .map((g) => String(g.name ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export type TaskAssignmentVariant = "member" | "mine" | "group";

type Props = {
  variant: TaskAssignmentVariant;
  tasks: TaskItem[];
  setTasks: Dispatch<SetStateAction<TaskItem[]>>;
  /** Initial screen load. */
  pageLoading: boolean;
  /** Required when `variant === "member"` (create task). */
  memberId?: string;
  /** Shown in add-task modal when `variant === "member"`. */
  primaryMemberDisplayName?: string;
  /** Required when `variant === "group"` (locked create + scope). */
  groupId?: string;
  /** Parent-fetch error (e.g. GET group tasks failed). */
  taskLoadError?: string | null;
  /** After group task create; modal already closed (e.g. reload list from API). */
  onAfterGroupTaskCreated?: () => void | Promise<void>;
};

export function TaskAssignmentList({
  variant,
  tasks,
  setTasks,
  pageLoading,
  memberId,
  primaryMemberDisplayName,
  groupId,
  taskLoadError,
  onAfterGroupTaskCreated,
}: Props) {
  const { user } = useAuth();
  const { isOnline, queueTaskPatch } = useOfflineSync();
  const { can } = usePermissions();
  const viewerId = user?.id ?? null;
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [newTodoDraft, setNewTodoDraft] = useState<Record<string, string>>({});
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilterId>("all");
  const [taskDueFilter, setTaskDueFilter] = useState<TaskDueFilterId>("all");
  const [taskFilterMenuOpen, setTaskFilterMenuOpen] = useState<null | "status" | "due">(null);
  const [taskFilterAnchor, setTaskFilterAnchor] = useState<AnchorRect | null>(null);
  const taskStatusTriggerRef = useRef<View>(null);
  const taskDueTriggerRef = useRef<View>(null);
  const [editingChecklist, setEditingChecklist] = useState<{ taskId: string; itemId: string } | null>(null);
  const [editChecklistLabelDraft, setEditChecklistLabelDraft] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [showEditTask, setShowEditTask] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  /** Member tasks only — matches web Member detail task edit. */
  const [editAssigneeIds, setEditAssigneeIds] = useState<Set<string>>(() => new Set());
  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [editRelatedMemberIds, setEditRelatedMemberIds] = useState<Set<string>>(() => new Set());
  const [staffOptions, setStaffOptions] = useState<StaffRow[]>([]);
  const [branchMembersForEdit, setBranchMembersForEdit] = useState<Member[]>([]);

  const { selectedBranch } = useBranch();

  const canManageMemberTasks = can("manage_member_tasks");
  const canManageGroupTasks = can("manage_group_tasks");

  const canManageTask = useCallback(
    (t: TaskItem) => (isGroupTask(t) ? canManageGroupTasks : canManageMemberTasks),
    [canManageGroupTasks, canManageMemberTasks]
  );

  /**
   * Inline add/remove/rename on the task row — off for anyone assigned to this task (including staff with
   * manage_* who are assignees). They can still toggle done; reshaping is for non-assignee managers or web.
   */
  const canEditChecklistStructureForTask = useCallback(
    (t: TaskItem) => {
      if (!viewerId) return false;
      const leaders = leaderIdsFromTaskItem(t);
      if (leaders.length > 0 && leaders.includes(viewerId)) return false;
      if (isGroupTask(t)) {
        return can("manage_group_tasks") || can("manage_group_task_checklist");
      }
      return can("manage_member_tasks") || can("manage_member_task_checklist");
    },
    [can, viewerId]
  );

  const applyTaskPatchLocally = useCallback((t: TaskItem, body: Record<string, unknown>): TaskItem => {
    return {
      ...t,
      ...body,
      updated_at: new Date().toISOString(),
    } as TaskItem;
  }, []);

  const patchTask = useCallback(
    async (t: TaskItem, body: Record<string, unknown>) => {
      if (!isOnline) {
        const keys = Object.keys(body);
        const isChecklistOnly = keys.length === 1 && keys[0] === "checklist" && Array.isArray(body.checklist);
        if (!isChecklistOnly) {
          throw new Error("Offline edits only support checklist updates.");
        }
        await queueTaskPatch(isGroupTask(t) ? "group" : "member", t.id, body);
        const nextTask = applyTaskPatchLocally(t, body);
        return { task: nextTask } as { task?: TaskItem; error?: string };
      }
      if (isGroupTask(t)) {
        return api.groups.patchGroupTask(t.id, body);
      }
      return api.members.patchMemberTask(t.id, body);
    },
    [isOnline, queueTaskPatch, applyTaskPatchLocally]
  );

  const canToggleChecklistForTask = useCallback(
    (t: TaskItem): boolean => {
      if (!user) return false;
      const status = String((t as { status?: string }).status ?? "pending");
      if (status === "cancelled") return false;
      if (isGroupTask(t) && status === "completed") return false;
      if (viewerId && leaderIdsFromTaskItem(t).includes(viewerId)) return true;
      if (isGroupTask(t)) {
        return can("manage_group_tasks") || can("manage_group_task_checklist");
      }
      return can("manage_member_tasks") || can("manage_member_task_checklist");
    },
    [user, viewerId, can]
  );

  const canStructuralEditOrDeleteTask = useCallback(
    (t: TaskItem) =>
      Boolean(
        viewerId &&
          (user?.is_org_owner === true || canManageTask(t) || isTaskCreator(t, viewerId))
      ),
    [viewerId, user?.is_org_owner, canManageTask]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const mergeTask = useCallback(
    (taskId: string, updated: TaskItem | undefined) => {
      if (!updated) return;
      setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, ...updated } : x)));
    },
    [setTasks]
  );

  const handleDelete = useCallback(
    (t: TaskItem) => {
      Alert.alert(
        "Delete task",
        isGroupTask(t) ? "Remove this group task?" : "Remove this task for the member?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const taskId = t.id;
                setBusyTaskId(taskId);
                try {
                  if (isGroupTask(t)) {
                    await api.groups.deleteGroupTask(taskId);
                  } else {
                    await api.members.deleteMemberTask(taskId);
                  }
                  setTasks((prev) => prev.filter((x) => x.id !== taskId));
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : "Could not delete task";
                  Alert.alert("Task", msg);
                } finally {
                  setBusyTaskId(null);
                }
              })();
            },
          },
        ]
      );
    },
    [setTasks]
  );

  const handleToggleChecklist = useCallback(
    async (t: TaskItem, itemId: string, done: boolean) => {
      if (!canToggleChecklistForTask(t)) return;
      const status = String((t as { status?: string }).status ?? "pending");
      if (status === "cancelled") return;

      const items = readChecklist(t);
      setBusyTaskId(t.id);
      try {
        if (viewerId && leaderIdsFromTaskItem(t).includes(viewerId)) {
          const res = await patchTask(t, { checklist: [{ id: itemId, done }] });
          mergeTask(t.id, res.task);
        } else {
          const full = items.map((c) => (c.id === itemId ? { ...c, done } : c));
          const res = await patchTask(t, {
            checklist: full.map((c) => ({ id: c.id, label: c.label, done: c.done })),
          });
          mergeTask(t.id, res.task);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not update checklist";
        Alert.alert("Task", msg);
      } finally {
        setBusyTaskId(null);
      }
    },
    [mergeTask, viewerId, canToggleChecklistForTask, patchTask]
  );

  const handleAddChecklistStep = useCallback(
    async (t: TaskItem, draftText: string) => {
      if (!canEditChecklistStructureForTask(t)) return;
      const status = String((t as { status?: string }).status ?? "pending");
      if (status === "cancelled") return;
      const label = draftText.trim();
      if (!label) {
        Alert.alert("Task", "Enter a step description.");
        return;
      }
      const items = readChecklist(t);
      const next = [...items.map((c) => ({ id: c.id, label: c.label, done: c.done })), { label, done: false }];
      setBusyTaskId(t.id);
      try {
        const res = await patchTask(t, { checklist: next });
        mergeTask(t.id, res.task);
        setNewTodoDraft((prev) => ({ ...prev, [t.id]: "" }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not add step";
        Alert.alert("Task", msg);
      } finally {
        setBusyTaskId(null);
      }
    },
    [canEditChecklistStructureForTask, mergeTask, patchTask]
  );

  const handleRemoveChecklistStep = useCallback(
    async (t: TaskItem, itemId: string) => {
      if (!canEditChecklistStructureForTask(t)) return;
      const items = readChecklist(t).filter((c) => c.id !== itemId);
      setBusyTaskId(t.id);
      try {
        const res = await patchTask(t, {
          checklist: items.map((c) => ({ id: c.id, label: c.label, done: c.done })),
        });
        mergeTask(t.id, res.task);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not remove step";
        Alert.alert("Task", msg);
      } finally {
        setBusyTaskId(null);
      }
    },
    [canEditChecklistStructureForTask, mergeTask, patchTask]
  );

  const confirmRemoveChecklistStep = useCallback(
    (t: TaskItem, itemId: string, stepLabel: string) => {
      Alert.alert(
        "Remove step?",
        `Remove "${stepLabel.trim() || "this step"}" from the checklist? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void handleRemoveChecklistStep(t, itemId),
          },
        ]
      );
    },
    [handleRemoveChecklistStep]
  );

  const beginEditChecklistLabel = useCallback(
    (t: TaskItem, item: ChecklistItem) => {
      if (!canEditChecklistStructureForTask(t)) return;
      setEditingChecklist({ taskId: t.id, itemId: item.id });
      setEditChecklistLabelDraft(item.label);
    },
    [canEditChecklistStructureForTask]
  );

  const cancelEditChecklistLabel = useCallback(() => {
    setEditingChecklist(null);
    setEditChecklistLabelDraft("");
  }, []);

  const saveEditChecklistLabel = useCallback(
    async (t: TaskItem) => {
      if (!editingChecklist || editingChecklist.taskId !== t.id || !canEditChecklistStructureForTask(t)) return;
      const label = editChecklistLabelDraft.trim();
      if (!label) {
        Alert.alert("Task", "Enter a step description.");
        return;
      }
      const items = readChecklist(t).map((c) =>
        c.id === editingChecklist.itemId ? { ...c, label } : c
      );
      setBusyTaskId(t.id);
      try {
        const res = await patchTask(t, {
          checklist: items.map((c) => ({ id: c.id, label: c.label, done: c.done })),
        });
        mergeTask(t.id, res.task);
        cancelEditChecklistLabel();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not update step";
        Alert.alert("Task", msg);
      } finally {
        setBusyTaskId(null);
      }
    },
    [editingChecklist, editChecklistLabelDraft, canEditChecklistStructureForTask, mergeTask, cancelEditChecklistLabel, patchTask]
  );

  const beginEditTask = useCallback((t: TaskItem) => {
    if (!canStructuralEditOrDeleteTask(t)) return;
    setEditTaskId(t.id);
    setEditTitle(String(t.title || ""));
    setEditDesc(String((t as { description?: string | null }).description ?? ""));
    if (!isGroupTask(t)) {
      setEditAssigneeIds(new Set(leaderIdsFromTaskItem(t)));
      const rawDue = (t as { due_at?: string | null }).due_at;
      if (rawDue != null && String(rawDue).trim()) {
        const d = new Date(String(rawDue));
        setEditDueDate(Number.isNaN(d.getTime()) ? null : d);
      } else {
        setEditDueDate(null);
      }
      setEditRelatedMemberIds(new Set(readRelatedMemberIds(t)));
    } else {
      setEditAssigneeIds(new Set());
      setEditDueDate(null);
      setEditRelatedMemberIds(new Set());
    }
    setShowEditTask(true);
  }, [canStructuralEditOrDeleteTask]);

  const closeEditTaskModal = useCallback(() => {
    setShowEditTask(false);
    setEditTaskId(null);
    setEditTitle("");
    setEditDesc("");
    setEditSaving(false);
    setEditAssigneeIds(new Set());
    setEditDueDate(null);
    setEditRelatedMemberIds(new Set());
    setStaffOptions([]);
    setBranchMembersForEdit([]);
  }, []);

  useEffect(() => {
    if (!showEditTask || !editTaskId || variant !== "member" || !memberId) return;
    const t = tasks.find((x) => x.id === editTaskId);
    if (!t || isGroupTask(t)) return;
    let cancelled = false;
    void (async () => {
      try {
        const [staffRows, memberPayload] = await Promise.all([
          api.org.staff().catch(() => [] as StaffRow[]),
          api.members.list({ limit: 100 }).catch(() => ({ members: [] as Member[], total_count: 0 })),
        ]);
        if (cancelled) return;
        const bid = selectedBranch?.id?.trim() || null;
        const staffFiltered = bid
          ? staffRows.filter((r) => !r.branch_id || String(r.branch_id) === bid)
          : staffRows;
        setStaffOptions(staffFiltered);
        const bm = memberPayload.members.filter((m) => {
          const mb = (m as { branch_id?: string | null }).branch_id;
          if (!bid) return true;
          return mb != null && String(mb) === bid;
        });
        setBranchMembersForEdit(bm);
      } catch {
        if (!cancelled) {
          setStaffOptions([]);
          setBranchMembersForEdit([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showEditTask, editTaskId, variant, memberId, tasks, selectedBranch?.id]);

  const editingTask = useMemo(
    () => (editTaskId ? tasks.find((x) => x.id === editTaskId) : undefined),
    [editTaskId, tasks]
  );

  const isEditingMemberTask = Boolean(editingTask && !isGroupTask(editingTask));

  const handleSaveEditedTask = useCallback(async () => {
    const tid = editTaskId;
    if (!tid) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert("Task", "Enter a title.");
      return;
    }
    const t = tasks.find((x) => x.id === tid);
      if (!t || !canStructuralEditOrDeleteTask(t)) return;
    setEditSaving(true);
    try {
      if (isGroupTask(t)) {
        const res = await patchTask(t, {
          title,
          description: editDesc.trim() || null,
        });
        mergeTask(tid, res.task);
        closeEditTaskModal();
        return;
      }
      if (editAssigneeIds.size === 0) {
        Alert.alert("Task", "Choose at least one assignee.");
        setEditSaving(false);
        return;
      }
      const primaryMemberId = String(memberId || "").trim();
      const related = [...editRelatedMemberIds].filter((id) => id !== primaryMemberId);
      const body: Record<string, unknown> = {
        title,
        description: editDesc.trim() || null,
        assignee_profile_ids: [...editAssigneeIds],
        related_member_ids: related,
        due_at: editDueDate ? dueDateToIso(editDueDate) : null,
      };
      const res = await patchTask(t, body);
      mergeTask(tid, res.task);
      closeEditTaskModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save task";
      Alert.alert("Task", msg);
    } finally {
      setEditSaving(false);
    }
  }, [
    editTaskId,
    editTitle,
    editDesc,
    editAssigneeIds,
    editDueDate,
    editRelatedMemberIds,
    tasks,
    canStructuralEditOrDeleteTask,
    patchTask,
    mergeTask,
    closeEditTaskModal,
    memberId,
  ]);

  const closeAddTaskModal = useCallback(() => {
    setShowAddTask(false);
  }, []);

  const showLoading = pageLoading && tasks.length === 0;

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (variant === "mine") {
      return sortedTasks;
    }
    const q = taskSearch.trim().toLowerCase();
    return sortedTasks.filter((t) => {
      const st = String((t as { status?: string }).status ?? "pending");
      if (taskStatusFilter !== "all" && st !== taskStatusFilter) return false;
      if (taskDueFilter !== "all") {
        const cat = taskDueCategory(t);
        if (cat !== taskDueFilter) return false;
      }
      if (q) {
        const r = t as { assignee_name?: string | null; groups?: { name?: string | null }[] };
        const groupNames = taskGroupsLine(r.groups);
        const blob = [t.title, t.description, st, r.assignee_name, groupNames].filter(Boolean).join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [sortedTasks, taskStatusFilter, taskDueFilter, taskSearch, variant]);

  const editTaskFooter = (
    <View style={styles.addTaskFooter}>
      <Pressable onPress={closeEditTaskModal} disabled={editSaving} style={[styles.addTaskFooterBtn, styles.addTaskFooterBtnSecondary]}>
        <Text style={styles.addTaskFooterBtnSecondaryText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={() => void handleSaveEditedTask()}
        disabled={editSaving || !editTitle.trim()}
        style={[styles.addTaskFooterBtn, styles.addTaskFooterBtnPrimary, editSaving && { opacity: 0.7 }]}
      >
        {editSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.addTaskFooterBtnPrimaryText}>Save</Text>}
      </Pressable>
    </View>
  );

  if (variant === "mine" && tasks.length === 0) {
    return null;
  }

  return (
    <View style={styles.outer}>
      {variant === "member" && memberId ? (
        <MemberCreateTaskModal
          visible={showAddTask}
          lockedPrimaryMemberId={memberId}
          lockedPrimaryMemberLabel={primaryMemberDisplayName}
          onClose={closeAddTaskModal}
          onSuccess={(created) => {
            if (created) setTasks((prev) => [created as TaskItem, ...prev]);
          }}
        />
      ) : null}
      {variant === "group" && groupId ? (
        <GroupCreateTaskModal
          visible={showAddTask}
          lockedContextGroupId={groupId}
          onClose={closeAddTaskModal}
          onSuccess={() => {
            void onAfterGroupTaskCreated?.();
          }}
        />
      ) : null}

      <FormModalShell
        visible={showEditTask}
        onClose={closeEditTaskModal}
        title="Edit task"
        subtitle={
          isEditingMemberTask
            ? "Title, assignee, due date, and linked members (same as web)."
            : "Update title and description."
        }
        headerIcon="create-outline"
        variant="compact"
        footer={editTaskFooter}
      >
        <View style={styles.addTaskFieldBlock}>
          <Text style={styles.addTaskFieldLabel}>Title</Text>
          <TextInput
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Task title"
            placeholderTextColor={colors.textSecondary}
            style={styles.addTaskInput}
          />
        </View>
        <View style={styles.addTaskFieldBlock}>
          <Text style={styles.addTaskFieldLabel}>Description</Text>
          <TextInput
            value={editDesc}
            onChangeText={setEditDesc}
            placeholder="Description (optional)"
            placeholderTextColor={colors.textSecondary}
            style={[styles.addTaskInput, { minHeight: 70, textAlignVertical: "top" }]}
            multiline
          />
        </View>
        {isEditingMemberTask && memberId ? (
          <>
            <View style={styles.addTaskFieldBlock}>
              <Text style={styles.addTaskFieldLabel}>Assign to (leaders)</Text>
              <Text style={styles.linkedMembersHint}>Select one or more staff.</Text>
              <ScrollView style={styles.linkedMembersScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {staffOptions.map((s) => {
                  const checked = editAssigneeIds.has(s.id);
                  return (
                    <Pressable
                      key={s.id}
                      style={({ pressed }) => [styles.linkedMemberRow, pressed && { opacity: 0.92 }]}
                      onPress={() => {
                        setEditAssigneeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        });
                      }}
                    >
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={22}
                        color={checked ? colors.accent : colors.textSecondary}
                      />
                      <Text style={styles.linkedMemberLabel} numberOfLines={2}>
                        {displayMemberWords(staffDisplayName(s))}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <View style={styles.addTaskFieldBlock}>
              <Text style={styles.addTaskFieldLabel}>Due date (optional)</Text>
              <DatePickerField
                value={editDueDate ? toYmd(editDueDate) : ""}
                onChange={(ymd) => {
                  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
                  if (!m) return;
                  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
                  setEditDueDate(Number.isNaN(d.getTime()) ? null : d);
                }}
                placeholder="Select date"
              />
              {editDueDate != null ? (
                <Pressable onPress={() => setEditDueDate(null)} style={styles.addTaskClearDue}>
                  <Text style={styles.addTaskClearDueText}>Clear date</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.addTaskFieldBlock}>
              <Text style={styles.addTaskFieldLabel}>Linked members</Text>
              <Text style={styles.linkedMembersHint}>
                Optional — link other people in this branch to the same task (excluding the primary member).
              </Text>
              <ScrollView style={styles.linkedMembersScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {branchMembersForEdit
                  .filter((m) => m.id !== memberId)
                  .map((m) => {
                    const checked = editRelatedMemberIds.has(m.id);
                    const label = displayMemberWords(
                      `${m.first_name || ""} ${m.last_name || ""}`.trim() || (m as { email?: string }).email || "Member"
                    );
                    return (
                      <Pressable
                        key={m.id}
                        style={({ pressed }) => [styles.linkedMemberRow, pressed && { opacity: 0.92 }]}
                        onPress={() => {
                          setEditRelatedMemberIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          });
                        }}
                      >
                        <Ionicons
                          name={checked ? "checkbox" : "square-outline"}
                          size={22}
                          color={checked ? colors.accent : colors.textSecondary}
                        />
                        <Text style={styles.linkedMemberLabel} numberOfLines={2}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
              </ScrollView>
            </View>
          </>
        ) : null}
      </FormModalShell>

      <View style={variant === "member" || variant === "group" ? styles.card : styles.mineOuter}>
        {variant === "member" ? (
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderTitle}>Member tasks</Text>
            <Text style={styles.cardHeaderSubtitle}>Tasks for this member</Text>
          </View>
        ) : variant === "group" ? (
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderTitle}>Group tasks</Text>
            <Text style={styles.cardHeaderSubtitle}>Tasks for this ministry</Text>
          </View>
        ) : null}
        {(variant === "member" || variant === "group") && taskLoadError ? (
          <Text style={styles.taskLoadErrorBanner}>{taskLoadError}</Text>
        ) : null}
        {(variant === "member" || variant === "group") && showLoading ? (
          <View style={styles.loadingBody}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : (
          <>
            {variant === "member" || variant === "group" ? (
              <View style={styles.unifiedToolbar}>
              <View style={styles.taskSearchRowCompact}>
                <Ionicons name="search" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <TextInput
                  value={taskSearch}
                  onChangeText={setTaskSearch}
                  placeholder="Search…"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.taskSearchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.toolbarFilters}>
                <FilterTriggerButton
                  ref={taskStatusTriggerRef}
                  open={taskFilterMenuOpen === "status"}
                  valueLabel={TASK_STATUS_FILTER_OPTIONS.find((o) => o.id === taskStatusFilter)?.label ?? "Status"}
                  accessibilityLabel={`Status, ${
                    TASK_STATUS_FILTER_OPTIONS.find((o) => o.id === taskStatusFilter)?.label ?? ""
                  }. Double tap to change.`}
                  onPress={() => {
                    taskStatusTriggerRef.current?.measureInWindow((x, y, w, h) => {
                      setTaskFilterAnchor({ x, y, width: w, height: h });
                      setTaskFilterMenuOpen("status");
                    });
                  }}
                />
                <FilterTriggerButton
                  ref={taskDueTriggerRef}
                  open={taskFilterMenuOpen === "due"}
                  valueLabel={TASK_DUE_FILTER_OPTIONS.find((o) => o.id === taskDueFilter)?.label ?? "Due"}
                  accessibilityLabel={`Due date, ${
                    TASK_DUE_FILTER_OPTIONS.find((o) => o.id === taskDueFilter)?.label ?? ""
                  }. Double tap to change.`}
                  onPress={() => {
                    taskDueTriggerRef.current?.measureInWindow((x, y, w, h) => {
                      setTaskFilterAnchor({ x, y, width: w, height: h });
                      setTaskFilterMenuOpen("due");
                    });
                  }}
                />
              </View>
              {variant === "member" && canManageMemberTasks ? (
                <Pressable
                  accessibilityLabel="Add task"
                  style={({ pressed }) => [styles.addTaskIconBtn, pressed && styles.addTaskIconBtnPressed]}
                  onPress={() => setShowAddTask(true)}
                >
                  <Ionicons name="add" size={22} color="#fff" />
                </Pressable>
              ) : variant === "group" && canManageGroupTasks ? (
                <Pressable
                  accessibilityLabel="Add group task"
                  style={({ pressed }) => [styles.addTaskIconBtn, pressed && styles.addTaskIconBtnPressed]}
                  onPress={() => setShowAddTask(true)}
                >
                  <Ionicons name="add" size={22} color="#fff" />
                </Pressable>
              ) : null}
            </View>
            ) : null}
            {(variant === "member" || variant === "group") && sortedTasks.length === 0 ? (
              <View style={styles.emptyBody}>
                <Text style={styles.emptyText}>No tasks yet.</Text>
              </View>
            ) : (variant === "member" || variant === "group") && filteredTasks.length === 0 ? (
              <View style={styles.emptyBody}>
                <Text style={styles.emptyText}>No tasks match your filters.</Text>
              </View>
            ) : null}
            {filteredTasks.map((t) => {
              const raw = t as TaskItem & {
                description?: string | null;
                assignee_name?: string | null;
                created_by_name?: string | null;
                due_at?: string | null;
                members?: { id: string; first_name: string | null; last_name: string | null }[];
              };
              const status = String(raw.status ?? "pending");
              const items = readChecklist(t);
              const expanded = expandedIds.has(t.id);
              const busy = busyTaskId === t.id;
              const badge = statusBadgeColors(status);
              const linked = taskMembersLine(raw.members);
              const desc = raw.description ? String(raw.description).trim() : "";
              const assigneeName = raw.assignee_name ? String(raw.assignee_name) : "—";
              const assigneeNameDisplay =
                assigneeName === "—"
                  ? "—"
                  : formatCommaSeparatedDisplay(replaceAssigneeNamesWithSelf(assigneeName, t, viewerId));
              const createdBy = raw.created_by_name ? String(raw.created_by_name) : "—";
              const createdByDisplayRaw = isTaskCreator(t, viewerId) ? "Self" : createdBy;
              const createdByDisplay =
                createdByDisplayRaw === "—" ? "—" : formatCommaSeparatedDisplay(createdByDisplayRaw);
              const dueRaw = raw.due_at;
              const dueLine =
                dueRaw && String(dueRaw).trim() ? formatLongWeekdayDateTime(String(dueRaw)) || null : null;
              const dueCd = dueRaw && String(dueRaw).trim() ? formatCalendarCountdown(String(dueRaw)) : "";
              const checklistLocked =
                status === "cancelled" ||
                (isGroupTask(t) && status === "completed") ||
                !canToggleChecklistForTask(t);
              const showAddTodo = expanded && canEditChecklistStructureForTask(t) && status !== "cancelled";
              const showRemoveStep = canEditChecklistStructureForTask(t) && status !== "cancelled";
              const groupsLineRaw = taskGroupsLine(
                (t as { groups?: { id: string; name?: string | null }[] }).groups
              );
              const groupsLine = groupsLineRaw ? formatCommaSeparatedDisplay(groupsLineRaw) : "";

              return (
                <View key={t.id} style={styles.row}>
                  <View style={styles.rowTop}>
                    <Pressable
                      onPress={() => toggleExpanded(t.id)}
                      style={({ pressed }) => [styles.rowExpandPress, pressed && styles.rowHeaderPressed]}
                    >
                      <View style={styles.rowHeaderMain}>
                        <Ionicons
                          name={expanded ? "chevron-down" : "chevron-forward"}
                          size={18}
                          color={colors.textSecondary}
                          style={styles.chevron}
                        />
                        <View style={styles.rowTitleBlock}>
                          <View style={styles.titleRow}>
                            <Text
                              style={[styles.taskTitle, variant === "mine" && styles.taskTitleMine]}
                              numberOfLines={expanded ? undefined : 2}
                            >
                              {displayMemberWords(String(raw.title || "Untitled task"))}
                            </Text>
                            {variant === "mine" || variant === "group" ? (
                              <View style={styles.typePillMine}>
                                <Text style={styles.typePillMineText}>
                                  {isGroupTask(t) ? "Group" : "Member"}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {!expanded ? (
                            <Text style={styles.taskHint}>
                              {items.length === 0
                                ? "No checklist steps — tap to expand"
                                : `${items.length} checklist items — tap to expand`}
                            </Text>
                          ) : null}
                          {desc && expanded ? (
                            <Text style={[styles.taskDesc, variant === "mine" && styles.taskDescMine]}>
                              {desc}
                            </Text>
                          ) : null}
                          {variant === "group" ? (
                            <Text style={styles.taskMeta}>Assigned by: {createdByDisplay}</Text>
                          ) : (
                            <Text style={styles.taskMeta}>
                              Assignees: {assigneeNameDisplay} · Assigned by: {createdByDisplay}
                            </Text>
                          )}
                          {linked ? (
                            <Text style={styles.taskMeta}>
                              Linked: {formatCommaSeparatedDisplay(linked)}
                            </Text>
                          ) : null}
                          {isGroupTask(t) && groupsLine ? (
                            <Text style={styles.taskMeta}>Groups: {groupsLine}</Text>
                          ) : null}
                          {dueLine ? (
                            <Text style={styles.taskMeta}>
                              Due {dueLine}
                              {dueCd ? ` · ${dueCd}` : ""}
                            </Text>
                          ) : null}
                          <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.statusPillText, { color: badge.text }]}>
                              {formatStatusLabel(status)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </Pressable>
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.accent} style={styles.rowBusy} />
                    ) : null}
                  </View>

                  {expanded ? (
                    <>
                      {canStructuralEditOrDeleteTask(t) ? (
                        <Pressable
                          accessibilityLabel="Edit task title and description"
                          disabled={busy}
                          onPress={() => beginEditTask(t)}
                          style={({ pressed }) => [styles.editDetailsRow, pressed && { opacity: 0.85 }]}
                        >
                          <Ionicons name="create-outline" size={18} color={colors.accent} />
                          <Text style={styles.editDetailsText}>Edit details</Text>
                        </Pressable>
                      ) : null}
                      {items.length === 0 ? (
                        <View style={styles.checklistEmpty}>
                          <Text style={[styles.checklistEmptyText, variant === "mine" && styles.checklistTodoMine]}>
                            No checklist steps for this task.
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.checklistBox, checklistLocked && styles.checklistBoxMuted]}>
                          {items.map((item) => {
                            const isEditing =
                              editingChecklist?.taskId === t.id && editingChecklist?.itemId === item.id;
                            return (
                              <View key={item.id} style={styles.checklistRowOuter}>
                                {isEditing ? (
                                  <View style={styles.checklistEditBlock}>
                                    <TextInput
                                      value={editChecklistLabelDraft}
                                      onChangeText={setEditChecklistLabelDraft}
                                      editable={!busy}
                                      style={[styles.checklistEditInput, variant === "mine" && styles.checklistTodoMine]}
                                      placeholder="Step description"
                                      placeholderTextColor={colors.textSecondary}
                                    />
                                    <View style={styles.checklistEditActions}>
                                      <Pressable
                                        onPress={cancelEditChecklistLabel}
                                        disabled={busy}
                                        style={styles.checklistEditSecondaryBtn}
                                      >
                                        <Text style={styles.checklistEditSecondaryText}>Cancel</Text>
                                      </Pressable>
                                      <Pressable
                                        onPress={() => void saveEditChecklistLabel(t)}
                                        disabled={busy}
                                        style={styles.checklistEditPrimaryBtn}
                                      >
                                        <Text style={styles.checklistEditPrimaryText}>Save</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                ) : (
                                  <>
                                    <Pressable
                                      disabled={checklistLocked || busy}
                                      onPress={() => void handleToggleChecklist(t, item.id, !item.done)}
                                      style={styles.checklistRow}
                                    >
                                      <Ionicons
                                        name={item.done ? "checkmark-circle" : "square-outline"}
                                        size={22}
                                        color={checklistLocked ? colors.textSecondary : colors.accent}
                                      />
                                      <Text
                                        style={[
                                          styles.checklistLabel,
                                          variant === "mine" && styles.checklistTodoMine,
                                          item.done && styles.checklistLabelDone,
                                        ]}
                                        numberOfLines={4}
                                      >
                                        {displayMemberWords(item.label)}
                                      </Text>
                                    </Pressable>
                                    {showRemoveStep ? (
                                      <View style={styles.checklistRowActions}>
                                        <Pressable
                                          accessibilityLabel="Edit checklist step"
                                          hitSlop={8}
                                          disabled={busy}
                                          onPress={() => beginEditChecklistLabel(t, item)}
                                          style={({ pressed }) => [
                                            styles.checklistIconBtn,
                                            pressed && { opacity: 0.75 },
                                          ]}
                                        >
                                          <Ionicons name="create-outline" size={18} color="#6b7280" />
                                        </Pressable>
                                        <Pressable
                                          accessibilityLabel="Remove checklist step"
                                          hitSlop={8}
                                          disabled={busy}
                                          onPress={() => confirmRemoveChecklistStep(t, item.id, item.label)}
                                          style={({ pressed }) => [styles.checklistRemoveBtn, pressed && { opacity: 0.75 }]}
                                        >
                                          <View style={styles.checklistRemoveXWrap}>
                                            <Text style={styles.checklistRemoveXText}>x</Text>
                                          </View>
                                        </Pressable>
                                      </View>
                                    ) : null}
                                  </>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      )}
                      {showAddTodo ? (
                        <View style={styles.addTodoRow}>
                          <TextInput
                            value={newTodoDraft[t.id] ?? ""}
                            onChangeText={(text) => setNewTodoDraft((prev) => ({ ...prev, [t.id]: text }))}
                            placeholder="New checklist step…"
                            placeholderTextColor={colors.textSecondary}
                            editable={!busy}
                            style={[styles.addTodoInput, variant === "mine" && styles.checklistTodoMine]}
                          />
                          <Pressable
                            onPress={() => void handleAddChecklistStep(t, newTodoDraft[t.id] ?? "")}
                            disabled={busy}
                            style={({ pressed }) => [styles.addTodoBtn, pressed && { opacity: 0.9 }]}
                          >
                            <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
                            <Text style={[styles.addTodoBtnText, variant === "mine" && styles.checklistTodoMine]}>
                              Add
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {canStructuralEditOrDeleteTask(t) ? (
                        <Pressable
                          accessibilityLabel="Delete task"
                          disabled={busy}
                          onPress={() => handleDelete(t)}
                          style={({ pressed }) => [styles.deleteInCard, pressed && styles.deleteInCardPressed]}
                        >
                          <Ionicons name="trash-outline" size={18} color="#b91c1c" />
                          <Text style={styles.deleteInCardText}>Delete task</Text>
                        </Pressable>
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })}
          </>
        )}
      </View>

      {variant === "member" || variant === "group" ? (
      <FilterPickerModal
        visible={taskFilterMenuOpen !== null && taskFilterAnchor !== null}
        title={
          taskFilterMenuOpen === "status" ? "Status" : taskFilterMenuOpen === "due" ? "Due date" : ""
        }
        anchorRect={taskFilterAnchor}
        options={
          taskFilterMenuOpen === "status"
            ? TASK_STATUS_FILTER_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
            : taskFilterMenuOpen === "due"
              ? TASK_DUE_FILTER_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
              : []
        }
        selectedValue={
          taskFilterMenuOpen === "status"
            ? taskStatusFilter
            : taskFilterMenuOpen === "due"
              ? taskDueFilter
              : ""
        }
        onSelect={(v) => {
          if (taskFilterMenuOpen === "status") {
            setTaskStatusFilter(v as TaskStatusFilterId);
          } else if (taskFilterMenuOpen === "due") {
            setTaskDueFilter(v as TaskDueFilterId);
          }
        }}
        onClose={() => {
          setTaskFilterMenuOpen(null);
          setTaskFilterAnchor(null);
        }}
      />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { gap: 12 },
  mineOuter: {
    gap: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    flexWrap: "wrap",
  },
  taskTitleMine: {
    flex: 1,
    minWidth: 0,
  },
  typePillMine: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#ede9fe",
    flexShrink: 0,
  },
  typePillMineText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5b21b6",
    textTransform: "uppercase",
  },
  taskLoadErrorBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: type.caption.size,
    color: "#b91c1c",
    backgroundColor: "#fef2f2",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  editDetailsRow: {
    marginLeft: 38,
    marginRight: 14,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editDetailsText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.accent,
  },
  unifiedToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: "#fafafa",
  },
  taskSearchRowCompact: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolbarFilters: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 6,
    alignItems: "stretch",
  },
  addTaskIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  addTaskIconBtnPressed: { opacity: 0.92 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: "#fafafa",
  },
  cardHeaderTitle: {
    fontSize: type.caption.size + 1.5,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardHeaderSubtitle: {
    marginTop: 4,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  loadingBody: {
    paddingVertical: 28,
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: type.body.size + 1.5,
    color: colors.textSecondary,
  },
  emptyBody: {
    padding: 20,
  },
  emptyText: {
    fontSize: type.body.size + 1.5,
    color: colors.textSecondary,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowExpandPress: {
    flex: 1,
    minWidth: 0,
  },
  rowHeaderPressed: { backgroundColor: "#f9fafb" },
  rowHeaderMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 6 },
  chevron: { marginTop: 2 },
  rowTitleBlock: { flex: 1, minWidth: 0 },
  taskTitle: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: "#111827",
  },
  taskHint: {
    marginTop: 4,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  taskDesc: {
    marginTop: 6,
    fontSize: type.caption.size + 1.5,
    lineHeight: 18 + 1.5,
    color: "#4b5563",
  },
  /** Mine Tasks tab: description +2px vs member list */
  taskDescMine: {
    fontSize: type.caption.size + 1.5 + 2,
    lineHeight: 18 + 1.5 + 2,
  },
  /** Mine Tasks tab: checklist / todo row text +2px */
  checklistTodoMine: {
    fontSize: type.caption.size + 2,
    lineHeight: 20,
  },
  taskMeta: {
    marginTop: 4,
    fontSize: 12.5,
    color: colors.textSecondary,
    paddingLeft: 2,
  },
  statusPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 12.5,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  rowBusy: { marginLeft: 4, marginTop: 2 },
  deleteInCard: {
    marginLeft: 38,
    marginRight: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#fecaca",
    backgroundColor: "#fff",
  },
  deleteInCardPressed: { opacity: 0.9, backgroundColor: "#fef2f2" },
  deleteInCardText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: "#b91c1c",
  },
  checklistBox: {
    marginLeft: 38,
    marginRight: 14,
    marginBottom: 8,
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    gap: 8,
  },
  checklistBoxMuted: {
    opacity: 0.65,
  },
  checklistRowOuter: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  checklistEditBlock: {
    width: "100%",
    gap: 8,
  },
  checklistEditInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: type.caption.size,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  checklistEditActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    alignItems: "center",
  },
  checklistEditSecondaryBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  checklistEditSecondaryText: { fontSize: type.caption.size, color: colors.textSecondary, fontWeight: "600" },
  checklistEditPrimaryBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  checklistEditPrimaryText: { fontSize: type.caption.size, color: "#fff", fontWeight: "600" },
  checklistRowActions: { flexDirection: "row", alignItems: "flex-start", gap: 2 },
  checklistIconBtn: { padding: 4, marginTop: -2 },
  checklistRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 0,
  },
  checklistRemoveBtn: {
    padding: 2,
    marginTop: -2,
  },
  checklistRemoveXWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checklistRemoveXText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6b7280",
    lineHeight: 18,
  },
  checklistLabel: {
    flex: 1,
    fontSize: type.caption.size,
    color: "#1f2937",
    lineHeight: 18,
  },
  checklistLabelDone: {
    color: colors.textSecondary,
    textDecorationLine: "line-through",
  },
  checklistEmpty: {
    marginLeft: 38,
    marginRight: 14,
    marginBottom: 8,
    padding: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  checklistEmptyText: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
  },
  addTodoRow: {
    marginLeft: 38,
    marginRight: 14,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addTodoInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: type.caption.size,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  addTodoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  addTodoBtnText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.accent,
  },
  taskSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: type.caption.size + 1.5,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  addTaskClearDue: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 4,
  },
  addTaskClearDueText: {
    fontSize: type.caption.size,
    fontWeight: "600",
    color: colors.accent,
  },
  addTaskFieldBlock: { marginBottom: 10 },
  addTaskFieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  addTaskInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    backgroundColor: "#f8fafc",
  },
  linkedMembersHint: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  linkedMembersScroll: { maxHeight: 160 },
  linkedMemberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  linkedMemberLabel: {
    flex: 1,
    fontSize: type.body.size,
    color: colors.textPrimary,
  },
  addTaskFooter: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  addTaskFooterBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.sm, minWidth: 100, alignItems: "center" },
  addTaskFooterBtnSecondary: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  addTaskFooterBtnSecondaryText: { fontSize: type.body.size, fontWeight: "600", color: colors.textPrimary },
  addTaskFooterBtnPrimary: { backgroundColor: colors.accent },
  addTaskFooterBtnPrimaryText: { fontSize: type.body.size, fontWeight: "600", color: "#fff" },
});
