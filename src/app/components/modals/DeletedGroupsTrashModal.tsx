import { useCallback, useEffect, useState } from 'react';
import { X, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import DeleteModal from './DeleteModal';

export type TrashGroupRow = {
  id: string;
  name: string;
  group_type?: string | null;
  deleted_at?: string | null;
  days_until_permanent_removal?: number;
  descendant_subgroup_count?: number;
  member_count?: number;
};

interface DeletedGroupsTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

export default function DeletedGroupsTrashModal({ isOpen, onClose, onRestored }: DeletedGroupsTrashModalProps) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [rows, setRows] = useState<TrashGroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const fetchTrash = useCallback(async () => {
    if (!token) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const url = new URL('/api/groups', window.location.origin);
      if (selectedBranch) url.searchParams.set('branch_id', selectedBranch.id);
      url.searchParams.set('deleted_only', '1');
      const res = await fetch(url.toString(), {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load trash');
      }
      const gArr = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
      setRows(gArr);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load deleted ministries');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set());
      return;
    }
    void fetchTrash();
  }, [isOpen, fetchTrash]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(rows.map((r) => r.id)));
  };

  const handleRestoreSelected = async () => {
    if (!token || selected.size === 0) return;
    try {
      const res = await fetch('/api/groups/batch-restore', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({ ids: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Restore failed');
      }
      const restored = (body as { restored?: number }).restored ?? 0;
      const errors = (body as { errors?: string[] }).errors ?? [];
      if (restored) toast.success(restored === 1 ? 'Ministry restored' : `${restored} ministries restored`);
      if (errors.length) toast.error(errors.slice(0, 2).join('; '));
      setSelected(new Set());
      await fetchTrash();
      onRestored?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    }
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const totalDescendants = selectedRows.reduce((s, r ) => s + (r.descendant_subgroup_count ?? 0), 0);

  const handlePurgeSelected = async () => {
    if (!token || selected.size === 0) return;
    setPurgeBusy(true);
    try {
      const res = await fetch('/api/groups/batch-purge', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({ ids: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Permanent delete failed');
      }
      const purged = (body as { purged?: number }).purged ?? 0;
      const errors = (body as { errors?: string[] }).errors ?? [];
      if (purged) toast.success(purged === 1 ? 'Ministry permanently removed' : `${purged} ministries permanently removed`);
      if (errors.length) toast.error(errors.slice(0, 2).join('; '));
      setSelected(new Set());
      setPurgeConfirmOpen(false);
      await fetchTrash();
      onRestored?.();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Permanent delete failed');
    } finally {
      setPurgeBusy(false);
    }
  };

  if (!isOpen) return null;

  const purgeMessage =
    selectedRows.length === 0
      ? ''
      : [
          `You are about to permanently delete ${selectedRows.length} ministry group(s).`,
          totalDescendants > 0
            ? `Together they include ${totalDescendants} subgroup(s) in the tree — all will be removed from the database.`
            : '',
          'This cannot be undone. Events are kept, but ministry links were already cleared when these were moved to trash.',
          '',
          selectedRows.length <= 5
            ? `Names: ${selectedRows.map((r) => r.name || '—').join('; ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

  return (
    <>
      <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <div className="relative z-[141] flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Deleted ministries (trash)</h2>
              <p className="mt-1 text-sm text-gray-500">
                Soft-deleted groups can be restored. After {30} days they are eligible for automatic cleanup; you can
                permanently delete below. Events are not deleted when a ministry is trashed — linked members were removed
                from those events.
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-500">Trash is empty.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400">
                    <th className="w-10 py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleAll}
                        aria-label="Select all"
                        className="rounded border-gray-300 text-blue-600"
                      />
                    </th>
                    <th className="py-2 pr-2">Ministry</th>
                    <th className="py-2 pr-2">Subgroups</th>
                    <th className="py-2">Days until auto-removal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50/80">
                      <td className="py-3 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                          aria-label={`Select ${r.name}`}
                          className="rounded border-gray-300 text-blue-600"
                        />
                      </td>
                      <td className="py-3 pr-2 align-top">
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-500">{r.group_type || 'ministry'}</p>
                      </td>
                      <td className="py-3 pr-2 align-top text-gray-700">
                        {r.descendant_subgroup_count ?? 0}
                      </td>
                      <td className="py-3 align-top">
                        <span
                          className={
                            (r.days_until_permanent_removal ?? 0) <= 3
                              ? 'font-semibold text-amber-700'
                              : 'text-gray-700'
                          }
                        >
                          {(r.days_until_permanent_removal ?? 0) === 0
                            ? 'Eligible now'
                            : `${r.days_until_permanent_removal ?? '—'} days left`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => void handleRestoreSelected()}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Restore selected
            </button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setPurgeConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Permanently delete selected
            </button>
          </div>
        </div>
      </div>

      <DeleteModal
        isOpen={purgeConfirmOpen}
        onClose={() => !purgeBusy && setPurgeConfirmOpen(false)}
        onConfirm={() => void handlePurgeSelected()}
        title="Permanently delete selected ministries?"
        message={purgeMessage}
        confirmLabel={purgeBusy ? 'Working…' : 'Permanently delete'}
        stackZClass="z-[200]"
      />
    </>
  );
}
