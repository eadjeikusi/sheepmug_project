import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  LayoutGrid,
  List,
  CheckSquare,
  Square,
  MinusSquare,
  User,
  Loader2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../ui/utils';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';

export type AttendanceStatus = 'not_marked' | 'present' | 'absent' | 'unsure';

export interface EventAttendanceRosterMember {
  id: string;
  first_name: string;
  last_name: string;
  memberimage_url: string | null;
  group_ids: string[];
}

export interface EventAttendanceRow {
  id: string;
  member_id: string;
  status: AttendanceStatus;
  check_in_time: string | null;
  check_in_method: string | null;
  notes: string | null;
  recorded_by_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EventAttendancePayload {
  event_id: string;
  assigned_groups: { id: string; name: string }[];
  filter_groups?: { id: string; name: string }[];
  members: EventAttendanceRosterMember[];
  attendance: EventAttendanceRow[];
}

const type = {
  eyebrow: 'text-[10px] font-semibold text-gray-400 sm:text-[11px]',
  label: 'text-xs font-medium text-gray-500',
  mini: 'text-[11px] leading-snug text-gray-500',
  value: 'text-sm font-semibold text-gray-900',
  stat: 'text-2xl font-semibold tabular-nums text-gray-900 sm:text-3xl',
} as const;

function statusLabel(s: AttendanceStatus): string {
  switch (s) {
    case 'present':
      return 'Present';
    case 'absent':
      return 'Absent';
    case 'unsure':
      return 'Not sure';
    default:
      return 'Not marked';
  }
}

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const styles: Record<AttendanceStatus, string> = {
    present: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    absent: 'bg-red-50 text-red-800 border-red-200',
    unsure: 'bg-amber-50 text-amber-900 border-amber-200',
    not_marked: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:text-xs',
        styles[status],
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

/** Row / card chrome aligned with mobile: green present, red absent, amber unsure, slate not marked. */
function statusCardClass(st: AttendanceStatus): string {
  switch (st) {
    case 'present':
      return 'border border-emerald-200 bg-emerald-50/90';
    case 'absent':
      return 'border border-red-200 bg-red-50/90';
    case 'unsure':
      return 'border border-amber-200 bg-amber-50/90';
    default:
      return 'border border-slate-200 bg-slate-50/80';
  }
}

export default function EventAttendanceTab({
  eventId,
  token,
  branchId,
  eventHasGroup,
}: {
  eventId: string;
  token: string | null;
  branchId?: string | null;
  eventHasGroup: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<EventAttendancePayload | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | AttendanceStatus
  >('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const attendanceByMember = useMemo(() => {
    const m = new Map<string, EventAttendanceRow>();
    for (const row of data?.attendance || []) {
      m.set(row.member_id, row);
    }
    return m;
  }, [data?.attendance]);

  const effectiveStatus = useCallback(
    (memberId: string): AttendanceStatus => {
      return attendanceByMember.get(memberId)?.status ?? 'not_marked';
    },
    [attendanceByMember],
  );

  const load = useCallback(async () => {
    if (!token || !eventId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attendance`, {
        headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Failed to load attendance');
      }
      setData(body as EventAttendancePayload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load attendance');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, eventId, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMembers = useMemo(() => {
    const members = data?.members || [];
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      const name = `${m.first_name} ${m.last_name}`.toLowerCase();
      if (q && !name.includes(q)) return false;
      const st = effectiveStatus(m.id);
      if (statusFilter !== 'all' && st !== statusFilter) return false;
      if (groupFilter !== 'all' && !m.group_ids.includes(groupFilter)) return false;
      return true;
    });
  }, [data?.members, search, statusFilter, groupFilter, effectiveStatus]);

  const filterGroups = useMemo(
    () => (data?.filter_groups?.length ? data.filter_groups : data?.assigned_groups || []),
    [data?.filter_groups, data?.assigned_groups],
  );

  const clearAttendanceFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('all');
    setGroupFilter('all');
  }, []);

  const attendanceFilterChips = useMemo((): FilterChipItem[] => {
    const chips: FilterChipItem[] = [];
    const q = search.trim();
    if (q) {
      chips.push({
        id: 'search',
        label: `Search: "${q.length > 40 ? `${q.slice(0, 40)}…` : q}"`,
        onRemove: () => setSearch(''),
      });
    }
    if (statusFilter !== 'all') {
      chips.push({
        id: 'status',
        label: `Status: ${statusLabel(statusFilter)}`,
        onRemove: () => setStatusFilter('all'),
      });
    }
    if (groupFilter !== 'all') {
      const g = filterGroups.find((x) => x.id === groupFilter);
      chips.push({
        id: 'group',
        label: `Group: ${g?.name ?? groupFilter}`,
        onRemove: () => setGroupFilter('all'),
      });
    }
    return chips;
  }, [search, statusFilter, groupFilter, filterGroups]);

  const counts = useMemo(() => {
    const members = data?.members || [];
    let present = 0,
      absent = 0,
      unsure = 0,
      not_marked = 0;
    for (const m of members) {
      switch (effectiveStatus(m.id)) {
        case 'present':
          present++;
          break;
        case 'absent':
          absent++;
          break;
        case 'unsure':
          unsure++;
          break;
        default:
          not_marked++;
      }
    }
    return { present, absent, unsure, not_marked, total: members.length };
  }, [data?.members, effectiveStatus]);

  const allFilteredSelected =
    filteredMembers.length > 0 && filteredMembers.every((m) => selected.has(m.id));
  const someFilteredSelected = filteredMembers.some((m) => selected.has(m.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const m of filteredMembers) next.delete(m.id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const m of filteredMembers) next.add(m.id);
        return next;
      });
    }
  };

  const applyStatusToSelected = async (status: AttendanceStatus) => {
    if (!token || selected.size === 0) return;
    setSaving(true);
    try {
      const updates = [...selected].map((member_id) => ({ member_id, status }));
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attendance`, {
        method: 'PUT',
        headers: withBranchScope(branchId, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Could not save attendance');
      }
      const attendance = (body as { attendance?: EventAttendanceRow[] }).attendance;
      if (attendance) {
        setData((prev) =>
          prev ? { ...prev, attendance } : prev,
        );
      } else {
        await load();
      }
      toast.success(
        status === 'present'
          ? 'Marked present'
          : status === 'absent'
            ? 'Marked absent'
            : status === 'unsure'
              ? 'Marked not sure'
              : 'Reset to not marked',
      );
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!eventHasGroup) {
    return (
      <div className="space-y-4">
        <p className={type.eyebrow}>Check-in</p>
        <p className={type.value}>Attendance roster</p>
        <p className={type.mini}>
          Add one or more ministries and/or specific members to this event so there is a roster to mark.
        </p>
        <div className="flex justify-center rounded-2xl border border-dashed border-gray-200 py-12">
          <div className="text-center">
            <Users className="mx-auto h-10 w-10 text-gray-200" strokeWidth={1.25} />
            <p className={'mt-4 ' + type.value}>No roster yet</p>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return <p className={type.mini}>Sign in to manage attendance.</p>;
  }

  return (
    <div className="space-y-4 pb-28">
      <div>
        <p className={type.eyebrow}>Check-in</p>
        <p className={type.value}>Attendance</p>
        <p className={'mt-1 ' + type.mini}>
          Roster includes members assigned to this event&apos;s ministry. Select people, then mark status below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-center">
          <p className={type.stat}>{counts.present}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-900">Present</p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-center">
          <p className={type.stat}>{counts.absent}</p>
          <p className="mt-1 text-xs font-semibold text-red-900">Absent</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-center">
          <p className={type.stat}>{counts.unsure}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900">Not sure</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-center">
          <p className={type.stat}>{counts.not_marked}</p>
          <p className="mt-1 text-xs font-semibold text-slate-700">Not marked</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none ring-blue-500/30 focus:ring-2"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as typeof statusFilter)
            }
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="unsure">Not sure</option>
            <option value="not_marked">Not marked</option>
          </select>
          {filterGroups.length > 0 ? (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All groups</option>
              {filterGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex rounded-xl border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'rounded-lg p-2 transition-colors',
                view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50',
              )}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              className={cn(
                'rounded-lg p-2 transition-colors',
                view === 'grid' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50',
              )}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {attendanceFilterChips.length > 0 ? (
        <FilterResultChips chips={attendanceFilterChips} onClearAll={clearAttendanceFilters} />
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : !data?.members.length ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <Users className="mx-auto h-10 w-10 text-gray-200" strokeWidth={1.25} />
          <p className={'mt-4 ' + type.value}>No members in this ministry</p>
          <p className={'mt-2 ' + type.mini}>Assign members to the linked group to see them here.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
            <button
              type="button"
              onClick={selectAllFiltered}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              {allFilteredSelected ? (
                <CheckSquare className="h-5 w-5 text-blue-600" />
              ) : someFilteredSelected ? (
                <MinusSquare className="h-5 w-5 text-blue-600" />
              ) : (
                <Square className="h-5 w-5 text-gray-400" />
              )}
              Select all{filteredMembers.length !== data.members.length ? ` (${filteredMembers.length} shown)` : ''}
            </button>
          </div>

          {view === 'list' ? (
            <ul className="space-y-2">
              {filteredMembers.map((m) => {
                const st = effectiveStatus(m.id);
                const isSel = selected.has(m.id);
                return (
                  <li key={m.id} className="overflow-hidden rounded-2xl">
                    <button
                      type="button"
                      onClick={() => toggleSelect(m.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-3 text-left transition-shadow sm:px-4',
                        statusCardClass(st),
                        isSel ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white' : 'hover:brightness-[0.99]',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center')}>
                        {isSel ? (
                          <CheckSquare className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Square className="h-5 w-5 text-gray-300" />
                        )}
                      </span>
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {m.memberimage_url?.trim() ? (
                          <img
                            src={m.memberimage_url.trim()}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="mx-auto h-full w-full scale-50 text-gray-400" strokeWidth={1.25} />
                        )}
                      </div>
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                        {m.first_name} {m.last_name}
                      </span>
                      <StatusBadge status={st} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filteredMembers.map((m) => {
                const st = effectiveStatus(m.id);
                const isSel = selected.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggleSelect(m.id)}
                      className={cn(
                        'flex w-full flex-col items-center rounded-2xl p-3 text-center transition-shadow',
                        statusCardClass(st),
                        isSel ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white' : 'hover:brightness-[0.99]',
                      )}
                    >
                      <span className="mb-2 flex h-5 w-5 self-start">
                        {isSel ? (
                          <CheckSquare className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Square className="h-5 w-5 text-gray-300" />
                        )}
                      </span>
                      <div className="relative mb-2 h-16 w-16 overflow-hidden rounded-full bg-gray-100">
                        {m.memberimage_url?.trim() ? (
                          <img
                            src={m.memberimage_url.trim()}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="mx-auto h-full w-full scale-50 text-gray-400" strokeWidth={1.25} />
                        )}
                      </div>
                      <span className="line-clamp-2 w-full text-xs font-semibold text-gray-900 sm:text-sm">
                        {m.first_name} {m.last_name}
                      </span>
                      <div className="mt-2">
                        <StatusBadge status={st} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {selected.size > 0 ? (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:bottom-6 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-2xl sm:border"
        >
          <p className="text-center text-sm font-semibold text-gray-900">
            {selected.size} selected — set attendance
          </p>
          <p className="mt-0.5 text-center text-xs text-gray-500">Overrides any previous mark for these members.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {(
              [
                ['present', 'Present'],
                ['absent', 'Absent'],
                ['unsure', 'Not sure'],
                ['not_marked', 'Not marked'],
              ] as const
            ).map(([st, label]) => (
              <button
                key={st}
                type="button"
                disabled={saving}
                onClick={() => void applyStatusToSelected(st)}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 sm:text-sm',
                  st === 'present' && 'bg-emerald-600 text-white hover:bg-emerald-700',
                  st === 'absent' && 'bg-red-600 text-white hover:bg-red-700',
                  st === 'unsure' && 'bg-amber-500 text-white hover:bg-amber-600',
                  st === 'not_marked' && 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
                )}
              >
                {saving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="mt-3 w-full text-center text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Clear selection
          </button>
        </div>
      ) : null}
    </div>
  );
}
