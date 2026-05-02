import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, ListTodo, ChevronDown, ChevronRight, Plus, Trash2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { groupApi } from '@/utils/api';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import { DateTimePickerField } from '@/components/datetime';
import { FilterResultChips } from '@/components/FilterResultChips';
import type { Group } from '@/types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  branchId: string | null | undefined;
  /** When set (e.g. ministry page), pre-selects that group. When null (Tasks page), user builds selection in-tree. */
  groupId: string | null;
  groupSelectionMode?: 'free' | 'current-plus-children';
  onSuccess?: () => void;
};

type TreeNode = Group & { children: TreeNode[] };

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function buildTree(flat: Group[]): TreeNode[] {
  const byParent = new Map<string | null, Group[]>();
  for (const g of flat) {
    const p = g.parent_group_id ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(g);
  }
  const sortFn = (a: Group, b: Group) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });

  function nest(parentId: string | null): TreeNode[] {
    const list = (byParent.get(parentId) || []).slice().sort(sortFn);
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
    const name = (n.name || '').toLowerCase();
    const desc = (n.description || '').toLowerCase();
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

function collectExpandedIdsForTree(nodes: TreeNode[]): Set<string> {
  const s = new Set<string>();
  const walk = (arr: TreeNode[]) => {
    for (const n of arr) {
      s.add(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return s;
}

function descendantIdsFromFlat(groupId: string, byId: Map<string, Group>): string[] {
  const out: string[] = [];
  const queue = [groupId];
  while (queue.length) {
    const pid = queue.shift()!;
    for (const g of byId.values()) {
      if (g.parent_group_id === pid) {
        out.push(g.id);
        queue.push(g.id);
      }
    }
  }
  return out;
}

/** Selected groups that have no selected ancestor — shallowest picks in each subtree. */
function selectedRootIds(selected: Set<string>, groupById: Map<string, Group>): string[] {
  const roots: string[] = [];
  for (const id of selected) {
    const g = groupById.get(id);
    const pid = g?.parent_group_id ?? null;
    if (pid && selected.has(pid)) continue;
    roots.push(id);
  }
  return roots.sort((a, b) =>
    (groupById.get(a)?.name || '').localeCompare(groupById.get(b)?.name || '', undefined, {
      sensitivity: 'base',
    }),
  );
}

function primaryGroupIdFromSelection(selected: Set<string>, groupById: Map<string, Group>): string | null {
  const roots = selectedRootIds(selected, groupById);
  return roots[0] ?? null;
}

export default function AssignGroupTaskModal({
  isOpen,
  onClose,
  token,
  branchId,
  groupId: groupIdProp,
  groupSelectionMode = 'free',
  onSuccess,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(true);
  const [checklistLines, setChecklistLines] = useState<{ key: string; label: string }[]>([]);
  const [urgency, setUrgency] = useState<'low' | 'urgent' | 'high'>('low');

  const [groupsFlat, setGroupsFlat] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [groupSearch, setGroupSearch] = useState('');

  const selectionSeededRef = useRef(false);

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groupsFlat) m.set(g.id, g);
    return m;
  }, [groupsFlat]);

  const treeRoots = useMemo(() => buildTree(groupsFlat), [groupsFlat]);
  const displayTree = useMemo(() => filterTreeBySearch(treeRoots, groupSearch), [treeRoots, groupSearch]);

  const lockRootId = groupSelectionMode === 'current-plus-children' ? groupIdProp : null;
  const lockedMode = Boolean(lockRootId && isUuid(lockRootId));
  const allowedLockedIds = useMemo(() => {
    if (!lockedMode || !lockRootId) return null;
    const next = new Set<string>([lockRootId]);
    for (const id of descendantIdsFromFlat(lockRootId, groupById)) next.add(id);
    return next;
  }, [lockedMode, lockRootId, groupById]);

  const primaryGroupId = useMemo(() => {
    if (lockedMode && lockRootId) return lockRootId;
    return primaryGroupIdFromSelection(selectedGroupIds, groupById);
  }, [lockedMode, lockRootId, selectedGroupIds, groupById]);

  const autoAssigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const gid of selectedGroupIds) {
      const g = groupById.get(gid) as (Group & { leader_id?: string | null }) | undefined;
      const leaderId = String(g?.leader_id ?? '').trim();
      if (leaderId && isUuid(leaderId)) ids.add(leaderId);
    }
    return [...ids];
  }, [selectedGroupIds, groupById]);

  useEffect(() => {
    if (!isOpen) {
      setTitle('');
      setDescription('');
      setDue('');
      setChecklistLines([]);
      setUrgency('low');
      setChecklistOpen(true);
      setGroupsFlat([]);
      setSelectedGroupIds(new Set());
      setExpandedIds(new Set());
      setGroupSearch('');
      setSubmitting(false);
      selectionSeededRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || groupsFlat.length === 0 || selectionSeededRef.current) return;
    selectionSeededRef.current = true;
    if (lockedMode && lockRootId && isUuid(lockRootId)) {
      const next = new Set<string>([lockRootId]);
      for (const d of descendantIdsFromFlat(lockRootId, groupById)) next.add(d);
      setSelectedGroupIds(next);
    } else if (groupIdProp && isUuid(groupIdProp)) {
      const next = new Set<string>([groupIdProp]);
      for (const d of descendantIdsFromFlat(groupIdProp, groupById)) next.add(d);
      setSelectedGroupIds(next);
    } else {
      setSelectedGroupIds(new Set());
    }
  }, [isOpen, groupsFlat.length, lockedMode, lockRootId, groupIdProp, groupById]);

  useEffect(() => {
    if (!isOpen || !token) return;
    setGroupsLoading(true);
    void (async () => {
      try {
        const url = new URL('/api/groups', window.location.origin);
        url.searchParams.set('tree', '1');
        url.searchParams.set('include_system', '1');
        if (branchId?.trim()) url.searchParams.set('branch_id', branchId.trim());
        const res = await fetch(url.toString(), {
          headers: withBranchScope(branchId ?? null, { Authorization: `Bearer ${token}` }),
        });
        const raw = await res.json().catch(() => []);
        if (!res.ok) {
          setGroupsFlat([]);
          toast.error(
            typeof (raw as { error?: string })?.error === 'string'
              ? (raw as { error: string }).error
              : 'Could not load groups',
          );
          return;
        }
        const arr = Array.isArray(raw) ? (raw as Group[]) : Array.isArray(raw?.groups) ? (raw.groups as Group[]) : [];
        setGroupsFlat(
          arr.slice().sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
          ),
        );
      } catch {
        setGroupsFlat([]);
      } finally {
        setGroupsLoading(false);
      }
    })();
  }, [isOpen, token, branchId]);

  useEffect(() => {
    if (!isOpen || !groupsFlat.length) return;
    if (lockedMode && lockRootId && isUuid(lockRootId) && !groupSearch.trim()) {
      const next = new Set<string>();
      let cur = groupById.get(lockRootId);
      while (cur?.parent_group_id) {
        next.add(cur.parent_group_id);
        cur = groupById.get(cur.parent_group_id);
      }
      next.add(lockRootId);
      for (const d of descendantIdsFromFlat(lockRootId, groupById)) next.add(d);
      setExpandedIds(next);
      return;
    }
    const roots = groupsFlat.filter((g) => !g.parent_group_id).map((g) => g.id);
    if (!groupSearch.trim()) {
      setExpandedIds(new Set(roots));
    } else {
      setExpandedIds(collectExpandedIdsForTree(displayTree));
    }
  }, [isOpen, groupsFlat, groupSearch, displayTree, lockedMode, lockRootId, groupById]);

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
    [groupById, lockedMode, lockRootId],
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

  const addChecklistLine = () => {
    setChecklistLines((prev) => [...prev, { key: `n-${Date.now()}-${prev.length}`, label: '' }]);
  };

  const removeChecklistLine = (key: string) => {
    setChecklistLines((prev) => prev.filter((l) => l.key !== key));
  };

  const submit = useCallback(async () => {
    const primary = primaryGroupId;
    if (!token || !primary || !isUuid(primary) || !selectedGroupIds.has(primary)) {
      toast.error('Select at least one group');
      return;
    }
    const t = title.trim();
    if (!t) {
      toast.error('Enter a title');
      return;
    }
    if (autoAssigneeIds.length === 0) {
      toast.error('No group leaders found on selected groups. Add group leaders first.');
      return;
    }
    const checklist = checklistLines
      .map((l) => l.label.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false }));
    const related = [...selectedGroupIds].filter((id) => isUuid(id) && id !== primary);

    setSubmitting(true);
    try {
      if (!token) {
        throw new Error('Session expired. Please log in again.');
      }
      const body: Record<string, unknown> = {
        title: t,
        assignee_profile_ids: autoAssigneeIds,
        related_group_ids: related,
        urgency,
      };
      if (description.trim()) body.description = description.trim();
      if (due.trim()) body.due_at = new Date(due).toISOString();
      if (checklist.length > 0) body.checklist = checklist;
      await groupApi.createTask(primary, body as {
        title: string;
        assignee_profile_ids: string[];
        related_group_ids?: string[];
        description?: string;
        due_at?: string;
        checklist?: { label: string; done: boolean }[];
        urgency?: 'low' | 'urgent' | 'high';
      });
      notifyMemberTasksChanged();
      onSuccess?.();
      toast.success('Task assigned');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create task');
    } finally {
      setSubmitting(false);
    }
  }, [
    token,
    primaryGroupId,
    selectedGroupIds,
    title,
    description,
    autoAssigneeIds,
    due,
    checklistLines,
    urgency,
    onClose,
    onSuccess,
  ]);

  const selectedSorted = useMemo(() => {
    return [...selectedGroupIds].sort((a, b) =>
      (groupById.get(a)?.name || '').localeCompare(groupById.get(b)?.name || '', undefined, {
        sensitivity: 'base',
      }),
    );
  }, [selectedGroupIds, groupById]);

  const groupSelectionChips = useMemo(() => {
    return selectedSorted.map((id) => ({
      id,
      label: groupById.get(id)?.name?.trim() || 'Untitled',
      onRemove: () => removeGroupBranch(id),
    }));
  }, [selectedSorted, groupById, removeGroupBranch]);

  const clearAllGroupSelection = useCallback(() => {
    if (lockedMode && lockRootId) {
      const next = new Set<string>([lockRootId]);
      for (const d of descendantIdsFromFlat(lockRootId, groupById)) next.add(d);
      setSelectedGroupIds(next);
      return;
    }
    setSelectedGroupIds(new Set());
  }, [lockedMode, lockRootId, groupById]);

  const canSubmit = Boolean(
    primaryGroupId &&
      isUuid(primaryGroupId) &&
      selectedGroupIds.has(primaryGroupId) &&
      selectedGroupIds.size > 0 &&
      title.trim() &&
      autoAssigneeIds.length > 0,
  );

  const renderTreeNodes = (nodes: TreeNode[], depth: number) => {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const expanded = expandedIds.has(node.id);
      const checked = selectedGroupIds.has(node.id);
      const disabledByLock = Boolean(lockedMode && allowedLockedIds && !allowedLockedIds.has(node.id));
      const inLockedScope = Boolean(lockedMode && allowedLockedIds?.has(node.id));

      return (
        <div key={node.id} className="select-none">
          <div
            className={`flex items-center gap-1 py-1 text-xs rounded-md border border-transparent ${
              disabledByLock
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200/80'
                : inLockedScope
                  ? 'bg-white'
                  : ''
            }`}
            style={{ paddingLeft: depth * 12 }}
            aria-disabled={disabledByLock || undefined}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleExpand(node.id)}
                className={`p-0.5 rounded shrink-0 ${
                  disabledByLock ? 'text-slate-400 hover:bg-slate-200/80' : 'hover:bg-gray-100 text-gray-500'
                }`}
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-4 inline-block shrink-0" />
            )}
            <label
              className={`flex items-center gap-2 min-w-0 flex-1 rounded px-1 py-0.5 ${
                disabledByLock
                  ? 'pointer-events-none cursor-not-allowed'
                  : 'cursor-pointer hover:bg-white/60'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleGroupCheckbox(node.id)}
                disabled={disabledByLock}
                className="rounded border-gray-300 shrink-0 disabled:opacity-50"
              />
              <span className={`truncate ${disabledByLock ? 'text-slate-500' : ''}`}>
                {node.name || 'Untitled'}
              </span>
            </label>
          </div>
          {hasChildren && expanded ? renderTreeNodes(node.children, depth + 1) : null}
        </div>
      );
    });
  };

  if (!isOpen) return null;

  const chipItems = groupSelectionChips.map((c) =>
    lockedMode && lockRootId && c.id === lockRootId ? { ...c, removable: false as const } : c,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col relative z-10"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ListTodo className="w-5 h-5 text-blue-600 shrink-0" />
            <h2 className="text-lg font-semibold text-gray-900 truncate">Assign group task</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          <div>
            <p className="text-xs font-bold text-blue-600 mb-3">Task</p>
            <label className="text-xs text-gray-500 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-slate-50"
              placeholder=""
            />
            <label className="text-xs text-gray-500 block mt-3 mb-1">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder=""
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none bg-slate-50"
            />
            <label className="text-xs text-gray-500 block mt-3 mb-1">Due (Optional)</label>
            <DateTimePickerField
              value={due}
              onChange={setDue}
              datePlaceholder="Due date"
              timePlaceholder="Due time"
              splitClassName="rounded-lg border-gray-200 bg-slate-50"
              triggerClassName="text-sm text-gray-900"
            />
            <label className="text-xs text-gray-500 block mt-3 mb-1">Urgency</label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as 'low' | 'urgent' | 'high')}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-slate-50"
            >
              <option value="low">Low</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="rounded-xl border border-gray-200 bg-slate-50/80 p-3 space-y-3">
            <div>
              <p className="text-xs font-bold text-blue-600">Groups</p>
              <p className="text-[11px] text-gray-500 mt-1">
                {lockedMode
                  ? 'This group and all its sub-groups are selected by default. Other ministries are grayed out and cannot be selected.'
                  : 'Checking a group selects it and all sub-groups. Unchecking removes that branch. Leaders on selected groups receive the task.'}
              </p>
            </div>

            {groupsLoading ? (
              <p className="text-xs text-gray-500">Loading groups…</p>
            ) : groupsFlat.length === 0 ? (
              <p className="text-xs text-amber-700">No groups in this branch. Add ministries under Ministries first.</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="search"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Filter groups…"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white"
                  />
                </div>

                <FilterResultChips
                  title="Selected groups"
                  chips={chipItems}
                  onClearAll={
                    lockedMode
                      ? selectedGroupIds.size > 1
                        ? clearAllGroupSelection
                        : undefined
                      : selectedGroupIds.size > 0
                        ? clearAllGroupSelection
                        : undefined
                  }
                />

                <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-lg bg-white p-2">
                  {renderTreeNodes(displayTree, 0)}
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-blue-600 mb-2">Checklist (Optional)</p>
            <button
              type="button"
              onClick={() => setChecklistOpen((o) => !o)}
              className="flex items-center gap-1 text-sm font-medium text-gray-800 mb-2"
            >
              {checklistOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              Steps
            </button>
            <AnimatePresence>
              {checklistOpen && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} className="space-y-2">
                  {checklistLines.map((line) => (
                    <div key={line.key} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={line.label}
                        onChange={(e) =>
                          setChecklistLines((prev) =>
                            prev.map((x) => (x.key === line.key ? { ...x, label: e.target.value } : x)),
                          )
                        }
                        placeholder=""
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-slate-50"
                      />
                      <button
                        type="button"
                        onClick={() => removeChecklistLine(line.key)}
                        className="p-1 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addChecklistLine}
                    className="text-xs font-medium text-blue-600 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add step
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !canSubmit}
            onClick={() => void submit()}
            className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Assign task'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
