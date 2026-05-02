import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, ListTodo, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import type { Member } from '@/types';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import { DateTimePickerField } from '@/components/datetime';

function isMemberDbId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

type StaffRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  branch_id: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  branchId: string | null | undefined;
  /** Pre-selected member id(s); only the first id is used as the task subject. */
  initialSelectedMemberIds: string[];
  allMembers: Member[];
  onSuccess?: () => void;
  /** When true, member list is fixed to initial selection (single-member flows). */
  lockMemberSelection?: boolean;
  /** Pre-selected leader assignee profile ids (e.g. leader detail page). */
  initialAssigneeIds?: string[];
  /** When true, assignee checkboxes are hidden and `initialAssigneeIds` stay fixed. */
  lockAssignees?: boolean;
};

export default function AssignTaskModal({
  isOpen,
  onClose,
  token,
  branchId,
  initialSelectedMemberIds,
  allMembers,
  onSuccess,
  lockMemberSelection = false,
  initialAssigneeIds,
  lockAssignees = false,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(true);
  const [checklistLines, setChecklistLines] = useState<{ key: string; label: string }[]>([]);
  const [urgency, setUrgency] = useState<'low' | 'urgent' | 'high'>('low');
  /** Single member id this task is about (POST URL `/api/members/:id/tasks`). */
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const assignModalWasOpenRef = useRef(false);
  /** Always read latest initial ids without listing them in useEffect deps (avoids re-running on every parent render). */
  const initialMemberIdsRef = useRef(initialSelectedMemberIds);
  initialMemberIdsRef.current = initialSelectedMemberIds;
  const initialAssigneeIdsRef = useRef<string[] | undefined>(undefined);
  initialAssigneeIdsRef.current = initialAssigneeIds;

  const branchMembers = useMemo(() => {
    const bid = branchId?.trim() || '';
    return allMembers.filter((m) => {
      if (!isMemberDbId(m.id)) return false;
      const mb = (m as { branch_id?: string | null }).branch_id ?? null;
      if (!bid) return true;
      return mb != null && String(mb) === bid;
    });
  }, [allMembers, branchId]);

  useEffect(() => {
    if (!isOpen) {
      assignModalWasOpenRef.current = false;
      return;
    }
    if (!token) return;

    const justOpened = !assignModalWasOpenRef.current;
    assignModalWasOpenRef.current = true;

    if (!justOpened) return;

    setTitle('');
    setDescription('');
    setDue('');
    const presetAssignees = (initialAssigneeIdsRef.current || []).filter((id) => isMemberDbId(id));
    setAssigneeIds(presetAssignees);
    setChecklistLines([]);
    setUrgency('low');
    setChecklistOpen(true);
    setMemberSearch('');
    setSelectedMemberIds(initialSelectedMemberIds.filter(isMemberDbId).slice(0, 1));
    void (async () => {
      try {
        const res = await fetch('/api/org/staff', {
          headers: withBranchScope(branchId ?? null, { Authorization: `Bearer ${token}` }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed staff');
        const rows = (raw as { staff?: StaffRow[] }).staff;
        setStaff(Array.isArray(rows) ? rows : []);
      } catch {
        setStaff([]);
      }
    })();
  }, [isOpen, token, branchId, lockAssignees]);

  const pickableMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return branchMembers.filter((m) => {
      if (!q) return true;
      const label = (m.fullName || [m.first_name, m.last_name].join(' ') || m.email || '').toLowerCase();
      return label.includes(q);
    });
  }, [branchMembers, memberSearch]);

  const selectMember = useCallback(
    (id: string) => {
      if (lockMemberSelection) return;
      if (!isMemberDbId(id)) return;
      setSelectedMemberIds([id]);
    },
    [lockMemberSelection],
  );

  const lockedMemberLabel = useMemo(() => {
    if (!lockMemberSelection || selectedMemberIds.length === 0) return '';
    const id = selectedMemberIds[0];
    const m = allMembers.find((x) => x.id === id);
    return m
      ? String(m.fullName || [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || id).trim() || id
      : id;
  }, [lockMemberSelection, selectedMemberIds, allMembers]);

  const toggleAssignee = useCallback((id: string) => {
    if (lockAssignees) return;
    if (!id) return;
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, [lockAssignees]);

  const addChecklistLine = () => {
    setChecklistLines((prev) => [...prev, { key: `n-${Date.now()}-${prev.length}`, label: '' }]);
  };

  const removeChecklistLine = (key: string) => {
    setChecklistLines((prev) => prev.filter((l) => l.key !== key));
  };

  const submit = useCallback(async () => {
    if (!token) return;
    const ids = selectedMemberIds.filter(isMemberDbId);
    if (ids.length === 0) {
      toast.error('Select at least one member');
      return;
    }
    const pathMemberId = ids[0];

    const t = title.trim();
    if (!t) {
      toast.error('Enter a title');
      return;
    }
    if (assigneeIds.length === 0) {
      toast.error('Choose at least one assignee');
      return;
    }
    const checklist = checklistLines
      .map((l) => l.label.trim())
      .filter(Boolean)
      .map((label) => ({ label, done: false }));

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: t,
        assignee_profile_ids: assigneeIds,
        urgency,
      };
      if (description.trim()) body.description = description.trim();
      if (due.trim()) body.due_at = new Date(due).toISOString();
      if (checklist.length > 0) body.checklist = checklist;

      const res = await fetch(`/api/members/${encodeURIComponent(pathMemberId)}/tasks`, {
        method: 'POST',
        headers: withBranchScope(branchId ?? null, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not create task');
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
    selectedMemberIds,
    title,
    description,
    assigneeIds,
    due,
    checklistLines,
    urgency,
    branchId,
    onClose,
    onSuccess,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <ListTodo className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Assign task</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5 flex-1">
          <div>
            <p className="text-xs font-bold text-blue-600 mb-3">Task</p>
            <label className="text-xs text-gray-500 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder=""
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-slate-50"
            />
            <label className="text-xs text-gray-500 block mt-3 mb-1">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder=""
              rows={2}
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

          <div>
            <p className="text-xs font-bold text-blue-600 mb-3">Members</p>
            {lockMemberSelection ? (
              <>
                <p className="text-xs text-gray-500 mb-2">Task for this member</p>
                <div className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-slate-100 text-gray-900">
                  {lockedMemberLabel || '—'}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">Select the member this task is about.</p>
                <label className="text-xs text-gray-500 block mb-1">Search</label>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder=""
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2 bg-slate-50"
                />
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-slate-50">
                  {pickableMembers.length === 0 ? (
                    <p className="p-3 text-xs text-gray-500">No members match.</p>
                  ) : (
                    pickableMembers.map((m) => (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-white cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="assign-task-member"
                          checked={selectedMemberIds[0] === m.id}
                          onChange={() => selectMember(m.id)}
                        />
                        <span>{m.fullName || [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email}</span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-blue-600 mb-3">Assignees</p>
            {lockAssignees ? (
              <p className="text-sm text-gray-800 px-3 py-2 border border-gray-200 rounded-lg bg-slate-100">
                This task is assigned to the selected leader.
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">Select one or more leaders for this task.</p>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-slate-50">
                  {staff.length === 0 ? (
                    <p className="p-3 text-xs text-gray-500">No staff loaded.</p>
                  ) : (
                    staff.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-white cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={assigneeIds.includes(s.id)}
                          onChange={() => toggleAssignee(s.id)}
                        />
                        <span>{[s.first_name, s.last_name].filter(Boolean).join(' ') || s.email || s.id.slice(0, 8)}</span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setChecklistOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 text-left text-sm font-medium text-gray-800"
            >
              <span className="flex items-center gap-2">
                {checklistOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Checklist (Optional)
              </span>
              <span className="text-xs text-gray-500">{checklistLines.filter((l) => l.label.trim()).length} items</span>
            </button>
            <AnimatePresence>
              {checklistOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-gray-100 p-3 space-y-2"
                >
                  {checklistLines.map((line) => (
                    <div key={line.key} className="flex gap-2">
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
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addChecklistLine}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add step
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Create & assign'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
