import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router';
import {
  X,
  Calendar,
  MapPin,
  ImagePlus,
  Users,
  Building2,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  Upload,
  ClipboardList,
  User,
  UserPlus,
  Check,
  ArrowLeft,
  Paperclip,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import ProgramOutlineAccordionEditor, {
  documentFromProgramOutline,
  documentToProgramOutline,
  emptyDocument,
  freshDuplicateOutline,
  type ProgramOutlineDocument,
} from '../pages/ProgramOutlineAccordionEditor';
import { DateTimePickerField } from '@/components/datetime';
import { compressImageForUpload, PUBLIC_BANNER_IMAGE_OPTIONS } from '../../utils/compressImageForUpload';
import { useBranch } from '../../contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { EventAttachmentItem } from '../pages/Events';
import { useCustomFieldDefinitions } from '../../hooks/useCustomFieldDefinitions';
import { usePermissions } from '../../hooks/usePermissions';
import CustomFieldsSection from '../CustomFieldsSection';
import { normalizeLocationTypeInput } from '@/utils/eventLocation';
import { downloadEventAttachmentFile, eventAttachmentStoragePath } from '../../utils/downloadEventAttachment';

const EVENT_FILE_MAX_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_ATTACHMENTS = 30;
/** Max files the user can add in one file-picker action */
const ATTACHMENT_FILES_PER_PICK = 10;

function parseAttachmentsFromEditing(raw: unknown): EventAttachmentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: EventAttachmentItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const storage_path = typeof o.storage_path === 'string' ? o.storage_path.trim() : '';
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name || (!storage_path && !url)) continue;
    const row: EventAttachmentItem = { name };
    if (storage_path) row.storage_path = storage_path;
    if (url) row.url = url;
    if (typeof o.size_bytes === 'number' && Number.isFinite(o.size_bytes)) row.size_bytes = o.size_bytes;
    if (typeof o.content_type === 'string') row.content_type = o.content_type || null;
    if (typeof o.uploaded_at === 'string') row.uploaded_at = o.uploaded_at || null;
    out.push(row);
  }
  return out;
}

function formatFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadEventAttachmentWithProgress(
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-event-file');
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable || evt.total <= 0) return;
      onProgress(Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100))));
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(body);
        return;
      }
      reject(new Error(String(body.error || 'Upload failed')));
    };
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

export interface EventRowForModal {
  id: string;
  title: string;
  start_time: string;
  end_time?: string | null;
  event_type?: string | null;
  location_type?: string | null;
  location_details?: string | null;
  online_meeting_url?: string | null;
  notes?: string | null;
  cover_image_url?: string | null;
  group_id?: string | null;
  /** Linked ministries (legacy `group_id` = first). */
  group_ids?: string[] | null;
  linked_groups?: { id: string; name: string }[] | null;
  /** Extra members included in the attendance roster (union with ministry rosters). */
  assigned_member_ids?: string[] | null;
  program_outline?: Record<string, unknown> | null;
  attachments?: EventAttachmentItem[] | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, event is created via `/api/events` and `onCreated` runs after success. */
  token?: string | null;
  onCreated?: () => void;
  /** When set, modal patches `/api/events/:id` and calls `onUpdated` after success. */
  editingEvent?: EventRowForModal | null;
  onUpdated?: () => void;
  /** Demo / legacy: fixed ministry and callback instead of API (e.g. mock GroupDetail). */
  groupId?: string;
  groupName?: string;
  onSave?: (eventData: Record<string, unknown>) => void;
}

type GroupOption = {
  id: string;
  name: string;
  group_type?: string | null;
  branch_id?: string | null;
  parent_group_id?: string | null;
};
type ApiEventType = { id: string; name: string; slug: string };
type OutlineTpl = { id: string; name: string; program_outline?: Record<string, unknown> | null };

type MemberRow = { id: string; first_name: string; last_name: string; profileImage: string | null };

type GroupTreeRow = {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  nodeKey: string;
  ancestorKeys: string[];
  subtitle: string;
};

function buildGroupTreeRows(groups: GroupOption[]): GroupTreeRow[] {
  const byId = new Map<string, GroupOption>();
  for (const g of groups) byId.set(g.id, g);
  const childrenByParent = new Map<string, GroupOption[]>();
  const roots: GroupOption[] = [];
  for (const g of groups) {
    const raw = g.parent_group_id ?? '';
    const parentId = typeof raw === 'string' && raw ? raw : '';
    if (!parentId || !byId.has(parentId)) roots.push(g);
    else {
      const arr = childrenByParent.get(parentId) || [];
      arr.push(g);
      childrenByParent.set(parentId, arr);
    }
  }
  const sortByName = (a: GroupOption, b: GroupOption) => String(a.name || '').localeCompare(String(b.name || ''));
  roots.sort(sortByName);
  for (const [, arr] of childrenByParent) arr.sort(sortByName);

  const rows: GroupTreeRow[] = [];
  const walk = (node: GroupOption, depth: number, ancestors: string[]) => {
    const id = String(node.id);
    const key = `group:${id}`;
    const kids = childrenByParent.get(id) || [];
    rows.push({
      id,
      name: String(node.name || 'Ministry'),
      depth,
      hasChildren: kids.length > 0,
      nodeKey: key,
      ancestorKeys: ancestors,
      subtitle: depth > 0 ? 'Subgroup' : 'Main ministry',
    });
    for (const child of kids) walk(child, depth + 1, [...ancestors, key]);
  };
  for (const r of roots) walk(r, 0, []);
  return rows;
}

