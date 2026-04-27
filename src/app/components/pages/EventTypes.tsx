import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface EventTypeRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  is_default?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export type EventTypesProps = { embedded?: boolean };

function pickDeletionReplacement(rows: EventTypeRow[], deletingId: string): EventTypeRow | null {
  const candidates = rows.filter((t) => t.id !== deletingId);
  if (candidates.length === 0) return null;
  return (
    candidates.find((t) => Boolean(t.is_default)) ||
    [...candidates].sort((a, b) => a.name.localeCompare(b.name))[0] ||
    null
  );
}

export default function EventTypes({ embedded = false }: EventTypesProps) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [rows, setRows] = useState<EventTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventTypeRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState('#6366f1');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EventTypeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!token) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/event-types', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to load');
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormSlug('');
    setFormDescription('');
    setFormColor('#6366f1');
    setFormIsDefault(false);
    setModalOpen(true);
  };

  const openEdit = (r: EventTypeRow) => {
    setEditing(r);
    setFormName(r.name);
    setFormSlug(r.slug);
    setFormDescription(r.description || '');
    setFormColor(r.color || '#6366f1');
    setFormIsDefault(Boolean(r.is_default));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!token) return;
    if (!formName.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/event-types/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            name: formName.trim(),
            slug: formSlug.trim() || undefined,
            description: formDescription.trim() || null,
            color: formColor.trim() || null,
            is_default: formIsDefault,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Save failed');
        toast.success('Event type updated');
      } else {
        const res = await fetch('/api/event-types', {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            name: formName.trim(),
            slug: formSlug.trim() || undefined,
            description: formDescription.trim() || null,
            color: formColor.trim() || null,
            is_default: formIsDefault,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Create failed');
        toast.success('Event type created');
      }
      setModalOpen(false);
      void fetchRows();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteReplacement = useMemo(
    () => (pendingDelete ? pickDeletionReplacement(rows, pendingDelete.id) : null),
    [pendingDelete, rows],
  );

  const confirmDelete = async () => {
    if (!token || !pendingDelete) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/event-types/${encodeURIComponent(pendingDelete.id)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        moved_events?: number;
        moved_templates?: number;
        replacement_slug?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      const ev = typeof data.moved_events === 'number' ? data.moved_events : 0;
      const tpl = typeof data.moved_templates === 'number' ? data.moved_templates : 0;
      toast.success(
        (tpl + ev) > 0
          ? `Deleted. Reassigned ${tpl} program template(s) and ${ev} event(s) to the default type.`
          : 'Event type deleted.',
      );
      setDeleteOpen(false);
      setPendingDelete(null);
      void fetchRows();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.slug.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q))
      )
    : rows;

  return (
    <div className={embedded ? '' : 'flex flex-col flex-1 bg-gray-50/80 min-h-0'}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-6xl px-4 py-8 md:px-8'}>
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Event types</h1>
            <p className="mt-1 text-sm text-gray-500">
              Custom labels used by events and program templates (stored as slug on each event). One type per branch is
              the default; deleting a type reassigns linked events and templates to that default.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add type
          </button>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
          <label className="relative mb-4 block max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search types…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-sm focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          {loading ? (
            <p className="py-12 text-center text-sm text-gray-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-sm text-gray-500">
              No event types yet. Add one for your calendar and templates.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/90">
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Slug</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Default</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Description</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                      <td className="px-6 py-4 align-middle">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: r.color || '#94a3b8' }}
                          />
                          <span className="text-[14px] font-medium text-gray-900">{r.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 align-middle">
                        <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-800">{r.slug}</code>
                      </td>
                      <td className="px-6 py-4 align-middle">
                        {r.is_default ? (
                          <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                            Default
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="max-w-xs px-6 py-4 align-middle">
                        <span className="line-clamp-2 text-sm text-gray-600">{r.description || '—'}</span>
                      </td>
                      <td className="px-6 py-4 align-middle text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingDelete(r);
                              setDeleteOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event type?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This action cannot be undone. The type <strong>{pendingDelete?.name}</strong> will be removed from
                settings.
              </span>
              {deleteReplacement ? (
                <span className="block text-sm text-gray-600">
                  Events and program templates that use this type will be switched to your default type{' '}
                  <strong>{deleteReplacement.name}</strong> (slug <code className="text-xs">{deleteReplacement.slug}</code>
                  ).
                </span>
              ) : (
                <span className="block text-sm text-amber-800">
                  You cannot delete the only event type for this branch. Add another type first.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy || !deleteReplacement}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteBusy ? 'Deleting…' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {modalOpen && (
        <>
          <div className="fixed inset-0 z-[110] bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-[120] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <Tag className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                {editing ? 'Edit event type' : 'New event type'}
              </h2>
            </div>
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
                <label className="text-xs font-medium text-gray-600">
                  Slug <span className="text-gray-400">(optional, auto from name)</span>
                </label>
                <input
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm"
                  placeholder="youth-night"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Color</label>
                <input
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="mt-1 h-10 w-full cursor-pointer rounded-xl border border-gray-200"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                />
                <span className="text-sm text-gray-700">
                  <span className="font-medium text-gray-900">Default event type</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Used when another type is deleted (events and program templates are reassigned here).
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
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
