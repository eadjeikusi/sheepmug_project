import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { X, Edit2, Mail, Phone, MapPin, Calendar, Users, Home, Award, Clock, CheckCircle, XCircle, AlertCircle, Send, FileText, Trash2, Plus, Mic, Loader2, Search, ListTodo, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import type { Member, FamilyGroup } from '../../utils/mockData';
import { mockGroups as allMockGroups, mockMembers as allMockMembers } from '../../utils/mockData';
import { compressImageForUpload, MEMBER_PROFILE_PHOTO_OPTIONS } from '../../utils/compressImageForUpload';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { usePermissions } from '@/hooks/usePermissions';
import { DatePickerField, DateTimePickerField, TimePickerField } from '@/components/datetime';
import { notifyMemberTasksChanged } from '@/hooks/useMyOpenTaskCount';
import { useMemberStatusOptions } from '../../hooks/useMemberStatusOptions';
import { useCustomFieldDefinitions } from '../../hooks/useCustomFieldDefinitions';
import CustomFieldsSection, { CustomFieldsReadOnlyList } from '../CustomFieldsSection';
import { memberStatusBadgePair } from '../../utils/memberStatusBadge';
import type { Member as ApiMember, MemberImportantDate } from '@/types';
import AssignTaskModal from '../modals/AssignTaskModal';
import BulkSmsComposeModal from '../modals/BulkSmsComposeModal';
import PhoneCountryInput from '../PhoneCountryInput';
import { e164ToCountryAndNational } from '@/lib/phoneE164';
import { capitalizeSentencesForUi } from '@/utils/sentenceCaseDisplay';
import {
  formatLongWeekdayDate,
  formatLongWeekdayDateTime,
  formatCalendarCountdown,
} from '@/utils/dateDisplayFormat';

const DEFAULT_PHONE_REGION = 'US';

const ATTENDANCE_STATUS_OPTIONS = ['not_marked', 'present', 'absent', 'unsure'] as const;
type AttendanceStatus = (typeof ATTENDANCE_STATUS_OPTIONS)[number];

function isMemberDbId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id).trim());
}

/** Any dashed 32-hex id (checklist rows may use non-RFC UUIDs from legacy seeds). */
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

type MemberGroupRow = {
  group_id: string;
  name: string;
  group_type: string | null;
  parent_group_id: string | null;
  role_in_group: string;
  viewer_accessible?: boolean;
};

type MemberEventRow = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  event_type: string | null;
  status: string | null;
  group_name: string | null;
  attendance_status: AttendanceStatus | string;
  check_in_time: string | null;
};

interface MemberDetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  familyGroups?: FamilyGroup[]; // Changed from familyGroup?: FamilyGroup
  allMembers: Member[];
  onEdit: (updatedMember: Member) => void;
}

interface Note {
  id: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  audioUrl?: string;
  audioDuration?: number;
}

