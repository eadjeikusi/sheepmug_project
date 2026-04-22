import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  CustomFieldDefinition,
  Group,
  Member,
  MemberEventItem,
  MemberImportantDate,
  MemberNote,
  MemberStatusOption,
  TaskItem,
} from "@sheepmug/shared-api";
import { FilterPickerModal, type AnchorRect } from "../../components/FilterPickerModal";
import { FilterTriggerButton } from "../../components/FilterTriggerButton";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import { MemberEditModal } from "../../components/MemberEditModal";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { MemberTasksTab } from "../../components/MemberTasksTab";
import { MinistriesGrid } from "../../components/MinistriesGrid";
import { api } from "../../lib/api";
import { ensurePhotoLibraryPermission } from "../../lib/photoLibraryAccess";
import { uploadMemberImageFromUri } from "../../lib/uploadMemberImage";
import { usePermissions } from "../../hooks/usePermissions";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";
import { sortMinistriesGroups } from "../../lib/ministriesOrder";
import {
  displayMemberField,
  displayMemberWords,
  formatCalendarCountdown,
  formatLongWeekdayDate,
  formatLongWeekdayDateTime,
} from "../../lib/memberDisplayFormat";
import { memberStatusBadgePair } from "../../lib/memberStatusBadge";
import { getOfflineResourceCache, setOfflineResourceCache } from "../../lib/storage";
import { colors, radius, sizes, type } from "../../theme";

/** Tighter corners for profile cards (smaller than global radius.lg). */
const cardRadius = radius.sm;

type ProfileTab = "overview" | "ministries" | "events" | "tasks";

type OverviewSectionId = "contact" | "memberInfo" | "additional" | "attendance" | "notes" | "importantDates";

const MAIN_TABS: { id: ProfileTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ministries", label: "Ministries" },
  { id: "events", label: "Events" },
  { id: "tasks", label: "Tasks" },
];
const memberDetailCacheKey = (memberId: string) => `member:detail:${memberId}`;

