import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Search, Pencil, Trash2, ClipboardList, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { EventTypeRow } from './EventTypes';
import ProgramOutlineAccordionEditor, {
  computeTotalUsedMinutes,
  documentFromProgramOutline,
  documentToProgramOutline,
  emptyDocument,
  formatHoursMinutes,
  freshDuplicateOutline,
  type ProgramOutlineDocument,
} from './ProgramOutlineAccordionEditor';

function outlineTableStats(program_outline: Record<string, unknown> | undefined | null) {
  const doc = documentFromProgramOutline(program_outline ?? {});
  const parts = doc.sections.length;
  const activities = doc.sections.reduce((n, s) => n + s.items.length, 0);
  const usedMinutes = computeTotalUsedMinutes(doc);
  const ph = doc.planned_duration_hours;
  const plannedMinutes =
    ph != null && Number.isFinite(ph) && ph > 0 ? ph * 60 : null;
  return { parts, activities, usedMinutes, plannedMinutes };
}

function TemplateTimeBudgetCell({
  usedMinutes,
  plannedMinutes,
}: {
  usedMinutes: number;
  plannedMinutes: number | null;
}) {
  const usedStr = formatHoursMinutes(usedMinutes);
  if (plannedMinutes == null) {
    return (
      <div className="text-sm">
        <span className="tabular-nums font-medium text-gray-900">{usedStr}</span>
        <span className="ml-1 text-xs text-gray-500">used</span>
        <p className="mt-0.5 text-[11px] text-gray-400">No event budget</p>
      </div>
    );
  }
  const rem = plannedMinutes - usedMinutes;
  const secondStr = rem >= 0 ? formatHoursMinutes(rem) : formatHoursMinutes(-rem);
  const tone = rem >= 0 ? 'text-blue-700' : 'text-blue-800';
  const suffix = rem >= 0 ? 'left' : 'over';
  return (
    <div className="text-sm">
      <span className="tabular-nums font-medium text-gray-900">{usedStr}</span>
      <span className="text-gray-400"> / </span>
      <span className={`tabular-nums font-medium ${tone}`}>{secondStr}</span>
      <span className="ml-1 text-xs font-medium text-gray-500">{suffix}</span>
    </div>
  );
}

export interface OutlineTemplateRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  event_type_id: string | null;
  name: string;
  description: string | null;
  program_outline: Record<string, unknown>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  event_types?: { name: string; slug: string; color: string | null } | null;
}

export type EventOutlineTemplatesProps = { embedded?: boolean };

