import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ListTodo,
  ChevronDown,
  ChevronRight,
  Play,
  CheckCircle,
  RotateCcw,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import { usePermissions } from '@/hooks/usePermissions';
import AssignGroupTaskModal from '../modals/AssignGroupTaskModal';
import { DateTimePickerField } from '@/components/datetime';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';
import { formatLongWeekdayDateTime, formatCalendarCountdown } from '@/utils/dateDisplayFormat';

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function isChecklistLineId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function taskGroupsLine(gs: { id: string; name: string | null }[] | undefined) {
  if (!gs?.length) return '';
  return gs.map((g) => g.name || 'Group').filter(Boolean).join(', ');
}

type ChecklistItem = { id: string; label: string; done: boolean };

export type GroupTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  group_id: string;
  assignee_profile_id: string;
  assignee_profile_ids?: string[];
  created_by_profile_id: string;
  checklist: ChecklistItem[];
  related_group_ids: string[];
  groups: { id: string; name: string | null }[];
  assignee_name?: string;
  created_by_name?: string;
};

type ChecklistLineEdit = { key: string; id?: string; label: string; done: boolean };

type TaskTargetOptions = {
  current: { id: string; name: string | null };
  ancestors: { id: string; name: string | null }[];
  descendants: { id: string; name: string | null }[];
};

type Props = {
  groupId: string | null;
  /** When true (e.g. routed from Tasks with ?assign=1), open the assign modal once on mount. */
  openAssignOnMount?: boolean;
};

