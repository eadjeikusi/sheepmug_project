import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useHref, useParams } from 'react-router';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, FileBarChart, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useMemberProfileModal } from '@/contexts/MemberProfileModalContext';
import { usePermissions } from '@/hooks/usePermissions';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { displayMemberWords } from '@sheepmug/shared-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTimePickerField } from '@/components/datetime';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import AssignTaskModal from '@/components/modals/AssignTaskModal';
import MinistryCard from '@/components/cards/MinistryCard';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import type { Group, Member } from '@/types';
import { canAccessLeadersDirectory } from '../../../permissions/atomicCanHelpers';

type LeaderTaskRow = {
  id: string;
  task_type: 'member' | 'group';
  title: string;
  status: string;
  due_at: string | null;
  member_id?: string;
  group_id?: string;
  members?: Array<{ id: string; first_name: string | null; last_name: string | null }>;
  groups?: Array<{ id: string; name: string | null }>;
};

type DetailPayload = {
  leader: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
    group_count: number;
  };
  groups: Array<{
    id: string;
    name: string;
    member_count: number;
    leader_id?: string | null;
    member_preview?: Array<{ member_id: string; image_url: string | null; initials: string }>;
  }>;
  members: Array<{ id: string; first_name: string | null; last_name: string | null; image_url?: string | null }>;
  tasks?: LeaderTaskRow[];
};

type TaskKindFilter = 'all' | 'member' | 'group';

function memberLabel(m: { first_name: string | null; last_name: string | null }): string {
  const n = `${String(m.first_name || '').trim()} ${String(m.last_name || '').trim()}`.trim();
  return n || 'Member';
}

function taskContextLine(t: LeaderTaskRow): string {
  if (t.task_type === 'member') {
    const m = t.members?.[0];
    return m ? displayMemberWords(memberLabel(m)) : 'Member follow-up';
  }
  const g = t.groups?.[0];
  return g?.name ? displayMemberWords(String(g.name)) : 'Group follow-up';
}

function syntheticMembersForAssignModal(
  rows: DetailPayload['members'],
  branchId: string | null,
): Member[] {
  const bid = branchId?.trim() || null;
  return rows.map((m) => ({
    id: m.id,
    organization_id: '',
    branch_id: bid,
    family_id: null,
    member_id_string: null,
    first_name: m.first_name || '',
    last_name: m.last_name || '',
    email: null,
    phone: null,
    dob: null,
    gender: null,
    marital_status: null,
    occupation: null,
    address: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    date_joined: null,
    status: null,
    created_at: '',
    updated_at: '',
    is_deleted: false,
    deleted_at: null,
    fullName: memberLabel(m),
    memberimage_url: m.image_url ?? null,
    member_url: m.image_url ?? null,
  }));
}

function leaderGroupToMinistryGroup(g: DetailPayload['groups'][number]): Group {
  return {
    id: g.id,
    organization_id: null,
    branch_id: null,
    parent_group_id: null,
    name: g.name,
    description: null,
    group_type: null,
    public_website_enabled: null,
    join_link_enabled: null,
    created_at: null,
    updated_at: null,
    leader_id: g.leader_id ?? null,
    member_count: g.member_count,
    member_preview: Array.isArray(g.member_preview) ? g.member_preview : [],
    profiles: null,
  };
}

const ASSIGN_TASK_NO_INITIAL_MEMBERS: string[] = [];

