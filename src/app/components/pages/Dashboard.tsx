import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  Inbox,
  ListTodo,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { usePermissions } from '@/hooks/usePermissions';
import MemberDetailPanel from '../panels/MemberDetailPanel';
import { displayTitleWords } from '@/utils/displayText';
import { formatLongWeekdayDateTime, formatCalendarCountdown } from '@/utils/dateDisplayFormat';
import type { Member } from '@/types';

type DashGroup = {
  id: string;
  name: string;
  group_type?: string | null;
  member_count?: number;
};

type DashTask = {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
};

type DashEvent = {
  id: string;
  title: string;
  start_time?: string | null;
};

type EventAttendancePayload = {
  members: Array<{ id: string }>;
  attendance: Array<{ member_id: string; status: string }>;
};

function memberImageUrl(m: Member | null | undefined): string {
  if (!m) return '';
  const profileImg = (m as { profile_image?: string | null }).profile_image;
  const cands = [m.avatar_url, m.member_url, profileImg, m.profileImage];
  for (const x of cands) {
    if (typeof x === 'string' && x.trim().length > 0) return x.trim();
  }
  return '';
}

function isMaleGender(g: string | null | undefined): boolean {
  const s = (g || '').toLowerCase().trim();
  return s === 'male' || s === 'm' || s.startsWith('male');
}

function isFemaleGender(g: string | null | undefined): boolean {
  const s = (g || '').toLowerCase().trim();
  return s === 'female' || s === 'f' || s.startsWith('female');
}

function cardIcon(icon: React.ReactNode) {
  return <div className="w-9 h-9 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center">{icon}</div>;
}