async function fetchAllMembersPages(
  baseUrl: string,
  headers: HeadersInit,
  parseMembers: (data: unknown) => MemberRow[],
): Promise<MemberRow[]> {
  const out: MemberRow[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const u = new URL(baseUrl, 'http://localhost');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('offset', String(offset));
    const res = await fetch(u.pathname + u.search, { headers });
    const data = await res.json().catch(() => []);
    if (!res.ok) break;
    const page = parseMembers(data);
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return out;
}

const WIZARD_STEPS = [
  { id: 1, label: 'Basics', description: 'Title, type & cover image', icon: Calendar },
  { id: 2, label: 'When & where', description: 'Schedule and location', icon: MapPin },
  { id: 3, label: 'Assignment', description: 'Ministries and roster', icon: Users },
  { id: 4, label: 'Program outline', description: 'Template and schedule', icon: ClipboardList },
  { id: 5, label: 'Files', description: 'PDFs & documents', icon: Paperclip },
] as const;

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEventModal({
  isOpen,
  onClose,
  token = null,
  onCreated,
  editingEvent = null,
  onUpdated,
  groupId,
  groupName,
  onSave,
}: CreateEventModalProps) {
  const { selectedBranch } = useBranch();
  const { can, isOrgOwner } = usePermissions();
  const canAssignEventMembers = isOrgOwner || can('assign_event_members');
  const isEditMode = Boolean(editingEvent?.id);
  const { definitions: eventCustomFieldDefs } = useCustomFieldDefinitions('event', isOpen);
  const [title, setTitle] = useState('');
  /** Organization event type row id from `/api/event-types` */
  const [selectedEventTypeId, setSelectedEventTypeId] = useState('');
  const [eventTypesList, setEventTypesList] = useState<ApiEventType[]>([]);
  const [outlineTemplates, setOutlineTemplates] = useState<OutlineTpl[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [outlineDoc, setOutlineDoc] = useState<ProgramOutlineDocument>(() => emptyDocument());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationType, setLocationType] = useState('');
  const [locationDetails, setLocationDetails] = useState('');
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [assignedMemberIds, setAssignedMemberIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [assignMembersOpen, setAssignMembersOpen] = useState(false);
  const [branchMembers, setBranchMembers] = useState<MemberRow[]>([]);
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [loadingSelectedGroupMembers, setLoadingSelectedGroupMembers] = useState(false);
  const [branchMembersLoading, setBranchMembersLoading] = useState(false);
  const [memberAssignSearch, setMemberAssignSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupPickerExpandedKeys, setGroupPickerExpandedKeys] = useState<Set<string>>(() => new Set());
  const [coverUploading, setCoverUploading] = useState(false);
  const [eventAttachments, setEventAttachments] = useState<EventAttachmentItem[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentUploadProgress, setAttachmentUploadProgress] = useState(0);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const attachmentFileRef = useRef<HTMLInputElement>(null);
  const prevIsOpenRef = useRef(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [eventCustomFields, setEventCustomFields] = useState<Record<string, unknown>>({});
  /** JSON.stringify(buildPayload()) after edit modal stabilizes — for dirty detection */
  const [editBaselineJson, setEditBaselineJson] = useState<string | null>(null);
  const editBaselineSessionKeyRef = useRef<string>('');

  /** Events cannot be scheduled in the past (local calendar day). */
  const eventScheduleMinDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  useEffect(() => {
    if (isOpen) setWizardStep(1);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || token) return;
    if (groupId) {
      setSelectedGroupIds([groupId]);
    }
  }, [isOpen, token, groupId]);

  useEffect(() => {
    if (!isOpen || !token) return;
    setGroupSearch('');
    setGroupPickerOpen(false);
    let cancelled = false;
    (async () => {
      setLoadingGroups(true);
      try {
        const [grRes, etRes] = await Promise.all([
          fetch('/api/groups?tree=1&include_system=1', {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          }),
          fetch('/api/event-types', {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          }),
        ]);
        const gData = await grRes.json().catch(() => []);
        if (!grRes.ok) {
          throw new Error((gData as { error?: string }).error || 'Could not load ministries');
        }
        const gArr = Array.isArray(gData) ? gData : Array.isArray(gData?.groups) ? gData.groups : [];
        const list = gArr.map(
          (g: {
            id: string;
            name: string;
            group_type?: string | null;
            branch_id?: string | null;
            parent_group_id?: string | null;
          }) => ({
            id: g.id,
            name: g.name,
            group_type: g.group_type,
            branch_id: g.branch_id ?? null,
            parent_group_id: g.parent_group_id ?? null,
          }),
        );
        const etBody = await etRes.json().catch(() => []);
        const types: ApiEventType[] =
          etRes.ok && Array.isArray(etBody)
            ? etBody.map((r: { id: string; name: string; slug: string }) => ({
                id: r.id,
                name: r.name,
                slug: r.slug,
              }))
            : [];
        if (!cancelled) {
          setGroups(list);
          setEventTypesList(types);
          if (types.length) {
            setSelectedEventTypeId((prev) => (prev && types.some((t) => t.id === prev) ? prev : types[0].id));
          } else {
            setSelectedEventTypeId('');
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Could not load ministries');
          setGroups([]);
          setEventTypesList([]);
        }
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, selectedBranch?.id]);

  const selectedCustomTypeId = selectedEventTypeId;

  useEffect(() => {
    if (!isOpen || !token || !selectedCustomTypeId) {
      setOutlineTemplates([]);
      if (!isEditMode) {
        setTemplateId('');
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/event-outline-templates?event_type_id=${encodeURIComponent(selectedCustomTypeId)}`,
          { headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }) },
        );
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || 'Could not load templates');
        }
        const list = Array.isArray(data)
          ? data.map((r: { id: string; name: string; program_outline?: Record<string, unknown> | null }) => ({
              id: r.id,
              name: r.name,
              program_outline: r.program_outline ?? {},
            }))
          : [];
        if (!cancelled) {
          setOutlineTemplates(list);
          if (!isEditMode) {
            setTemplateId('');
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setOutlineTemplates([]);
          toast.error(e instanceof Error ? e.message : 'Could not load templates');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, selectedCustomTypeId, isEditMode, selectedBranch?.id]);

  const resetForm = useCallback(() => {
    setTitle('');
    setSelectedEventTypeId(eventTypesList.length ? eventTypesList[0].id : '');
    setTemplateId('');
    setOutlineDoc(emptyDocument());
    setStartTime('');
    setEndTime('');
    setLocationType('');
    setLocationDetails('');
    setOnlineMeetingUrl('');
    setNotes('');
    setCoverImageUrl('');
    setCoverUploading(false);
    setEventAttachments([]);
    setAttachmentUploading(false);
    setAttachmentUploadProgress(0);
    setSelectedGroupIds(groupId ? [groupId] : []);
    setAssignedMemberIds([]);
    setEventCustomFields({});
  }, [eventTypesList, groupId]);

  /** When the dialog opens, hydrate create (reset) or edit (load row) — not on every keystroke */
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }
    const justOpened = !prevIsOpenRef.current;
    prevIsOpenRef.current = true;
    if (!justOpened) return;

    if (editingEvent) {
      setTitle(editingEvent.title);
      setStartTime(isoToDatetimeLocal(editingEvent.start_time));
      setEndTime(editingEvent.end_time ? isoToDatetimeLocal(editingEvent.end_time) : '');
      const locMode = normalizeLocationTypeInput(editingEvent.location_type ?? '') ?? '';
      setLocationType(locMode);
      setLocationDetails(editingEvent.location_details ?? '');
      setOnlineMeetingUrl(
        typeof editingEvent.online_meeting_url === 'string' ? editingEvent.online_meeting_url : '',
      );
      setNotes(editingEvent.notes ?? '');
      setCoverImageUrl(editingEvent.cover_image_url?.trim() ?? '');
      setEventAttachments(parseAttachmentsFromEditing(editingEvent.attachments));
      setAttachmentUploadProgress(0);
      setTemplateId('');
      setOutlineDoc(documentFromProgramOutline(editingEvent.program_outline ?? {}));
      const slug = (editingEvent.event_type || '').trim().toLowerCase();
      const custom = eventTypesList.find((t) => t.slug.toLowerCase() === slug);
      if (custom) {
        setSelectedEventTypeId(custom.id);
      } else if (eventTypesList.length) {
        setSelectedEventTypeId(eventTypesList[0].id);
      } else {
        setSelectedEventTypeId('');
      }
      const gids =
        Array.isArray(editingEvent.group_ids) && editingEvent.group_ids.length > 0
          ? [...editingEvent.group_ids]
          : editingEvent.group_id?.trim()
            ? [editingEvent.group_id.trim()]
            : [];
      setSelectedGroupIds(gids);
      setAssignedMemberIds(
        Array.isArray(editingEvent.assigned_member_ids) ? [...editingEvent.assigned_member_ids] : [],
      );
      const cf = editingEvent.custom_fields;
      if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
        setEventCustomFields({ ...cf });
      } else {
        setEventCustomFields({});
      }
    } else {
      resetForm();
    }
  }, [isOpen, editingEvent, eventTypesList, resetForm]);

  useEffect(() => {
    if (!isOpen || !editingEvent || eventTypesList.length === 0) return;
    const slug = (editingEvent.event_type || '').trim().toLowerCase();
    const custom = eventTypesList.find((t) => t.slug.toLowerCase() === slug);
    if (custom) setSelectedEventTypeId(custom.id);
  }, [isOpen, editingEvent, eventTypesList]);

  useEffect(() => {
    if (!isOpen) return;
    const t = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (assignMembersOpen) {
        setAssignMembersOpen(false);
        return;
      }
      if (groupPickerOpen) setGroupPickerOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [isOpen, onClose, groupPickerOpen, assignMembersOpen]);

  const groupPickerTreeRows = useMemo(() => buildGroupTreeRows(groups), [groups]);

  const visibleGroupPickerRows = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) {
      return groupPickerTreeRows.filter(
        (row) => row.depth === 0 || row.ancestorKeys.every((x) => groupPickerExpandedKeys.has(x)),
      );
    }
    const include = new Set<string>();
    for (const row of groupPickerTreeRows) {
      const hay = `${row.name} ${row.subtitle}`.toLowerCase();
      if (hay.includes(q)) {
        include.add(row.nodeKey);
        for (const k of row.ancestorKeys) include.add(k);
      }
    }
    return groupPickerTreeRows.filter((row) => include.has(row.nodeKey));
  }, [groupPickerTreeRows, groupSearch, groupPickerExpandedKeys]);

  useEffect(() => {
    if (!isOpen || !token) return;
    const needMemberDirectory = assignMembersOpen || wizardStep === 3;
    if (!needMemberDirectory) return;
    let cancelled = false;

    const parseMembers = (data: unknown): MemberRow[] => {
      const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.members) ? (data as any).members : [];
      return arr.map((m: { id: string; first_name?: string; last_name?: string; profileImage?: string | null; profile_image?: string | null; profile_image_url?: string | null; memberimage_url?: string | null }) => ({
        id: m.id,
        first_name: String(m.first_name || ''),
        last_name: String(m.last_name || ''),
        profileImage:
          m.profileImage ?? m.profile_image ?? m.profile_image_url ?? m.memberimage_url ?? null,
      }));
    };

    const headers = withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` });

    (async () => {
      setBranchMembersLoading(true);
      try {
        const branchIds = [
          ...new Set(
            selectedGroupIds
              .map((gid) => groups.find((g) => g.id === gid)?.branch_id)
              .filter((b): b is string => typeof b === 'string' && b.length > 0),
          ),
        ];

        let rows: MemberRow[] = [];

        if (branchIds.length === 0) {
          const q = selectedBranch?.id ? `?branch_id=${encodeURIComponent(selectedBranch.id)}` : '';
          rows = await fetchAllMembersPages(`/api/members${q}`, headers, parseMembers);
        } else if (branchIds.length === 1) {
          rows = await fetchAllMembersPages(
            `/api/members?branch_id=${encodeURIComponent(branchIds[0])}`,
            headers,
            parseMembers,
          );
        } else {
          const byId = new Map<string, MemberRow>();
          for (const bid of branchIds) {
            const pageRows = await fetchAllMembersPages(
              `/api/members?branch_id=${encodeURIComponent(bid)}`,
              headers,
              parseMembers,
            );
            for (const m of pageRows) {
              byId.set(m.id, m);
            }
          }
          rows = [...byId.values()].sort((a, b) =>
            `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
          );
        }

        if (!cancelled) setBranchMembers(rows);
      } catch {
        if (!cancelled) setBranchMembers([]);
      } finally {
        if (!cancelled) setBranchMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, assignMembersOpen, wizardStep, token, selectedGroupIds, groups, selectedBranch]);

  const assignedMembersForDisplay = useMemo(() => {
    return assignedMemberIds.map((id) => {
      const m = branchMembers.find((x) => x.id === id);
      if (m) return m;
      return {
        id,
        first_name: '',
        last_name: '',
        profileImage: null as string | null,
      };
    });
  }, [assignedMemberIds, branchMembers]);

  const filteredBranchMembers = useMemo(() => {
    const q = memberAssignSearch.trim().toLowerCase();
    if (!q) return branchMembers;
    return branchMembers.filter((m) =>
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(q),
    );
  }, [branchMembers, memberAssignSearch]);

  useEffect(() => {
    if (!isOpen || !token || selectedGroupIds.length === 0) {
      setSelectedGroupMemberIds([]);
      setLoadingSelectedGroupMembers(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSelectedGroupMembers(true);
      try {
        const responses = await Promise.all(
          selectedGroupIds.map((gid) =>
            fetch(`/api/group-members?group_id=${encodeURIComponent(gid)}`, {
              headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
            }).then(async (res) => {
              const body = await res.json().catch(() => []);
              return { ok: res.ok, body };
            }),
          ),
        );
        const ids = new Set<string>();
        for (const response of responses) {
          if (!response.ok || !Array.isArray(response.body)) continue;
          for (const row of response.body as Array<{ member_id?: string }>) {
            const memberId = typeof row.member_id === 'string' ? row.member_id : '';
            if (memberId) ids.add(memberId);
          }
        }
        if (!cancelled) setSelectedGroupMemberIds([...ids]);
      } catch {
        if (!cancelled) setSelectedGroupMemberIds([]);
      } finally {
        if (!cancelled) setLoadingSelectedGroupMembers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, selectedGroupIds, selectedBranch?.id]);

  useEffect(() => {
    if (selectedGroupMemberIds.length === 0) return;
    const covered = new Set(selectedGroupMemberIds);
    setAssignedMemberIds((prev) => prev.filter((id) => !covered.has(id)));
  }, [selectedGroupMemberIds]);

  const toggleAssignMember = useCallback((memberId: string) => {
    if (selectedGroupMemberIds.includes(memberId)) return;
    setAssignedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((x) => x !== memberId) : [...prev, memberId],
    );
  }, [selectedGroupMemberIds]);

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    setCoverUploading(true);
    try {
      const toUpload = await compressImageForUpload(file, PUBLIC_BANNER_IMAGE_OPTIONS);
      const fd = new FormData();
      fd.append('image', toUpload);
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Upload failed');
      }
      const url = (data as { url?: string }).url;
      if (!url) throw new Error('No image URL returned');
      setCoverImageUrl(url);
      toast.success('Cover image uploaded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setCoverUploading(false);
    }
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot files before clearing the input — `files` is a live list and goes empty after `value = ''`.
    const filesFromPicker = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (filesFromPicker.length === 0) return;
    if (!token) {
      toast.error('Sign in required');
      return;
    }
    if (eventAttachments.length >= MAX_EVENT_ATTACHMENTS) {
      toast.error(`You can attach at most ${MAX_EVENT_ATTACHMENTS} files`);
      return;
    }

    let files = filesFromPicker;
    if (files.length > ATTACHMENT_FILES_PER_PICK) {
      toast.info(`Only the first ${ATTACHMENT_FILES_PER_PICK} files will upload (limit per selection).`);
      files = files.slice(0, ATTACHMENT_FILES_PER_PICK);
    }

    const slotsLeft = MAX_EVENT_ATTACHMENTS - eventAttachments.length;
    if (slotsLeft <= 0) {
      toast.error(`You can attach at most ${MAX_EVENT_ATTACHMENTS} files`);
      return;
    }
    if (files.length > slotsLeft) {
      toast.info(`Only ${slotsLeft} more file${slotsLeft === 1 ? '' : 's'} can be attached (event limit).`);
      files = files.slice(0, slotsLeft);
    }

    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > EVENT_FILE_MAX_BYTES) {
        toast.error(`${file.name}: must be 50 MB or smaller`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    const headers = withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` });
    setAttachmentUploading(true);
    setAttachmentUploadProgress(0);
    let successCount = 0;
    try {
      const totalCount = validFiles.length;
      let completedCount = 0;
      for (const file of validFiles) {
        const data = await uploadEventAttachmentWithProgress(file, headers as Record<string, string>, (pct) => {
          const overall = Math.round(((completedCount + pct / 100) / totalCount) * 100);
          setAttachmentUploadProgress(overall);
        }).catch((err: unknown) => {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`);
          return null;
        });
        completedCount += 1;
        if (!data) continue;
        const storage_path = (data as { storage_path?: string }).storage_path?.trim() || '';
        const name = (data as { name?: string }).name || file.name;
        const size_bytes = (data as { size_bytes?: number }).size_bytes;
        const content_type = (data as { content_type?: string }).content_type ?? null;
        const uploaded_at = (data as { uploaded_at?: string }).uploaded_at ?? null;
        if (!storage_path) {
          toast.error(`${file.name}: Upload did not return a storage path`);
          continue;
        }
        setEventAttachments((prev) => [
          ...prev,
          { storage_path, name, size_bytes, content_type, uploaded_at },
        ]);
        successCount += 1;
        setAttachmentUploadProgress(Math.round((completedCount / totalCount) * 100));
      }
      if (successCount > 0) {
        toast.success(successCount === 1 ? 'File uploaded' : `${successCount} files uploaded`);
      }
    } finally {
      setAttachmentUploading(false);
      setAttachmentUploadProgress(0);
    }
  };

  const getStepError = (step: number): string | null => {
    switch (step) {
      case 1:
        if (!title.trim()) return 'Enter an event title';
        if (eventTypesList.length > 0 && !selectedEventTypeId) return 'Choose an event type';
        return null;
      case 2:
        if (!startTime) return 'Choose a start date and time';
        if (!locationType) return 'Choose how the event is held (in person, online, or hybrid)';
        if (locationType === 'InPerson' && !locationDetails.trim()) return 'Enter a location or address';
        if (locationType === 'Online' && !onlineMeetingUrl.trim()) return 'Paste the meeting or livestream link';
        if (locationType === 'Hybrid' && (!locationDetails.trim() || !onlineMeetingUrl.trim())) {
          return 'Enter both the physical location and the online link';
        }
        return null;
      case 3:
        if (canAssignEventMembers) {
          if (selectedGroupIds.length === 0 && assignedMemberIds.length === 0) {
            return 'Choose at least one ministry or at least one specific member';
          }
        } else if (selectedGroupIds.length === 0) {
          return 'Choose at least one ministry';
        }
        return null;
      default:
        return null;
    }
  };

  /** Forward jump to `targetStep` only if steps 1..min(targetStep-1,3) pass `getStepError`. */
  const getForwardNavBlockReason = (targetStep: number): string | null => {
    if (targetStep <= wizardStep) return null;
    for (let s = 1; s < targetStep && s <= 3; s += 1) {
      const err = getStepError(s);
      if (err) return err;
    }
    return null;
  };

  const handleWizardNext = () => {
    const err = getStepError(wizardStep);
    if (err) {
      toast.error(err);
      return;
    }
    setWizardStep((s) => Math.min(WIZARD_STEPS.length, s + 1));
  };

  const handleWizardBack = () => {
    if (wizardStep <= 1) {
      onClose();
      return;
    }
    setWizardStep((s) => Math.max(1, s - 1));
  };

  const buildPayload = () => {
    const t = eventTypesList.find((x) => x.id === selectedEventTypeId);
    const eventTypeSlug = t?.slug ?? null;
    let locDetails: string | null = null;
    let meetUrl: string | null = null;
    const mode = locationType;
    if (mode === 'InPerson') {
      locDetails = locationDetails.trim() || null;
    } else if (mode === 'Online') {
      meetUrl = onlineMeetingUrl.trim() || null;
    } else if (mode === 'Hybrid') {
      locDetails = locationDetails.trim() || null;
      meetUrl = onlineMeetingUrl.trim() || null;
    }
    const program_outline = documentToProgramOutline(outlineDoc);
    return {
      title: title.trim(),
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : null,
      event_type: eventTypeSlug,
      location_type: mode || null,
      location_details: locDetails,
      online_meeting_url: meetUrl,
      notes: notes.trim() || null,
      cover_image_url: coverImageUrl.trim() || null,
      group_scope: 'group',
      group_id: selectedGroupIds[0] ?? null,
      group_ids: selectedGroupIds,
      assigned_member_ids: canAssignEventMembers ? assignedMemberIds : [],
      groupName: groupName ?? null,
      program_outline,
      attachments: eventAttachments,
      custom_fields: eventCustomFields,
    };
  };

  const buildPayloadRef = useRef(buildPayload);
  buildPayloadRef.current = buildPayload;

  /** Capture a stable payload snapshot for edit-mode dirty detection (timer calls latest `buildPayload`). */
  useEffect(() => {
    if (!isOpen) {
      editBaselineSessionKeyRef.current = '';
      setEditBaselineJson(null);
      return;
    }
    if (!isEditMode || !editingEvent?.id) {
      editBaselineSessionKeyRef.current = '';
      setEditBaselineJson(null);
      return;
    }
    const sessionKey = `${editingEvent.id}|${eventTypesList.length}`;
    if (editBaselineSessionKeyRef.current === sessionKey) return;
    editBaselineSessionKeyRef.current = sessionKey;
    const t = window.setTimeout(() => {
      setEditBaselineJson(JSON.stringify(buildPayloadRef.current()));
    }, 150);
    return () => clearTimeout(t);
  }, [isOpen, isEditMode, editingEvent?.id, eventTypesList.length]);

  const getSaveBlockedReason = (): string | null => {
    if (eventTypesList.length === 0) {
      return 'Add at least one event type in Settings before creating events.';
    }
    const e1 = getStepError(1);
    if (e1) return e1;
    const e2 = getStepError(2);
    if (e2) return e2;
    const e3 = getStepError(3);
    if (e3) return e3;
    if (coverUploading) return 'Wait for the cover image upload to finish.';
    if (attachmentUploading) return 'Wait for file uploads to finish.';
    if (!onSave && !token) return 'Sign in required';
    if (isEditMode) {
      if (editBaselineJson === null) return 'Still loading…';
      try {
        if (JSON.stringify(buildPayload()) === editBaselineJson) return 'No changes to save.';
      } catch {
        /* treat as dirty */
      }
    } else if (wizardStep !== WIZARD_STEPS.length) {
      return 'Complete all steps first.';
    }
    return null;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const blocked = getSaveBlockedReason();
    if (blocked) {
      toast.error(blocked);
      return;
    }

    const payload = buildPayload();

    if (onSave && !token) {
    onSave({
        ...payload,
        start_time: payload.start_time,
        end_time: payload.end_time,
      });
      resetForm();
      onClose();
      return;
    }

    if (!token) {
      toast.error('Sign in required');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode && editingEvent) {
        const res = await fetch(`/api/events/${encodeURIComponent(editingEvent.id)}`, {
          method: 'PATCH',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            title: payload.title,
            start_time: payload.start_time,
            end_time: payload.end_time,
            event_type: payload.event_type,
            location_type: payload.location_type,
            location_details: payload.location_details,
            online_meeting_url: payload.online_meeting_url,
            notes: payload.notes,
            cover_image_url: payload.cover_image_url,
            group_scope: payload.group_scope,
            group_id: payload.group_id,
            group_ids: payload.group_ids,
            assigned_member_ids: payload.assigned_member_ids,
            program_outline: payload.program_outline,
            attachments: payload.attachments,
            custom_fields: payload.custom_fields,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((body as { error?: string }).error || 'Could not update event');
        }
        toast.success('Event updated');
        onUpdated?.();
      } else {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          }),
          body: JSON.stringify({
            title: payload.title,
            start_time: payload.start_time,
            end_time: payload.end_time,
            event_type: payload.event_type,
            location_type: payload.location_type,
            location_details: payload.location_details,
            online_meeting_url: payload.online_meeting_url,
            notes: payload.notes,
            cover_image_url: payload.cover_image_url,
            group_scope: payload.group_scope,
            group_id: payload.group_id,
            group_ids: payload.group_ids,
            assigned_member_ids: payload.assigned_member_ids,
            program_outline: payload.program_outline,
            attachments: payload.attachments,
            custom_fields: payload.custom_fields,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((body as { error?: string }).error || 'Could not create event');
        }
        toast.success('Event created');
        onCreated?.();
      }
      resetForm();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const isEditDirtyFlag =
    isOpen &&
    isEditMode &&
    editBaselineJson !== null &&
    (() => {
      try {
        return JSON.stringify(buildPayload()) !== editBaselineJson;
      } catch {
        return true;
      }
    })();

  const saveBlockedReason = isOpen ? getSaveBlockedReason() : null;
  const saveVisible = isOpen && (isEditMode ? isEditDirtyFlag : wizardStep === WIZARD_STEPS.length);
  const saveEnabled = saveVisible && saveBlockedReason === null && !submitting;

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={() =>
          assignMembersOpen
            ? setAssignMembersOpen(false)
            : groupPickerOpen
              ? setGroupPickerOpen(false)
              : onClose()
        }
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-event-title"
        className="fixed left-1/2 top-1/2 z-[120] flex max-h-[min(94vh,920px)] w-full max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (wizardStep < WIZARD_STEPS.length) {
              handleWizardNext();
              return;
            }
            if (saveEnabled) void handleSubmit();
          }}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
            <aside className="flex w-full shrink-0 flex-col border-b border-gray-100 bg-gray-50/95 px-5 py-6 sm:px-6 md:max-w-[380px] md:border-b-0 md:border-r md:border-gray-100">
              <div className="flex items-start justify-between gap-4 pr-10">
          <div>
                  <h2 id="create-event-title" className="text-lg font-semibold tracking-tight text-gray-900">
                    {isEditMode ? 'Edit event' : 'New event'}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">Event setup</p>
          </div>
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums text-gray-800 shadow-inner"
                  style={{
                    background: `conic-gradient(rgb(34 197 94) ${(wizardStep / WIZARD_STEPS.length) * 360}deg, rgb(229 231 235) 0deg)`,
                  }}
                  aria-hidden
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-gray-700">
                    {wizardStep}/{WIZARD_STEPS.length}
                  </span>
                </div>
              </div>

              <nav className="mt-8 flex flex-col gap-1" aria-label="Steps">
                <p className="mb-2 text-xs text-gray-500">
                  You can go back anytime. To jump ahead, complete Basics, Schedule &amp; location, and Ministries
                  first.
                </p>
                {WIZARD_STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  const done = wizardStep > step.id;
                  const active = wizardStep === step.id;
                  const upcoming = wizardStep < step.id;
                  const forwardBlock = getForwardNavBlockReason(step.id);
                  const navDisabled = forwardBlock !== null;
                  const row = (
                    <>
                      {idx > 0 ? (
                        <span
                          className="absolute left-4 top-0 h-2 w-px -translate-y-full border-l-2 border-dashed border-gray-200"
                          aria-hidden
                        />
                      ) : null}
                      <div
                        className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          done
                            ? 'bg-blue-100 text-blue-700'
                            : active
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'border border-gray-200 bg-white text-gray-400'
                        }`}
                      >
                        {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div
                        className={`min-w-0 flex-1 rounded-xl py-2 pl-1 pr-3 transition-colors ${
                          active ? 'bg-white shadow-sm ring-1 ring-gray-200/90' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-sm font-medium ${active ? 'text-gray-900' : upcoming ? 'text-gray-400' : 'text-gray-600'}`}
                          >
                            {step.label}
                          </p>
                          {active ? <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden /> : null}
                        </div>
                        <p className={`mt-0.5 text-xs leading-snug ${active ? 'text-gray-600' : 'text-gray-400'}`}>
                          {step.description}
                        </p>
                      </div>
                    </>
                  );
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={navDisabled}
                      title={navDisabled ? forwardBlock ?? undefined : undefined}
                      onClick={() => setWizardStep(step.id)}
                      className={`relative flex w-full gap-3 rounded-xl text-left outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? '' : 'hover:bg-white/60'
                      }`}
                      aria-current={active ? 'step' : undefined}
                    >
                      {row}
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
                {wizardStep === 1 && (
                  <div className="mx-auto max-w-xl">
                    <h3 className="text-base font-semibold text-gray-900">Event basics</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Name your event, choose its type, and add an optional cover image.
                    </p>
                    <div className="mt-6 space-y-6">
            <div>
                        <label htmlFor="ev-title" className="text-sm font-medium text-gray-700">
                          Project / event title
              </label>
              <input
                          id="ev-title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Youth night"
                          className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
                        <p className="text-sm font-medium text-gray-700">Event type</p>
                        <p className="mt-0.5 text-xs text-gray-500">Select one option.</p>
                        <fieldset className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                          <legend className="sr-only">Event type</legend>
                          {eventTypesList.length === 0 ? (
                            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                              No event types are configured. Add types in{' '}
                              <Link to="/settings?tab=general&sub=eventTypes" className="font-medium text-blue-700 underline">
                                Settings → Event types
                              </Link>
                              .
                            </p>
                          ) : null}
                          {eventTypesList.map((t) => (
                            <label
                              key={t.id}
                              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                                selectedEventTypeId === t.id
                                  ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="ev-event-type"
                                className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                                checked={selectedEventTypeId === t.id}
                                onChange={() => {
                                  setSelectedEventTypeId(t.id);
                                  setTemplateId('');
                                  setOutlineDoc(emptyDocument());
                                }}
                              />
                              <span className="font-medium text-gray-900">{t.name}</span>
              </label>
                          ))}
                        </fieldset>
            </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">
                          <span className="inline-flex items-center gap-2">
                            <ImagePlus className="h-4 w-4 text-gray-500" aria-hidden />
                            Cover image
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">Optional. Shown on event cards.</p>
                        <input
                          ref={coverFileRef}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => void handleCoverFileChange(e)}
                        />
                        <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4">
                          <div className="flex flex-wrap items-center gap-4">
                            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
                              {coverUploading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-hidden />
                              ) : coverImageUrl ? (
                                <img src={coverImageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <ImagePlus className="h-8 w-8 text-gray-300" aria-hidden />
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={coverUploading}
                                onClick={() => coverFileRef.current?.click()}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                              >
                                {coverUploading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <Upload className="h-4 w-4" aria-hidden />
                                )}
                                {coverImageUrl ? 'Replace image' : 'Upload image'}
                              </button>
                              {coverImageUrl && !coverUploading ? (
                                <button
                                  type="button"
                                  onClick={() => setCoverImageUrl('')}
                                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="mx-auto w-full max-w-4xl">
                    <h3 className="text-base font-semibold text-gray-900">When & where</h3>
                    <p className="mt-1 text-sm text-gray-500">Schedule the event and add location details.</p>
                    <div className="mt-6 flex flex-col gap-6">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <div>
                          <label htmlFor="ev-start" className="text-sm font-medium text-gray-700">
                            Starts
                </label>
                <div className="mt-2">
                  <DateTimePickerField
                    id="ev-start"
                    value={startTime}
                    onChange={setStartTime}
                    datePlaceholder="Start date"
                    timePlaceholder="Start time"
                    minDate={isEditMode ? undefined : eventScheduleMinDate}
                    splitClassName="rounded-xl border-gray-200 bg-white shadow-sm"
                    triggerClassName="min-h-[42px] py-2.5 text-sm text-gray-900"
                  />
                </div>
              </div>
              <div>
                          <label htmlFor="ev-end" className="text-sm font-medium text-gray-700">
                            Ends <span className="font-normal text-gray-400">(Optional)</span>
                </label>
                <div className="mt-2">
                  <DateTimePickerField
                    id="ev-end"
                    value={endTime}
                    onChange={setEndTime}
                    datePlaceholder="End date"
                    timePlaceholder="End time"
                    minDate={isEditMode ? undefined : eventScheduleMinDate}
                    splitClassName="rounded-xl border-gray-200 bg-white shadow-sm"
                    triggerClassName="min-h-[42px] py-2.5 text-sm text-gray-900"
                  />
                </div>
              </div>
            </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="ev-loc-type" className="text-sm font-medium text-gray-700">
                          How is this event held?
                        </label>
                        <select
                          id="ev-loc-type"
                          value={locationType}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLocationType(v);
                            if (v === 'Online') {
                              setLocationDetails('');
                            }
                            if (v === 'InPerson') {
                              setOnlineMeetingUrl('');
                            }
                          }}
                          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">Choose one…</option>
                          <option value="InPerson">In person</option>
                          <option value="Online">Online</option>
                          <option value="Hybrid">Hybrid</option>
                        </select>
                      </div>
                      {(locationType === 'InPerson' || locationType === 'Hybrid') && (
                        <div className="sm:col-span-2">
                          <label htmlFor="ev-loc-details" className="text-sm font-medium text-gray-700">
                            {locationType === 'Hybrid' ? 'Physical location' : 'Location'}
                          </label>
                          <input
                            id="ev-loc-details"
                            value={locationDetails}
                            onChange={(e) => setLocationDetails(e.target.value)}
                            placeholder="Room, building, address…"
                            className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                        </div>
                      )}
                      {(locationType === 'Online' || locationType === 'Hybrid') && (
                        <div className="sm:col-span-2">
                          <label htmlFor="ev-meeting-url" className="text-sm font-medium text-gray-700">
                            Meeting or livestream link
                          </label>
                          <input
                            id="ev-meeting-url"
                            type="url"
                            inputMode="url"
                            value={onlineMeetingUrl}
                            onChange={(e) => setOnlineMeetingUrl(e.target.value)}
                            placeholder="https://…"
                            className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                        </div>
                      )}
                      <div className="sm:col-span-2">
                        <label htmlFor="ev-notes" className="text-sm font-medium text-gray-700">
                          About Event
                        </label>
                        <textarea
                          id="ev-notes"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={3}
                          placeholder="Short description for attendees…"
                          className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      {eventCustomFieldDefs.length > 0 ? (
                        <div className="sm:col-span-2 rounded-xl border border-gray-100 bg-gray-50/80 p-4">
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Additional fields</h4>
                          <CustomFieldsSection
                            definitions={eventCustomFieldDefs}
                            values={eventCustomFields}
                            onChange={(key, value) =>
                              setEventCustomFields((prev) => ({ ...prev, [key]: value }))
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="mx-auto max-w-xl">
                    <h3 className="text-base font-semibold text-gray-900">Assignment</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Link ministries (tree below). Only ministries you are assigned to appear here. To roster
                      everyone in the branch, an owner can assign you the &quot;All Members&quot; system ministry in
                      Settings.
                      {canAssignEventMembers
                        ? ' You can also add specific members for the attendance roster.'
                        : ' Adding specific members outside ministries is limited to the organization owner or roles with the “Assign members to event roster” permission.'}
                    </p>
                    <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/80 p-4 shadow-sm">
                      {selectedGroupIds.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {selectedGroupIds.map((gid) => {
                            const label = groups.find((g) => g.id === gid)?.name || 'Ministry';
                            return (
                              <span
                                key={gid}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-900 ring-1 ring-gray-200"
                              >
                                <span className="min-w-0 truncate">{label}</span>
                                <button
                                  type="button"
                                  className="shrink-0 rounded px-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                  aria-label={`Remove ${label}`}
                                  onClick={() => setSelectedGroupIds((prev) => prev.filter((x) => x !== gid))}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setGroupPickerExpandedKeys(new Set());
                          setGroupPickerOpen(true);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-900 shadow-sm hover:bg-gray-50/80"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Building2 className="h-4 w-4 shrink-0 text-blue-600" />
                          <span className="truncate">
                            {selectedGroupIds.length === 0
                              ? 'Add ministry…'
                              : 'Add another ministry…'}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                      </button>
                      {canAssignEventMembers ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMemberAssignSearch('');
                              setAssignMembersOpen(true);
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-left text-sm font-medium text-gray-900 hover:bg-gray-50/80"
                          >
                            <span className="flex items-center gap-2">
                              <UserPlus className="h-4 w-4 shrink-0 text-blue-600" />
                              {assignedMemberIds.length
                                ? `${assignedMemberIds.length} extra member${assignedMemberIds.length === 1 ? '' : 's'} on roster`
                                : 'Add specific members to roster…'}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                          </button>
                          {assignedMemberIds.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-3">
                                <div className="flex flex-wrap gap-2">
                                  {assignedMembersForDisplay.map((m) => {
                                    const label =
                                      `${m.first_name} ${m.last_name}`.trim() || 'Member';
                                    const resolvedInList = branchMembers.some((x) => x.id === m.id);
                                    return (
                                      <div
                                        key={m.id}
                                        className="relative flex w-[76px] shrink-0 flex-col items-center gap-1"
                                        title={label}
                                      >
                                        <div className="relative">
                                          <div className="relative z-0 h-11 w-11 overflow-hidden rounded-full bg-gray-100 ring-2 ring-gray-100 shadow-sm">
                                            {branchMembersLoading && !resolvedInList ? (
                                              <div className="flex h-full w-full items-center justify-center">
                                                <Loader2 className="h-5 w-5 animate-spin text-blue-400" aria-hidden />
                                              </div>
                                            ) : m.profileImage?.trim() ? (
                                              <img
                                                src={m.profileImage.trim()}
                                                alt=""
                                                className="h-full w-full object-cover"
                                              />
                                            ) : (
                                              <User
                                                className="mx-auto h-full w-full scale-50 text-gray-400"
                                                strokeWidth={1.25}
                                                aria-hidden
                                              />
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            aria-label={`Remove ${label} from roster`}
                                            onClick={() =>
                                              setAssignedMemberIds((prev) => prev.filter((x) => x !== m.id))
                                            }
                                            className="absolute -right-1 -top-1 z-[1] flex h-5 w-5 items-center justify-center rounded-full border border-white bg-gray-800 text-[11px] font-semibold leading-none text-white shadow hover:bg-gray-950"
                                          >
                                            ×
                                          </button>
                                        </div>
                                        <p className="max-w-full truncate text-center text-[10px] font-medium leading-tight text-gray-800">
                                          {label}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setAssignedMemberIds([])}
                                  className="text-xs font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
                                >
                                  Clear all
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="mx-auto max-w-3xl">
                    <div className="flex items-start gap-3">
                      <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
                        <h3 className="text-base font-semibold text-gray-900">Program outline</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          Pick a template when you use a custom event type, then edit the schedule below. This program is
                          saved with the event only — not the template library.
                        </p>
                      </div>
                    </div>
                    {selectedCustomTypeId && outlineTemplates.length > 0 ? (
                      <div className="mt-6">
                        <label htmlFor="ev-template" className="text-sm font-medium text-gray-700">
                          Template <span className="font-normal text-gray-400">(optional starting point)</span>
              </label>
                        <select
                          id="ev-template"
                          value={templateId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setTemplateId(id);
                            const tpl = outlineTemplates.find((x) => x.id === id);
                            if (tpl?.program_outline && Object.keys(tpl.program_outline).length > 0) {
                              setOutlineDoc(
                                freshDuplicateOutline(documentFromProgramOutline(tpl.program_outline ?? {})),
                              );
                            } else {
                              setOutlineDoc(emptyDocument());
                            }
                          }}
                          className="mt-2 w-full max-w-xl rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">Blank program — build below</option>
                          {outlineTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : selectedCustomTypeId ? (
                      <p className="mt-6 text-sm text-gray-600">
                        No program templates for this event type yet.{' '}
                        <Link to="/settings?tab=general&sub=programTemplates" className="font-medium text-blue-600 hover:underline">
                          Add a program template
                        </Link>{' '}
                        or build the program in the editor below.
                      </p>
                    ) : (
                      <p className="mt-6 text-sm text-gray-600">
                        Use the program editor below. When templates exist for your event type (step 1), you can load one
                        as a starting point.
                      </p>
                    )}
                    <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
                      <p className="mb-3 text-[11px] font-semibold text-gray-400">Program</p>
                      <div className="max-h-[min(52vh,560px)] overflow-y-auto pr-1">
                        <ProgramOutlineAccordionEditor
                          variant="full"
                          value={outlineDoc}
                          onChange={setOutlineDoc}
                        />
            </div>
                    </div>
                  </div>
                )}

                {wizardStep === 5 && (
                  <div className="mx-auto max-w-xl">
                    <div className="flex items-start gap-3">
                      <Paperclip className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">Files & documents</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          Select up to {ATTACHMENT_FILES_PER_PICK} files at a time (up to 50 MB each,{' '}
                          {MAX_EVENT_ATTACHMENTS} total per event).
                        </p>
                </div>
              </div>
                    <input
                      ref={attachmentFileRef}
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={(e) => void handleAttachmentFileChange(e)}
                    />
                    <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={attachmentUploading || !token || eventAttachments.length >= MAX_EVENT_ATTACHMENTS}
                          onClick={() => attachmentFileRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {attachmentUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Upload className="h-4 w-4" aria-hidden />
                          )}
                          Upload files
                        </button>
                        <p className="text-xs text-gray-500">
                          {eventAttachments.length} / {MAX_EVENT_ATTACHMENTS} files
                        </p>
                        {attachmentUploading ? (
                          <div className="min-w-[140px] flex-1">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                              <div
                                className="h-full rounded-full bg-blue-600 transition-[width] duration-150"
                                style={{ width: `${attachmentUploadProgress}%` }}
                              />
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500 tabular-nums">
                              Uploading… {attachmentUploadProgress}%
                            </p>
                          </div>
                        ) : null}
            </div>
          </div>
                    {eventAttachments.length > 0 ? (
                      <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                        {eventAttachments.map((a, i) => (
                          <li
                            key={`${a.storage_path ?? a.url ?? i}-${i}`}
                            className="flex items-center gap-3 px-4 py-3 text-sm"
                          >
                            <Paperclip className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-gray-900">{a.name}</p>
                              <p className="text-xs text-gray-500">
                                {typeof a.size_bytes === 'number' ? formatFileSize(a.size_bytes) : 'Size unknown'}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  void (async () => {
                                    if (!token) {
                                      toast.error('Sign in required');
                                      return;
                                    }
                                    const path = eventAttachmentStoragePath(a);
                                    if (path) {
                                      try {
                                        await downloadEventAttachmentFile({
                                          token,
                                          branchId: selectedBranch?.id,
                                          storagePath: path,
                                          filename: a.name,
                                          contentType: a.content_type,
                                        });
                                      } catch (err) {
                                        toast.error(err instanceof Error ? err.message : 'Download failed');
                                      }
                                    } else if (a.url?.trim()) {
                                      window.open(a.url.trim(), '_blank', 'noopener,noreferrer');
                                    } else {
                                      toast.error('This file cannot be downloaded.');
                                    }
                                  })();
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEventAttachments((prev) => prev.filter((_, j) => j !== i))}
                                className="shrink-0 rounded-lg px-2 py-1.5 text-lg font-semibold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                                aria-label={`Remove ${a.name}`}
                              >
                                ×
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-4 text-sm text-gray-600">No files attached yet.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-4 border-t border-gray-100 bg-white px-5 py-4 sm:px-8">
                <button
                  type="button"
                  onClick={handleWizardBack}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                  aria-label={wizardStep === 1 ? 'Close' : 'Back'}
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
                  {wizardStep < WIZARD_STEPS.length ? (
                    <button
                      type="button"
                      onClick={handleWizardNext}
                      className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                    >
                      Continue
                    </button>
                  ) : null}
                  {saveVisible ? (
                    <button
                      type="button"
                      disabled={!saveEnabled}
                      onClick={() => void handleSubmit()}
                      title={saveBlockedReason ?? undefined}
                      className={`rounded-xl px-6 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-50 ${
                        saveEnabled
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {submitting ? 'Saving…' : isEditMode ? 'Save changes' : 'Create event'}
                    </button>
                  ) : null}
        </div>
    </div>
            </div>
          </div>
        </form>
      </div>

      {groupPickerOpen && (
        <>
          <div
            className="fixed inset-0 z-[130] bg-black/40"
            aria-hidden
            onClick={() => setGroupPickerOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[140] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">Add ministry</p>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setGroupPickerOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="Search ministries…"
                  className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </label>
            </div>
            <div className="max-h-64 overflow-y-auto border-t border-gray-100 px-2 py-1">
              {loadingGroups ? (
                <p className="py-8 text-center text-sm text-gray-500">Loading…</p>
              ) : visibleGroupPickerRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No ministries match.</p>
              ) : (
                <ul className="space-y-0.5">
                  {visibleGroupPickerRows.map((row) => {
                    const g = groups.find((x) => x.id === row.id);
                    const selected = selectedGroupIds.includes(row.id);
                    return (
                      <li key={row.nodeKey}>
                        <div className="flex items-stretch rounded-lg">
                          <div
                            className="flex min-w-0 flex-1 items-center gap-1"
                            style={{ paddingLeft: row.depth * 14 }}
                          >
                            {row.hasChildren ? (
                              <button
                                type="button"
                                aria-label={groupPickerExpandedKeys.has(row.nodeKey) ? 'Collapse' : 'Expand'}
                                className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100"
                                onClick={() =>
                                  setGroupPickerExpandedKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.nodeKey)) next.delete(row.nodeKey);
                                    else next.add(row.nodeKey);
                                    return next;
                                  })
                                }
                              >
                                <ChevronDown
                                  className={`h-4 w-4 transition-transform ${groupPickerExpandedKeys.has(row.nodeKey) ? 'rotate-0' : '-rotate-90'}`}
                                />
                              </button>
                            ) : (
                              <span className="w-6 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedGroupIds((prev) => {
                                  if (prev.includes(row.id)) return prev;
                                  return [...prev, row.id];
                                });
                                setGroupPickerOpen(false);
                              }}
                              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-blue-50 ${
                                selected ? 'bg-blue-50 font-medium text-blue-900' : 'text-gray-800'
                              }`}
                            >
                              <span className="min-w-0 truncate">{row.name}</span>
                              {g?.group_type && (
                                <span className="shrink-0 text-xs text-gray-500">({g.group_type})</span>
                              )}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {assignMembersOpen && (
        <>
          <div
            className="fixed inset-0 z-[145] bg-black/40"
            aria-hidden
            onClick={() => setAssignMembersOpen(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[150] flex max-h-[min(88vh,640px)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Assign members</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  Pick people to add to the roster (in addition to everyone in the linked ministries). List scope follows
                  your ministry branches, or your selected branch when no ministry is chosen.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setAssignMembersOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={memberAssignSearch}
                  onChange={(e) => setMemberAssignSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-100 px-2 py-1">
              {branchMembersLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
                </div>
              ) : filteredBranchMembers.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No members found for this branch.</p>
              ) : (
                <ul className="space-y-0.5 pb-2">
                  {filteredBranchMembers.map((m) => {
                    const coveredBySelectedGroup = selectedGroupMemberIds.includes(m.id);
                    const checked = assignedMemberIds.includes(m.id) || coveredBySelectedGroup;
                    return (
                      <li key={m.id}>
                        <label
                          className={`flex items-center gap-3 rounded-lg px-2 py-2 ${
                            coveredBySelectedGroup ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            checked={checked}
                            disabled={coveredBySelectedGroup}
                            onChange={() => toggleAssignMember(m.id)}
                          />
                          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-gray-100">
                            {m.profileImage?.trim() ? (
                              <img src={m.profileImage.trim()} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <User className="mx-auto h-full w-full scale-50 text-gray-400" strokeWidth={1.25} />
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                            {m.first_name} {m.last_name}
                          </span>
                          {coveredBySelectedGroup ? (
                            <span className="shrink-0 text-[11px] font-medium text-gray-500">In selected ministry</span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">
                {assignedMemberIds.length} selected
              </p>
              {selectedGroupIds.length > 0 ? (
                <p className="text-[11px] text-gray-400">
                  {loadingSelectedGroupMembers ? 'Checking selected ministries…' : 'Members already in selected ministries are disabled'}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setAssignMembersOpen(false)}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