function firstValidImageUri(member: Member): string | null {
  const candidates = [
    member.avatar_url,
    member.member_url,
    member.profileImage as string | null | undefined,
    member.profile_image as string | null | undefined,
    member.memberimage_url as string | null | undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function asTrimmed(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  return "";
}

function memberPhoneDisplay(m: Member): string {
  return (
    asTrimmed(m.phone) ||
    asTrimmed((m as { phone_number?: unknown }).phone_number) ||
    asTrimmed((m as { phoneNumber?: unknown }).phoneNumber) ||
    "—"
  );
}

function memberDateJoinedFormatted(m: Member): string {
  const raw =
    asTrimmed((m as { date_joined?: unknown }).date_joined) ||
    asTrimmed((m as { dateJoined?: unknown }).dateJoined);
  if (!raw) return "N/A";
  const long = formatLongWeekdayDate(raw);
  return long || displayMemberWords(raw);
}

function memberDobFormatted(m: Member): string {
  const raw =
    asTrimmed((m as { dob?: unknown }).dob) || asTrimmed((m as { dateOfBirth?: unknown }).dateOfBirth);
  if (!raw) return "N/A";
  const long = formatLongWeekdayDate(raw);
  return long || displayMemberWords(raw);
}

function readOnlyCustomFieldRows(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown> | null | undefined
): { fieldKey: string; label: string; text: string }[] {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const sorted = [...definitions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.label).localeCompare(String(b.label))
  );
  const rows: { fieldKey: string; label: string; text: string }[] = [];
  for (const def of sorted) {
    const label = displayMemberWords(String(def.label || ""));
    const val = v[def.field_key];
    if (val === null || val === undefined || val === "") {
      rows.push({ fieldKey: def.field_key, label, text: "—" });
    } else if (typeof val === "boolean") {
      rows.push({ fieldKey: def.field_key, label, text: val ? "Yes" : "No" });
    } else if (def.field_type === "date") {
      const raw = String(val).trim();
      const formatted = formatLongWeekdayDate(raw);
      rows.push({
        fieldKey: def.field_key,
        label,
        text: formatted || displayMemberWords(raw),
      });
    } else {
      rows.push({ fieldKey: def.field_key, label, text: displayMemberWords(String(val)) });
    }
  }
  return rows;
}

function lastAttendanceLabel(member: Member | null, events: MemberEventItem[]): string {
  if (!member) return "—";
  const m = member as Member & { lastAttendance?: unknown; last_attendance?: unknown };
  const raw = m.lastAttendance ?? m.last_attendance;
  if (typeof raw === "string" && raw.trim()) {
    const long = formatLongWeekdayDate(raw);
    if (long) return long;
  }
  const present = events.filter((e) => (e.attendance_status || "").toLowerCase() === "present");
  const sorted = [...present].sort((a, b) => {
    const ta = new Date(a.start_time || 0).getTime();
    const tb = new Date(b.start_time || 0).getTime();
    return tb - ta;
  });
  const best = sorted[0];
  if (!best) return "—";
  const checkIn =
    typeof best.check_in_time === "string" && best.check_in_time.trim() ? best.check_in_time : null;
  const ts = checkIn || best.start_time;
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const long = formatLongWeekdayDate(d);
  return long || "—";
}

function normalizeImageUri(rawUri: string | null): string | null {
  if (!rawUri) return null;
  const trimmed = rawUri.trim();
  if (!trimmed) return null;
  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE_URL || "").trim();
  let apiUrl: URL | null = null;
  try {
    if (apiBase) apiUrl = new URL(apiBase);
  } catch {
    apiUrl = null;
  }
  if (trimmed.startsWith("/")) {
    if (!apiUrl) return trimmed;
    return `${apiUrl.protocol}//${apiUrl.host}${trimmed}`;
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  try {
    const parsed = new URL(trimmed);
    if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && apiUrl) {
      parsed.protocol = apiUrl.protocol;
      parsed.host = apiUrl.host;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function normalizeRouteId(raw: string | string[] | undefined): string {
  if (raw === undefined) return "";
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === "string" ? s.trim() : "";
}

function normalizeEventTypeKey(type: string | null | undefined): string {
  return (type || "general").toLowerCase().replace(/\s+/g, "_");
}

function eventTypeChipColors(typeKey: string): { bg: string; border: string; text: string } {
  const map: Record<string, { bg: string; border: string; text: string }> = {
    worship: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    study: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    prayer: { bg: "#fdf2f8", border: "#fbcfe8", text: "#be185d" },
    conference: { bg: "#fff7ed", border: "#fed7aa", text: "#c2410c" },
    outreach: { bg: "#dbeafe", border: "#93c5fd", text: "#1e40af" },
    youth: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
    general: { bg: "#f9fafb", border: "#e5e7eb", text: "#374151" },
  };
  return map[typeKey] || { bg: "#f9fafb", border: "#e5e7eb", text: "#374151" };
}

function formatMemberEventSubtitle(event: MemberEventItem): string {
  const raw = event.start_time;
  const g = asTrimmed(event.group_name);
  if (!raw || !String(raw).trim()) {
    return g ? displayMemberWords(g) : "";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return g ? displayMemberWords(g) : "";
  const line = formatLongWeekdayDateTime(String(raw)) || "";
  const cd = formatCalendarCountdown(String(raw));
  if (g) {
    return [line, cd, displayMemberWords(g)].filter(Boolean).join(" · ");
  }
  return [line, cd].filter(Boolean).join(" · ");
}

function attendanceDisplayLabel(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "present") return "Present";
  if (s === "absent") return "Absent";
  if (s === "unsure") return "Unsure";
  return "Not marked";
}

type AttendanceStatus = "not_marked" | "present" | "absent" | "unsure";

function normalizeAttendanceFilterKey(status: string | null | undefined): AttendanceStatus {
  const s = (status || "").toLowerCase();
  if (s === "present") return "present";
  if (s === "absent") return "absent";
  if (s === "unsure") return "unsure";
  return "not_marked";
}

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "not_marked", label: "Not marked" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "unsure", label: "Unsure" },
];

const MEMBER_EVENT_WHEN_OPTIONS: { id: "all" | "upcoming" | "past"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

const MEMBER_ATTENDANCE_FILTER_OPTIONS: { id: "all" | AttendanceStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "not_marked", label: "Not marked" },
  { id: "present", label: "Present" },
  { id: "absent", label: "Absent" },
  { id: "unsure", label: "Unsure" },
];

function attendancePillColors(status: string | null | undefined): { bg: string; border: string; text: string } {
  const s = (status || "").toLowerCase();
  if (s === "present") return { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" };
  if (s === "absent") return { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c" };
  if (s === "unsure") return { bg: "#fffbeb", border: "#fde68a", text: "#92400e" };
  return { bg: "#f9fafb", border: "#e5e7eb", text: "#374151" };
}

export default function MemberProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const memberId = normalizeRouteId(params.id);
  const { can } = usePermissions();
  const { isOnline, queueMemberNoteCreate, queueMemberNoteUpdate, queueMemberNoteDelete } =
    useOfflineSync();

  const [member, setMember] = useState<Member | null>(null);
  const [ministries, setMinistries] = useState<Group[]>([]);
  const [events, setEvents] = useState<MemberEventItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [importantDates, setImportantDates] = useState<MemberImportantDate[]>([]);
  const [memberStatusOptions, setMemberStatusOptions] = useState<MemberStatusOption[]>([]);
  const [memberCustomFieldDefs, setMemberCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [loading, setLoading] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<AnchorRect | null>(null);
  const headerOverflowRef = useRef<View>(null);
  const [showImageFullView, setShowImageFullView] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const [attendancePickEventId, setAttendancePickEventId] = useState<string | null>(null);
  const [savingAttendanceEventId, setSavingAttendanceEventId] = useState<string | null>(null);
  const [memberEventSearch, setMemberEventSearch] = useState("");
  const [memberEventWhenFilter, setMemberEventWhenFilter] = useState<"all" | "upcoming" | "past">("all");
  const [memberEventAttendanceFilter, setMemberEventAttendanceFilter] = useState<"all" | AttendanceStatus>("all");
  const [memberEventMenuOpen, setMemberEventMenuOpen] = useState<null | "when" | "attendance">(null);
  const [memberFilterAnchor, setMemberFilterAnchor] = useState<AnchorRect | null>(null);
  const memberWhenTriggerRef = useRef<View>(null);
  const memberAttendanceTriggerRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const [accordionOpen, setAccordionOpen] = useState<Record<OverviewSectionId, boolean>>({
    contact: true,
    memberInfo: false,
    additional: false,
    attendance: false,
    notes: false,
    importantDates: false,
  });
  const [newNote, setNewNote] = useState("");
  const [newImportantTitle, setNewImportantTitle] = useState("");
  const [newImportantDate, setNewImportantDate] = useState("");
  const [newImportantDescription, setNewImportantDescription] = useState("");
  const [newImportantType, setNewImportantType] = useState<"birthday" | "anniversary" | "custom">("custom");
  const [newImportantReminderOffsets, setNewImportantReminderOffsets] = useState<string[]>([]);
  const [newImportantDefaultAlertEnabled, setNewImportantDefaultAlertEnabled] = useState(false);
  const [showAddImportantDateForm, setShowAddImportantDateForm] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteDraft, setEditNoteDraft] = useState("");
  const [editingImportantId, setEditingImportantId] = useState<string | null>(null);
  const [editImpTitle, setEditImpTitle] = useState("");
  const [editImpDate, setEditImpDate] = useState("");
  const [editImpDesc, setEditImpDesc] = useState("");
  const [editImpTime, setEditImpTime] = useState("");
  const [editImpType, setEditImpType] = useState<"birthday" | "anniversary" | "custom">("custom");
  const [editImpReminderOffsets, setEditImpReminderOffsets] = useState<string[]>([]);
  const [editImpDefaultAlertEnabled, setEditImpDefaultAlertEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);
  const [deletingMemberInProgress, setDeletingMemberInProgress] = useState(false);

  const visibleMainTabs = useMemo(() => {
    return MAIN_TABS.filter((t) => {
      if (t.id === "tasks") return can("view_member_tasks");
      if (t.id === "ministries" || t.id === "events") return can("view_members");
      return true;
    });
  }, [can]);

  useEffect(() => {
    if (!visibleMainTabs.some((x) => x.id === tab)) {
      setTab("overview");
    }
  }, [tab, visibleMainTabs]);

  const headerOverflowOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (can("edit_members")) opts.push({ value: "edit", label: "Edit" });
    if (can("delete_members")) opts.push({ value: "delete", label: "Delete" });
    return opts;
  }, [can]);

  function openHeaderOverflowMenu() {
    headerOverflowRef.current?.measureInWindow((x, y, width, height) => {
      setHeaderMenuAnchor({ x, y, width, height });
      setHeaderMenuOpen(true);
    });
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!memberId) return;
      setLoading(true);
      try {
        const cached = await getOfflineResourceCache<{
          member: Member | null;
          ministries: Group[];
          events: MemberEventItem[];
          tasks: TaskItem[];
          notes: MemberNote[];
          importantDates: MemberImportantDate[];
          statusOpts: MemberStatusOption[];
          fieldDefs: CustomFieldDefinition[];
        }>(memberDetailCacheKey(memberId));
        if (mounted && cached?.data) {
          setMember(cached.data.member || null);
          setMinistries(Array.isArray(cached.data.ministries) ? cached.data.ministries : []);
          setEvents(Array.isArray(cached.data.events) ? cached.data.events : []);
          setTasks(Array.isArray(cached.data.tasks) ? cached.data.tasks : []);
          setNotes(Array.isArray(cached.data.notes) ? cached.data.notes : []);
          setImportantDates(
            Array.isArray(cached.data.importantDates) ? cached.data.importantDates : []
          );
          setMemberStatusOptions(Array.isArray(cached.data.statusOpts) ? cached.data.statusOpts : []);
          setMemberCustomFieldDefs(Array.isArray(cached.data.fieldDefs) ? cached.data.fieldDefs : []);
        }
        try {
          const [
            detailMember,
            listFallback,
            memberGroups,
            memberEvents,
            memberTasksResult,
            memberNotes,
            memberImportantDates,
            statusOpts,
            fieldDefs,
          ] = await Promise.all([
            api.members.get(memberId),
            api.members.list({ limit: 100 }),
            api.members.groups(memberId),
            api.members.events(memberId),
            (async () => {
              try {
                const rows = await api.members.tasks(memberId);
                return { rows, error: null as string | null };
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Could not load member tasks";
                return { rows: [] as TaskItem[], error: message };
              }
            })(),
            api.members.notes.list(memberId),
            api.members.importantDates.list(memberId),
            api.memberStatusOptions(),
            api.customFieldDefinitions("member"),
          ]);
          if (!mounted) return;

          const fromList = listFallback.members.find((m) => m.id === memberId) || null;
          setMember(detailMember || fromList);
          setMinistries(memberGroups);
          setEvents(memberEvents);
          setTasks(memberTasksResult.rows);
          setTaskLoadError(memberTasksResult.error);
          setNotes(memberNotes);
          setImportantDates(memberImportantDates);
          setMemberStatusOptions(statusOpts);
          setMemberCustomFieldDefs(fieldDefs);
          await setOfflineResourceCache(memberDetailCacheKey(memberId), {
            member: detailMember || fromList,
            ministries: memberGroups,
            events: memberEvents,
            tasks: memberTasksResult.rows,
            notes: memberNotes,
            importantDates: memberImportantDates,
            statusOpts,
            fieldDefs,
          });
        } catch {
          // keep cached member detail when offline
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [memberId]);

  const imageUri = useMemo(
    () => normalizeImageUri(member ? firstValidImageUri(member) : null),
    [member]
  );

  const customFieldRows = useMemo(
    () =>
      member
        ? readOnlyCustomFieldRows(
            memberCustomFieldDefs,
            member.custom_fields as Record<string, unknown> | null | undefined
          )
        : [],
    [member, memberCustomFieldDefs]
  );

  const ministriesSorted = useMemo(() => sortMinistriesGroups(ministries), [ministries]);

  const headerMemberName = useMemo(() => {
    if (!member) return "Member";
    const line = [displayMemberWords(asTrimmed(member.first_name)), displayMemberWords(asTrimmed(member.last_name))]
      .filter(Boolean)
      .join(" ")
      .trim();
    return line || "Member";
  }, [member]);

  const telHref = useMemo(() => {
    if (!member) return "";
    const raw = memberPhoneDisplay(member);
    if (raw === "—" || !raw.trim()) return "";
    const cleaned = raw.replace(/[^\d+]/g, "");
    return cleaned.length > 0 ? `tel:${cleaned}` : "";
  }, [member]);

  const mailHref = useMemo(() => {
    const e = (member?.email || "").trim();
    return e ? `mailto:${e}` : "";
  }, [member]);

  const filteredMemberEvents = useMemo(() => {
    let list = events;
    const q = memberEventSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const title = String(e.title || e.name || "").toLowerCase();
        const sub = formatMemberEventSubtitle(e).toLowerCase();
        const gn = String(e.group_name || "").toLowerCase();
        const et = String(e.event_type || "").toLowerCase();
        const st = String(e.status || "").toLowerCase();
        return title.includes(q) || sub.includes(q) || gn.includes(q) || et.includes(q) || st.includes(q);
      });
    }
    const now = Date.now();
    list = list.filter((e) => {
      const raw = e.start_time;
      if (!raw || !String(raw).trim()) {
        return memberEventWhenFilter === "all";
      }
      const t = new Date(raw).getTime();
      if (Number.isNaN(t)) return memberEventWhenFilter === "all";
      if (memberEventWhenFilter === "upcoming") return t >= now;
      if (memberEventWhenFilter === "past") return t < now;
      return true;
    });
    if (memberEventAttendanceFilter !== "all") {
      list = list.filter(
        (e) => normalizeAttendanceFilterKey(e.attendance_status) === memberEventAttendanceFilter
      );
    }
    return list;
  }, [events, memberEventSearch, memberEventWhenFilter, memberEventAttendanceFilter]);

  function toggleAccordion(id: OverviewSectionId) {
    setAccordionOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleAddNote() {
    const content = newNote.trim();
    if (!memberId || !content) return;
    if (!isOnline) {
      const optimistic: MemberNote = {
        id: `offline-note-${Date.now().toString(36)}`,
        member_id: memberId,
        content,
        created_at: new Date().toISOString(),
        created_by: null,
      };
      await queueMemberNoteCreate(memberId, content);
      setNewNote("");
      setNotes((prev) => [optimistic, ...prev]);
      return;
    }
    const res = await api.members.notes.create(memberId, content).catch(() => null);
    setNewNote("");
    if (res?.note) {
      setNotes((prev) => [res.note as MemberNote, ...prev]);
      return;
    }
    const fresh = await api.members.notes.list(memberId).catch(() => []);
    setNotes(fresh);
  }

  async function handleDeleteNote(noteId: string) {
    if (!memberId || !noteId) return;
    if (!isOnline) {
      await queueMemberNoteDelete(memberId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      return;
    }
    await api.members.notes.remove(memberId, noteId).catch(() => null);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  function beginEditNote(note: MemberNote) {
    setEditingNoteId(note.id);
    setEditNoteDraft(String(note.content ?? ""));
  }

  async function handleSaveNoteEdit() {
    if (!memberId || !editingNoteId || !can("edit_member_notes")) return;
    const noteId = editingNoteId;
    const content = editNoteDraft.trim();
    if (!content) return;
    if (!isOnline) {
      await queueMemberNoteUpdate(memberId, noteId, content);
      setEditingNoteId(null);
      setEditNoteDraft("");
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? ({ ...n, content } as MemberNote) : n))
      );
      return;
    }
    const res = await api.members.notes.update(memberId, noteId, content).catch(() => null);
    setEditingNoteId(null);
    setEditNoteDraft("");
    if (res?.note) {
      setNotes((prev) => prev.map((n) => (n.id === noteId ? (res.note as MemberNote) : n)));
      return;
    }
    const fresh = await api.members.notes.list(memberId).catch(() => []);
    setNotes(fresh);
  }

  async function handleAddImportantDate() {
    if (!memberId) return;
    const title = newImportantTitle.trim();
    const dateValue = newImportantDate.trim();
    if (!title || !dateValue) return;
    const res = await api.members.importantDates
      .create(memberId, {
        title,
        date_value: dateValue,
        description: newImportantDescription.trim() || undefined,
        date_type: newImportantType,
        is_recurring_yearly: newImportantType === "birthday",
        reminder_offsets: newImportantReminderOffsets,
        default_alert_enabled:
          newImportantType === "birthday" ? true : newImportantDefaultAlertEnabled,
      })
      .catch(() => null);
    setNewImportantTitle("");
    setNewImportantDate("");
    setNewImportantDescription("");
    setNewImportantType("custom");
    setNewImportantReminderOffsets([]);
    setNewImportantDefaultAlertEnabled(false);
    setShowAddImportantDateForm(false);
    if (res?.important_date) {
      setImportantDates((prev) => [res.important_date as MemberImportantDate, ...prev]);
      return;
    }
    const fresh = await api.members.importantDates.list(memberId).catch(() => []);
    setImportantDates(fresh);
  }

  async function handleDeleteImportantDate(dateId: string) {
    if (!memberId || !dateId) return;
    await api.members.importantDates.remove(memberId, dateId).catch(() => null);
    setImportantDates((prev) => prev.filter((d) => d.id !== dateId));
  }

  function beginEditImportantDate(d: MemberImportantDate) {
    setEditingImportantId(d.id);
    setEditImpTitle(String(d.title ?? ""));
    setEditImpDate(String(d.date_value ?? ""));
    setEditImpDesc(String(d.description ?? ""));
    setEditImpTime(d.time_value ? String(d.time_value) : "");
    setEditImpType(
      d.date_type === "birthday" || d.date_type === "anniversary" ? d.date_type : "custom"
    );
    setEditImpReminderOffsets(Array.isArray(d.reminder_offsets) ? d.reminder_offsets : []);
    setEditImpDefaultAlertEnabled(d.default_alert_enabled === true);
  }

  function cancelEditImportantDate() {
    setEditingImportantId(null);
    setEditImpTitle("");
    setEditImpDate("");
    setEditImpDesc("");
    setEditImpTime("");
    setEditImpType("custom");
    setEditImpReminderOffsets([]);
    setEditImpDefaultAlertEnabled(false);
  }

  async function handleSaveImportantDateEdit() {
    if (!memberId || !editingImportantId || !can("edit_members")) return;
    const dateId = editingImportantId;
    const title = editImpTitle.trim();
    const dateValue = editImpDate.trim();
    if (!title || !dateValue) return;
    const res = await api.members.importantDates
      .update(memberId, dateId, {
        title,
        date_value: dateValue,
        description: editImpDesc.trim() || undefined,
        time_value: editImpTime.trim() || null,
        date_type: editImpType,
        is_recurring_yearly: editImpType === "birthday",
        reminder_offsets: editImpReminderOffsets,
        default_alert_enabled: editImpType === "birthday" ? true : editImpDefaultAlertEnabled,
      })
      .catch(() => null);
    cancelEditImportantDate();
    if (res?.important_date) {
      setImportantDates((prev) =>
        prev.map((x) => (x.id === dateId ? (res.important_date as MemberImportantDate) : x))
      );
      return;
    }
    const fresh = await api.members.importantDates.list(memberId).catch(() => []);
    setImportantDates(fresh);
  }

  function toggleNewImportantOffset(offset: string) {
    setNewImportantReminderOffsets((prev) =>
      prev.includes(offset) ? prev.filter((x) => x !== offset) : [...prev, offset]
    );
  }

  function toggleEditImportantOffset(offset: string) {
    setEditImpReminderOffsets((prev) =>
      prev.includes(offset) ? prev.filter((x) => x !== offset) : [...prev, offset]
    );
  }

  function handleDeleteMemberRecord() {
    if (!memberId || !can("delete_members")) return;
    Alert.alert(
      "Delete member",
      "This member will be removed from the branch (soft delete). Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeletingMemberInProgress(true);
              try {
                await api.members.remove(memberId);
                router.back();
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : "Could not delete member";
                Alert.alert("Member", msg);
              } finally {
                setDeletingMemberInProgress(false);
              }
            })();
          },
        },
      ]
    );
  }

  async function handleChangeProfilePhoto() {
    if (!memberId || !can("edit_members")) return;
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const uri = result.assets[0].uri;
    setUploadingProfileImage(true);
    try {
      const url = await uploadMemberImageFromUri(uri);
      const updated = await api.members.update(memberId, { profileImage: url });
      const u = String(url).trim();
      setMember((prev) => {
        const base = { ...(prev || {}), ...updated } as Member;
        if (u) {
          const o = base as Record<string, unknown>;
          o.profile_image = u;
          o.memberimage_url = u;
          o.avatar_url = u;
          o.profileImage = u;
        }
        return base;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not upload photo";
      Alert.alert("Profile photo", msg);
    } finally {
      setUploadingProfileImage(false);
    }
  }

  async function saveMemberAttendance(eventId: string, status: AttendanceStatus) {
    if (!memberId) return;
    setSavingAttendanceEventId(eventId);
    try {
      await api.events.attendance.update(eventId, [{ member_id: memberId, status }]);
      const fresh = await api.members.events(memberId).catch(() => [] as MemberEventItem[]);
      setEvents(fresh);
      setAttendancePickEventId(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save attendance";
      Alert.alert("Attendance", msg);
    } finally {
      setSavingAttendanceEventId(null);
    }
  }

  const onRefresh = useCallback(async () => {
    if (!memberId) return;
    setRefreshing(true);
    try {
      const [
        detailMember,
        listFallback,
        memberGroups,
        memberEvents,
        memberTasksResult,
        memberNotes,
        memberImportantDates,
        statusOpts,
        fieldDefs,
      ] = await Promise.all([
        api.members.get(memberId),
        api.members.list({ limit: 100 }),
        api.members.groups(memberId),
        api.members.events(memberId),
        (async () => {
          try {
            const rows = await api.members.tasks(memberId);
            return { rows, error: null as string | null };
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Could not load member tasks";
            return { rows: [] as TaskItem[], error: message };
          }
        })(),
        api.members.notes.list(memberId),
        api.members.importantDates.list(memberId),
        api.memberStatusOptions(),
        api.customFieldDefinitions("member"),
      ]);
      const fromList = listFallback.members.find((m) => m.id === memberId) || null;
      setMember(detailMember || fromList);
      setMinistries(memberGroups);
      setEvents(memberEvents);
      setTasks(memberTasksResult.rows);
      setTaskLoadError(memberTasksResult.error);
      setNotes(memberNotes);
      setImportantDates(memberImportantDates);
      setMemberStatusOptions(statusOpts);
      setMemberCustomFieldDefs(fieldDefs);
    } finally {
      setRefreshing(false);
    }
  }, [memberId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <HeaderIconCircleButton onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
            </HeaderIconCircleButton>
            <Text style={styles.topTitle} numberOfLines={1}>
              Member profile
            </Text>
          </View>
          <View style={styles.topBarRight}>
            {member && headerOverflowOptions.length > 0 ? (
              <View ref={headerOverflowRef} collapsable={false}>
                <HeaderIconCircleButton
                  accessibilityLabel="Member actions"
                  onPress={openHeaderOverflowMenu}
                  hitSlop={12}
                >
                  <Ionicons name="ellipsis-vertical" size={sizes.headerIcon} color={colors.textPrimary} />
                </HeaderIconCircleButton>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <View style={styles.avatarWrap}>
              <Pressable
                accessibilityLabel="View profile photo full screen"
                onPress={() => imageUri && setShowImageFullView(true)}
                disabled={!imageUri}
                style={({ pressed }) => [
                  styles.avatarImagePressable,
                  !imageUri && styles.avatarImagePressableDisabled,
                  pressed && imageUri && styles.avatarImagePressablePressed,
                ]}
              >
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.profileImageSquare} />
                ) : (
                  <MemberInitialAvatar
                    initial={(member?.first_name || "M")[0]}
                    size={96}
                    style={styles.profileFallbackSquare}
                    textStyle={styles.profileFallbackText}
                  />
                )}
                {uploadingProfileImage ? (
                  <View style={styles.avatarUploadingOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
              {can("edit_members") ? (
                <Pressable
                  accessibilityLabel="Change profile photo"
                  onPress={() => void handleChangeProfilePhoto()}
                  disabled={uploadingProfileImage}
                  style={({ pressed }) => [styles.avatarEditOnImage, pressed && styles.avatarEditOnImagePressed]}
                >
                  <Ionicons name="create-outline" size={16} color="#111111" />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.heroTextCol}>
              <Text style={styles.heroName} numberOfLines={2}>
                {headerMemberName}
              </Text>
              {(() => {
                const { chipBg, chipBorder, text, dot, labelColor } = memberStatusBadgePair(
                  member?.status,
                  memberStatusOptions
                );
                const chipLabel = text === "—" ? text : displayMemberWords(text);
                return (
                  <View style={[styles.statusTag, { backgroundColor: chipBg, borderColor: chipBorder }]}>
                    <View style={[styles.statusTagDot, { backgroundColor: dot }]} />
                    <Text style={[styles.statusTagText, { color: labelColor }]} numberOfLines={1}>
                      {chipLabel}
                    </Text>
                  </View>
                );
              })()}
              <View style={styles.heroActions}>
                <Pressable
                  accessibilityLabel="Call"
                  disabled={!telHref}
                  onPress={() => {
                    if (telHref) void Linking.openURL(telHref);
                  }}
                  style={({ pressed }) => [
                    styles.heroActionPill,
                    styles.heroActionPillCall,
                    !telHref && styles.heroActionPillDisabled,
                    pressed && telHref && styles.heroActionPillPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.heroActionPillText,
                      styles.heroActionPillTextCall,
                      !telHref && styles.heroActionPillTextDisabled,
                    ]}
                    numberOfLines={1}
                  >
                    Call
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Email"
                  disabled={!mailHref}
                  onPress={() => {
                    if (!mailHref) return;
                    void Linking.openURL(mailHref);
                  }}
                  style={({ pressed }) => [
                    styles.heroActionPill,
                    styles.heroActionPillEmail,
                    !mailHref && styles.heroActionPillDisabled,
                    pressed && mailHref && styles.heroActionPillPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.heroActionPillText,
                      styles.heroActionPillTextEmail,
                      !mailHref && styles.heroActionPillTextDisabled,
                    ]}
                    numberOfLines={1}
                  >
                    Email
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.segmentWrap}>
          {visibleMainTabs.map((t) => {
            const active = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <Text style={styles.helper}>Loading profile...</Text>
        ) : tab === "overview" ? (
          member ? (
            <View style={styles.overviewStack}>
              <View style={[styles.accordionCard, styles.accordionTintContact]}>
                <Pressable
                  onPress={() => toggleAccordion("contact")}
                  style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                >
                  <Text style={styles.accordionTitle}>Contact information</Text>
                  <Ionicons
                    name={accordionOpen.contact ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {accordionOpen.contact ? (
                  <View style={styles.accordionBody}>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Email</Text>
                      <Text style={styles.fieldValue}>
                        {(member.email || "").trim() ? displayMemberWords((member.email || "").trim()) : "—"}
                      </Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Phone Number</Text>
                      <Text style={styles.fieldValue}>{memberPhoneDisplay(member)}</Text>
                    </View>
                    <View style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>Location</Text>
                      <Text style={styles.fieldValue}>
                        {displayMemberField(
                          asTrimmed(member.address) || asTrimmed(member.location) || "",
                          "—"
                        )}
                      </Text>
                    </View>
                    {(() => {
                      const emPhone =
                        asTrimmed((member as { emergency_contact_phone?: unknown }).emergency_contact_phone) ||
                        asTrimmed((member as { emergencyContactPhone?: unknown }).emergencyContactPhone) ||
                        asTrimmed((member as { emergencyContact?: unknown }).emergencyContact) ||
                        "";
                      const emName =
                        asTrimmed((member as { emergency_contact_name?: unknown }).emergency_contact_name) ||
                        asTrimmed((member as { emergencyContactName?: unknown }).emergencyContactName) ||
                        "";
                      if (!emPhone.trim() && !emName.trim()) return null;
                      return (
                        <View style={[styles.fieldRow, styles.emergencyBlock]}>
                          <Text style={styles.fieldLabel}>Emergency Contact</Text>
                          <Text style={styles.fieldValue}>
                            {emName.trim() ? displayMemberWords(emName) : "N/A"}
                          </Text>
                          <Text style={styles.fieldSub}>{emPhone.trim() || "—"}</Text>
                        </View>
                      );
                    })()}
                  </View>
                ) : null}
              </View>

              <View style={[styles.accordionCard, styles.accordionTintMember]}>
                <Pressable
                  onPress={() => toggleAccordion("memberInfo")}
                  style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                >
                  <Text style={styles.accordionTitle}>Member information</Text>
                  <Ionicons
                    name={accordionOpen.memberInfo ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {accordionOpen.memberInfo ? (
                  <View style={styles.accordionBody}>
                    <View style={styles.twoColGrid}>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Gender</Text>
                        <Text style={styles.fieldValue}>
                          {displayMemberField((member.gender as string | undefined)?.trim() || "", "N/A")}
                        </Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Date of Birth</Text>
                        <Text style={styles.fieldValue}>{memberDobFormatted(member)}</Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Marital Status</Text>
                        <Text style={styles.fieldValue}>
                          {displayMemberField((member.marital_status as string | undefined)?.trim() || "", "N/A")}
                        </Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Membership status</Text>
                        <Text style={styles.fieldValue}>
                          {displayMemberField((member.status || "").trim(), "—")}
                        </Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Occupation</Text>
                        <Text style={styles.fieldValue}>
                          {displayMemberField((member.occupation as string | undefined)?.trim() || "", "N/A")}
                        </Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Date Joined</Text>
                        <Text style={styles.fieldValue}>{memberDateJoinedFormatted(member)}</Text>
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>

              {memberCustomFieldDefs.length > 0 ? (
                <View style={[styles.accordionCard, styles.accordionTintAdditional]}>
                  <Pressable
                    onPress={() => toggleAccordion("additional")}
                    style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                  >
                    <Text style={styles.accordionTitle}>{displayMemberWords("Additional fields")}</Text>
                    <Ionicons
                      name={accordionOpen.additional ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  {accordionOpen.additional ? (
                    <View style={styles.accordionBody}>
                      <View style={styles.customGrid}>
                        {customFieldRows.map((row) => (
                          <View key={row.fieldKey} style={styles.customCell}>
                            <Text style={styles.fieldLabel}>{row.label}</Text>
                            <Text style={styles.fieldValue}>{row.text}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.accordionCard, styles.accordionTintAttendance]}>
                <Pressable
                  onPress={() => toggleAccordion("attendance")}
                  style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                >
                  <Text style={styles.accordionTitle}>Attendance & status</Text>
                  <Ionicons
                    name={accordionOpen.attendance ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {accordionOpen.attendance ? (
                  <View style={styles.accordionBody}>
                    <View style={styles.twoColGrid}>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Last Attendance</Text>
                        <Text style={styles.fieldValue}>{lastAttendanceLabel(member, events)}</Text>
                      </View>
                      <View style={styles.gridCell}>
                        <Text style={styles.fieldLabel}>Status</Text>
                        {(() => {
                          const { chipBg, chipBorder, text, dot, labelColor } = memberStatusBadgePair(
                            member.status,
                            memberStatusOptions
                          );
                          const chipLabel = text === "—" ? text : displayMemberWords(text);
                          return (
                            <View style={[styles.statusChip, { backgroundColor: chipBg, borderColor: chipBorder }]}>
                              <View style={[styles.statusDot, { backgroundColor: dot }]} />
                              <Text style={[styles.statusChipText, { color: labelColor }]}>{chipLabel}</Text>
                            </View>
                          );
                        })()}
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>

              {can("view_member_notes") ? (
                <View style={[styles.accordionCard, styles.accordionTintNotes]}>
                  <Pressable
                    onPress={() => toggleAccordion("notes")}
                    style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                  >
                    <Text style={styles.accordionTitle}>Notes</Text>
                    <Ionicons
                      name={accordionOpen.notes ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  {accordionOpen.notes ? (
                    <View style={styles.accordionBody}>
                      {can("add_member_notes") ? (
                        <View style={styles.noteComposer}>
                          <TextInput
                            value={newNote}
                            onChangeText={setNewNote}
                            placeholder="Write a member note..."
                            placeholderTextColor={colors.textSecondary}
                            style={styles.noteComposerInput}
                            multiline
                            textAlignVertical="top"
                          />
                          <Pressable style={styles.noteComposerBtn} onPress={() => void handleAddNote()}>
                            <Ionicons name="send" size={18} color="#fff" />
                          </Pressable>
                        </View>
                      ) : null}
                      {notes.length === 0 ? (
                        <Text style={styles.helper}>No notes yet</Text>
                      ) : (
                        notes.map((note) => (
                          <View key={note.id} style={styles.noteCard}>
                            {editingNoteId === note.id ? (
                              <>
                                <TextInput
                                  value={editNoteDraft}
                                  onChangeText={setEditNoteDraft}
                                  placeholder="Note text"
                                  placeholderTextColor={colors.textSecondary}
                                  style={styles.noteEditInput}
                                  multiline
                                  textAlignVertical="top"
                                />
                                <View style={styles.noteEditActions}>
                                  <Pressable onPress={() => setEditingNoteId(null)} hitSlop={8}>
                                    <Text style={styles.noteEditSecondary}>Cancel</Text>
                                  </Pressable>
                                  <Pressable style={styles.actionPrimaryBtn} onPress={() => void handleSaveNoteEdit()}>
                                    <Text style={styles.actionPrimaryText}>Save</Text>
                                  </Pressable>
                                </View>
                              </>
                            ) : (
                              <>
                                <Text style={styles.bodyText}>{note.content}</Text>
                                <View style={styles.noteFooter}>
                                  <Text style={styles.listRowMeta}>
                                    {note.createdAt ? formatLongWeekdayDateTime(String(note.createdAt)) : ""}
                                  </Text>
                                  <View style={styles.noteActionsRow}>
                                    {can("edit_member_notes") ? (
                                      <Pressable onPress={() => beginEditNote(note)} hitSlop={8} style={styles.noteIconBtn}>
                                        <Ionicons name="create-outline" size={18} color="#6b7280" />
                                      </Pressable>
                                    ) : null}
                                    {can("delete_member_notes") ? (
                                      <Pressable
                                        onPress={() => void handleDeleteNote(note.id)}
                                        hitSlop={8}
                                        style={styles.noteIconBtn}
                                      >
                                        <Ionicons name="trash-outline" size={18} color="#b91c1c" />
                                      </Pressable>
                                    ) : null}
                                  </View>
                                </View>
                              </>
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.accordionCard, styles.accordionTintImportant]}>
                <Pressable
                  onPress={() => toggleAccordion("importantDates")}
                  style={({ pressed }) => [styles.accordionHeader, pressed && styles.accordionHeaderPressed]}
                >
                  <Text style={styles.accordionTitle}>Important dates</Text>
                  <Ionicons
                    name={accordionOpen.importantDates ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={colors.textSecondary}
                  />
                </Pressable>
                {accordionOpen.importantDates ? (
                  <View style={styles.accordionBody}>
                    {can("edit_members") ? (
                      <View style={styles.importantDateHeaderActions}>
                        <Pressable
                          style={styles.addImportantDateBtn}
                          onPress={() => setShowAddImportantDateForm((v) => !v)}
                        >
                          <Ionicons name={showAddImportantDateForm ? "remove-outline" : "add-outline"} size={16} color="#fff" />
                          <Text style={styles.addImportantDateBtnText}>
                            {showAddImportantDateForm ? "Close" : "Add important date"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {can("edit_members") && showAddImportantDateForm ? (
                      <View style={styles.importantDateAddForm}>
                        <TextInput
                          value={newImportantTitle}
                          onChangeText={setNewImportantTitle}
                          placeholder="Title (e.g. Birthday)"
                          placeholderTextColor={colors.textSecondary}
                          style={styles.input}
                        />
                        <TextInput
                          value={newImportantDate}
                          onChangeText={setNewImportantDate}
                          placeholder="Date (YYYY-MM-DD)"
                          placeholderTextColor={colors.textSecondary}
                          style={styles.input}
                        />
                        <TextInput
                          value={newImportantDescription}
                          onChangeText={setNewImportantDescription}
                          placeholder="Description (optional)"
                          placeholderTextColor={colors.textSecondary}
                          style={styles.input}
                        />
                        <Text style={styles.listRowMeta}>Type</Text>
                        <View style={styles.filterRowWrap}>
                          {(["custom", "birthday", "anniversary"] as const).map((t) => (
                            <Pressable
                              key={t}
                              onPress={() => setNewImportantType(t)}
                              style={[styles.filterChip, newImportantType === t && styles.filterChipOn]}
                            >
                              <Text style={[styles.filterChipText, newImportantType === t && styles.filterChipTextOn]}>
                                {t[0].toUpperCase() + t.slice(1)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <Text style={styles.listRowMeta}>Remind me</Text>
                        <View style={styles.filterRowWrap}>
                          {[
                            { id: "1w", label: "1 week" },
                            { id: "2d", label: "2 days" },
                            { id: "day_morning", label: "On day morning" },
                          ].map((opt) => (
                            <Pressable
                              key={opt.id}
                              onPress={() => toggleNewImportantOffset(opt.id)}
                              style={[
                                styles.filterChip,
                                newImportantReminderOffsets.includes(opt.id) && styles.filterChipOn,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.filterChipText,
                                  newImportantReminderOffsets.includes(opt.id) && styles.filterChipTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        {newImportantType !== "birthday" ? (
                          <Pressable
                            style={styles.filterChip}
                            onPress={() => setNewImportantDefaultAlertEnabled((v) => !v)}
                          >
                            <Text style={styles.filterChipText}>
                              {newImportantDefaultAlertEnabled ? "Default day alert: On" : "Default day alert: Off"}
                            </Text>
                          </Pressable>
                        ) : (
                          <Text style={styles.listRowMeta}>Birthday default alert is always on.</Text>
                        )}
                        <Pressable style={styles.actionPrimaryBtnWide} onPress={() => void handleAddImportantDate()}>
                          <Text style={styles.actionPrimaryText}>Save important date</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {importantDates.length === 0 ? (
                      <Text style={styles.helper}>No important dates yet</Text>
                    ) : (
                      <View style={styles.importantDatesList}>
                        {importantDates.map((d) => {
                          const impCd = d.date_value ? formatCalendarCountdown(String(d.date_value)) : "";
                          return (
                        <View key={d.id} style={styles.importantDateItem}>
                          {editingImportantId === d.id ? (
                            <>
                              <TextInput
                                value={editImpTitle}
                                onChangeText={setEditImpTitle}
                                placeholder="Title"
                                placeholderTextColor={colors.textSecondary}
                                style={styles.input}
                              />
                              <TextInput
                                value={editImpDate}
                                onChangeText={setEditImpDate}
                                placeholder="YYYY-MM-DD"
                                placeholderTextColor={colors.textSecondary}
                                style={styles.input}
                              />
                              <TextInput
                                value={editImpTime}
                                onChangeText={setEditImpTime}
                                placeholder="Time (optional, HH:MM)"
                                placeholderTextColor={colors.textSecondary}
                                style={styles.input}
                              />
                              <TextInput
                                value={editImpDesc}
                                onChangeText={setEditImpDesc}
                                placeholder="Description"
                                placeholderTextColor={colors.textSecondary}
                                style={styles.input}
                              />
                              <Text style={styles.listRowMeta}>Type</Text>
                              <View style={styles.filterRowWrap}>
                                {(["custom", "birthday", "anniversary"] as const).map((t) => (
                                  <Pressable
                                    key={t}
                                    onPress={() => setEditImpType(t)}
                                    style={[styles.filterChip, editImpType === t && styles.filterChipOn]}
                                  >
                                    <Text style={[styles.filterChipText, editImpType === t && styles.filterChipTextOn]}>
                                      {t[0].toUpperCase() + t.slice(1)}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                              <Text style={styles.listRowMeta}>Remind me</Text>
                              <View style={styles.filterRowWrap}>
                                {[
                                  { id: "1w", label: "1 week" },
                                  { id: "2d", label: "2 days" },
                                  { id: "day_morning", label: "On day morning" },
                                ].map((opt) => (
                                  <Pressable
                                    key={opt.id}
                                    onPress={() => toggleEditImportantOffset(opt.id)}
                                    style={[
                                      styles.filterChip,
                                      editImpReminderOffsets.includes(opt.id) && styles.filterChipOn,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.filterChipText,
                                        editImpReminderOffsets.includes(opt.id) && styles.filterChipTextOn,
                                      ]}
                                    >
                                      {opt.label}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                              {editImpType !== "birthday" ? (
                                <Pressable
                                  style={styles.filterChip}
                                  onPress={() => setEditImpDefaultAlertEnabled((v) => !v)}
                                >
                                  <Text style={styles.filterChipText}>
                                    {editImpDefaultAlertEnabled ? "Default day alert: On" : "Default day alert: Off"}
                                  </Text>
                                </Pressable>
                              ) : (
                                <Text style={styles.listRowMeta}>Birthday default alert is always on.</Text>
                              )}
                              <View style={styles.noteEditActions}>
                                <Pressable onPress={cancelEditImportantDate}>
                                  <Text style={styles.noteEditSecondary}>Cancel</Text>
                                </Pressable>
                                <Pressable style={styles.actionPrimaryBtnWide} onPress={() => void handleSaveImportantDateEdit()}>
                                  <Text style={styles.actionPrimaryText}>Save</Text>
                                </Pressable>
                              </View>
                            </>
                          ) : (
                            <>
                              <Text style={styles.importantDateTitle}>{displayMemberWords(d.title || "")}</Text>
                              <Text style={styles.importantDateMeta}>
                                {formatLongWeekdayDate(d.date_value) || d.date_value}
                                {d.time_value ? ` • ${d.time_value}` : ""}
                                {impCd ? ` · ${impCd}` : ""}
                              </Text>
                              {!!d.description && <Text style={styles.bodyText}>{d.description}</Text>}
                              {can("edit_members") ? (
                                <View style={styles.importantDateFooter}>
                                  <View style={styles.noteActionsRow}>
                                    <Pressable onPress={() => beginEditImportantDate(d)}>
                                      <Text style={styles.editLinkText}>Edit</Text>
                                    </Pressable>
                                    <Pressable onPress={() => void handleDeleteImportantDate(d.id)}>
                                      <Text style={styles.deleteText}>Delete</Text>
                                    </Pressable>
                                  </View>
                                </View>
                              ) : null}
                            </>
                          )}
                        </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={styles.helper}>Member not found.</Text>
          )
        ) : tab === "ministries" ? (
          ministries.length === 0 ? (
            <Text style={styles.helper}>No ministries found</Text>
          ) : (
            <MinistriesGrid
              groups={ministriesSorted}
              onPressItem={(g) => router.push({ pathname: "/ministry/[id]", params: { id: g.id } })}
            />
          )
        ) : tab === "events" ? (
          events.length === 0 ? (
            <Text style={styles.helper}>No roster events for this member in this branch.</Text>
          ) : (
            <View style={styles.memberEventsTab}>
              <View style={styles.memberEventsToolbarRow}>
                <View style={styles.memberEventsToolbarSearch}>
                  <Ionicons name="search" size={sizes.headerIcon} color={colors.textSecondary} style={styles.eventSearchIcon} />
                  <TextInput
                    value={memberEventSearch}
                    onChangeText={setMemberEventSearch}
                    placeholder="Search…"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.eventSearchInput}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.memberEventsToolbarFilters}>
                  <FilterTriggerButton
                    ref={memberWhenTriggerRef}
                    open={memberEventMenuOpen === "when"}
                    valueLabel={
                      MEMBER_EVENT_WHEN_OPTIONS.find((o) => o.id === memberEventWhenFilter)?.label ?? "All"
                    }
                    accessibilityLabel={`When, ${
                      MEMBER_EVENT_WHEN_OPTIONS.find((o) => o.id === memberEventWhenFilter)?.label ?? "All"
                    }. Double tap to change.`}
                    onPress={() => {
                      memberWhenTriggerRef.current?.measureInWindow((x, y, w, h) => {
                        setMemberFilterAnchor({ x, y, width: w, height: h });
                        setMemberEventMenuOpen("when");
                      });
                    }}
                  />
                  <FilterTriggerButton
                    ref={memberAttendanceTriggerRef}
                    open={memberEventMenuOpen === "attendance"}
                    valueLabel={
                      MEMBER_ATTENDANCE_FILTER_OPTIONS.find((o) => o.id === memberEventAttendanceFilter)?.label ??
                      "All"
                    }
                    accessibilityLabel={`Attendance filter, ${
                      MEMBER_ATTENDANCE_FILTER_OPTIONS.find((o) => o.id === memberEventAttendanceFilter)?.label ?? "All"
                    }. Double tap to change.`}
                    onPress={() => {
                      memberAttendanceTriggerRef.current?.measureInWindow((x, y, w, h) => {
                        setMemberFilterAnchor({ x, y, width: w, height: h });
                        setMemberEventMenuOpen("attendance");
                      });
                    }}
                  />
                </View>
              </View>
              {filteredMemberEvents.length === 0 ? (
                <Text style={styles.helper}>No events match your search or filters.</Text>
              ) : (
                <View style={styles.eventListStack}>
                  {filteredMemberEvents.map((event) => {
                const title = displayMemberWords(String(event.title || event.name || "Untitled event"));
                const start = event.start_time ? new Date(event.start_time) : null;
                const hasValidStart = Boolean(start && !Number.isNaN(start.getTime()));
                const isPast = hasValidStart ? start!.getTime() < Date.now() : false;
                const typeKey = normalizeEventTypeKey(event.event_type || undefined);
                const typeColors = eventTypeChipColors(typeKey);
                const subtitle = formatMemberEventSubtitle(event);
                const statusRaw = asTrimmed(event.status);
                const attColors = attendancePillColors(event.attendance_status);
                const saving = savingAttendanceEventId === event.id;
                const recorderName = asTrimmed(event.attendance_recorded_by_name);
                return (
                  <View key={event.id} style={styles.eventCard}>
                    <View style={styles.eventCardTopRow}>
                      <Pressable
                        onPress={() => router.push({ pathname: "/event/[id]", params: { id: event.id } })}
                        style={({ pressed }) => [styles.eventCardTapMain, pressed && styles.eventCardPressed]}
                      >
                        <Text style={styles.eventCardTitle} numberOfLines={2}>
                          {title}
                        </Text>
                        {subtitle ? (
                          <Text style={styles.eventCardMeta} numberOfLines={2}>
                            {subtitle}
                          </Text>
                        ) : null}
                        <View style={styles.eventChipRow}>
                          {asTrimmed(event.event_type) ? (
                            <View
                              style={[
                                styles.eventChip,
                                { backgroundColor: typeColors.bg, borderColor: typeColors.border },
                              ]}
                            >
                              <Text style={[styles.eventChipText, { color: typeColors.text }]}>
                                {displayMemberWords(asTrimmed(event.event_type))}
                              </Text>
                            </View>
                          ) : null}
                          {statusRaw ? (
                            <View style={[styles.eventChip, styles.eventChipStatus]}>
                              <Text style={styles.eventChipStatusText}>{displayMemberWords(statusRaw)}</Text>
                            </View>
                          ) : null}
                          {hasValidStart ? (
                            <View
                              style={[
                                styles.eventChip,
                                isPast ? styles.eventChipPast : styles.eventChipUpcoming,
                              ]}
                            >
                              <Text style={isPast ? styles.eventChipPastText : styles.eventChipUpcomingText}>
                                {isPast ? "Past" : "Upcoming"}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={
                          can("track_attendance") ? "Change attendance" : "Attendance (view only)"
                        }
                        onPress={() => {
                          if (can("track_attendance")) setAttendancePickEventId(event.id);
                        }}
                        disabled={saving || !can("track_attendance")}
                        style={({ pressed }) => [
                          styles.eventAttendanceTag,
                          {
                            backgroundColor: attColors.bg,
                            borderColor: attColors.border,
                          },
                          !can("track_attendance") && { opacity: 0.55 },
                          pressed && !saving && can("track_attendance") && { opacity: 0.88 },
                          saving && { opacity: 0.7 },
                        ]}
                      >
                        {saving ? (
                          <ActivityIndicator size="small" color={attColors.text} />
                        ) : (
                          <>
                            <Text style={[styles.eventAttendanceTagText, { color: attColors.text }]} numberOfLines={1}>
                              {attendanceDisplayLabel(event.attendance_status)}
                            </Text>
                            <Ionicons name="chevron-down" size={14} color={attColors.text} />
                          </>
                        )}
                      </Pressable>
                    </View>
                    {recorderName ? (
                      <Text style={styles.eventRecordedBy} numberOfLines={1}>
                        Recorded by {displayMemberWords(recorderName)}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
                </View>
              )}
            </View>
          )
        ) : tab === "tasks" ? (
          memberId ? (
            <View style={styles.tasksPanel}>
              {taskLoadError ? <Text style={styles.taskLoadErrorText}>Could not load tasks: {taskLoadError}</Text> : null}
              <MemberTasksTab
                tasks={tasks}
                setTasks={setTasks}
                pageLoading={loading}
                memberId={memberId}
                primaryMemberDisplayName={headerMemberName}
              />
            </View>
          ) : null
        ) : null}
      </ScrollView>

      <FilterPickerModal
        visible={memberEventMenuOpen !== null && memberFilterAnchor !== null}
        title={
          memberEventMenuOpen === "when"
            ? "When"
            : memberEventMenuOpen === "attendance"
              ? "Attendance"
              : ""
        }
        anchorRect={memberFilterAnchor}
        options={
          memberEventMenuOpen === "when"
            ? MEMBER_EVENT_WHEN_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
            : memberEventMenuOpen === "attendance"
              ? MEMBER_ATTENDANCE_FILTER_OPTIONS.map((o) => ({ value: String(o.id), label: o.label }))
              : []
        }
        selectedValue={
          memberEventMenuOpen === "when"
            ? memberEventWhenFilter
            : memberEventMenuOpen === "attendance"
              ? memberEventAttendanceFilter
              : ""
        }
        onSelect={(v) => {
          if (memberEventMenuOpen === "when") {
            setMemberEventWhenFilter(v as "all" | "upcoming" | "past");
          } else if (memberEventMenuOpen === "attendance") {
            if (v === "all") setMemberEventAttendanceFilter("all");
            else setMemberEventAttendanceFilter(v as AttendanceStatus);
          }
        }}
        onClose={() => {
          setMemberEventMenuOpen(null);
          setMemberFilterAnchor(null);
        }}
      />

      <FilterPickerModal
        visible={headerMenuOpen}
        title=""
        anchorRect={headerMenuAnchor}
        options={headerOverflowOptions}
        selectedValue="__none__"
        onSelect={(v) => {
          if (v === "edit") setShowEditMemberModal(true);
          else if (v === "delete") handleDeleteMemberRecord();
        }}
        onClose={() => {
          setHeaderMenuOpen(false);
          setHeaderMenuAnchor(null);
        }}
      />

      <Modal
        visible={showImageFullView && !!imageUri}
        animationType="fade"
        transparent
        onRequestClose={() => setShowImageFullView(false)}
      >
        <View style={[styles.imageFullRoot, { paddingTop: insets.top }]}>
          <View style={styles.imageFullHeader}>
            <Pressable
              accessibilityLabel="Close"
              onPress={() => setShowImageFullView(false)}
              hitSlop={12}
              style={({ pressed }) => [styles.imageFullCloseBtn, pressed && styles.imageFullCloseBtnPressed]}
            >
              <Ionicons name="close" size={28} color="#ffffff" />
            </Pressable>
          </View>
          <Pressable
            style={styles.imageFullBody}
            onPress={() => setShowImageFullView(false)}
            accessibilityLabel="Close full screen photo"
          >
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={{
                  width: windowW - 24,
                  height: Math.max(240, windowH - insets.top - insets.bottom - 72),
                }}
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
        </View>
      </Modal>

      <Modal
        visible={attendancePickEventId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!savingAttendanceEventId) setAttendancePickEventId(null);
        }}
      >
        <View style={styles.attendanceModalRoot}>
          <Pressable
            style={styles.attendanceModalBackdrop}
            onPress={() => {
              if (!savingAttendanceEventId) setAttendancePickEventId(null);
            }}
            accessibilityLabel="Dismiss"
          />
          <View
            style={[
              styles.attendanceBottomSheet,
              { paddingBottom: Math.max(insets.bottom, 12) + 12 },
            ]}
          >
            <View style={styles.sheetGrabber} />
            <View style={styles.attendanceSheetHeader}>
              <Text style={styles.attendanceModalTitle}>Attendance</Text>
              <Pressable
                hitSlop={12}
                disabled={!!savingAttendanceEventId}
                onPress={() => setAttendancePickEventId(null)}
                style={({ pressed }) => [styles.attendanceSheetCloseBtn, pressed && { opacity: 0.7 }]}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={26} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Text style={styles.attendanceModalHint}>Choose a status for this member on this event.</Text>
            <View style={styles.attendanceModalSheetInner}>
              {savingAttendanceEventId ? (
                <View style={styles.attendanceModalSavingOverlay}>
                  <ActivityIndicator size="large" color={colors.accent} />
                  <Text style={styles.attendanceModalSavingText}>Saving attendance…</Text>
                </View>
              ) : null}
              {ATTENDANCE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    if (attendancePickEventId) void saveMemberAttendance(attendancePickEventId, opt.value);
                  }}
                  disabled={!!savingAttendanceEventId}
                  style={({ pressed }) => [
                    styles.attendanceModalOption,
                    pressed && !savingAttendanceEventId && styles.attendanceModalOptionPressed,
                  ]}
                >
                  <Text style={styles.attendanceModalOptionText}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => setAttendancePickEventId(null)}
              disabled={!!savingAttendanceEventId}
              style={({ pressed }) => [
                styles.attendanceSheetDismissBtn,
                pressed && !savingAttendanceEventId && { opacity: 0.92 },
                !!savingAttendanceEventId && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.attendanceSheetDismissBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <MemberEditModal
        visible={showEditMemberModal}
        onClose={() => setShowEditMemberModal(false)}
        memberId={memberId}
        member={member}
        memberStatusOptions={memberStatusOptions}
        fieldDefs={memberCustomFieldDefs}
        onSaved={(m) => {
          setMember(m);
        }}
      />

      <Modal visible={deletingMemberInProgress} transparent animationType="fade">
        <View style={styles.deletingOverlay} accessibilityLabel="Deleting member">
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.deletingOverlayText}>Deleting member…</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  deletingOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  deletingOverlayText: {
    color: "#ffffff",
    fontSize: type.body.size,
    fontWeight: "600",
  },
  container: { padding: 16, gap: 12, paddingBottom: 28 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  topBarLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 2 },
  topTitle: {
    flex: 1,
    fontSize: type.h1.size,
    lineHeight: type.h1.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.h1.weight,
    letterSpacing: type.h1.letterSpacing,
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: colors.accentSurface,
    borderRadius: radius.sm,
    padding: 4,
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: radius.sm - 2,
    minWidth: 0,
    minHeight: 48,
  },
  segmentItemActive: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentLabel: {
    color: "#6b7280",
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  segmentLabelActive: { color: "#ffffff" },
  accordionCard: {
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  accordionTintContact: { backgroundColor: "#eff6ff" },
  accordionTintMember: { backgroundColor: "#dbeafe" },
  accordionTintAdditional: { backgroundColor: colors.accentSurface },
  accordionTintAttendance: { backgroundColor: "#fffbeb" },
  accordionTintNotes: { backgroundColor: "#f0fdfa" },
  accordionTintImportant: { backgroundColor: "#fdf2f8" },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  accordionHeaderPressed: { opacity: 0.92 },
  accordionTitle: {
    color: colors.textPrimary,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    flex: 1,
    paddingRight: 8,
  },
  accordionBody: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 18,
    gap: 12,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    padding: 16,
  },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarWrap: {
    width: 96,
    height: 96,
    position: "relative",
  },
  avatarImagePressable: {
    width: 96,
    height: 96,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#ececec",
  },
  avatarImagePressableDisabled: { opacity: 1 },
  avatarImagePressablePressed: { opacity: 0.92 },
  profileImageSquare: {
    width: "100%",
    height: "100%",
    backgroundColor: "#ececec",
  },
  profileFallbackSquare: {
    width: "100%",
    height: "100%",
    backgroundColor: "#ececec",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileFallbackText: {
    color: colors.textPrimary,
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  avatarEditOnImage: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  avatarEditOnImagePressed: { opacity: 0.88 },
  /** Match avatar square (96): name + status + call/email must not exceed this height. */
  heroTextCol: {
    flex: 1,
    minWidth: 0,
    height: 96,
    maxHeight: 96,
    justifyContent: "space-between",
    gap: 4,
  },
  heroName: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: type.title.letterSpacing,
    flexShrink: 1,
  },
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: "100%",
  },
  statusTagDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusTagText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: type.bodyStrong.weight,
    flexShrink: 1,
  },
  heroActions: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  heroActionPill: {
    flex: 1,
    minHeight: 30,
    maxHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroActionPillCall: {
    backgroundColor: "#dbeafe",
    borderColor: "#93c5fd",
  },
  heroActionPillEmail: {
    backgroundColor: "#dbeafe",
    borderColor: "#93c5fd",
  },
  heroActionPillDisabled: {
    backgroundColor: "#f1f5f9",
    borderColor: colors.border,
    opacity: 0.7,
  },
  heroActionPillPressed: { opacity: 0.88 },
  heroActionPillText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  heroActionPillTextCall: { color: colors.accent },
  heroActionPillTextEmail: { color: "#1d4ed8" },
  heroActionPillTextDisabled: { color: colors.textSecondary },
  imageFullRoot: {
    flex: 1,
    backgroundColor: "#000000",
  },
  imageFullHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  imageFullCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  imageFullCloseBtnPressed: { opacity: 0.7 },
  imageFullBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  tabRow: { flexDirection: "row", gap: 8 },
  tabBtn: {
    flex: 1,
    minHeight: 42,
    paddingVertical: 8,
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBtnActive: { backgroundColor: "#dbeafe", borderColor: "#bfdbfe" },
  tabText: {
    color: colors.textSecondary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.body.weight,
    letterSpacing: type.body.letterSpacing,
  },
  tabTextActive: { color: "#1d4ed8", fontWeight: type.bodyStrong.weight },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  inputFlex: { flex: 1 },
  formRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionPrimaryBtn: {
    height: 44,
    borderRadius: cardRadius,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimaryBtnWide: {
    height: 44,
    borderRadius: cardRadius,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimaryText: {
    color: "#fff",
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
  },
  bodyCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    padding: 14,
    gap: 10,
  },
  overviewStack: { gap: 6 },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    letterSpacing: type.subtitle.letterSpacing,
    marginBottom: 4,
  },
  fieldRow: { gap: 4 },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    letterSpacing: type.caption.letterSpacing,
  },
  fieldValue: {
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
    letterSpacing: type.body.letterSpacing,
  },
  fieldSub: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    marginTop: 2,
  },
  emergencyBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  twoColGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  gridCell: { width: "47%", minWidth: 140, gap: 4 },
  customGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  customCell: { width: "47%", minWidth: 140, gap: 4 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: cardRadius,
    borderWidth: 1,
    gap: 6,
    marginTop: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    letterSpacing: type.bodyStrong.letterSpacing,
  },
  bodyText: {
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    letterSpacing: type.body.letterSpacing,
  },
  listRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  listRowText: {
    color: colors.textPrimary,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    letterSpacing: type.subtitle.letterSpacing,
  },
  listRowMeta: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    letterSpacing: type.caption.letterSpacing,
  },
  pillStatus: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
    backgroundColor: colors.accentSurface,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  noteComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 12,
  },
  noteComposerInput: {
    flex: 1,
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  noteComposerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  noteCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
    marginBottom: 10,
  },
  noteEditInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
  },
  noteFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  noteEditActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  noteEditSecondary: { fontSize: type.body.size, fontWeight: "600", color: colors.textSecondary },
  noteActionsRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  noteIconBtn: { padding: 4 },
  importantDateHeaderActions: {
    marginBottom: 8,
  },
  addImportantDateBtn: {
    alignSelf: "flex-start",
    minHeight: 38,
    borderRadius: cardRadius,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addImportantDateBtnText: {
    color: "#fff",
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  importantDateAddForm: {
    gap: 8,
    marginBottom: 10,
  },
  importantDatesList: {
    gap: 8,
  },
  importantDateItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: cardRadius,
    backgroundColor: "#f8fafc",
    padding: 12,
    gap: 8,
  },
  importantDateTitle: {
    color: colors.textPrimary,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    letterSpacing: type.subtitle.letterSpacing,
  },
  importantDateMeta: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
    letterSpacing: type.caption.letterSpacing,
  },
  importantDateFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 2,
  },
  editLinkText: { fontSize: type.caption.size, fontWeight: "600", color: colors.accent },
  deleteText: {
    color: "#b91c1c",
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  helper: {
    color: colors.textSecondary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    letterSpacing: type.body.letterSpacing,
  },
  tasksPanel: { gap: 8 },
  taskLoadErrorText: { color: "#b91c1c", fontSize: type.caption.size, lineHeight: type.caption.lineHeight },
  memberEventsTab: { gap: 10 },
  memberEventsToolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberEventsToolbarSearch: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  memberEventsToolbarFilters: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 6,
    alignItems: "stretch",
  },
  eventSearchIcon: { marginRight: 6 },
  eventSearchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  eventListStack: { gap: 8 },
  eventCard: {
    borderRadius: cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  eventCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  eventCardTapMain: {
    flex: 1,
    minWidth: 0,
  },
  eventCardPressed: { opacity: 0.94 },
  eventCardTitle: {
    color: "#111827",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: "600",
  },
  eventCardMeta: {
    color: "#6b7280",
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    marginTop: 4,
  },
  eventAttendanceTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
    maxWidth: "42%",
  },
  eventAttendanceTagText: {
    fontSize: type.caption.size,
    fontWeight: "700",
    flexShrink: 1,
  },
  eventRecordedBy: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textSecondary,
    fontStyle: "italic",
  },
  eventChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
    alignItems: "center",
  },
  eventChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
  },
  eventChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  eventChipStatus: {
    backgroundColor: "#f1f5f9",
    borderColor: "#e2e8f0",
  },
  eventChipStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  eventChipPast: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  eventChipPastText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
  },
  eventChipUpcoming: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe",
  },
  eventChipUpcomingText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4338ca",
  },
  attendanceModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  attendanceModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  attendanceBottomSheet: {
    width: "100%",
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 6,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetGrabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#e5e7eb",
    alignSelf: "center",
    marginBottom: 8,
  },
  attendanceSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  attendanceSheetCloseBtn: {
    padding: 4,
    marginRight: -4,
  },
  attendanceModalSheetInner: {
    position: "relative",
    minHeight: 168,
    marginTop: 4,
    marginRight: -4,
    marginLeft: -4,
  },
  attendanceModalSavingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.94)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    gap: 12,
    borderRadius: radius.sm,
  },
  attendanceModalSavingText: {
    fontSize: type.body.size,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  attendanceModalTitle: {
    flex: 1,
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
  },
  attendanceModalHint: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  attendanceModalOption: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  attendanceModalOptionPressed: { backgroundColor: "#f9fafb" },
  attendanceModalOptionText: {
    fontSize: type.body.size,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  attendanceSheetDismissBtn: {
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  attendanceSheetDismissBtnText: {
    fontSize: type.body.size,
    fontWeight: "600",
    color: "#ffffff",
  },
  filterRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  filterChipText: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
  },
  filterChipTextOn: {
    color: colors.accent,
    fontWeight: "700",
  },
});