export default function EventOutlineTemplates({ embedded = false }: EventOutlineTemplatesProps) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [rows, setRows] = useState<OutlineTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTypeId, setFilterTypeId] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OutlineTemplateRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formEventTypeId, setFormEventTypeId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [outlineDoc, setOutlineDoc] = useState<ProgramOutlineDocument>(() => emptyDocument());
  const [saving, setSaving] = useState(false);
  const [openedAsDuplicate, setOpenedAsDuplicate] = useState(false);

  const fetchEventTypes = useCallback(async () => {
    if (!token) {
      setEventTypes([]);
      return;
    }
    try {
      const res = await fetch('/api/event-types', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to load types');
      setEventTypes(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load event types');
      setEventTypes([]);
    }
  }, [token, selectedBranch?.id]);

  const fetchRows = useCallback(async () => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = filterTypeId ? `?event_type_id=${encodeURIComponent(filterTypeId)}` : '';
      const res = await fetch(`/api/event-outline-templates${q}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to load templates');
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, filterTypeId, selectedBranch?.id]);

  useEffect(() => {
    void fetchEventTypes();
  }, [fetchEventTypes]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const typeLabel = useCallback(
    (eventTypeId: string | null) => {
      if (!eventTypeId) return '—';
      const t = eventTypes.find((x) => x.id === eventTypeId);
      return t ? t.name : eventTypeId.slice(0, 8) + '…';
    },
    [eventTypes]
  );

  const openCreate = () => {
    if (eventTypes.length === 0) {
      toast.message('Create at least one event type first');
      return;
    }
    setEditing(null);
    setFormName('');
    setFormEventTypeId(filterTypeId || eventTypes[0]?.id || '');
    setFormDescription('');
    setFormActive(true);
    setOutlineDoc(emptyDocument());
    setOpenedAsDuplicate(false);
    setModalOpen(true);
  };

  const openEdit = (r: OutlineTemplateRow) => {
    setOpenedAsDuplicate(false);
    setEditing(r);
    setFormName(r.name);
    setFormEventTypeId(r.event_type_id || '');
    setFormDescription(r.description || '');
    setFormActive(r.is_active !== false);
    setOutlineDoc(documentFromProgramOutline(r.program_outline ?? {}));
    setModalOpen(true);
  };

  const openDuplicateTemplate = (r: OutlineTemplateRow) => {
    if (eventTypes.length === 0) {
      toast.message('Create at least one event type first');
      return;
    }
    setEditing(null);
    const base = r.name.trim() || 'Template';
    setFormName(`${base} (copy)`);
    setFormEventTypeId(r.event_type_id || filterTypeId || eventTypes[0]?.id || '');
    setFormDescription(r.description || '');
    setFormActive(r.is_active !== false);
    setOutlineDoc(freshDuplicateOutline(documentFromProgramOutline(r.program_outline ?? {})));
    setOpenedAsDuplicate(true);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!token) return;
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!formEventTypeId || !eventTypes.some((e) => e.id === formEventTypeId)) {
      toast.error('Choose a valid event type');
      return;
    }
    const outline = documentToProgramOutline(outlineDoc);
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/event-outline-templates/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            name: formName.trim(),
            description: formDescription.trim() || null,
            is_active: formActive,
            event_type_id: formEventTypeId,
            program_outline: outline,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Save failed');
        toast.success('Template updated');
      } else {
        const res = await fetch('/api/event-outline-templates', {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            name: formName.trim(),
            event_type_id: formEventTypeId,
            description: formDescription.trim() || null,
            is_active: formActive,
            program_outline: outline,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Create failed');
        toast.success('Template created');
      }
      setModalOpen(false);
      setOpenedAsDuplicate(false);
      void fetchRows();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: OutlineTemplateRow) => {
    if (!token) return;
    if (!window.confirm(`Delete template “${r.name}”?`)) return;
    try {
      const res = await fetch(`/api/event-outline-templates/${encodeURIComponent(r.id)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Delete failed');
      toast.success('Deleted');
      void fetchRows();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = rows;
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          typeLabel(r.event_type_id).toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, q, typeLabel]);

  return (
    <div className={embedded ? '' : 'flex flex-col flex-1 bg-gray-50/80 min-h-0'}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-6xl px-4 py-8 md:px-8'}>
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Program templates</h1>
            <p className="mt-1 text-sm text-gray-500">
              Saved outlines per event type — use when creating events to pre-fill the program.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            disabled={eventTypes.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add template
          </button>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="relative block max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-sm focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <div className="sm:w-56">
              <label className="text-xs font-medium text-gray-600">Event type</label>
              <select
                value={filterTypeId}
                onChange={(e) => setFilterTypeId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">All types</option>
                {eventTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {eventTypes.length === 0 && !loading ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
              Add at least one{' '}
              <Link to="/settings?tab=general&sub=eventTypes" className="font-medium underline decoration-blue-600/50">
                event type
              </Link>{' '}
              before you can create program templates.
            </div>
          ) : null}

          {loading ? (
            <p className="py-12 text-center text-sm text-gray-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-sm text-gray-500">
              No templates {filterTypeId ? 'for this type' : 'yet'}. Create one to reuse program structures.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/90">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">
                      Template
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500">
                      Parts
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500">
                      Activities
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">
                      Time
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">
                      Event type
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">
                      Active
                    </th>
                    <th className="whitespace-nowrap px-3 py-4 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const emb = r.event_types;
                    const typeName = emb?.name ?? typeLabel(r.event_type_id);
                    const stats = outlineTableStats(r.program_outline);
                    return (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                        <td className="max-w-[min(24rem,40vw)] px-6 py-4 align-middle">
                          <p className="truncate text-[14px] font-medium text-gray-900" title={r.name}>
                            {r.name}
                          </p>
                        </td>
                        <td className="px-6 py-4 align-middle text-right tabular-nums text-sm text-gray-800">
                          {stats.parts}
                        </td>
                        <td className="px-6 py-4 align-middle text-right tabular-nums text-sm text-gray-800">
                          {stats.activities}
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <TemplateTimeBudgetCell
                            usedMinutes={stats.usedMinutes}
                            plannedMinutes={stats.plannedMinutes}
                          />
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                              style={{ backgroundColor: emb?.color || '#94a3b8' }}
                            />
                            <span className="text-sm text-gray-700">{typeName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-middle text-sm text-gray-700">
                          {r.is_active === false ? 'No' : 'Yes'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 align-middle text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              title="Edit template"
                              aria-label="Edit template"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openDuplicateTemplate(r)}
                              title="Duplicate template"
                              aria-label="Duplicate template"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(r)}
                              title="Delete template"
                              aria-label="Delete template"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <>
          <div
            className="fixed inset-0 z-[110] bg-black/40"
            onClick={() => {
              setModalOpen(false);
              setOpenedAsDuplicate(false);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[120] flex max-h-[min(94vh,880px)] w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="shrink-0 border-b border-gray-100 p-5 pb-4 sm:p-6">
              <div className="flex items-start gap-2">
                <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {editing ? 'Edit template' : 'New template'}
                  </h2>
                  {!editing && openedAsDuplicate ? (
                    <p className="mt-0.5 text-xs text-gray-500">Duplicating — save to create a new template</p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div className="flex max-h-[42vh] shrink-0 flex-col gap-4 overflow-y-auto border-gray-100 p-5 sm:p-6 md:max-h-none md:w-[min(100%,320px)] md:border-r md:py-6">
                <div>
                  <p className="mb-3 text-[11px] font-semibold text-gray-400">
                    Details
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600">Name</label>
                      <input
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Event type</label>
                      <select
                        value={formEventTypeId}
                        onChange={(e) => setFormEventTypeId(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        {eventTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Description</label>
                      <textarea
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        rows={3}
                        className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                      <input
                        type="checkbox"
                        checked={formActive}
                        onChange={(e) => setFormActive(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      Active
                    </label>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold text-gray-400">
                    Time
                  </p>
                  <ProgramOutlineAccordionEditor
                    variant="budgetOnly"
                    value={outlineDoc}
                    onChange={setOutlineDoc}
                  />
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-gray-100 md:border-t-0">
                <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
                  <p className="mb-3 text-[11px] font-semibold text-gray-400">
                    Parts & activities
                  </p>
                  <ProgramOutlineAccordionEditor
                    variant="scheduleOnly"
                    value={outlineDoc}
                    onChange={setOutlineDoc}
                  />
                </div>
              </div>
            </div>
            <div className="shrink-0 flex justify-end gap-2 border-t border-gray-100 p-6">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setOpenedAsDuplicate(false);
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