function MemberFace({
  m,
  size = 'md',
  className = '',
}: {
  m: Member;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const src = memberImageUrl(m);
  const initial = (m.first_name?.[0] || m.last_name?.[0] || '?').toUpperCase();
  const sm = size === 'sm';
  const dim = sm ? 'h-8 w-8 text-[10px] border-2' : 'h-9 w-9 text-xs border-2';
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${sm ? 'h-8 w-8' : 'h-9 w-9'} shrink-0 rounded-full object-cover ring-2 ring-white ${className}`}
      />
    );
  }
  const male = isMaleGender(m.gender);
  const female = isFemaleGender(m.gender);
  return (
    <div
      className={`${dim} flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white ${
        male
          ? 'border-blue-200 bg-blue-100 text-blue-800'
          : female
            ? 'border-rose-200 bg-rose-100 text-rose-900'
            : 'border-gray-200 bg-gray-100 text-gray-700'
      } ${className}`}
    >
      {initial}
    </div>
  );
}

function StackedMemberFaces({ members, max = 4, size = 'sm' }: { members: Member[]; max?: number; size?: 'sm' | 'md' }) {
  const slice = members.slice(0, max);
  if (slice.length === 0) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-100 ring-2 ring-white">
        <Users className="h-3.5 w-3.5 text-slate-500" />
      </div>
    );
  }
  return (
    <div className="flex items-center pl-1">
      {slice.map((m, i) => (
        <div key={m.id} className={i > 0 ? '-ml-2' : ''} style={{ zIndex: slice.length - i }}>
          <MemberFace m={m} size={size} />
        </div>
      ))}
    </div>
  );
}

function GroupFaceStack({ groups, max = 3 }: { groups: DashGroup[]; max?: number }) {
  const slice = groups.slice(0, max);
  if (slice.length === 0) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 ring-2 ring-white">
        <Building2 className="h-3.5 w-3.5 text-slate-500" />
      </div>
    );
  }
  return (
    <div className="flex items-center pl-1">
      {slice.map((g, i) => (
        <div
          key={g.id}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-slate-100 to-slate-50 text-[10px] font-bold text-slate-700 ring-2 ring-white ${i > 0 ? '-ml-2' : ''}`}
          style={{ zIndex: slice.length - i }}
          title={g.name}
        >
          {(g.name || '?')[0]?.toUpperCase() ?? '?'}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { token, user } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();

  const canViewMembers = can('view_members');
  const canViewGroups = can('view_groups');
  const canViewMemberRequests = can('view_member_requests') || can('approve_member_requests');
  const canViewGroupRequests = can('view_group_requests') || can('approve_group_requests');
  const canViewEvents = can('view_events');
  const canTrackAttendance = can('view_event_attendance') || can('record_event_attendance');
  const canViewTasks = can('view_member_tasks') || can('view_group_tasks');

  const [loading, setLoading] = useState(false);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<DashGroup[]>([]);
  const [tasks, setTasks] = useState<DashTask[]>([]);
  const [memberRequestCount, setMemberRequestCount] = useState(0);
  const [groupRequestCount, setGroupRequestCount] = useState(0);
  const [recentEvent, setRecentEvent] = useState<DashEvent | null>(null);
  const [attendanceSummary, setAttendanceSummary] = useState<{ present: number; total: number }>({ present: 0, total: 0 });
  const [viewingMemberDetail, setViewingMemberDetail] = useState<Member | null>(null);

  const recentMembers = useMemo(() => allMembers.slice(0, 8), [allMembers]);

  const recentEventCountdown = recentEvent?.start_time ? formatCalendarCountdown(recentEvent.start_time) : '';

  useEffect(() => {
    if (!token || !selectedBranch?.id) return;
    let cancelled = false;
    const headers = withBranchScope(selectedBranch.id, { Authorization: `Bearer ${token}` });

    const load = async () => {
      setLoading(true);
      try {
        const requests: Promise<void>[] = [];

        if (canViewMembers) {
          requests.push(
            (async () => {
              const url = new URL('/api/members', window.location.origin);
              url.searchParams.set('include_deleted', 'false');
              url.searchParams.set('branch_id', selectedBranch.id);
              url.searchParams.set('limit', '100');
              const res = await fetch(url.toString(), { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.members) ? raw.members : [];
              const rows = arr as Record<string, unknown>[];
              const mapped = rows.map((m) => {
                const firstName = String(m.first_name ?? '').trim();
                const lastName = String(m.last_name ?? '').trim();
                const memberUrl = typeof m.member_url === 'string' ? m.member_url : null;
                const avatarUrl = typeof m.avatar_url === 'string' ? m.avatar_url : null;
                const fallbackImage = typeof m.profile_image === 'string' ? m.profile_image : null;
                const profileImage = avatarUrl || memberUrl || fallbackImage || '';
                return {
                  ...(m as Member),
                  fullName: `${firstName} ${lastName}`.trim(),
                  profileImage,
                  profile_image: fallbackImage,
                  member_url: memberUrl,
                } as Member;
              });
              setAllMembers(mapped);
            })(),
          );
        }

        if (canViewGroups) {
          requests.push(
            (async () => {
              const url = new URL('/api/groups', window.location.origin);
              url.searchParams.set('tree', '1');
              url.searchParams.set('branch_id', selectedBranch.id);
              const res = await fetch(url.toString(), { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const gArr = Array.isArray(raw) ? raw : Array.isArray(raw?.groups) ? raw.groups : [];
              setGroups((gArr as DashGroup[]).slice(0, 6));
            })(),
          );
        }

        if (canViewTasks) {
          requests.push(
            (async () => {
              const res = await fetch('/api/tasks/mine?status=open&limit=10', { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const list = Array.isArray((raw as { tasks?: unknown[] }).tasks)
                ? ((raw as { tasks: DashTask[] }).tasks || [])
                : [];
              const sorted = [...list].sort((a, b) => {
                if (!a.due_at) return 1;
                if (!b.due_at) return -1;
                return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
              });
              setTasks(sorted.slice(0, 3));
            })(),
          );
        }

        if (canViewMemberRequests) {
          requests.push(
            (async () => {
              const url = new URL('/api/member-requests', window.location.origin);
              url.searchParams.set('status', 'pending');
              const res = await fetch(url.toString(), { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const mrArr = Array.isArray(raw) ? raw : Array.isArray(raw?.requests) ? raw.requests : [];
              setMemberRequestCount(raw?.total_count ?? mrArr.length);
            })(),
          );
        }

        if (canViewGroupRequests) {
          requests.push(
            (async () => {
              const url = new URL('/api/group-requests', window.location.origin);
              url.searchParams.set('status', 'pending');
              const res = await fetch(url.toString(), { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const grArr = Array.isArray(raw) ? raw : Array.isArray(raw?.requests) ? raw.requests : [];
              setGroupRequestCount(raw?.total_count ?? grArr.length);
            })(),
          );
        }

        if (canViewEvents || canTrackAttendance) {
          requests.push(
            (async () => {
              const res = await fetch('/api/events?limit=20', { headers });
              const raw = await res.json().catch(() => ({}));
              if (!res.ok || cancelled) return;
              const evArr = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : [];
              const rows = evArr as DashEvent[];
              const now = Date.now();
              const upcoming = rows
                .filter((e) => !!e.start_time && new Date(e.start_time as string).getTime() >= now)
                .sort((a, b) => new Date(a.start_time || '').getTime() - new Date(b.start_time || '').getTime());
              const picked = upcoming[0] || rows[0] || null;
              setRecentEvent(picked);
              if (!picked || !canTrackAttendance) return;
              const attRes = await fetch(`/api/events/${encodeURIComponent(picked.id)}/attendance`, { headers });
              const attRaw = await attRes.json().catch(() => ({}));
              if (!attRes.ok || cancelled) return;
              const payload = attRaw as EventAttendancePayload;
              const total = Array.isArray(payload.members) ? payload.members.length : 0;
              const present = Array.isArray(payload.attendance)
                ? payload.attendance.filter((a) => String(a.status).toLowerCase() === 'present').length
                : 0;
              setAttendanceSummary({ present, total });
            })(),
          );
        }

        await Promise.all(requests);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    selectedBranch?.id,
    canViewMembers,
    canViewGroups,
    canViewTasks,
    canViewMemberRequests,
    canViewGroupRequests,
    canViewEvents,
    canTrackAttendance,
  ]);

  const stats = useMemo(
    () => [
      { label: 'Members', value: allMembers.length > 0 ? String(allMembers.length) : '0' },
      { label: 'Groups', value: groups.length > 0 ? String(groups.length) : '0' },
      { label: 'Pending Requests', value: String(memberRequestCount + groupRequestCount) },
      { label: 'Open Tasks', value: String(tasks.length) },
    ],
    [allMembers.length, groups.length, memberRequestCount, groupRequestCount, tasks.length],
  );

  /** Overlapping faces for stat cards (prioritize members with photos; separate pools so cards differ). */
  const statFacePools = useMemo(() => {
    const preferWithPhotos = (list: Member[]) => {
      const withPhoto = list.filter((m) => memberImageUrl(m));
      return withPhoto.length >= 3 ? withPhoto : list;
    };
    const pool = preferWithPhotos(allMembers);
    const n = pool.length;
    const take = (start: number) => {
      if (n === 0) return [];
      const out: Member[] = [];
      for (let i = 0; i < 4; i += 1) out.push(pool[(start + i) % n]);
      return out;
    };
    return {
      members: pool.slice(0, 4),
      requests: n > 4 ? take(4) : pool.slice(0, 4),
      tasks: n > 8 ? take(8) : take(2),
    };
  }, [allMembers]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="font-semibold text-gray-900 text-[24px]">Hello {user?.first_name || 'there'}</h1>
        <p className="mt-1 text-gray-500 text-[14px]">Simple view of what needs attention right now.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, idx) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-white rounded-2xl p-4 border border-gray-200 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-gray-500 leading-tight">{s.label}</p>
              <div className="flex shrink-0 items-center gap-1">
                {s.label === 'Members' ? (
                  <StackedMemberFaces members={statFacePools.members} max={4} />
                ) : s.label === 'Groups' ? (
                  <GroupFaceStack groups={groups} max={3} />
                ) : s.label === 'Pending Requests' ? (
                  <div className="flex items-center gap-0.5">
                    <StackedMemberFaces members={statFacePools.requests} max={3} />
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-amber-50 ring-2 ring-white">
                      <Inbox className="h-3.5 w-3.5 text-amber-700" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <StackedMemberFaces members={statFacePools.tasks} max={3} />
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-blue-50 ring-2 ring-white">
                      <ListTodo className="h-3.5 w-3.5 text-blue-700" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="text-2xl font-semibold text-gray-900 tabular-nums">{loading ? '...' : s.value}</p>
              <div className="opacity-80">{cardIcon(<BarChart3 className="w-4 h-4 text-gray-600" />)}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {canViewTasks && (
          <section className="bg-white rounded-2xl p-5 border border-gray-200 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {cardIcon(<ListTodo className="w-4 h-4 text-gray-700" />)}
                <h2 className="font-semibold text-gray-900">Task List (Top 3)</h2>
              </div>
              <Link to="/tasks" className="text-sm text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            <div className="space-y-2">
              {tasks.map((t) => {
                const dueCd = t.due_at ? formatCalendarCountdown(t.due_at) : '';
                return (
                  <div key={t.id} className="p-2 rounded-xl border border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{displayTitleWords(t.title)}</p>
                    <p className="text-xs text-gray-500">
                      {t.due_at
                        ? `Due ${formatLongWeekdayDateTime(t.due_at)}${dueCd ? ` · ${dueCd}` : ''}`
                        : 'No due date'}{' '}
                      · {displayTitleWords(t.status.replace(/_/g, ' '))}
                    </p>
                  </div>
                );
              })}
              {!loading && tasks.length === 0 && <p className="text-sm text-gray-500">No upcoming tasks.</p>}
            </div>
          </section>
        )}

        {canViewMembers && (
          <section className="bg-white rounded-2xl p-5 border border-gray-200 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {cardIcon(<Users className="w-4 h-4 text-gray-700" />)}
                <h2 className="font-semibold text-gray-900">Recent Members</h2>
              </div>
              <Link to="/members" className="text-sm text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            <div className="space-y-2">
              {recentMembers.slice(0, 4).map((m) => {
                const imageSrc = memberImageUrl(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setViewingMemberDetail(m)}
                    className="w-full text-left flex items-center gap-3 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-colors"
                  >
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={`${m.first_name} ${m.last_name}`}
                        className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white border border-gray-200 shadow-sm"
                      />
                    ) : (
                      <div className="shrink-0">
                        <MemberFace m={m} size="md" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.first_name} {m.last_name}</p>
                      <p className="text-xs text-gray-500 truncate">{m.email || '-'}</p>
                    </div>
                  </button>
                );
              })}
              {!loading && recentMembers.length === 0 && <p className="text-sm text-gray-500">No members to show.</p>}
            </div>
          </section>
        )}

        {(canViewMemberRequests || canViewGroupRequests) && (
          <section className="bg-white rounded-2xl p-5 border border-gray-200 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {cardIcon(<Inbox className="w-4 h-4 text-gray-700" />)}
                <h2 className="font-semibold text-gray-900">Requests</h2>
              </div>
              <Link to="/members" className="text-sm text-blue-600 hover:text-blue-700">Review</Link>
            </div>
            <div className="space-y-2">
              {canViewMemberRequests && (
                <div className="flex items-center justify-between p-2 rounded-xl border border-gray-100">
                  <p className="text-sm text-gray-700">Member requests</p>
                  <span className="text-sm font-semibold text-gray-900">{memberRequestCount}</span>
                </div>
              )}
              {canViewGroupRequests && (
                <div className="flex items-center justify-between p-2 rounded-xl border border-gray-100">
                  <p className="text-sm text-gray-700">Group join requests</p>
                  <span className="text-sm font-semibold text-gray-900">{groupRequestCount}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {(canTrackAttendance || canViewEvents) && (
        <section className="bg-white rounded-2xl p-5 border border-gray-200 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {cardIcon(<CalendarCheck className="w-4 h-4 text-gray-700" />)}
              <h2 className="font-semibold text-gray-900">Recent Event Attendance</h2>
            </div>
            {canTrackAttendance && recentEvent && (
              <Link to={`/events/${recentEvent.id}`} className="text-sm text-blue-600 hover:text-blue-700">
                Take attendance
              </Link>
            )}
          </div>
          {recentEvent ? (
            <div className="flex items-center justify-between rounded-xl border border-gray-100 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {displayTitleWords(recentEvent.title)}
                </p>
                <p className="text-xs text-gray-500">
                  {recentEvent.start_time ? formatLongWeekdayDateTime(recentEvent.start_time) || 'Date not set' : 'Date not set'}
                  {recentEventCountdown ? ` · ${recentEventCountdown}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Present</p>
                <p className="text-sm font-semibold text-gray-900">
                  {attendanceSummary.present}/{attendanceSummary.total}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-100 p-3 text-sm text-gray-500">No recent events available.</div>
          )}
        </section>
      )}

      <MemberDetailPanel
        isOpen={!!viewingMemberDetail}
        onClose={() => setViewingMemberDetail(null)}
        member={viewingMemberDetail}
        familyGroups={[]}
        allMembers={allMembers}
        onEdit={(updatedMember) => {
          setAllMembers((prev) => prev.map((m) => (m.id === updatedMember.id ? { ...m, ...updatedMember } : m)));
          setViewingMemberDetail(updatedMember);
        }}
      />
    </div>
  );
}