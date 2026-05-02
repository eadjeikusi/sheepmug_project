import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Users, UsersRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { usePermissions } from '@/hooks/usePermissions';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { displayMemberWords } from '@sheepmug/shared-api';
import { canAccessLeadersDirectory } from '../../../permissions/atomicCanHelpers';
import { displayTitleWords } from '@/utils/displayText';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type LeaderRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  group_count?: number;
};

type GroupPickRow = { id: string; name: string; leader_id?: string | null };

function leaderName(l: LeaderRow): string {
  const n = `${String(l.first_name || '').trim()} ${String(l.last_name || '').trim()}`.trim();
  return n || String(l.email || 'Leader');
}

export default function Leaders() {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const canSee = canAccessLeadersDirectory(can);
  const canAssignMinistryLeader = can('assign_ministry_leaders') || can('edit_groups');

  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderSearch, setLeaderSearch] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<LeaderRow | null>(null);
  const [groupOptions, setGroupOptions] = useState<GroupPickRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [savingAssign, setSavingAssign] = useState(false);

  const filteredRows = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((l) => {
      const name = leaderName(l).toLowerCase();
      const email = String(l.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, leaderSearch]);

  const load = useCallback(async () => {
    if (!token || !canSee) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const headers = withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` });
      const res = await fetch('/api/reports/leaders', { headers });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load leaders');
      const list = Array.isArray((raw as { leaders?: LeaderRow[] }).leaders)
        ? (raw as { leaders: LeaderRow[] }).leaders
        : [];
      setRows(list.filter((r) => r?.id));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, canSee, selectedBranch?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGroupsForAssign = useCallback(async () => {
    if (!token || !canAssignMinistryLeader) return;
    setLoadingGroups(true);
    try {
      const headers = withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` });
      const all: GroupPickRow[] = [];
      let offset = 0;
      const limit = 100;
      for (;;) {
        const res = await fetch(`/api/groups?limit=${limit}&offset=${offset}`, { headers });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load ministries');
        const batch = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { groups?: unknown }).groups)
            ? (raw as { groups: GroupPickRow[] }).groups
            : [];
        const mapped = (batch as { id?: string; name?: string; leader_id?: string | null }[])
          .filter((g) => g?.id)
          .map((g) => ({ id: String(g.id), name: String(g.name || 'Ministry'), leader_id: g.leader_id ?? null }));
        all.push(...mapped);
        if (mapped.length < limit) break;
        offset += limit;
      }
      setGroupOptions(all.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setGroupOptions([]);
      toast.error('Could not load ministries');
    } finally {
      setLoadingGroups(false);
    }
  }, [token, canAssignMinistryLeader, selectedBranch?.id]);

  useEffect(() => {
    if (assignOpen) void loadGroupsForAssign();
  }, [assignOpen, loadGroupsForAssign]);

  const openAssign = (l: LeaderRow) => {
    setAssignTarget(l);
    setSelectedGroupId('');
    setAssignOpen(true);
  };

  const submitAssign = async () => {
    if (!token || !assignTarget || !selectedGroupId) {
      toast.error('Select a ministry');
      return;
    }
    setSavingAssign(true);
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(selectedGroupId)}`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id ?? null, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        }),
        body: JSON.stringify({ leader_id: assignTarget.id }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not assign leader');
      toast.success('Ministry leader updated');
      setAssignOpen(false);
      setAssignTarget(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign leader');
    } finally {
      setSavingAssign(false);
    }
  };

  if (!canSee) {
    return (
      <div className="mx-auto max-w-4xl py-10 text-center text-sm text-gray-600">
        You do not have permission to view leaders.
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-1 flex-col space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <UsersRound className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Leaders</h1>
            <p className="text-sm text-gray-500">Staff profiles and the ministries they lead.</p>
          </div>
        </div>
        <Input
          type="search"
          value={leaderSearch}
          onChange={(e) => setLeaderSearch(e.target.value)}
          placeholder="Search leaders by name or email"
          className="w-full max-w-md bg-white sm:ml-auto sm:shrink-0"
          autoComplete="off"
        />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No leaders found in your branch scope.</p>
      ) : (
        <>
          {filteredRows.length === 0 ? (
            <p className="text-sm text-gray-500">No leaders match your search.</p>
          ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredRows.map((l) => {
            const img = l.avatar_url?.trim();
            const count = typeof l.group_count === 'number' ? l.group_count : 0;
            const name = leaderName(l);
            return (
              <div
                key={l.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-200 hover:border-blue-100 hover:shadow-md"
              >
                <Link
                  to={`/leaders/${l.id}`}
                  className="group flex flex-1 flex-col p-6 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                >
                  <div className="flex flex-col items-center text-center">
                    {img ? (
                      <img
                        src={img}
                        alt=""
                        className="h-20 w-20 rounded-full object-cover bg-gray-100 ring-2 ring-gray-50"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 text-2xl font-semibold text-blue-800 ring-2 ring-gray-50">
                        {(name[0] || '?').toUpperCase()}
                      </div>
                    )}
                    <h2 className="mt-4 line-clamp-2 text-lg font-semibold text-gray-900 transition-colors group-hover:text-blue-700">
                      {displayMemberWords(name)}
                    </h2>
                    {l.email ? (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">{displayTitleWords(l.email)}</p>
                    ) : null}
                    <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1 text-xs text-gray-600">
                      <Users className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="tabular-nums font-medium text-gray-800">{count}</span>
                      <span>{count === 1 ? 'group' : 'groups'}</span>
                    </div>
                  </div>
                </Link>
                {canAssignMinistryLeader ? (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openAssign(l)}
                      className="w-full rounded-lg py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
                    >
                      Assign to ministry…
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
          )}
        </>
      )}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign formal ministry leader</DialogTitle>
            <DialogDescription>
              Set <strong>{assignTarget ? displayMemberWords(leaderName(assignTarget)) : ''}</strong> as the formal leader
              (leader_id) for one ministry. They should already have access via staff scope where needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor="leader-assign-group">
              Ministry
            </label>
            {loadingGroups ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading ministries…
              </div>
            ) : (
              <select
                id="leader-assign-group"
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="">Select a ministry…</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.leader_id ? ' (has leader)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={savingAssign || !selectedGroupId} onClick={() => void submitAssign()}>
              {savingAssign ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