export default function MemberDetailPanel({
  isOpen,
  onClose,
  member,
  familyGroups,
  allMembers,
  onEdit,
}: MemberDetailPanelProps) {
  const { token, user } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const { options: memberStatusPicklist } = useMemberStatusOptions(isOpen);
  const { definitions: memberCustomFieldDefs } = useCustomFieldDefinitions('member', isOpen);
  const sortedMemberStatusOptions = useMemo(
    () =>
      [...memberStatusPicklist].sort(
        (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
      ),
    [memberStatusPicklist],
  );
  const dobMaxDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'family' | 'ministries' | 'attendance' | 'tasks' | 'notes' | 'important_dates'
  >('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editedMember, setEditedMember] = useState<Member | null>(null);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const toUpload = await compressImageForUpload(file, MEMBER_PROFILE_PHOTO_OPTIONS);
      const formData = new FormData();
      formData.append('image', toUpload);

      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error('Failed to upload image');
      
      const { url } = await response.json();
      
      // Update member with new image URL
      onEdit({ ...member, profileImage: url });
      toast.success('Profile image updated successfully');
    } catch (error) {
      toast.error('Failed to update profile image');
    }
  };
  
  // Notes (loaded from /api/members/:id/notes for real members)
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  /** Notes tab: primary control is a button; textarea appears after click. */
  const [newNoteComposerOpen, setNewNoteComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [deleteConfirmNoteId, setDeleteConfirmNoteId] = useState<string | null>(null);
  const [importantDates, setImportantDates] = useState<MemberImportantDate[]>([]);
  const [importantDatesLoading, setImportantDatesLoading] = useState(false);
  const [importantDatesError, setImportantDatesError] = useState<string | null>(null);
  const [importantDateTitle, setImportantDateTitle] = useState('');
  const [importantDateDescription, setImportantDateDescription] = useState('');
  const [importantDateDate, setImportantDateDate] = useState('');
  const [importantDateTime, setImportantDateTime] = useState('');
  const [importantDateType, setImportantDateType] = useState<'birthday' | 'anniversary' | 'custom'>('custom');
  const [importantDateReminderOffsets, setImportantDateReminderOffsets] = useState<string[]>([]);
  const [importantDateDefaultAlertEnabled, setImportantDateDefaultAlertEnabled] = useState(false);
  const [savingImportantDate, setSavingImportantDate] = useState(false);
  const [editingImportantDateId, setEditingImportantDateId] = useState<string | null>(null);
  const [importantDateComposerOpen, setImportantDateComposerOpen] = useState(false);

  type MemberTaskRow = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    member_id: string;
    assignee_profile_id: string;
    assignee_profile_ids?: string[];
    created_by_profile_id: string;
    assignee_name: string;
    created_by_name: string;
    checklist?: { id: string; label: string; done: boolean }[];
    related_member_ids?: string[];
    members?: { id: string; first_name: string | null; last_name: string | null }[];
  };

  const leaderIdsFromMemberTask = (t: MemberTaskRow): string[] => {
    if (Array.isArray(t.assignee_profile_ids) && t.assignee_profile_ids.length > 0) {
      return [...new Set(t.assignee_profile_ids.filter((id) => isMemberDbId(id)))];
    }
    return t.assignee_profile_id ? [t.assignee_profile_id] : [];
  };

  const [memberTasks, setMemberTasks] = useState<MemberTaskRow[]>([]);
  const [memberTasksLoading, setMemberTasksLoading] = useState(false);
  const [assignTaskModalOpen, setAssignTaskModalOpen] = useState(false);
  const [taskCardExpandedIds, setTaskCardExpandedIds] = useState<Set<string>>(() => new Set());
  const [taskStaffOptions, setTaskStaffOptions] = useState<
    { id: string; email: string | null; first_name: string | null; last_name: string | null; branch_id: string | null }[]
  >([]);
  const [taskBeingEditedId, setTaskBeingEditedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editAssigneeIds, setEditAssigneeIds] = useState<Set<string>>(() => new Set());
  const [editChecklistLines, setEditChecklistLines] = useState<
    { key: string; id?: string; label: string; done: boolean }[]
  >([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  /** When true, only checklist is edited (user has manage_member_task_checklist but not manage_member_tasks). */
  const [editingChecklistOnly, setEditingChecklistOnly] = useState(false);

  const branchMembers = useMemo(() => {
    const bid = selectedBranch?.id?.trim() || '';
    return allMembers.filter((m) => {
      if (!isMemberDbId(m.id)) return false;
      const mb = (m as { branch_id?: string | null }).branch_id ?? null;
      if (!bid) return true;
      return mb != null && String(mb) === bid;
    });
  }, [allMembers, selectedBranch?.id]);

  const [selectedGroup, setSelectedGroup] = useState<{ name: string; members: Member[] } | null>(null);

  const [memberGroups, setMemberGroups] = useState<MemberGroupRow[]>([]);
  const [memberGroupsLoading, setMemberGroupsLoading] = useState(false);
  const [memberGroupsError, setMemberGroupsError] = useState<string | null>(null);
  const [ministrySearch, setMinistrySearch] = useState('');
  const [ministryTypeFilter, setMinistryTypeFilter] = useState<string>('all');

  const [memberEvents, setMemberEvents] = useState<MemberEventRow[]>([]);
  const [memberEventsLoading, setMemberEventsLoading] = useState(false);
  const [memberEventsError, setMemberEventsError] = useState<string | null>(null);
  const [eventSearch, setEventSearch] = useState('');
  const [eventStatusFilter, setEventStatusFilter] = useState<string>('all');
  const [eventTimeFilter, setEventTimeFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [eventAttendanceFilter, setEventAttendanceFilter] = useState<string>('all');
  const [savingAttendanceForEventId, setSavingAttendanceForEventId] = useState<string | null>(null);

  const fetchMemberGroups = useCallback(async () => {
    if (!member || !token || !isMemberDbId(member.id)) return;
    setMemberGroupsLoading(true);
    setMemberGroupsError(null);
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(String(member.id).trim())}/groups`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to load ministries');
      setMemberGroups(Array.isArray(raw) ? (raw as MemberGroupRow[]) : []);
    } catch (e) {
      setMemberGroups([]);
      setMemberGroupsError(e instanceof Error ? e.message : 'Failed to load ministries');
    } finally {
      setMemberGroupsLoading(false);
    }
  }, [member, token, selectedBranch?.id]);

  const fetchMemberEvents = useCallback(async () => {
    if (!member || !token || !isMemberDbId(member.id)) return;
    setMemberEventsLoading(true);
    setMemberEventsError(null);
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(String(member.id).trim())}/events`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to load events');
      const list = raw?.events;
      setMemberEvents(Array.isArray(list) ? (list as MemberEventRow[]) : []);
    } catch (e) {
      setMemberEvents([]);
      setMemberEventsError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setMemberEventsLoading(false);
    }
  }, [member, token, selectedBranch?.id]);

  useEffect(() => {
    if (!isOpen || !member) return;
    setMinistrySearch('');
    setMinistryTypeFilter('all');
    setEventSearch('');
    setEventStatusFilter('all');
    setEventTimeFilter('all');
    setEventAttendanceFilter('all');
  }, [isOpen, member?.id]);

  useEffect(() => {
    setNewNoteContent('');
    setNewNoteComposerOpen(false);
    setEditingNoteId(null);
    setEditingNoteContent('');
    setDeleteConfirmNoteId(null);
    setImportantDates([]);
    setImportantDatesError(null);
    setImportantDateTitle('');
    setImportantDateDescription('');
    setImportantDateDate('');
    setImportantDateTime('');
    setImportantDateType('custom');
    setImportantDateReminderOffsets([]);
    setImportantDateDefaultAlertEnabled(false);
    setEditingImportantDateId(null);
    setImportantDateComposerOpen(false);
  }, [member?.id]);

  useEffect(() => {
    if (!isOpen || !member || !token || !isMemberDbId(member.id)) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }
    if (
      !can('view_member_notes') &&
      !can('view_members') &&
      !can('add_member_notes') &&
      !can('edit_member_notes') &&
      !can('delete_member_notes')
    ) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/members/${encodeURIComponent(String(member.id).trim())}/notes`, {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const raw = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setNotes([]);
          return;
        }
        const list = (raw as { notes?: Note[] }).notes;
        setNotes(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setNotes([]);
      } finally {
        if (!cancelled) setNotesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, member?.id, token, selectedBranch?.id, can]);

  useEffect(() => {
    setMemberTasks([]);
    setAssignTaskModalOpen(false);
    setTaskCardExpandedIds(new Set());
    setTaskBeingEditedId(null);
    setEditTitle('');
    setEditDescription('');
    setEditDue('');
    setEditAssigneeIds(new Set());
    setEditChecklistLines([]);
    setEditingChecklistOnly(false);
  }, [member?.id, user?.id]);

  useEffect(() => {
    if (!isOpen || !member || !token || !isMemberDbId(member.id)) {
      setMemberTasks([]);
      setMemberTasksLoading(false);
      return;
    }
    if (activeTab !== 'tasks' || !can('view_member_tasks')) {
      setMemberTasksLoading(false);
      return;
    }
    let cancelled = false;
    setMemberTasksLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/members/${encodeURIComponent(String(member.id).trim())}/tasks`,
          { headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }) },
        );
        const raw = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setMemberTasks([]);
          return;
        }
        const list = (raw as { tasks?: MemberTaskRow[] }).tasks;
        setMemberTasks(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setMemberTasks([]);
      } finally {
        if (!cancelled) setMemberTasksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, member?.id, token, selectedBranch?.id, activeTab, can]);

  useEffect(() => {
    if (!isOpen || !member || !token || !isMemberDbId(member.id)) {
      setImportantDates([]);
      setImportantDatesLoading(false);
      setImportantDatesError(null);
      return;
    }
    if (activeTab !== 'important_dates' || !can('view_members')) {
      setImportantDatesLoading(false);
      return;
    }
    let cancelled = false;
    setImportantDatesLoading(true);
    setImportantDatesError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/members/${encodeURIComponent(String(member.id).trim())}/important-dates`,
          { headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }) },
        );
        const raw = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setImportantDates([]);
          setImportantDatesError(typeof raw?.error === 'string' ? raw.error : 'Failed to load important dates');
          return;
        }
        const list = (raw as { important_dates?: MemberImportantDate[] }).important_dates;
        setImportantDates(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!cancelled) {
          setImportantDates([]);
          setImportantDatesError(e instanceof Error ? e.message : 'Failed to load important dates');
        }
      } finally {
        if (!cancelled) setImportantDatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, member?.id, token, selectedBranch?.id, activeTab, can]);

  useEffect(() => {
    if (!isOpen || !token || activeTab !== 'tasks' || !can('manage_member_tasks')) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/org/staff', {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const raw = await res.json().catch(() => ({}));
        if (cancelled) return;
        const staff = (raw as { staff?: typeof taskStaffOptions }).staff;
        const rows = Array.isArray(staff) ? staff : [];
        const bid = selectedBranch?.id?.trim() || null;
        const filtered = bid
          ? rows.filter((r) => !r.branch_id || String(r.branch_id) === bid)
          : rows;
        setTaskStaffOptions(filtered);
      } catch {
        if (!cancelled) setTaskStaffOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, activeTab, selectedBranch?.id, can]);

  useEffect(() => {
    if (!isOpen || !member || !token || !isMemberDbId(member.id)) return;
    if (activeTab === 'ministries') fetchMemberGroups();
    if (activeTab === 'attendance') {
      fetchMemberGroups();
      fetchMemberEvents();
    }
  }, [isOpen, member?.id, activeTab, token, fetchMemberGroups, fetchMemberEvents]);

  const updateAttendance = async (eventId: string, status: AttendanceStatus) => {
    if (!member || !token || !isMemberDbId(member.id)) return;
    setSavingAttendanceForEventId(eventId);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attendance`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          updates: [{ member_id: String(member.id).trim(), status }],
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not save attendance');
      }
      const nowIso = new Date().toISOString();
      setMemberEvents((prev) =>
        prev.map((ev) =>
          ev.id === eventId
            ? {
                ...ev,
                attendance_status: status,
                check_in_time: status === 'present' ? nowIso : null,
              }
            : ev
        )
      );
      toast.success('Attendance saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save attendance');
    } finally {
      setSavingAttendanceForEventId(null);
    }
  };

  const filteredMemberGroups = useMemo(() => {
    const q = ministrySearch.trim().toLowerCase();
    return memberGroups.filter((g) => {
      if (ministryTypeFilter !== 'all') {
        const t = (g.group_type || '').trim();
        if (t !== ministryTypeFilter) return false;
      }
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || (g.group_type || '').toLowerCase().includes(q);
    });
  }, [memberGroups, ministrySearch, ministryTypeFilter]);

  const ministryTypeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const g of memberGroups) {
      const t = (g.group_type || '').trim();
      if (t) s.add(t);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [memberGroups]);

  const filteredMemberEvents = useMemo(() => {
    const now = Date.now();
    const q = eventSearch.trim().toLowerCase();
    return memberEvents.filter((ev) => {
      const start = new Date(ev.start_time).getTime();
      if (eventTimeFilter === 'upcoming' && start < now) return false;
      if (eventTimeFilter === 'past' && start >= now) return false;
      if (eventStatusFilter !== 'all') {
        const st = (ev.status || '').trim();
        if (st !== eventStatusFilter) return false;
      }
      if (eventAttendanceFilter !== 'all' && ev.attendance_status !== eventAttendanceFilter) return false;
      if (!q) return true;
      const blob = `${ev.title} ${ev.group_name || ''} ${ev.event_type || ''} ${ev.status || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [memberEvents, eventSearch, eventStatusFilter, eventTimeFilter, eventAttendanceFilter]);

  const eventStatusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of memberEvents) {
      const st = (e.status || '').trim();
      if (st) s.add(st);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [memberEvents]);

  const attendanceRateLast12Mo = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 12);
    const past = memberEvents.filter((e) => {
      const t = new Date(e.start_time);
      return t < now && t >= cutoff;
    });
    if (past.length === 0) return null;
    const present = past.filter((e) => e.attendance_status === 'present').length;
    return Math.round((present / past.length) * 100);
  }, [memberEvents]);

  const isLeaderRole = (role: string) => /lead/i.test(role);

  const handleOpenGroupModal = (group: any) => {
    const membersInGroup = allMockMembers.filter(m => group.memberIds.includes(m.id));
    setSelectedGroup({ name: group.name, members: membersInGroup });
  };

  const getMemberGroups = (memberId: string) => {
    const trimmedMemberId = String(memberId).trim();
    const groups = allMockGroups.filter(g => g.memberIds.includes(trimmedMemberId));
    return groups;
  };
  useEffect(() => {
    if (!member) return;
    if (!isEditing) {
      setEditedMember(member);
      return;
    }
    const p = e164ToCountryAndNational(
      member.phone || member.phoneNumber || '',
      member.phone_country_iso || DEFAULT_PHONE_REGION,
    );
    const e = e164ToCountryAndNational(
      member.emergency_contact_phone || member.emergencyContact || '',
      member.emergency_contact_phone_country_iso || DEFAULT_PHONE_REGION,
    );
    setEditedMember({
      ...member,
      phone: p.national,
      phoneNumber: p.national,
      phone_country_iso: p.countryIso,
      emergency_contact_phone: e.national,
      emergencyContact: e.national,
      emergency_contact_phone_country_iso: e.countryIso,
    });
  }, [member, isEditing]);

  const memberFamilies = useMemo(() => {
    if (!member || !familyGroups?.length) return [];
    const mid = String(member.id).trim();
    return familyGroups.filter((fg) => {
      const inFamilyMemberList = (fg.memberIds || []).some((id) => String(id).trim() === mid);
      const inMemberFamilyIds = member.familyIds?.includes(fg.id) ?? false;
      return inFamilyMemberList || inMemberFamilyIds;
    });
  }, [member, familyGroups]);

  if (!member) return null;

  const currentMember = isEditing && editedMember ? editedMember : member;

  const handleSave = async () => {
    if (!editedMember || !member) return;

    if (!token || !isMemberDbId(String(member.id).trim())) {
      toast.error('Sign in and open a saved member to save changes to the server.');
      setIsEditing(false);
      onEdit(editedMember);
      return;
    }

    if (!can('edit_members')) {
      toast.error('You do not have permission to edit members.');
      return;
    }

    try {
      const res = await fetch(`/api/members/${encodeURIComponent(String(member.id).trim())}`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          first_name: editedMember.first_name,
          last_name: editedMember.last_name,
          email: editedMember.email,
          phone: editedMember.phone ?? editedMember.phoneNumber,
          phone_country_iso: editedMember.phone_country_iso,
          address: editedMember.address ?? editedMember.location,
          emergency_contact_name: editedMember.emergency_contact_name,
          emergency_contact_phone: editedMember.emergency_contact_phone ?? editedMember.emergencyContact,
          emergency_contact_phone_country_iso: editedMember.emergency_contact_phone_country_iso,
          dob: editedMember.dob,
          gender: editedMember.gender,
          marital_status: editedMember.marital_status,
          occupation: editedMember.occupation,
          member_url: editedMember.member_url ?? editedMember.profileImage,
          date_joined: editedMember.date_joined,
          member_id_string: editedMember.member_id_string,
          status: editedMember.status ?? null,
          custom_fields:
            editedMember.custom_fields &&
            typeof editedMember.custom_fields === 'object' &&
            !Array.isArray(editedMember.custom_fields)
              ? editedMember.custom_fields
              : {},
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to save member');
      }
      const m = raw as Record<string, string | null | undefined>;
      const cfRaw = (raw as Record<string, unknown>).custom_fields;
      const mergedCf =
        cfRaw && typeof cfRaw === 'object' && !Array.isArray(cfRaw)
          ? (cfRaw as Record<string, unknown>)
          : editedMember.custom_fields;
      const merged: Member = {
        ...editedMember,
        first_name: String(m.first_name ?? editedMember.first_name ?? ''),
        last_name: String(m.last_name ?? editedMember.last_name ?? ''),
        email: (m.email as string) ?? editedMember.email ?? null,
        phone: (m.phone_number as string) ?? editedMember.phone,
        phoneNumber: (m.phone_number as string) ?? editedMember.phoneNumber,
        phone_country_iso: (m.phone_country_iso as string | null) ?? editedMember.phone_country_iso ?? null,
        address: (m.address as string) ?? editedMember.address,
        location: (m.address as string) ?? editedMember.location,
        emergency_contact_name: (m.emergency_contact_name as string) ?? editedMember.emergency_contact_name,
        emergency_contact_phone: (m.emergency_contact_phone as string) ?? editedMember.emergency_contact_phone,
        emergency_contact_phone_country_iso:
          (m.emergency_contact_phone_country_iso as string | null) ??
          editedMember.emergency_contact_phone_country_iso ??
          null,
        dob: (m.dob as string) ?? editedMember.dob,
        gender: (m.gender as string) ?? editedMember.gender,
        marital_status: (m.marital_status as string) ?? editedMember.marital_status,
        occupation: (m.occupation as string) ?? editedMember.occupation,
        member_id_string: (m.member_id_string as string) ?? editedMember.member_id_string,
        date_joined: (m.date_joined as string) ?? editedMember.date_joined,
        status: (m.status as string) ?? editedMember.status,
        member_url: (m.member_url as string) ?? editedMember.member_url,
        profileImage: (m.memberimage_url as string) ?? editedMember.profileImage,
        fullName: `${m.first_name ?? editedMember.first_name ?? ''} ${m.last_name ?? editedMember.last_name ?? ''}`.trim(),
        custom_fields: mergedCf,
      };
      setEditedMember(merged);
      onEdit(merged);
      setIsEditing(false);
      toast.success('Member updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save member');
    }
  };

  const handleCancel = () => {
    setEditedMember(member);
    setIsEditing(false);
  };

  const updateField = (field: keyof Member, value: string) => {
    if (editedMember) {
      setEditedMember({ ...editedMember, [field]: value });
    }
  };

  const updateCustomField = (key: string, value: unknown) => {
    if (!editedMember) return;
    const prev = editedMember.custom_fields;
    const base =
      prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : ({} as Record<string, unknown>);
    base[key] = value;
    setEditedMember({ ...editedMember, custom_fields: base });
  };

  // Notes functions

  const handleEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNoteContent(note.content);
  };

  const handleSaveEditNote = async (noteId: string) => {
    if (!can('edit_member_notes')) {
      toast.error('You do not have permission to edit notes.');
      return;
    }
    const existing = notes.find((n) => n.id === noteId);
    const text = editingNoteContent.trim();
    if (!text && !existing?.audioUrl) {
      toast.error('Note content cannot be empty');
      return;
    }
    if (!member || !token || !isMemberDbId(member.id)) {
      toast.error('Notes can only be saved for members in your directory.');
      return;
    }
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(String(member.id).trim())}/notes/${encodeURIComponent(noteId)}`,
        {
          method: 'PUT',
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ content: text || (existing?.audioUrl ? 'Voice note' : '') }),
        }
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to update note');
      const saved = (raw as { note?: Note }).note;
      if (saved) {
        setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, ...saved } : n)));
      }
      setEditingNoteId(null);
      setEditingNoteContent('');
      toast.success('Note updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update note');
    }
  };

  const handleCancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteContent('');
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!can('delete_member_notes')) {
      toast.error('You do not have permission to delete notes.');
      return;
    }
    if (!member || !token || !isMemberDbId(member.id)) return;
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(String(member.id).trim())}/notes/${encodeURIComponent(noteId)}`,
        {
          method: 'DELETE',
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        }
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to delete note');
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setDeleteConfirmNoteId(null);
      toast.success('Note deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete note');
    }
  };

  const formatNoteDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
      }
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return formatLongWeekdayDate(date) || date.toLocaleDateString();
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatImportantDate = (row: Pick<MemberImportantDate, 'date_value' | 'time_value'>) => {
    if (!row.date_value) return 'No date';
    const dateText = formatLongWeekdayDate(row.date_value) || row.date_value;
    if (!row.time_value) return dateText;
    const t = row.time_value.slice(0, 5);
    return `${dateText} · ${t}`;
  };

  const startEditingImportantDate = (item: MemberImportantDate) => {
    setImportantDateComposerOpen(true);
    setEditingImportantDateId(item.id);
    setImportantDateTitle(item.title || '');
    setImportantDateDescription(item.description || '');
    setImportantDateDate(item.date_value || '');
    setImportantDateTime(item.time_value ? item.time_value.slice(0, 5) : '');
    setImportantDateType(item.date_type || 'custom');
    setImportantDateReminderOffsets(Array.isArray(item.reminder_offsets) ? item.reminder_offsets : []);
    setImportantDateDefaultAlertEnabled(item.default_alert_enabled === true);
  };

  const resetImportantDateForm = () => {
    setEditingImportantDateId(null);
    setImportantDateTitle('');
    setImportantDateDescription('');
    setImportantDateDate('');
    setImportantDateTime('');
    setImportantDateType('custom');
    setImportantDateReminderOffsets([]);
    setImportantDateDefaultAlertEnabled(false);
    setImportantDateComposerOpen(false);
  };

  const submitImportantDate = async () => {
    if (!can('edit_members')) {
      toast.error('You do not have permission to edit members.');
      return;
    }
    if (!member || !token || !isMemberDbId(member.id)) {
      toast.error('Open a saved member profile first.');
      return;
    }
    const title = importantDateTitle.trim();
    const dateValue = importantDateDate.trim();
    if (!title) {
      toast.error('Title is required.');
      return;
    }
    if (!dateValue) {
      toast.error('Date is required.');
      return;
    }
    setSavingImportantDate(true);
    try {
      const isEdit = Boolean(editingImportantDateId);
      const url = isEdit
        ? `/api/members/${encodeURIComponent(String(member.id).trim())}/important-dates/${encodeURIComponent(String(editingImportantDateId))}`
        : `/api/members/${encodeURIComponent(String(member.id).trim())}/important-dates`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          title,
          description: importantDateDescription.trim() || null,
          date_value: dateValue,
          time_value: importantDateTime.trim() || null,
          date_type: importantDateType,
          is_recurring_yearly: importantDateType === 'birthday',
          reminder_offsets: importantDateReminderOffsets,
          default_alert_enabled:
            importantDateType === 'birthday' ? true : importantDateDefaultAlertEnabled,
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to save important date');
      }
      const saved = (raw as { important_date?: MemberImportantDate }).important_date;
      if (saved) {
        if (isEdit) {
          setImportantDates((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
        } else {
          setImportantDates((prev) => [...prev, saved]);
        }
      }
      resetImportantDateForm();
      toast.success(isEdit ? 'Important date updated' : 'Important date added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save important date');
    } finally {
      setSavingImportantDate(false);
    }
  };

  const toggleImportantReminderOffset = (id: string) => {
    setImportantDateReminderOffsets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const deleteImportantDate = async (id: string) => {
    if (!can('edit_members')) {
      toast.error('You do not have permission to edit members.');
      return;
    }
    if (!member || !token || !isMemberDbId(member.id)) return;
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(String(member.id).trim())}/important-dates/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        }
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to delete important date');
      setImportantDates((prev) => prev.filter((x) => x.id !== id));
      if (editingImportantDateId === id) resetImportantDateForm();
      toast.success('Important date deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete important date');
    }
  };

  const handleAddNote = async () => {
    if (!can('add_member_notes')) {
      toast.error('You do not have permission to add notes.');
      return;
    }
    const text = newNoteContent.trim();
    if (!text) {
      toast.error('Please enter note text');
      return;
    }
    if (!member || !token || !isMemberDbId(member.id)) {
      toast.error('Sign in and open a saved member to save notes to the server.');
      return;
    }

    try {
      const res = await fetch(`/api/members/${encodeURIComponent(String(member.id).trim())}/notes`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          content: text,
          audio_url: null,
          audio_duration: null,
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to save note');
      }
      const saved = (raw as { note?: Note }).note;
      if (saved) {
        setNotes((prev) => [saved, ...prev]);
      }
      setNewNoteContent('');
      setNewNoteComposerOpen(false);
      toast.success('Note saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save note');
    }
  };

  const refreshMemberTasks = async () => {
    if (!member || !token || !isMemberDbId(member.id) || !can('view_member_tasks')) return;
    setMemberTasksLoading(true);
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(String(member.id).trim())}/tasks`,
        { headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }) },
      );
      const raw = await res.json().catch(() => ({}));
      if (res.ok) {
        const list = (raw as { tasks?: MemberTaskRow[] }).tasks;
        setMemberTasks(Array.isArray(list) ? list : []);
      }
    } catch {
      /* ignore */
    } finally {
      setMemberTasksLoading(false);
    }
  };

  const mergeMemberTaskFromApi = (prev: MemberTaskRow, partial: Partial<MemberTaskRow>): MemberTaskRow => ({
    ...prev,
    ...partial,
    checklist: partial.checklist !== undefined ? partial.checklist : prev.checklist,
    related_member_ids:
      partial.related_member_ids !== undefined ? partial.related_member_ids : prev.related_member_ids,
    assignee_profile_ids:
      partial.assignee_profile_ids !== undefined ? partial.assignee_profile_ids : prev.assignee_profile_ids,
    assignee_name: partial.assignee_name ?? prev.assignee_name,
    created_by_name: partial.created_by_name ?? prev.created_by_name,
    members: prev.members,
  });

  const toggleTaskCardExpanded = (taskId: string) => {
    setTaskCardExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleDeleteMemberTask = async (taskId: string) => {
    if (!token || !can('manage_member_tasks')) return;
    if (
      !window.confirm(
        'Delete this task permanently? Checklist progress will be lost. This cannot be undone.',
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/member-tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not delete');
      }
      if (taskBeingEditedId === taskId) setTaskBeingEditedId(null);
      await refreshMemberTasks();
      notifyMemberTasksChanged();
      toast.success('Task removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete task');
    }
  };

  const canToggleChecklist = (t: MemberTaskRow) =>
    Boolean(
      user?.id &&
        t.status !== 'cancelled' &&
        (leaderIdsFromMemberTask(t).includes(user.id) ||
          can('manage_member_tasks') ||
          can('manage_member_task_checklist')),
    );

  const beginEditTask = (t: MemberTaskRow) => {
    if (!user?.id || t.created_by_profile_id !== user.id) return;
    setEditingChecklistOnly(false);
    setTaskBeingEditedId(t.id);
    setEditTitle(t.title);
    setEditDescription(t.description ?? '');
    setEditDue(toDatetimeLocalValue(t.due_at));
    setEditAssigneeIds(new Set(leaderIdsFromMemberTask(t)));
    setEditChecklistLines(
      (t.checklist ?? []).map((c) => ({ key: c.id, id: c.id, label: c.label, done: c.done })),
    );
  };

  const beginEditChecklistOnly = (t: MemberTaskRow) => {
    if (
      user?.id &&
      leaderIdsFromMemberTask(t).includes(user.id) &&
      t.created_by_profile_id !== user.id
    ) {
      return;
    }
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
  };

  const handleSaveEditedTask = async () => {
    if (!token || !taskBeingEditedId || !member || !can('manage_member_tasks')) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error('Enter a title');
      return;
    }
    if (editAssigneeIds.size === 0) {
      toast.error('Choose at least one assignee');
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
      const body: Record<string, unknown> = {
        title,
        assignee_profile_ids: [...editAssigneeIds],
        description: editDescription.trim() || null,
        checklist,
        related_member_ids: [],
      };
      if (editDue.trim()) body.due_at = new Date(editDue).toISOString();
      else body.due_at = null;

      const res = await fetch(`/api/member-tasks/${encodeURIComponent(taskBeingEditedId)}`, {
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
      await refreshMemberTasks();
      notifyMemberTasksChanged();
      toast.success('Task updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save task');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSaveChecklistOnlyEdit = async () => {
    if (!token || !taskBeingEditedId || !can('manage_member_task_checklist')) return;
    const row = memberTasks.find((x) => x.id === taskBeingEditedId);
    if (
      row &&
      user?.id &&
      leaderIdsFromMemberTask(row).includes(user.id) &&
      row.created_by_profile_id !== user.id
    ) {
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
      const res = await fetch(`/api/member-tasks/${encodeURIComponent(taskBeingEditedId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ checklist }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not save checklist');
      const updated = (raw as { task?: MemberTaskRow }).task;
      if (updated) {
        setMemberTasks((prev) =>
          prev.map((x) => (x.id === taskBeingEditedId ? mergeMemberTaskFromApi(x, updated) : x)),
        );
      } else {
        await refreshMemberTasks();
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

  const handleToggleTaskChecklist = async (t: MemberTaskRow, itemId: string, done: boolean) => {
    if (!token || !canToggleChecklist(t)) return;
    if (user?.id && leaderIdsFromMemberTask(t).includes(user.id)) {
      try {
        const res = await fetch(`/api/member-tasks/${encodeURIComponent(t.id)}`, {
          method: 'PATCH',
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ checklist: [{ id: itemId, done }] }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Could not update checklist');
        const updated = (raw as { task?: MemberTaskRow }).task;
        if (updated) {
          setMemberTasks((prev) => prev.map((x) => (x.id === t.id ? mergeMemberTaskFromApi(x, updated) : x)));
        } else {
          await refreshMemberTasks();
        }
        notifyMemberTasksChanged();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not update checklist');
      }
      return;
    }
    const full = (t.checklist ?? []).map((c) => (c.id === itemId ? { ...c, done } : c));
    try {
      const res = await fetch(`/api/member-tasks/${encodeURIComponent(t.id)}`, {
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
      const updated = (raw as { task?: MemberTaskRow }).task;
      if (updated) {
        setMemberTasks((prev) => prev.map((x) => (x.id === t.id ? mergeMemberTaskFromApi(x, updated) : x)));
      } else {
        await refreshMemberTasks();
      }
      notifyMemberTasksChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update checklist');
    }
  };

  const getEventIcon = (attended: boolean) => {
    if (attended) return <CheckCircle className="w-4 h-4 text-blue-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const getEventTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      worship: 'bg-blue-50 text-blue-700 border-blue-200',
      study: 'bg-blue-50 text-blue-700 border-blue-200',
      prayer: 'bg-pink-50 text-pink-700 border-pink-200',
      conference: 'bg-orange-50 text-orange-700 border-orange-200',
      outreach: 'bg-blue-50 text-blue-700 border-blue-200',
      youth: 'bg-blue-50 text-blue-700 border-blue-200',
    };
    return colors[type] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Group Members Modal */}
          <AnimatePresence>
            {selectedGroup && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedGroup(null)}
                  className="fixed inset-0 bg-black/50 z-[60]"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                >
                  <div className="bg-white rounded-2xl p-6 shadow-xl w-full max-w-md">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">{selectedGroup.name} Members</h3>
                      <button onClick={() => setSelectedGroup(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {selectedGroup.members.map(member => (
                        <div key={member.id} className="flex items-center space-x-3 p-2 bg-gray-50 rounded-lg">
                          <img src={member.profileImage} alt={member.fullName} className="w-8 h-8 rounded-full object-cover" />
                          <span className="text-sm font-medium text-gray-900">{member.fullName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50"
          />

          {/* Side Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-3xl bg-gray-50 z-50 shadow-2xl overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
              <div className="flex items-center justify-between px-8 py-6">
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col items-center space-y-2">
                    <button 
                      onClick={() => setShowFullImage(true)}
                      className="focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                    >
                      <img
                        src={member.profileImage}
                        alt={member.fullName}
                        className="w-16 h-16 rounded-full object-cover shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Change Photo
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      className="hidden" 
                      accept="image/*"
                    />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-900">{member.fullName}</h2>
                    <p className="text-gray-500 mt-1">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleCancel}
                        className="px-4 py-2.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-all text-sm font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleSave()}
                        className="px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-sm font-medium"
                      >
                        Save Changes
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setShowMessageModal(true)}
                        className="px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all text-sm font-medium flex items-center space-x-2"
                        title="Send Message"
                      >
                        <Send className="w-4 h-4" />
                        <span>Send Message</span>
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="p-2.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                        title="Edit Member"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={onClose}
                        className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center space-x-1 px-8 pb-4">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'overview'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('family')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'family'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Family
                </button>
                <button
                  onClick={() => setActiveTab('ministries')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'ministries'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Ministries
                </button>
                <button
                  onClick={() => setActiveTab('attendance')}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    activeTab === 'attendance'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Attendance
                </button>
                {can('view_member_tasks') && (
                  <button
                    onClick={() => setActiveTab('tasks')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-1.5 ${
                      activeTab === 'tasks'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <ListTodo className="w-4 h-4" />
                    Tasks
                  </button>
                )}
                {(can('view_member_notes') ||
                  can('view_members') ||
                  can('add_member_notes') ||
                  can('edit_member_notes') ||
                  can('delete_member_notes')) && (
                  <button
                    onClick={() => setActiveTab('notes')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                      activeTab === 'notes'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Notes
                  </button>
                )}
                {can('view_members') && (
                  <button
                    onClick={() => setActiveTab('important_dates')}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                      activeTab === 'important_dates'
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Important Dates
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="px-8 py-6 space-y-6">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <>
                  {/* Contact Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Mail className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 mb-1">Email</p>
                          {isEditing ? (
                            <input
                              type="email"
                              value={currentMember.email}
                              onChange={(e) => updateField('email', e.target.value)}
                              className="w-full px-3 py-2 font-medium text-gray-900 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <p className="font-medium text-gray-900">{currentMember.email}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <button className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all font-medium flex-shrink-0">
                            Send
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Phone className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <PhoneCountryInput
                              label="Phone number"
                              countryIso={currentMember.phone_country_iso || DEFAULT_PHONE_REGION}
                              onCountryChange={(iso) => {
                                if (editedMember) {
                                  setEditedMember({ ...editedMember, phone_country_iso: iso });
                                }
                              }}
                              national={currentMember.phone || currentMember.phoneNumber || ''}
                              onNationalChange={(v) => {
                                if (editedMember) {
                                  setEditedMember({ ...editedMember, phone: v, phoneNumber: v });
                                }
                              }}
                            />
                          ) : (
                            <>
                              <p className="text-xs text-gray-500 mb-1">Phone Number</p>
                              <p className="font-medium text-gray-900">{currentMember.phone || currentMember.phoneNumber}</p>
                            </>
                          )}
                        </div>
                        {!isEditing && (
                          <button className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all font-medium flex-shrink-0">
                            Call
                          </button>
                        )}
                      </div>

                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-gray-500 mb-1">Location</p>
                          {isEditing ? (
                            <input
                              type="text"
                              value={currentMember.address || currentMember.location || ''}
                              onChange={(e) => updateField('address', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm font-medium text-gray-900 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : (
                            <p className="text-sm font-medium text-gray-900">{currentMember.address || currentMember.location}</p>
                          )}
                        </div>
                      </div>

                      {(currentMember.emergency_contact_phone || currentMember.emergencyContact || isEditing) && (
                        <div className="flex items-center space-x-3 pt-4 border-t border-gray-100">
                          <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                            <AlertCircle className="w-5 h-5 text-red-600" />
                          </div>
                          <div className="flex-1">
                            <p className="text-xs text-gray-500 mb-1">Emergency Contact</p>
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={currentMember.emergency_contact_name || ''}
                                  onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                                  placeholder="Contact Name"
                                  className="w-full px-3 py-1.5 text-sm font-medium text-gray-900 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                                <PhoneCountryInput
                                  label="Contact phone"
                                  countryIso={currentMember.emergency_contact_phone_country_iso || DEFAULT_PHONE_REGION}
                                  onCountryChange={(iso) => {
                                    if (editedMember) {
                                      setEditedMember({ ...editedMember, emergency_contact_phone_country_iso: iso });
                                    }
                                  }}
                                  national={
                                    currentMember.emergency_contact_phone || currentMember.emergencyContact || ''
                                  }
                                  onNationalChange={(v) => {
                                    if (editedMember) {
                                      setEditedMember({
                                        ...editedMember,
                                        emergency_contact_phone: v,
                                        emergencyContact: v,
                                      });
                                    }
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="text-sm font-medium text-gray-900">
                                <p>{currentMember.emergency_contact_name || 'N/A'}</p>
                                <p className="text-xs text-gray-500">{currentMember.emergency_contact_phone || currentMember.emergencyContact || 'N/A'}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  </div>

                  {/* Member Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Member Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Gender</p>
                        {isEditing ? (
                          <select
                            value={currentMember.gender || ''}
                            onChange={(e) => updateField('gender', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.gender || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Date of Birth</p>
                        {isEditing ? (
                          <DatePickerField
                            value={currentMember.dob || ''}
                            onChange={(v) => updateField('dob', v)}
                            placeholder="Date of birth"
                            maxDate={dobMaxDate}
                            triggerClassName="h-auto min-h-[36px] rounded-lg border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-none focus-visible:ring-blue-500"
                          />
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.dob || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Marital Status</p>
                        {isEditing ? (
                          <select
                            value={currentMember.marital_status || ''}
                            onChange={(e) => updateField('marital_status', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select Status</option>
                            <option value="Single">Single</option>
                            <option value="Married">Married</option>
                            <option value="Divorced">Divorced</option>
                            <option value="Widowed">Widowed</option>
                          </select>
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.marital_status || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Membership status</p>
                        {isEditing ? (
                          <select
                            value={currentMember.status ?? ''}
                            onChange={(e) => updateField('status', e.target.value)}
                            disabled={sortedMemberStatusOptions.length === 0}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                          >
                            {sortedMemberStatusOptions.length === 0 ? (
                              <option value={currentMember.status || ''}>
                                {(currentMember.status || '—').toString()} (configure in Settings)
                              </option>
                            ) : (
                              <>
                                {currentMember.status &&
                                sortedMemberStatusOptions.every((o) => o.label !== currentMember.status) ? (
                                  <option value={currentMember.status}>{currentMember.status} (current)</option>
                                ) : null}
                                {sortedMemberStatusOptions.map((o) => (
                                  <option key={o.id} value={o.label}>
                                    {o.label}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        ) : (
                          <p className="font-medium text-gray-900">
                            {(currentMember.status || '').trim() || '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Occupation</p>
                        {isEditing ? (
                          <input
                            type="text"
                            value={currentMember.occupation || ''}
                            onChange={(e) => updateField('occupation', e.target.value)}
                            className="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <p className="font-medium text-gray-900">{currentMember.occupation || 'N/A'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Date Joined</p>
                        <p className="font-medium text-gray-900">{currentMember.date_joined || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {memberCustomFieldDefs.length > 0 ? (
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional fields</h3>
                      {isEditing && editedMember ? (
                        <CustomFieldsSection
                          definitions={memberCustomFieldDefs}
                          values={
                            editedMember.custom_fields &&
                            typeof editedMember.custom_fields === 'object' &&
                            !Array.isArray(editedMember.custom_fields)
                              ? editedMember.custom_fields
                              : {}
                          }
                          onChange={updateCustomField}
                        />
                      ) : (
                        <CustomFieldsReadOnlyList
                          definitions={memberCustomFieldDefs}
                          values={currentMember.custom_fields}
                        />
                      )}
                    </div>
                  ) : null}

                  {/* Personal Information */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Member Information</h3>
                    <div className="grid grid-cols-2 gap-4">

                      <div>
                        <p className="text-xs text-gray-500 mb-1">Last Attendance</p>
                        <p className="text-sm font-medium text-gray-900">
                          {formatLongWeekdayDateTime(member.lastAttendance) ||
                            formatLongWeekdayDate(member.lastAttendance) ||
                            '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Status</p>
                        {(() => {
                          const { chipClass, dotClass, text } = memberStatusBadgePair(
                            currentMember.status,
                            sortedMemberStatusOptions,
                          );
                          return (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${chipClass}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${dotClass}`} />
                              {text}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Family Tab */}
              {activeTab === 'family' && (
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Family Groups ({memberFamilies.length})</h3>
                  {memberFamilies.length > 0 ? (
                    <div className="space-y-2">
                      {memberFamilies.map((familyGroup) => {
                        const memberCount = (familyGroup.memberIds || []).length
                          || allMembers.filter((m) => m.familyIds?.includes(familyGroup.id)).length;
                        return (
                          <div key={familyGroup.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{familyGroup.familyName}</span>
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">{memberCount} members</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">This member is not assigned to any family group.</p>
                  )}
                </div>
              )}
              
              {/* Ministries Tab */}
              {activeTab === 'ministries' && (
                <>
                  {!isMemberDbId(currentMember.id) ? (
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center text-sm text-gray-600">
                      Ministries are loaded from your directory after this member is saved with a real profile ID. Demo or unsaved members cannot load group assignments.
                    </div>
                  ) : !token ? (
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center text-sm text-gray-600">
                      Sign in to view ministry assignments.
                    </div>
                  ) : memberGroupsLoading ? (
                    <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span>Loading ministries…</span>
                    </div>
                  ) : memberGroupsError ? (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-800">{memberGroupsError}</div>
                  ) : memberGroups.length > 0 ? (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Users className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">{memberGroups.length}</p>
                          <p className="text-xs text-blue-100 mt-1">Groups</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Award className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">{memberGroups.filter((g) => isLeaderRole(g.role_in_group)).length}</p>
                          <p className="text-xs text-blue-100 mt-1">Lead roles</p>
                        </div>
                        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-5 shadow-lg text-white text-center">
                          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <CheckCircle className="w-6 h-6" />
                          </div>
                          <p className="text-2xl font-bold">{filteredMemberGroups.length}</p>
                          <p className="text-xs text-blue-100 mt-1">Shown (filtered)</p>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-4">
                        <h3 className="text-lg font-semibold text-gray-900">Assigned ministries</h3>
                        <div className="flex flex-col sm:flex-row gap-3">
                          <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="search"
                              value={ministrySearch}
                              onChange={(e) => setMinistrySearch(e.target.value)}
                              placeholder="Search by name or type…"
                              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <select
                            value={ministryTypeFilter}
                            onChange={(e) => setMinistryTypeFilter(e.target.value)}
                            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[140px]"
                          >
                            <option value="all">All types</option>
                            {ministryTypeOptions.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-3">
                          {filteredMemberGroups.map((group) => (
                            <div
                              key={group.group_id}
                              className={`p-5 rounded-xl border transition-all ${
                                group.viewer_accessible === false
                                  ? 'bg-gray-100/80 border-gray-200 opacity-70'
                                  : 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-200 hover:border-blue-300 hover:shadow-md'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center space-x-3 min-w-0">
                                  <div
                                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                      isLeaderRole(group.role_in_group)
                                        ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                                        : 'bg-blue-50'
                                    }`}
                                  >
                                    {isLeaderRole(group.role_in_group) ? (
                                      <Award className="w-6 h-6" />
                                    ) : (
                                      <Users className="w-6 h-6 text-blue-600" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-semibold text-gray-900 text-base truncate">{group.name}</h4>
                                    {group.viewer_accessible === false ? (
                                      <p className="text-xs text-amber-800 mt-0.5">Outside your ministry scope — read-only context</p>
                                    ) : null}
                                    {group.group_type ? (
                                      <p className="text-xs text-gray-500 mt-0.5">{group.group_type}</p>
                                    ) : null}
                                  </div>
                                </div>
                                <span
                                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex-shrink-0 ${
                                    isLeaderRole(group.role_in_group)
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}
                                >
                                  {group.role_in_group}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {filteredMemberGroups.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-4">No ministries match your filters.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="bg-white rounded-2xl p-12 shadow-sm border border-gray-200 text-center">
                      <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">
                        👥
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No ministry groups</h3>
                      <p className="text-sm text-gray-500 mb-4">This member is not assigned to any group in this branch yet.</p>
                    </div>
                  )}
                </>
              )}

              {/* Attendance Tab */}
              {activeTab === 'attendance' && (
                <>
                  {!isMemberDbId(currentMember.id) ? (
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center text-sm text-gray-600">
                      Events and attendance are loaded after this member is saved with a real profile ID.
                    </div>
                  ) : !token ? (
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 text-center text-sm text-gray-600">
                      Sign in to view events and record attendance.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Calendar className="w-6 h-6 text-blue-600" />
                          </div>
                          <p className="text-2xl font-bold text-gray-900">
                            {(currentMember.status || '').trim() || '—'}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">Member status</p>
                        </div>
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <CheckCircle className="w-6 h-6 text-blue-600" />
                          </div>
                          <p className="text-2xl font-bold text-gray-900">
                            {attendanceRateLast12Mo !== null ? `${attendanceRateLast12Mo}%` : '—'}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">Attendance rate</p>
                          <p className="text-xs text-gray-400 mt-1">Past events, last 12 mo.</p>
                        </div>
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 text-center">
                          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                            <Users className="w-6 h-6 text-blue-600" />
                          </div>
                          <p className="text-2xl font-bold text-gray-900">{memberGroups.length}</p>
                          <p className="text-xs text-gray-500 mt-1">Groups</p>
                          <p className="text-xs text-gray-400 mt-1">This branch</p>
                        </div>
                      </div>

                      {(memberEventsError || memberGroupsError) && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 space-y-1">
                          {memberGroupsError ? <p>Ministries: {memberGroupsError}</p> : null}
                          {memberEventsError ? <p>Events: {memberEventsError}</p> : null}
                        </div>
                      )}

                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">Events on roster</h3>
                          <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-lg w-fit">
                            {filteredMemberEvents.length} shown · {memberEvents.length} total
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="search"
                              value={eventSearch}
                              onChange={(e) => setEventSearch(e.target.value)}
                              placeholder="Search title, ministry, type…"
                              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <select
                              value={eventTimeFilter}
                              onChange={(e) => setEventTimeFilter(e.target.value as 'all' | 'upcoming' | 'past')}
                              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                              <option value="all">All dates</option>
                              <option value="upcoming">Upcoming</option>
                              <option value="past">Past</option>
                            </select>
                            <select
                              value={eventStatusFilter}
                              onChange={(e) => setEventStatusFilter(e.target.value)}
                              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[140px]"
                            >
                              <option value="all">All event statuses</option>
                              {eventStatusOptions.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                            <select
                              value={eventAttendanceFilter}
                              onChange={(e) => setEventAttendanceFilter(e.target.value)}
                              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[160px]"
                            >
                              <option value="all">All attendance</option>
                              <option value="not_marked">Not marked</option>
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="unsure">Unsure</option>
                            </select>
                          </div>
                        </div>

                        {memberEventsLoading ? (
                          <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Loading events…
                          </div>
                        ) : filteredMemberEvents.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-8">
                            {memberEvents.length === 0
                              ? 'No roster events for this member in this branch.'
                              : 'No events match your filters.'}
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {filteredMemberEvents.map((event) => {
                              const start = new Date(event.start_time);
                              const eventCd = formatCalendarCountdown(event.start_time);
                              const isPast = start.getTime() < Date.now();
                              const typeKey = (event.event_type || 'general').toLowerCase().replace(/\s+/g, '_');
                              const attended = event.attendance_status === 'present';
                              return (
                                <div
                                  key={event.id}
                                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border-2 transition-all ${
                                    attended ? 'bg-blue-50/50 border-blue-200' : 'bg-gray-50/80 border-gray-200'
                                  }`}
                                >
                                  <div className="flex items-start space-x-3 min-w-0">
                                    <div
                                      className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                        attended ? 'bg-blue-100' : 'bg-white border border-gray-200'
                                      }`}
                                    >
                                      {getEventIcon(attended)}
                                    </div>
                                    <div className="min-w-0">
                                      <h4 className="font-medium text-gray-900">{event.title || 'Untitled event'}</h4>
                                      <p className="text-xs text-gray-500 mt-0.5">
                                        {formatLongWeekdayDateTime(event.start_time)}
                                        {eventCd ? ` · ${eventCd}` : ''}
                                        {event.group_name ? ` · ${event.group_name}` : ''}
                                      </p>
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {event.event_type ? (
                                          <span
                                            className={`px-2 py-0.5 rounded-md text-xs font-medium border ${getEventTypeColor(typeKey)}`}
                                          >
                                            {event.event_type}
                                          </span>
                                        ) : null}
                                        {event.status ? (
                                          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                            {event.status}
                                          </span>
                                        ) : null}
                                        <span
                                          className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                                            isPast ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700'
                                          }`}
                                        >
                                          {isPast ? 'Past' : 'Upcoming'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col sm:items-end gap-2 flex-shrink-0">
                                    <label className="text-xs text-gray-500 sr-only sm:not-sr-only sm:mb-0">Attendance</label>
                                    <select
                                      value={
                                        ATTENDANCE_STATUS_OPTIONS.includes(event.attendance_status as AttendanceStatus)
                                          ? (event.attendance_status as AttendanceStatus)
                                          : 'not_marked'
                                      }
                                      disabled={savingAttendanceForEventId === event.id}
                                      onChange={(e) =>
                                        updateAttendance(event.id, e.target.value as AttendanceStatus)
                                      }
                                      className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    >
                                      <option value="not_marked">Not marked</option>
                                      <option value="present">Present</option>
                                      <option value="absent">Absent</option>
                                      <option value="unsure">Unsure</option>
                                    </select>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Tasks Tab */}
              {activeTab === 'tasks' && can('view_member_tasks') && (
                <div className="space-y-4">
                  {can('manage_member_tasks') && member && isMemberDbId(member.id) && (
                    <button
                      type="button"
                      onClick={() => setAssignTaskModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-sm"
                    >
                      <ListTodo className="w-4 h-4" />
                      New task
                    </button>
                  )}

                  <AssignTaskModal
                    isOpen={assignTaskModalOpen}
                    onClose={() => setAssignTaskModalOpen(false)}
                    token={token}
                    branchId={selectedBranch?.id}
                    initialSelectedMemberIds={
                      member && isMemberDbId(member.id) ? [member.id] : []
                    }
                    allMembers={allMembers as unknown as ApiMember[]}
                    lockMemberSelection
                    onSuccess={() => {
                      void refreshMemberTasks();
                      notifyMemberTasksChanged();
                    }}
                  />

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <h3 className="text-sm font-semibold text-gray-900">Tasks for this member</h3>
                    </div>
                    {memberTasksLoading ? (
                      <div className="p-6 text-sm text-gray-500">Loading…</div>
                    ) : memberTasks.length === 0 ? (
                      <div className="p-6 text-sm text-gray-500">No tasks yet.</div>
                    ) : (
                      <ul className="divide-y divide-gray-100">
                        {memberTasks.map((t) => {
                          const items = t.checklist ?? [];
                          const expanded = taskCardExpandedIds.has(t.id);
                          const checklistLocked = t.status === 'cancelled' || !canToggleChecklist(t);
                          const taskDueCd = t.due_at ? formatCalendarCountdown(t.due_at) : '';
                          const selfId = user?.id;
                          const tLeaderIds = leaderIdsFromMemberTask(t);
                          const displayAssigneeName = tLeaderIds.length === 1 && selfId && tLeaderIds[0] === selfId
                            ? 'Self'
                            : t.assignee_name.split(', ').map((n, i) => selfId && tLeaderIds[i] === selfId ? 'Self' : n).join(', ');
                          const displayCreatedByName = selfId && t.created_by_profile_id === selfId ? 'Self' : t.created_by_name;
                          const isTaskCreator = !!selfId && t.created_by_profile_id === selfId;
                          return (
                            <li
                              key={t.id}
                              className="px-4 py-3 text-sm space-y-2 group"
                              onClick={(e) => {
                                if (taskBeingEditedId === t.id) return;
                                const el = e.target as HTMLElement;
                                if (el.closest('button, a, input, textarea, select, label')) return;
                                toggleTaskCardExpanded(t.id);
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
                                              setEditChecklistLines((prev) =>
                                                prev.filter((x) => x.key !== line.key),
                                              )
                                            }
                                            className="p-1 text-gray-400 hover:text-red-600"
                                            title="Remove step"
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
                                            {
                                              key: `e-${Date.now()}-${prev.length}`,
                                              label: '',
                                              done: false,
                                            },
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
                              ) : taskBeingEditedId === t.id && isTaskCreator && can('manage_member_tasks') ? (
                                <div
                                  className="space-y-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <p className="text-xs font-semibold text-blue-900">Edit task</p>
                                  <label className="text-xs text-gray-500 block -mb-2">Title</label>
                                  <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    placeholder="Task title"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                                  />
                                  <label className="text-xs text-gray-500 block -mb-2">Description</label>
                                  <textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    rows={2}
                                    placeholder="Task description"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                                  />
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div className="sm:col-span-2">
                                      <label className="text-xs text-gray-500 block mb-1">Assign to (leaders)</label>
                                      <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
                                        {taskStaffOptions.map((s) => (
                                          <label
                                            key={s.id}
                                            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={editAssigneeIds.has(s.id)}
                                              onChange={(e) => {
                                                setEditAssigneeIds((prev) => {
                                                  const next = new Set(prev);
                                                  if (e.target.checked) next.add(s.id);
                                                  else next.delete(s.id);
                                                  return next;
                                                });
                                              }}
                                            />
                                            <span>
                                              {[s.first_name, s.last_name].filter(Boolean).join(' ') ||
                                                s.email ||
                                                s.id.slice(0, 8)}
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
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
                                    <p className="text-xs font-medium text-gray-700 mb-1">To-do items</p>
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
                                              setEditChecklistLines((prev) =>
                                                prev.filter((x) => x.key !== line.key),
                                              )
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
                                            {
                                              key: `e-${Date.now()}-${prev.length}`,
                                              label: '',
                                              done: false,
                                            },
                                          ])
                                        }
                                        className="text-xs font-medium text-blue-600"
                                      >
                                        + Add step
                                      </button>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                      Add rows above, type each step, then save. Empty rows are ignored.
                                    </p>
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
                                      <p className="text-xs text-gray-500 mt-0.5 pl-7">
                                        Assignees: {displayAssigneeName} · Assigned by: {displayCreatedByName}
                                      </p>
                                      {t.due_at && (
                                        <p className="text-xs text-gray-500 pl-7">
                                          Due {formatLongWeekdayDateTime(t.due_at)}
                                          {taskDueCd ? ` · ${taskDueCd}` : ''}
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
                                      {isTaskCreator && can('manage_member_tasks') && (
                                        <button
                                          type="button"
                                          title="Edit task"
                                          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700"
                                          onClick={() => beginEditTask(t)}
                                        >
                                          <Pencil className="w-4 h-4" />
                                        </button>
                                      )}
                                      {can('manage_member_task_checklist') &&
                                        !(isTaskCreator && can('manage_member_tasks')) &&
                                        (!tLeaderIds.includes(selfId ?? '') || isTaskCreator) && (
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
                                  {expanded && (
                                    <>
                                      {items.length === 0 ? (
                                        <p className="text-xs text-gray-500 ml-5 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2">
                                          No checklist steps for this task.
                                        </p>
                                      ) : (
                                        <ul className="rounded-lg border border-gray-100 bg-gray-50/80 p-2 space-y-1.5 ml-5">
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
                                                className={
                                                  item.done ? 'text-gray-500 line-through' : 'text-gray-800'
                                                }
                                              >
                                                {item.label}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {isTaskCreator && can('manage_member_tasks') && (
                                        <div className="ml-5 mt-2 flex justify-end">
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void handleDeleteMemberTask(t.id);
                                            }}
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Delete task
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Notes Tab */}
              {activeTab === 'important_dates' && (
                <div className="space-y-4">
                  {can('edit_members') && (
                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 space-y-3">
                      {!importantDateComposerOpen ? (
                        <button
                          type="button"
                          onClick={() => setImportantDateComposerOpen(true)}
                          className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm font-medium flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add Important Date
                        </button>
                      ) : (
                        <>
                          <h3 className="text-sm font-semibold text-gray-900">
                            {editingImportantDateId ? 'Edit Important Date' : 'Add Important Date'}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="md:col-span-2">
                              <label className="text-xs text-gray-600">Title</label>
                              <input
                                type="text"
                                value={importantDateTitle}
                                onChange={(e) => setImportantDateTitle(e.target.value)}
                                placeholder="e.g. Wedding Anniversary"
                                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-xs text-gray-600">Description (Optional)</label>
                              <textarea
                                value={importantDateDescription}
                                onChange={(e) => setImportantDateDescription(e.target.value)}
                                rows={2}
                                placeholder="Any extra notes"
                                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">Date</label>
                              <div className="mt-1">
                                <DatePickerField
                                  value={importantDateDate}
                                  onChange={setImportantDateDate}
                                  placeholder="Date"
                                  triggerClassName="h-auto min-h-[38px] rounded-lg border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-none focus-visible:ring-blue-500"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">Time (Optional)</label>
                              <div className="mt-1">
                                <TimePickerField
                                  value={importantDateTime}
                                  onChange={setImportantDateTime}
                                  placeholder="Time"
                                  triggerClassName="h-auto min-h-[38px] rounded-lg border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-none focus-visible:ring-blue-500"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-gray-600">Date Type</label>
                              <select
                                value={importantDateType}
                                onChange={(e) =>
                                  setImportantDateType(
                                    (e.target.value as 'birthday' | 'anniversary' | 'custom') || 'custom',
                                  )
                                }
                                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="custom">Custom</option>
                                <option value="birthday">Birthday</option>
                                <option value="anniversary">Anniversary</option>
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-xs text-gray-600">Reminder options</label>
                              <div className="mt-1 flex flex-wrap gap-2">
                                {[
                                  { id: '1w', label: '1 week before' },
                                  { id: '2d', label: '2 days before' },
                                  { id: 'day_morning', label: 'On day morning' },
                                ].map((opt) => {
                                  const on = importantDateReminderOffsets.includes(opt.id);
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() => toggleImportantReminderOffset(opt.id)}
                                      className={`px-2.5 py-1.5 rounded-full text-xs border ${
                                        on
                                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                                          : 'border-gray-200 bg-white text-gray-700'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {importantDateType !== 'birthday' ? (
                                <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-600">
                                  <input
                                    type="checkbox"
                                    checked={importantDateDefaultAlertEnabled}
                                    onChange={(e) => setImportantDateDefaultAlertEnabled(e.target.checked)}
                                  />
                                  Send default reminder on day morning
                                </label>
                              ) : (
                                <p className="mt-2 text-xs text-blue-700">
                                  Birthday alerts are always enabled by default.
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={resetImportantDateForm}
                              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={savingImportantDate}
                              onClick={() => void submitImportantDate()}
                              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                            >
                              {savingImportantDate ? 'Saving…' : editingImportantDateId ? 'Save Changes' : 'Add Date'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">Important Dates</h3>
                      <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded">
                        {importantDates.length}
                      </span>
                    </div>

                    {importantDatesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        Loading important dates…
                      </div>
                    ) : importantDatesError ? (
                      <div className="text-sm text-red-600 py-4">{importantDatesError}</div>
                    ) : importantDates.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <Calendar className="w-6 h-6 text-gray-400" />
                        </div>
                        <p className="text-gray-500 mb-1 text-sm">No important dates yet</p>
                        <p className="text-xs text-gray-400">
                          {can('edit_members')
                            ? 'Add one above to track member milestones.'
                            : 'You can view dates but cannot edit this member.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {importantDates.map((item) => {
                          const importantCd = item.date_value
                            ? formatCalendarCountdown(item.date_value)
                            : '';
                          return (
                          <div
                            key={item.id}
                            className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-all"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                                <p className="text-xs text-blue-700 mt-0.5">
                                  {formatImportantDate(item)}
                                  {importantCd ? (
                                    <span className="text-gray-500"> · {importantCd}</span>
                                  ) : null}
                                </p>
                                {item.description ? (
                                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
                                    {capitalizeSentencesForUi(item.description)}
                                  </p>
                                ) : null}
                              </div>
                              {can('edit_members') && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => startEditingImportantDate(item)}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                                    title="Edit"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteImportantDate(item.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes Tab */}
              {activeTab === 'notes' && (
                <>
                  {/* Add New Note */}
                  {can('add_member_notes') && (
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    {!newNoteComposerOpen ? (
                      <button
                        type="button"
                        onClick={() => setNewNoteComposerOpen(true)}
                        className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm font-medium flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add Note
                      </button>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                            <Plus className="w-4 h-4 text-blue-600" />
                          </div>
                          <h3 className="text-sm font-semibold text-gray-900">New Note</h3>
                        </div>
                        <textarea
                          value={newNoteContent}
                          onChange={(e) => setNewNoteContent(e.target.value)}
                          rows={3}
                          autoFocus
                          placeholder="Enter note about this member..."
                          style={{ fontSize: '13px' }}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNewNoteComposerOpen(false);
                              setNewNoteContent('');
                            }}
                            className="px-4 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAddNote()}
                            disabled={!newNoteContent.trim()}
                            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Note
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  )}

                  {/* Notes List */}
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900">Member Notes</h3>
                      </div>
                      <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-medium rounded">
                        {notes.length}
                      </span>
                    </div>

                    {notesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        Loading notes…
                      </div>
                    ) : notes.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                          <FileText className="w-6 h-6 text-gray-400" />
                        </div>
                        <p style={{ fontSize: '13px' }} className="text-gray-500 mb-1">No notes yet</p>
                        <p className="text-xs text-gray-400">
                          {can('add_member_notes')
                            ? 'Add your first note above'
                            : 'You can view notes on this profile but cannot add new ones.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {notes.map((note) => (
                          <div
                            key={note.id}
                            className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-all"
                          >
                            {editingNoteId === note.id ? (
                              // Edit Mode
                              <div className="space-y-2">
                                <textarea
                                  value={editingNoteContent}
                                  onChange={(e) => setEditingNoteContent(e.target.value)}
                                  rows={3}
                                  style={{ fontSize: '13px' }}
                                  className="w-full px-3 py-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                                  autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={handleCancelEditNote}
                                    className="px-3 py-1.5 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all text-sm font-medium"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveEditNote(note.id)}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm font-medium"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // View Mode
                              <>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex-1">
                                    {note.content && (
                                      <p style={{ fontSize: '13px' }} className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                                        {capitalizeSentencesForUi(note.content)}
                                      </p>
                                    )}
                                    {note.audioUrl && (
                                      <div className="mt-2 flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                                        <Mic className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                                        <audio 
                                          src={note.audioUrl} 
                                          controls 
                                          className="flex-1 h-8" 
                                          style={{ maxWidth: '100%' }}
                                        />
                                        <span className="text-xs text-blue-600 font-medium whitespace-nowrap">
                                          {formatDuration(note.audioDuration || 0)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  {(can('edit_member_notes') || can('delete_member_notes')) && (
                                    <div className="flex items-center gap-0.5 flex-shrink-0">
                                      {can('edit_member_notes') && (
                                        <button
                                          onClick={() => handleEditNote(note)}
                                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all"
                                          title="Edit Note"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {can('delete_member_notes') && (
                                        <button
                                          onClick={() => setDeleteConfirmNoteId(note.id)}
                                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                          title="Delete Note"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white text-[10px] font-semibold">
                                      {note.createdBy.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <span className="font-medium text-gray-700">{note.createdBy}</span>
                                  </div>
                                  <span>•</span>
                                  <span>{formatNoteDate(note.createdAt)}</span>
                                  {note.updatedAt && (
                                    <>
                                      <span>•</span>
                                      <span className="text-gray-400">(edited)</span>
                                    </>
                                  )}
                                </div>

                                {/* Delete Confirmation */}
                                {deleteConfirmNoteId === note.id && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg"
                                  >
                                    <p style={{ fontSize: '13px' }} className="text-red-800 mb-2">
                                      Are you sure you want to delete this note? This action cannot be undone.
                                    </p>
                                    <div className="flex justify-end gap-2">
                                      <button
                                        onClick={() => setDeleteConfirmNoteId(null)}
                                        className="px-3 py-1.5 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all text-sm font-medium"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleDeleteNote(note.id)}
                                        className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all text-sm font-medium"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </motion.div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}

      {/* Full Image Modal */}
      <AnimatePresence>
        {showFullImage && (
          <motion.div key="full-image-modal">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFullImage(false)}
              className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4"
            >
              {/* Close Button */}
              <button
                onClick={() => setShowFullImage(false)}
                className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all text-white"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Image */}
              <motion.img
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                src={member.profileImage}
                alt={member.fullName}
                className="max-w-2xl max-h-[80vh] w-auto h-auto rounded-3xl shadow-2xl object-contain"
                onClick={(e) => e.stopPropagation()}
              />

              {/* Member Name Label */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ delay: 0.1 }}
                className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white/10 backdrop-blur-md px-6 py-3 rounded-2xl border border-white/20"
              >
                <p className="text-white font-semibold text-lg">{member.fullName}</p>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {member && (
        <BulkSmsComposeModal
          isOpen={showMessageModal}
          onClose={() => setShowMessageModal(false)}
          mode="member"
          lockedMember={{
            id: member.id,
            name: member.fullName,
            email: member.email,
          }}
        />
      )}
    </AnimatePresence>
  );
}