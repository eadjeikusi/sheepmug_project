import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import type { Group } from "@sheepmug/shared-api";
import { ApiError } from "@sheepmug/shared-api";
import { FormModalShell } from "./FormModalShell";
import { YmdDateField } from "./YmdDateField";
import { api } from "../lib/api";
import { useBranch } from "../contexts/BranchContext";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { colors, radius, type } from "../theme";

type TreeNode = Group & { children: TreeNode[] };

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function parentId(g: Group): string | null {
  const raw = (g as { parent_group_id?: string | null }).parent_group_id;
  return raw != null && String(raw).trim() ? String(raw) : null;
}

function groupLabel(g: Group): string {
  const n = (g.name || "").trim();
  return n || g.id.slice(0, 8);
}

function buildTree(flat: Group[]): TreeNode[] {
  const byParent = new Map<string | null, Group[]>();
  for (const g of flat) {
    const p = parentId(g);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(g);
  }
  const sortFn = (a: Group, b: Group) =>
    groupLabel(a).localeCompare(groupLabel(b), undefined, { sensitivity: "base" });

  function nest(pid: string | null): TreeNode[] {
    const list = (byParent.get(pid) || []).slice().sort(sortFn);
    return list.map((g) => ({
      ...g,
      children: nest(g.id),
    }));
  }
  return nest(null);
}

function filterTreeBySearch(nodes: TreeNode[], q: string): TreeNode[] {
  const ql = q.trim().toLowerCase();
  if (!ql) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const name = (n.name || "").toLowerCase();
    const desc = String(n.description || "").toLowerCase();
    const selfMatch = name.includes(ql) || desc.includes(ql);
    const childFiltered = filterTreeBySearch(n.children, q);
    if (selfMatch) {
      out.push({ ...n, children: n.children });
    } else if (childFiltered.length > 0) {
      out.push({ ...n, children: childFiltered });
    }
  }
  return out;
}

function descendantIdsFromFlat(groupId: string, byId: Map<string, Group>): string[] {
  const out: string[] = [];
  const queue = [groupId];
  while (queue.length) {
    const pid = queue.shift()!;
    for (const g of byId.values()) {
      if (parentId(g) === pid) {
        out.push(g.id);
        queue.push(g.id);
      }
    }
  }
  return out;
}

function collectTreeNodeIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    ids.push(n.id, ...collectTreeNodeIds(n.children));
  }
  return ids;
}

function selectedRootIds(selected: Set<string>, groupById: Map<string, Group>): string[] {
  const roots: string[] = [];
  for (const id of selected) {
    const g = groupById.get(id);
    const pid = parentId(g ?? { id, name: "" });
    if (pid && selected.has(pid)) continue;
    roots.push(id);
  }
  return roots.sort((a, b) =>
    groupLabel(groupById.get(a) ?? { id: a, name: "" }).localeCompare(
      groupLabel(groupById.get(b) ?? { id: b, name: "" }),
      undefined,
      { sensitivity: "base" }
    )
  );
}

function primaryGroupIdFromSelection(selected: Set<string>, groupById: Map<string, Group>): string | null {
  const roots = selectedRootIds(selected, groupById);
  return roots[0] ?? null;
}

function ymdToDueAtIso(ymd: string): string | null {
  const t = ymd.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  lockedContextGroupId?: string | null;
};

