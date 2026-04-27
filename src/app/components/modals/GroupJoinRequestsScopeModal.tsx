import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Ban, CheckCircle, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatLongWeekdayDate, formatLongWeekdayDateTime } from '@/utils/dateDisplayFormat';

type GroupJoinRequestRow = {
  id: string;
  group_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  dob?: string | null;
  member_id?: string | null;
  requested_at?: string | null;
  created_at?: string | null;
  groups?: { name?: string | null } | null;
};

function joinRequestDisplayName(r: GroupJoinRequestRow): string {
  const fn = (r.first_name || '').trim();
  const ln = (r.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return (r.full_name || '').trim() || 'Applicant';
}

function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function GroupJoinRequestsScopeModal({ open, onClose }: Props) {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const canApprove = can('approve_group_requests');

  const [rows, setRows] = useState<GroupJoinRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !open) return;
    setLoading(true);
    try {
      const collected: GroupJoinRequestRow[] = [];
      let offset = 0;
      while (true) {
        const params = new URLSearchParams({
          status: 'pending',
          ministry_scope_only: '1',
          offset: String(offset),
          limit: '100',
        });
        const res = await fetch(`/api/group-requests?${params.toString()}`, {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || 'Could not load join requests');
        }
        const batch = Array.isArray(data)
          ? (data as GroupJoinRequestRow[])
          : Array.isArray((data as { requests?: unknown }).requests)
            ? ((data as { requests: GroupJoinRequestRow[] }).requests as GroupJoinRequestRow[])
            : [];
        collected.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      setRows(collected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load join requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, open, selectedBranch?.id]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const runAction = async (kind: 'approve' | 'reject' | 'ignore', requestId: string) => {
    if (!token) return;
    if (kind === 'reject' && !window.confirm('Decline this join request?')) return;
    if (
      kind === 'ignore' &&
      !window.confirm(
        'Ignore this request? It leaves the pending list without adding them to the group.',
      )
    ) {
      return;
    }
    setBusyId(requestId);
    try {
      const path =
        kind === 'approve' ? 'approve' : kind === 'reject' ? 'reject' : 'ignore';
      const res = await fetch(`/api/group-requests/${encodeURIComponent(requestId)}/${path}`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Action failed');
      }
      toast.success(
        kind === 'approve' ? 'Request approved.' : kind === 'reject' ? 'Request declined.' : 'Request ignored.',
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[min(90vh,720px)] flex flex-col gap-0 sm:max-w-lg p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0 border-b border-gray-100">
          <DialogTitle>Group join requests</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Loading requests…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
              No pending join requests for your assigned ministries.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((r) => {
                const name = joinRequestDisplayName(r);
                const ministryName =
                  (r.groups && typeof r.groups.name === 'string' && r.groups.name.trim()) || 'Ministry';
                const gid = typeof r.group_id === 'string' ? r.group_id : r.group_id != null ? String(r.group_id) : '';
                const dobRaw = r.dob;
                const dobLabel =
                  dobRaw && String(dobRaw).trim()
                    ? formatLongWeekdayDate(String(dobRaw)) || '—'
                    : '—';
                const reqAt = r.requested_at || r.created_at;
                const reqLabel = reqAt ? formatLongWeekdayDateTime(String(reqAt)) || '—' : '—';
                const verified = Boolean(r.member_id);
                const busy = busyId === r.id;

                return (
                  <li
                    key={r.id}
                    className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 shadow-sm"
                  >
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-full shrink-0 bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold ring-1 ring-black/5">
                        {memberInitials(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
                        <p className="text-xs text-gray-600 mt-0.5 truncate">{ministryName}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span>DOB: {dobLabel}</span>
                          <span>Requested: {reqLabel}</span>
                        </div>
                        <div className="mt-2">
                          {verified ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-blue-50 text-blue-800 border-blue-200">
                              Directory match
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-800 border-amber-200">
                              Guest application
                            </span>
                          )}
                        </div>
                        {gid ? (
                          <Link
                            to={`/groups/${encodeURIComponent(gid)}?tab=requests`}
                            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-blue-600 hover:underline"
                          >
                            Open ministry
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : null}
                        {canApprove ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={busy}
                              className="h-8"
                              onClick={() => void runAction('approve', r.id)}
                            >
                              {busy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                              )}
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              className="h-8"
                              onClick={() => void runAction('ignore', r.id)}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Ignore
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              className="h-8"
                              onClick={() => void runAction('reject', r.id)}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Decline
                            </Button>
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                            You can view these requests; ask an administrator for approve permissions to act here.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