export default function GroupTasksSection({ groupId, openAssignOnMount = false }: Props) {
  const { token, user } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();

  const [tasks, setTasks] = useState<GroupTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [taskBeingEditedId, setTaskBeingEditedId] = useState<string | null>(null);
  const [editingChecklistOnly, setEditingChecklistOnly] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editChecklistLines, setEditChecklistLines] = useState<ChecklistLineEdit[]>([]);
  const [editRelatedGroupIds, setEditRelatedGroupIds] = useState<Set<string>>(new Set());
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editTargetOptions, setEditTargetOptions] = useState<TaskTargetOptions | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !groupId || !isUuid(groupId) || !can('view_group_tasks')) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/tasks`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const raw = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (raw as { tasks?: GroupTaskRow[] }).tasks;
        setTasks(Array.isArray(list) ? list : []);
      } else {
        setTasks([]);
      }
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [token, groupId, selectedBranch?.id, can]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!openAssignOnMount || !groupId || !isUuid(groupId)) return;
    if (!can('manage_group_tasks')) return;
    setAssignOpen(true);
  }, [openAssignOnMount, groupId, can]);

  const mergeTask = (prev: GroupTaskRow, partial: Partial<GroupTaskRow>): GroupTaskRow => ({
    ...prev,
    ...partial,
    checklist: partial.checklist !== undefined ? partial.checklist : prev.checklist,
    related_group_ids:
      partial.related_group_ids !== undefined ? partial.related_group_ids : prev.related_group_ids,
    assignee_profile_ids:
      partial.assignee_profile_ids !== undefined ? partial.assignee_profile_ids : prev.assignee_profile_ids,
    assignee_name: partial.assignee_name ?? prev.assignee_name,
    created_by_name: partial.created_by_name ?? prev.created_by_name,
    groups: prev.groups,
  });

  const leaderIdsFromGroupTask = (t: GroupTaskRow): string[] => {
    if (Array.isArray(t.assignee_profile_ids) && t.assignee_profile_ids.length > 0) {
      return [...new Set(t.assignee_profile_ids.filter((id) => isUuid(id)))];
    }
    return t.assignee_profile_id ? [t.assignee_profile_id] : [];
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canActOnTaskStatus = (t: GroupTaskRow) =>
    Boolean(user?.id && (leaderIdsFromGroupTask(t).includes(user.id) || can('manage_group_tasks')));

  const canToggleChecklist = (t: GroupTaskRow) =>
    Boolean(
      user?.id &&
        t.status !== 'cancelled' &&
        t.status !== 'completed' &&
        (leaderIdsFromGroupTask(t).includes(user.id) ||
          can('manage_group_tasks') ||
          can('manage_group_task_checklist')),
    );

  const canFullEditTask = (t: GroupTaskRow) =>
    Boolean(
      user?.id &&
        (user.is_org_owner === true ||
          can('manage_group_tasks') ||
          t.created_by_profile_id === user.id),
    );

  const handleUpdateStatus = async (taskId: string, status: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/group-tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ status }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not update task');
      const updated = (raw as { task?: GroupTaskRow }).task;
      if (updated) {
        setTasks((prev) => prev.map((x) => (x.id === taskId ? mergeTask(x, updated) : x)));
      } else {
        await refresh();
      }
      notifyMemberTasksChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update task');
    }
  };

  const handleDelete = async (taskId: string) => {
    const task = tasks.find((x) => x.id === taskId);
    if (!token || !task || !user?.id) return;
    if (!(user.is_org_owner === true || can('manage_group_tasks') || task.created_by_profile_id === user.id)) {
      return;
    }
    if (
      !window.confirm(
        'Delete this task permanently? Checklist progress will be lost. This cannot be undone.',
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/group-tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not delete');
      }
      if (taskBeingEditedId === taskId) setTaskBeingEditedId(null);
      await refresh();
      notifyMemberTasksChanged();
      toast.success('Task removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete task');
    }
  };

  const loadEditTargetOptions = async (primaryGroupId: string) => {
    if (!token || !isUuid(primaryGroupId)) {
      setEditTargetOptions(null);
      return;
    }
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(primaryGroupId)}/task-target-options`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const raw = await res.json().catch(() => ({}));
      if (res.ok) setEditTargetOptions(raw as TaskTargetOptions);
      else setEditTargetOptions(null);
    } catch {
      setEditTargetOptions(null);
    }
  };

  const beginEditTask = (t: GroupTaskRow) => {
    setEditingChecklistOnly(false);
    setTaskBeingEditedId(t.id);
    setEditTitle(t.title);
    setEditDescription(t.description ?? '');
    setEditDue(toDatetimeLocalValue(t.due_at));
    setEditChecklistLines(
      (t.checklist ?? []).map((c) => ({ key: c.id, id: c.id, label: c.label, done: c.done })),
    );
    setEditRelatedGroupIds(new Set((t.related_group_ids ?? []).filter((id) => isUuid(id))));
    void loadEditTargetOptions(t.group_id);
  };

  const beginEditChecklistOnly = (t: GroupTaskRow) => {
    setEditingChecklistOnly(true);
    setTaskBeingEditedId(t.id);
    setEditTitle(t.title);
    setEditChecklistLines(
      (t.checklist ?? []).map((c) => ({ key: c.id, id: c.id, label: c.label, done: c.done })),
    );
  };

  const cancelEditTask = () => {
    setTaskBeingEditedId(null);
    setEditSubmitting(false);
    setEditingChecklistOnly(false);
    setEditTargetOptions(null);
  };

  const handleSaveEditedTask = async () => {
    if (!token || !taskBeingEditedId) return;
    const cur = tasks.find((x) => x.id === taskBeingEditedId);
    if (!cur || !canFullEditTask(cur)) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error('Enter a title');
      return;
    }
    setEditSubmitting(true);
    try {
      const checklist = editChecklistLines
        .filter((l) => l.label.trim())
        .map((l) => {
          const label = l.label.trim();
          if (l.id && isChecklistLineId(l.id)) return { id: l.id, label, done: l.done };
          return { label, done: l.done };
        });
      const primary = cur?.group_id;
      if (!primary) throw new Error('Missing task');
      const related = [...editRelatedGroupIds].filter((id) => isUuid(id) && id !== primary);
      const body: Record<string, unknown> = {
        title,
        description: editDescription.trim() || null,
        checklist,
        related_group_ids: related,
      };
      if (editDue.trim()) body.due_at = new Date(editDue).toISOString();
      else body.due_at = null;

      const res = await fetch(`/api/group-tasks/${encodeURIComponent(taskBeingEditedId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not save task');
      cancelEditTask();
      await refresh();
      notifyMemberTasksChanged();
      toast.success('Task updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save task');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSaveChecklistOnlyEdit = async () => {
    if (!token || !taskBeingEditedId || !can('manage_group_task_checklist')) return;
    setEditSubmitting(true);
    try {
      const checklist = editChecklistLines
        .filter((l) => l.label.trim())
        .map((l) => {
          const label = l.label.trim();
          if (l.id && isChecklistLineId(l.id)) return { id: l.id, label, done: l.done };
          return { label, done: l.done };
        });
      const res = await fetch(`/api/group-tasks/${encodeURIComponent(taskBeingEditedId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ checklist }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not save checklist');
      const updated = (raw as { task?: GroupTaskRow }).task;
      if (updated) {
        setTasks((prev) =>
          prev.map((x) => (x.id === taskBeingEditedId ? mergeTask(x, updated) : x)),
        );
      } else {
        await refresh();
      }
      cancelEditTask();
      notifyMemberTasksChanged();
      toast.success('Checklist updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save checklist');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleToggleTaskChecklist = async (t: GroupTaskRow, itemId: string, done: boolean) => {
    if (!token || !canToggleChecklist(t)) return;
    if (user?.id && leaderIdsFromGroupTask(t).includes(user.id)) {
      try {
        const res = await fetch(`/api/group-tasks/${encodeURIComponent(t.id)}`, {
          method: 'PATCH',
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ checklist: [{ id: itemId, done }] }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not update checklist');
        const updated = (raw as { task?: GroupTaskRow }).task;
        if (updated) {
          setTasks((prev) => prev.map((x) => (x.id === t.id ? mergeTask(x, updated) : x)));
        } else {
          await refresh();
        }
        notifyMemberTasksChanged();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update checklist');
      }
      return;
    }
    const full = (t.checklist ?? []).map((c) => (c.id === itemId ? { ...c, done } : c));
    try {
      const res = await fetch(`/api/group-tasks/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          checklist: full.map((c) => ({ id: c.id, label: c.label, done: c.done })),
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not update checklist');
      const updated = (raw as { task?: GroupTaskRow }).task;
      if (updated) {
        setTasks((prev) => prev.map((x) => (x.id === t.id ? mergeTask(x, updated) : x)));
      } else {
        await refresh();
      }
      notifyMemberTasksChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update checklist');
    }
  };

  const editSelectableGroups = useMemo(() => {
    if (!editTargetOptions) return [];
    const list = [
      editTargetOptions.current,
      ...editTargetOptions.ancestors,
      ...editTargetOptions.descendants,
    ];
    const seen = new Set<string>();
    return list.filter((x) => {
      if (!isUuid(x.id) || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  }, [editTargetOptions]);

  if (!can('view_group_tasks')) return null;

  return (
    <div className="space-y-4">
      {can('manage_group_tasks') && groupId && isUuid(groupId) && (
        <button
          type="button"
          onClick={() => setAssignOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm"
        >
          <ListTodo className="w-4 h-4" />
          New task
        </button>
      )}

      <AssignGroupTaskModal
        isOpen={assignOpen}
        onClose={() => setAssignOpen(false)}
        token={token}
        branchId={selectedBranch?.id}
        groupId={groupId && isUuid(groupId) ? groupId : null}
        groupSelectionMode="current-plus-children"
        onSuccess={() => void refresh()}
      />

      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-semibold text-gray-900">Task list</h3>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No tasks yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tasks.map((t) => {
              const linked = taskGroupsLine(t.groups);
              const items = t.checklist ?? [];
              const expanded = expandedIds.has(t.id);
              const dueCd = t.due_at ? formatCalendarCountdown(t.due_at) : '';
              const checklistLocked =
                t.status === 'cancelled' || t.status === 'completed' || !canToggleChecklist(t);
              return (
                <li
                  key={t.id}
                  className="px-4 py-3 text-sm space-y-2 group"
                  onClick={(e) => {
                    if (taskBeingEditedId === t.id) return;
                    const el = e.target as HTMLElement;
                    if (el.closest('button, a, input, textarea, select, label')) return;
                    toggleExpanded(t.id);
                  }}
                >
                  {taskBeingEditedId === t.id && editingChecklistOnly ? (
                    <div
                      className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-semibold text-blue-900">Edit checklist</p>
                      <p className="text-sm font-medium text-gray-900">{editTitle}</p>
                      <div>
                        <p className="text-xs font-medium text-gray-700 mb-1">Checklist</p>
                        <div className="space-y-2">
                          {editChecklistLines.map((line) => (
                            <div key={line.key} className="flex gap-2 items-center">
                              <input
                                type="checkbox"
                                checked={line.done}
                                onChange={(e) =>
                                  setEditChecklistLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, done: e.target.checked } : x,
                                    ),
                                  )
                                }
                                className="rounded border-gray-300"
                              />
                              <input
                                type="text"
                                value={line.label}
                                onChange={(e) =>
                                  setEditChecklistLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, label: e.target.value } : x,
                                    ),
                                  )
                                }
                                placeholder="Step description"
                                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditChecklistLines((prev) => prev.filter((x) => x.key !== line.key))
                                }
                                className="p-1 text-gray-400 hover:text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setEditChecklistLines((prev) => [
                                ...prev,
                                { key: `e-${Date.now()}-${prev.length}`, label: '', done: false },
                              ])
                            }
                            className="text-xs font-medium text-blue-600"
                          >
                            + Add step
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={cancelEditTask}
                          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={editSubmitting}
                          onClick={() => void handleSaveChecklistOnlyEdit()}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50"
                        >
                          {editSubmitting ? 'Saving…' : 'Save checklist'}
                        </button>
                      </div>
                    </div>
                  ) : taskBeingEditedId === t.id && canFullEditTask(t) ? (
                    <div
                      className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-semibold text-blue-900">Edit task</p>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Due</label>
                          <DateTimePickerField
                            value={editDue}
                            onChange={setEditDue}
                            datePlaceholder="Due date"
                            timePlaceholder="Due time"
                            splitClassName="rounded-lg border-gray-200 bg-white"
                            triggerClassName="text-sm text-gray-900"
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-700 mb-1">Checklist</p>
                        <div className="space-y-2">
                          {editChecklistLines.map((line) => (
                            <div key={line.key} className="flex gap-2 items-center">
                              <input
                                type="checkbox"
                                checked={line.done}
                                onChange={(e) =>
                                  setEditChecklistLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, done: e.target.checked } : x,
                                    ),
                                  )
                                }
                                className="rounded border-gray-300"
                              />
                              <input
                                type="text"
                                value={line.label}
                                onChange={(e) =>
                                  setEditChecklistLines((prev) =>
                                    prev.map((x) =>
                                      x.key === line.key ? { ...x, label: e.target.value } : x,
                                    ),
                                  )
                                }
                                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditChecklistLines((prev) => prev.filter((x) => x.key !== line.key))
                                }
                                className="p-1 text-gray-400 hover:text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setEditChecklistLines((prev) => [
                                ...prev,
                                { key: `e-${Date.now()}-${prev.length}`, label: '', done: false },
                              ])
                            }
                            className="text-xs font-medium text-blue-600"
                          >
                            + Add step
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-700 mb-1">Linked groups</p>
                        <div className="max-h-28 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {editSelectableGroups.map((g) => {
                            const primary = t.group_id;
                            const isPrimary = g.id === primary;
                            return (
                              <label
                                key={g.id}
                                className={`flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-gray-50 cursor-pointer ${
                                  isPrimary ? 'bg-blue-50/60' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isPrimary || editRelatedGroupIds.has(g.id)}
                                  disabled={isPrimary}
                                  onChange={() => {
                                    if (isPrimary) return;
                                    setEditRelatedGroupIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(g.id)) next.delete(g.id);
                                      else next.add(g.id);
                                      return next;
                                    });
                                  }}
                                />
                                <span>{g.name || 'Untitled'}</span>
                                {isPrimary ? <span className="text-gray-400">(primary)</span> : null}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={cancelEditTask}
                          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={editSubmitting}
                          onClick={() => void handleSaveEditedTask()}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg disabled:opacity-50"
                        >
                          {editSubmitting ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 cursor-pointer">
                          <div className="w-full text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-gray-50/80 flex items-start gap-2">
                            <span className="mt-0.5 text-gray-400 shrink-0 group-hover:text-gray-600">
                              {expanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900">{t.title}</p>
                              {!expanded && (
                                <p className="text-[11px] text-gray-500 mt-0.5">
                                  {items.length === 0
                                    ? 'No checklist steps — tap to expand'
                                    : `${items.length} checklist items — tap to expand`}
                                </p>
                              )}
                            </div>
                          </div>
                          {t.description ? (
                            <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap pl-7">
                              {capitalizeSentencesForUi(t.description)}
                            </p>
                          ) : null}
                          <p className="text-xs text-gray-500 mt-0.5 pl-7">Assigned by: {t.created_by_name}</p>
                          {linked ? (
                            <p className="text-xs text-gray-500 pl-7">Linked groups: {linked}</p>
                          ) : null}
                          {t.due_at && (
                            <p className="text-xs text-gray-500 pl-7">
                              Due {formatLongWeekdayDateTime(t.due_at)}
                              {dueCd ? ` · ${dueCd}` : ''}
                            </p>
                          )}
                          <span
                            className={`inline-block mt-1 ml-7 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                              t.status === 'completed'
                                ? 'bg-blue-50 text-blue-800'
                                : t.status === 'in_progress'
                                  ? 'bg-blue-50 text-blue-800'
                                  : t.status === 'cancelled'
                                    ? 'bg-gray-100 text-gray-600'
                                    : 'bg-amber-50 text-amber-900'
                            }`}
                          >
                            {t.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div
                          className="flex flex-wrap gap-1 shrink-0 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t.status !== 'completed' &&
                            t.status !== 'cancelled' &&
                            canActOnTaskStatus(t) && (
                              <>
                                {t.status === 'pending' && (
                                  <button
                                    type="button"
                                    title="Start task"
                                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                                    onClick={() => void handleUpdateStatus(t.id, 'in_progress')}
                                  >
                                    <Play className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  title="Mark complete"
                                  className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                                  onClick={() => void handleUpdateStatus(t.id, 'completed')}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          {t.status === 'completed' && canActOnTaskStatus(t) && (
                            <button
                              type="button"
                              title="Reopen task"
                              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                              onClick={() => void handleUpdateStatus(t.id, 'pending')}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {canFullEditTask(t) && (
                            <>
                              <button
                                type="button"
                                title="Edit task"
                                className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                                onClick={() => beginEditTask(t)}
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                title="Delete task"
                                className="p-2 rounded-lg text-red-600 border border-red-100 hover:bg-red-50"
                                onClick={() => void handleDelete(t.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {can('manage_group_task_checklist') && !canFullEditTask(t) && (
                            <button
                              type="button"
                              title="Edit checklist"
                              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                              onClick={() => beginEditChecklistOnly(t)}
                            >
                              <ListTodo className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {expanded &&
                        (items.length === 0 ? (
                          <p
                            className={`text-xs text-gray-500 ml-5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2 ${
                              t.status === 'completed' ? 'opacity-60' : ''
                            }`}
                          >
                            No checklist steps for this task.
                          </p>
                        ) : (
                          <ul
                            className={`rounded-lg border border-gray-100 bg-gray-50/80 p-2 space-y-1.5 ml-5 ${
                              t.status === 'completed' ? 'opacity-60 text-gray-500 pointer-events-none' : ''
                            }`}
                          >
                            {items.map((item) => (
                              <li key={item.id} className="flex items-start gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  disabled={checklistLocked}
                                  onChange={(e) =>
                                    void handleToggleTaskChecklist(t, item.id, e.target.checked)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5 rounded border-gray-300"
                                />
                                <span
                                  className={item.done ? 'text-gray-500 line-through' : 'text-gray-800'}
                                >
                                  {item.label}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ))}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