export function GroupCreateTaskModal({ visible, onClose, onSuccess, lockedContextGroupId = null }: Props) {
  const { selectedBranch } = useBranch();
  const [loading, setLoading] = useState(false);
  const [groupsFlat, setGroupsFlat] = useState<Group[]>([]);

  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [groupSearch, setGroupSearch] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueYmd, setDueYmd] = useState("");
  const [checklistLines, setChecklistLines] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);

  const selectionSeededRef = useRef(false);

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groupsFlat) m.set(g.id, g);
    return m;
  }, [groupsFlat]);

  const treeRoots = useMemo(() => buildTree(groupsFlat), [groupsFlat]);
  const displayTree = useMemo(() => filterTreeBySearch(treeRoots, groupSearch), [treeRoots, groupSearch]);
  const lockRootId = lockedContextGroupId?.trim() && isUuid(lockedContextGroupId.trim()) ? lockedContextGroupId.trim() : null;
  const lockedMode = Boolean(lockRootId);

  const allowedLockedIds = useMemo(() => {
    if (!lockRootId) return null;
    const next = new Set<string>([lockRootId]);
    for (const id of descendantIdsFromFlat(lockRootId, groupById)) {
      next.add(id);
    }
    return next;
  }, [lockRootId, groupById]);

  const primaryGroupId = useMemo(() => {
    if (lockedMode && lockRootId) return lockRootId;
    return primaryGroupIdFromSelection(selectedGroupIds, groupById);
  }, [lockedMode, lockRootId, selectedGroupIds, groupById]);

  const autoAssigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const gid of selectedGroupIds) {
      const g = groupById.get(gid) as (Group & { leader_id?: string | null }) | undefined;
      const leaderId = String(g?.leader_id ?? "").trim();
      if (leaderId && isUuid(leaderId)) ids.add(leaderId);
    }
    return [...ids];
  }, [selectedGroupIds, groupById]);

  const selectedSorted = useMemo(() => {
    return [...selectedGroupIds].sort((a, b) =>
      groupLabel(groupById.get(a) ?? { id: a, name: "" }).localeCompare(
        groupLabel(groupById.get(b) ?? { id: b, name: "" }),
        undefined,
        { sensitivity: "base" }
      )
    );
  }, [selectedGroupIds, groupById]);

  const reset = useCallback(() => {
    setGroupsFlat([]);
    setSelectedGroupIds(new Set());
    setExpandedIds(new Set());
    setGroupSearch("");
    setTitle("");
    setDescription("");
    setDueYmd("");
    setChecklistLines([""]);
    setSubmitting(false);
    selectionSeededRef.current = false;
  }, []);

  useEffect(() => {
    if (!visible) return;
    reset();
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const groupList = await api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]);
        if (cancelled) return;
        const bid = selectedBranch?.id?.trim() || null;
        const byBranch = bid
          ? groupList.filter((g) => {
              const b = (g as { branch_id?: string | null }).branch_id;
              return b != null && String(b) === bid;
            })
          : null;
        const bg = byBranch && byBranch.length > 0 ? byBranch : groupList;
        setGroupsFlat(
          bg.slice().sort((a, b) =>
            groupLabel(a).localeCompare(groupLabel(b), undefined, { sensitivity: "base" })
          )
        );
      } catch {
        if (!cancelled) setGroupsFlat([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, selectedBranch?.id, reset]);

  useEffect(() => {
    if (!visible || groupsFlat.length === 0 || selectionSeededRef.current) return;
    selectionSeededRef.current = true;
    if (lockedMode && lockRootId) {
      const next = new Set<string>([lockRootId]);
      for (const d of descendantIdsFromFlat(lockRootId, groupById)) next.add(d);
      setSelectedGroupIds(next);
    } else {
      setSelectedGroupIds(new Set());
    }
  }, [visible, groupsFlat.length, lockedMode, lockRootId, groupById]);

  useEffect(() => {
    if (!visible || groupsFlat.length === 0) return;
    if (lockedMode && lockRootId && !groupSearch.trim()) {
      const next = new Set<string>();
      let cur = groupById.get(lockRootId);
      while (cur && parentId(cur)) {
        const pid = parentId(cur)!;
        next.add(pid);
        cur = groupById.get(pid);
      }
      next.add(lockRootId);
      for (const d of descendantIdsFromFlat(lockRootId, groupById)) next.add(d);
      setExpandedIds(next);
      return;
    }
    if (groupSearch.trim()) {
      setExpandedIds(new Set(collectTreeNodeIds(displayTree)));
    } else {
      const roots = groupsFlat.filter((g) => !parentId(g)).map((g) => g.id);
      setExpandedIds(new Set(roots));
    }
  }, [visible, groupsFlat, groupSearch, displayTree, lockedMode, lockRootId, groupById]);

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const removeGroupBranch = useCallback(
    (id: string) => {
      if (lockedMode && lockRootId && id === lockRootId) return;
      setSelectedGroupIds((prev) => {
        const toRemove = new Set<string>([id, ...descendantIdsFromFlat(id, groupById)]);
        const next = new Set(prev);
        for (const x of toRemove) next.delete(x);
        if (next.size === 0) return prev;
        if (lockedMode && lockRootId && !next.has(lockRootId)) return prev;
        return next;
      });
    },
    [groupById, lockedMode, lockRootId]
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupCheckbox = (id: string) => {
    if (lockedMode) {
      if (!allowedLockedIds?.has(id)) return;
      if (lockRootId && id === lockRootId) return;
    }
    setSelectedGroupIds((prev) => {
      if (prev.has(id)) {
        if (lockedMode && lockRootId && id === lockRootId) return prev;
        const toRemove = new Set<string>([id, ...descendantIdsFromFlat(id, groupById)]);
        const next = new Set(prev);
        for (const x of toRemove) next.delete(x);
        if (next.size === 0) return prev;
        if (lockedMode && lockRootId && !next.has(lockRootId)) return prev;
        return next;
      }
      const next = new Set(prev);
      next.add(id);
      for (const d of descendantIdsFromFlat(id, groupById)) next.add(d);
      return next;
    });
  };

  const canSubmit = Boolean(
    primaryGroupId &&
      selectedGroupIds.has(primaryGroupId) &&
      selectedGroupIds.size > 0 &&
      title.trim() &&
      autoAssigneeIds.length > 0
  );

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Task title required", "Enter a task title.");
      return;
    }
    const primary = primaryGroupId;
    if (!primary || !selectedGroupIds.has(primary)) {
      Alert.alert("Groups", "Select at least one group.");
      return;
    }
    if (autoAssigneeIds.length === 0) {
      Alert.alert("Leaders required", "No group leaders found on selected groups. Add group leaders first.");
      return;
    }
    const related_group_ids = [...selectedGroupIds].filter((id) => id !== primary);
    const checklist = checklistLines
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false as const }));
    const dueIso = dueYmd.trim() ? ymdToDueAtIso(dueYmd) : null;
    setSubmitting(true);
    try {
      await api.groups.createTask(primary, {
        title: t,
        assignee_profile_ids: autoAssigneeIds,
        description: description.trim() || undefined,
        due_at: dueIso,
        ...(related_group_ids.length > 0 ? { related_group_ids } : {}),
        ...(checklist.length > 0 ? { checklist } : {}),
      });
      Alert.alert("Task created", "The group task was created.");
      closeAndReset();
      onSuccess();
    } catch (e: unknown) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not create task";
      Alert.alert("Create task", msg);
    } finally {
      setSubmitting(false);
    }
  };

  function renderTreeNodes(nodes: TreeNode[], depth: number): ReactNode {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const expanded = expandedIds.has(node.id);
      const checked = selectedGroupIds.has(node.id);
      const disabledByLock = Boolean(lockedMode && allowedLockedIds && !allowedLockedIds.has(node.id));

      return (
        <View key={node.id}>
          <View
            style={[
              styles.treeRow,
              { paddingLeft: 8 + depth * 14 },
              disabledByLock ? styles.treeRowLockedOut : styles.treeRowInScope,
            ]}
          >
            {hasChildren ? (
              <Pressable onPress={() => toggleExpand(node.id)} style={styles.treeChevron} hitSlop={8}>
                <Ionicons
                  name={expanded ? "chevron-down" : "chevron-forward"}
                  size={18}
                  color={disabledByLock ? "#94a3b8" : colors.textSecondary}
                />
              </Pressable>
            ) : (
              <View style={styles.treeChevronSpacer} />
            )}
            <Pressable
              onPress={() => toggleGroupCheckbox(node.id)}
              style={styles.treeLabel}
              disabled={disabledByLock}
            >
              <Ionicons
                name={checked ? "checkbox" : "square-outline"}
                size={22}
                color={disabledByLock ? "#cbd5e1" : checked ? colors.accent : colors.textSecondary}
              />
              <Text style={[styles.treeText, disabledByLock && styles.treeTextLockedOut]} numberOfLines={1}>
                {groupLabel(node)}
              </Text>
            </Pressable>
          </View>
          {hasChildren && expanded ? <View>{renderTreeNodes(node.children, depth + 1)}</View> : null}
        </View>
      );
    });
  }

  const footer = (
    <View style={styles.footer}>
      <Pressable onPress={closeAndReset} disabled={submitting} style={[styles.footerBtn, styles.footerBtnSecondary]}>
        <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={() => void submit()}
        disabled={submitting || !canSubmit}
        style={[
          styles.footerBtn,
          styles.footerBtnPrimary,
          (submitting || !canSubmit) && { opacity: 0.55 },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.footerBtnPrimaryText}>Create task</Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <FormModalShell
      visible={visible}
      onClose={closeAndReset}
      title="Group task"
      subtitle="Assign a follow-up for ministries and groups"
      headerIcon="people-outline"
      footer={footer}
    >
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>Loading…</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>{displayMemberWords("Task")}</Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Title")}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder=""
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </View>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Description (optional)")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder=""
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, styles.inputMultiline]}
          multiline
          textAlignVertical="top"
        />
      </View>
      <YmdDateField label="Due date (optional)" value={dueYmd} onChange={setDueYmd} placeholder="" />

      <Text style={styles.sectionLabel}>{displayMemberWords("Checklist (optional)")}</Text>
      {checklistLines.map((line, idx) => (
        <View key={`todo-${idx}`} style={styles.checklistRow}>
          <TextInput
            value={line}
            onChangeText={(text) =>
              setChecklistLines((prev) => prev.map((x, j) => (j === idx ? text : x)))
            }
            placeholder=""
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, styles.checklistLineInput]}
          />
          {checklistLines.length > 1 ? (
            <Pressable
              onPress={() =>
                setChecklistLines((prev) =>
                  prev.length <= 1 ? [""] : prev.filter((_, j) => j !== idx)
                )
              }
              style={styles.checklistRemove}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color="#9ca3af" />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable onPress={() => setChecklistLines((prev) => [...prev, ""])} style={styles.addTodoBtn}>
        <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        <Text style={styles.addTodoText}>Add to-do</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>{displayMemberWords("Groups")}</Text>
      <Text style={styles.hint}>
        {lockedMode
          ? "This group and its sub-groups are selected by default. Other ministries are grayed out and cannot be selected."
          : "Tapping a group selects it and all sub-groups. Leaders on selected groups receive the task."}
      </Text>
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>{displayMemberWords("Search")}</Text>
        <TextInput
          value={groupSearch}
          onChangeText={setGroupSearch}
          placeholder=""
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {selectedSorted.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsRow}
        >
          {selectedSorted.map((id) => {
            const g = groupById.get(id);
            const label = g ? groupLabel(g) : id.slice(0, 8);
            const lockedChip = lockedMode && lockRootId && id === lockRootId;
            return (
              <View key={id} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {label}
                </Text>
                {!lockedChip ? (
                  <Pressable onPress={() => removeGroupBranch(id)} hitSlop={6} style={styles.chipRemove}>
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.treeWrap}>
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={styles.treeScroll}
        >
          {groupsFlat.length === 0 ? (
            <Text style={styles.hint}>No groups in this branch.</Text>
          ) : (
            renderTreeNodes(displayTree, 0)
          )}
        </ScrollView>
      </View>

      <Text style={styles.selectedCount}>
        {selectedGroupIds.size} group{selectedGroupIds.size === 1 ? "" : "s"} selected
      </Text>
    </FormModalShell>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: type.overline.size,
    fontWeight: "700",
    color: colors.accent,
    marginTop: 14,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  fieldBlock: { marginBottom: 10 },
  fieldLabel: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  hint: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  input: {
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
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  checklistLineInput: {
    flex: 1,
    minWidth: 0,
  },
  checklistRemove: {
    padding: 4,
  },
  addTodoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    marginBottom: 8,
  },
  addTodoText: {
    fontSize: type.body.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
  },
  chipsScroll: { maxHeight: 44, marginBottom: 8 },
  chipsRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 200,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { flexShrink: 1, fontSize: type.caption.size, color: colors.textPrimary, fontWeight: "600" },
  chipRemove: { padding: 2 },
  treeWrap: {
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#f8fafc",
    overflow: "hidden",
  },
  treeScroll: { maxHeight: 240 },
  treeRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    paddingVertical: 6,
    paddingRight: 8,
    marginVertical: 1,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  treeRowInScope: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  treeRowLockedOut: {
    backgroundColor: "#e2e8f0",
    borderColor: "#cbd5e1",
    opacity: 0.92,
  },
  treeChevron: { width: 28, alignItems: "center", justifyContent: "center" },
  treeChevronSpacer: { width: 28 },
  treeLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  treeText: { flex: 1, fontSize: type.body.size, color: colors.textPrimary },
  treeTextLockedOut: { color: "#64748b" },
  selectedCount: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  footerBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.sm,
    minWidth: 100,
    alignItems: "center",
  },
  footerBtnSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  footerBtnSecondaryText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  footerBtnPrimary: { backgroundColor: colors.accent },
  footerBtnPrimaryText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: "#fff",
  },
});