export default function LeaderDetail() {
  const { profileId } = useParams<{ profileId: string }>();
  const { token, user } = useAuth();
  const { selectedBranch } = useBranch();
  const memberProfile = useMemberProfileModal();
  const { can } = usePermissions();
  const canSee = canAccessLeadersDirectory(can);
  const canRunLeaderReport = can('report_leaders');
  const canViewLeaderTasks =
    user?.is_org_owner === true ||
    user?.is_super_admin === true ||
    can('monitor_member_tasks') ||
    can('monitor_group_tasks') ||
    can('report_leaders');
  const canAssignMemberTask = can('add_member_tasks');
  const canAssignGroupTask = can('add_group_tasks');

  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignMemberOpen, setAssignMemberOpen] = useState(false);
  const [assignGroupOpen, setAssignGroupOpen] = useState(false);
  const [groupTaskTitle, setGroupTaskTitle] = useState('');
  const [groupTaskDescription, setGroupTaskDescription] = useState('');
  const [groupTaskDue, setGroupTaskDue] = useState('');
  const [groupTaskGroupId, setGroupTaskGroupId] = useState('');
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [taskKindFilter, setTaskKindFilter] = useState<TaskKindFilter>('all');
  const [groupSearch, setGroupSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');

  const reportLeaderHref = useHref(
    data?.leader?.id
      ? `/reports?leader=${encodeURIComponent(data.leader.id)}`
      : '/reports',
  );

  const load = useCallback(async () => {
    if (!token || !canSee || !profileId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` });
      const res = await fetch(`/api/reports/leaders/${encodeURIComponent(profileId)}`, { headers });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not load leader');
      setData(raw as DetailPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, canSee, profileId, selectedBranch?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignModalMembers = useMemo(
    () => (data?.members ? syntheticMembersForAssignModal(data.members, selectedBranch?.id ?? null) : []),
    [data?.members, selectedBranch?.id],
  );

  const tasks = data?.tasks ?? [];
  const taskCounts = useMemo(() => {
    let member = 0;
    let group = 0;
    for (const t of tasks) {
      if (t.task_type === 'member') member += 1;
      else if (t.task_type === 'group') group += 1;
    }
    return { all: tasks.length, member, group };
  }, [tasks]);
  const filteredTasks = useMemo(() => {
    if (taskKindFilter === 'all') return tasks;
    return tasks.filter((t) => t.task_type === taskKindFilter);
  }, [tasks, taskKindFilter]);

  const filteredGroupsDisplay = useMemo(() => {
    if (!data) return [];
    const q = groupSearch.trim().toLowerCase();
    if (!q) return data.groups;
    return data.groups.filter(
      (g) => g.name.toLowerCase().includes(q) || String(g.member_count).includes(q),
    );
  }, [data?.groups, groupSearch]);

  const filteredMembersDisplay = useMemo(() => {
    if (!data) return [];
    const q = memberSearch.trim().toLowerCase();
    if (!q) return data.members;
    return data.members.filter((m) => memberLabel(m).toLowerCase().includes(q));
  }, [data?.members, memberSearch]);

  const searchedTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    if (!q) return filteredTasks;
    return filteredTasks.filter((t) => {
      const dueLabel =
        t.due_at &&
        (() => {
          try {
            return format(parseISO(t.due_at), 'MMM d, yyyy');
          } catch {
            return '';
          }
        })();
      const blob = `${t.title} ${t.status} ${taskContextLine(t)} ${dueLabel || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [filteredTasks, taskSearch]);

  const submitGroupTask = async () => {
    if (!token || !profileId) return;
    const title = groupTaskTitle.trim();
    if (!title) {
      toast.error('Enter a title');
      return;
    }
    const gid = groupTaskGroupId.trim();
    if (!gid) {
      toast.error('Select a group');
      return;
    }
    setGroupSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title,
        assignee_profile_ids: [profileId],
        assignee_profile_id: profileId,
      };
      if (groupTaskDescription.trim()) body.description = groupTaskDescription.trim();
      if (groupTaskDue.trim()) body.due_at = new Date(groupTaskDue).toISOString();
      const res = await fetch(`/api/groups/${encodeURIComponent(gid)}/tasks`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id ?? null, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not create task');
      notifyMemberTasksChanged();
      toast.success('Group task assigned');
      setAssignGroupOpen(false);
      setGroupTaskTitle('');
      setGroupTaskDescription('');
      setGroupTaskDue('');
      setGroupTaskGroupId('');
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create task');
    } finally {
      setGroupSubmitting(false);
    }
  };

  if (!canSee) {
    return (
      <div className="mx-auto max-w-4xl py-10 text-center text-sm text-gray-600">
        You do not have permission to view this page.
      </div>
    );
  }

  const title =
    data?.leader &&
    displayMemberWords(
      `${String(data.leader.first_name || '').trim()} ${String(data.leader.last_name || '').trim()}`.trim() ||
        String(data.leader.email || 'Leader'),
    );

  const showTasksTab = canViewLeaderTasks;

  const groupsOnlySection = data ? (
    <div className="min-w-0 space-y-4">
      <Input
        type="search"
        value={groupSearch}
        onChange={(e) => setGroupSearch(e.target.value)}
        placeholder="Search assigned groups"
        className="max-w-md bg-white"
        autoComplete="off"
      />
      {data.groups.length === 0 ? (
        <p className="text-sm text-gray-500">No groups tied to this leader in your scope.</p>
      ) : filteredGroupsDisplay.length === 0 ? (
        <p className="text-sm text-gray-500">No groups match your search.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredGroupsDisplay.map((g) => (
            <MinistryCard key={g.id} ministry={leaderGroupToMinistryGroup(g)} openGroupInNewTab />
          ))}
        </div>
      )}
    </div>
  ) : null;

  const membersSection = data ? (
    <section className="min-w-0 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">Members in those groups</h2>
      <Input
        type="search"
        value={memberSearch}
        onChange={(e) => setMemberSearch(e.target.value)}
        placeholder="Search members"
        className="max-w-md bg-white"
        autoComplete="off"
      />
      {data.members.length === 0 ? (
        <p className="text-sm text-gray-500">No members found (or none visible to you).</p>
      ) : filteredMembersDisplay.length === 0 ? (
        <p className="text-sm text-gray-500">No members match your search.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
          {filteredMembersDisplay.map((m) => {
            const initials =
              `${(m.first_name || '').trim()[0] || ''}${(m.last_name || '').trim()[0] || ''}`.toUpperCase() || '?';
            const img = m.image_url?.trim();
            return (
              <li key={m.id} className="px-0 py-0 text-sm text-gray-800">
                <button
                  type="button"
                  onClick={() => void memberProfile.openMemberById(m.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  {img ? (
                    <img src={img} alt="" className="h-9 w-9 shrink-0 rounded-full bg-gray-100 object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-800">
                      {initials}
                    </div>
                  )}
                  <span className="min-w-0 truncate font-medium text-gray-900">
                    {displayMemberWords(memberLabel(m))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  ) : null;

  const tasksSection = data ? (
    <div className="min-w-0 space-y-4">
      <Input
        type="search"
        value={taskSearch}
        onChange={(e) => setTaskSearch(e.target.value)}
        placeholder="Search tasks"
        className="max-w-md bg-white"
        autoComplete="off"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="bg-muted inline-flex w-full flex-wrap items-center gap-1 rounded-xl p-[3px] sm:w-auto">
          {(['all', 'member', 'group'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTaskKindFilter(k)}
              className={
                taskKindFilter === k
                  ? 'rounded-lg bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm'
                  : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {k === 'all'
                ? `All tasks (${taskCounts.all})`
                : k === 'member'
                  ? `Member tasks (${taskCounts.member})`
                  : `Group tasks (${taskCounts.group})`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {canAssignMemberTask && data.members.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setAssignMemberOpen(true)}
            >
              <ListTodo className="mr-1.5 h-3.5 w-3.5" />
              Member task ({data.members.length})
            </Button>
          ) : null}
          {canAssignGroupTask && data.groups.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setGroupTaskGroupId(data.groups[0]?.id ?? '');
                setAssignGroupOpen(true);
              }}
            >
              <ListTodo className="mr-1.5 h-3.5 w-3.5" />
              Group task ({data.groups.length})
            </Button>
          ) : null}
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks assigned to this leader in your branch scope.</p>
      ) : filteredTasks.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks in this filter.</p>
      ) : searchedTasks.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks match your search.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {searchedTasks.map((t) => {
            const dueLabel =
              t.due_at &&
              (() => {
                try {
                  return format(parseISO(t.due_at), 'MMM d, yyyy');
                } catch {
                  return null;
                }
              })();
            return (
              <li key={t.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{displayMemberWords(t.title)}</p>
                    <p className="text-xs text-gray-500">
                      {t.task_type === 'member' ? 'Member task' : 'Group task'} · {taskContextLine(t)}
                    </p>
                    {dueLabel ? <p className="mt-0.5 text-xs text-gray-400">Due {dueLabel}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">
                      {t.status.replace(/_/g, ' ')}
                    </span>
                    {t.task_type === 'member' && t.member_id ? (
                      <button
                        type="button"
                        onClick={() => void memberProfile.openMemberById(t.member_id!)}
                        className="text-xs font-medium text-violet-700 hover:underline"
                      >
                        Open member
                      </button>
                    ) : null}
                    {t.task_type === 'group' && t.group_id ? (
                      <Link
                        to={`/groups/${t.group_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-violet-700 hover:underline"
                      >
                        Open group
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ) : null;

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/leaders"
          className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Leaders
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !data ? (
        <p className="text-sm text-gray-500">Leader not found.</p>
      ) : (
        <>
          <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
            {data.leader.avatar_url?.trim() ? (
              <img
                src={data.leader.avatar_url.trim()}
                alt=""
                className="h-20 w-20 rounded-full object-cover bg-gray-100"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200 text-2xl font-semibold text-gray-600">
                {(title?.[0] || '?').toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{title}</h1>
              {data.leader.email ? (
                <p className="text-sm text-gray-500">{data.leader.email}</p>
              ) : null}
            </div>
            {canRunLeaderReport ? (
              <Button
                type="button"
                className="shrink-0 rounded-full bg-violet-600 text-white hover:bg-violet-700"
                onClick={() => {
                  const abs = new URL(reportLeaderHref, window.location.origin).href;
                  window.open(abs, '_blank', 'noopener,noreferrer');
                }}
              >
                <FileBarChart className="mr-2 h-4 w-4" />
                Generate report
              </Button>
            ) : null}
          </div>

          {showTasksTab ? (
            <Tabs defaultValue="groups" className="w-full min-w-0 gap-4">
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
                <TabsTrigger value="groups" className="px-3 py-2 sm:px-4">
                  Groups assigned ({data.groups.length})
                </TabsTrigger>
                <TabsTrigger value="members" className="px-3 py-2 sm:px-4">
                  Members ({data.members.length})
                </TabsTrigger>
                <TabsTrigger value="tasks" className="px-3 py-2 sm:px-4">
                  Tasks ({taskCounts.all})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="groups" className="mt-4 min-w-0 focus-visible:outline-none">
                {groupsOnlySection}
              </TabsContent>
              <TabsContent value="members" className="mt-4 min-w-0 focus-visible:outline-none">
                {membersSection}
              </TabsContent>
              <TabsContent value="tasks" className="mt-4 min-w-0 focus-visible:outline-none">
                {tasksSection}
              </TabsContent>
            </Tabs>
          ) : (
            <Tabs defaultValue="groups" className="w-full min-w-0 gap-4">
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
                <TabsTrigger value="groups" className="px-3 py-2 sm:px-4">
                  Groups assigned ({data.groups.length})
                </TabsTrigger>
                <TabsTrigger value="members" className="px-3 py-2 sm:px-4">
                  Members ({data.members.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="groups" className="mt-4 min-w-0 focus-visible:outline-none">
                {groupsOnlySection}
              </TabsContent>
              <TabsContent value="members" className="mt-4 min-w-0 focus-visible:outline-none">
                {membersSection}
              </TabsContent>
            </Tabs>
          )}

          <AssignTaskModal
            isOpen={assignMemberOpen}
            onClose={() => setAssignMemberOpen(false)}
            token={token}
            branchId={selectedBranch?.id}
            initialSelectedMemberIds={ASSIGN_TASK_NO_INITIAL_MEMBERS}
            allMembers={assignModalMembers}
            initialAssigneeIds={profileId ? [profileId] : []}
            lockAssignees
            onSuccess={() => {
              void load();
            }}
          />
          <Dialog open={assignGroupOpen} onOpenChange={(o) => !o && setAssignGroupOpen(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Assign group task</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Group</label>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-slate-50 px-3 py-2 text-sm"
                    value={groupTaskGroupId}
                    onChange={(e) => setGroupTaskGroupId(e.target.value)}
                  >
                    {data.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Title</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-slate-50 px-3 py-2 text-sm"
                    value={groupTaskTitle}
                    onChange={(e) => setGroupTaskTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Description (optional)</label>
                  <textarea
                    className="w-full rounded-lg border border-gray-200 bg-slate-50 px-3 py-2 text-sm"
                    rows={2}
                    value={groupTaskDescription}
                    onChange={(e) => setGroupTaskDescription(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Due (optional)</label>
                  <DateTimePickerField
                    value={groupTaskDue}
                    onChange={setGroupTaskDue}
                    datePlaceholder="Due date"
                    timePlaceholder="Due time"
                    splitClassName="rounded-lg border-gray-200 bg-slate-50"
                    triggerClassName="text-sm text-gray-900"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAssignGroupOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" disabled={groupSubmitting} onClick={() => void submitGroupTask()}>
                  {groupSubmitting ? 'Saving…' : 'Create & assign'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
