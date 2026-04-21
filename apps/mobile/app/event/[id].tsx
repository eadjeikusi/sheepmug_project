import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { EventAttendanceRow, EventItem, EventTypeRow, Group, Member } from "@sheepmug/shared-api";
import type { AnchorRect } from "../../components/FilterPickerModal";
import { FilterPickerModal } from "../../components/FilterPickerModal";
import { FilterTriggerButton } from "../../components/FilterTriggerButton";
import { EventUpsertModal } from "../../components/EventUpsertModal";
import { api } from "../../lib/api";
import { eventAttachmentStoragePath, shareEventAttachmentDownload } from "../../lib/downloadEventAttachment";

type EventAttendancePayload = Awaited<ReturnType<typeof api.events.attendance.get>>;
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { normalizeImageUri } from "../../lib/imageUri";
import { displayMemberWords, formatCalendarCountdown } from "../../lib/memberDisplayFormat";
import { labelForEventTypeSlug } from "../../lib/eventTypeDisplay";
import {
  locationModeDisplayLabel,
  normalizeLocationTypeInput,
  type CanonicalLocationType,
} from "../../lib/eventLocation";
import { colors, radius, sizes, type } from "../../theme";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";
import { getOfflineResourceCache, setOfflineResourceCache } from "../../lib/storage";
import { hydratePayloadWithOfflineImages } from "../../lib/offline/imageCache";

type EventTab = "details" | "program" | "files" | "group" | "attendance";

type AttendanceStatus = "not_marked" | "present" | "absent" | "unsure";
type AttendanceFilter = "all" | AttendanceStatus;
type AttendanceView = "list" | "grid";

type AttendanceMember = Member & {
  memberimage_url?: string | null;
  group_ids?: string[];
};
const EVENT_DETAIL_CACHE_PREFIX = "event:detail:";

function eventTitle(event: EventItem | null): string {
  const raw = String((event?.name as string) || (event?.title as string) || "Event").trim() || "Event";
  return displayMemberWords(raw);
}

function eventTypeDisplay(event: EventItem | null, rows: EventTypeRow[]): string {
  const slug = event?.event_type;
  const label = labelForEventTypeSlug(typeof slug === "string" ? slug : null, rows);
  return label || "Event";
}

function memberLabel(member: AttendanceMember): string {
  const raw = `${member.first_name || ""} ${member.last_name || ""}`.trim();
  return raw ? displayMemberWords(raw) : "Unnamed member";
}

function statusLabel(status: AttendanceStatus): string {
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  if (status === "unsure") return "Not sure";
  return "Not marked";
}

/** Short date for hero tags, e.g. "Thu, Apr 15". */
function formatShortEventDate(iso: string | null): string {
  if (!iso || !String(iso).trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatCompactClock(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const s = new Date(ms)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.replace(/\s*(AM|PM)$/i, (_, ap: string) => ap.toLowerCase()).replace(/\s/g, "");
}

/** Start date & time through end date & time (always both ends when end is valid). */
function formatDateTimePrimaryLine(startIso: string | null, endIso: string | null): string {
  if (!startIso || !String(startIso).trim()) return "";
  const startD = new Date(startIso);
  if (Number.isNaN(startD.getTime())) return "";
  const startPart = `${formatShortEventDate(startIso)}, ${formatCompactClock(startIso)}`;
  if (!endIso || !String(endIso).trim()) return startPart;
  const endD = new Date(endIso);
  if (Number.isNaN(endD.getTime()) || endD.getTime() <= startD.getTime()) return startPart;
  return `${startPart} – ${formatShortEventDate(endIso)}, ${formatCompactClock(endIso)}`;
}

function locationModeBadgeTone(mode: CanonicalLocationType): { bg: string; border: string; text: string } {
  if (mode === "Online") return { bg: "#dbeafe", border: "#93c5fd", text: "#1d4ed8" };
  if (mode === "Hybrid") return { bg: "#ede9fe", border: "#c4b5fd", text: "#5b21b6" };
  return { bg: "#ecfdf5", border: "#6ee7b7", text: "#047857" };
}

/** Street / venue line only (not meeting URL). */
function physicalLocationLine(ev: EventItem | null): string {
  if (!ev) return "";
  const details = typeof ev.location_details === "string" ? ev.location_details.trim() : "";
  if (details) return details;
  const mode = normalizeLocationTypeInput(ev.location_type);
  if (mode === "Online") return "";
  const legacy = typeof ev.location === "string" ? ev.location.trim() : "";
  return legacy;
}

function customFieldLabelFromKey(key: string): string {
  return displayMemberWords(key.replace(/_/g, " "));
}

function meetingUrlOpenable(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function statusTone(status: AttendanceStatus): { bg: string; border: string; text: string } {
  if (status === "present") return { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" };
  if (status === "absent") return { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b" };
  if (status === "unsure") return { bg: "#fffbeb", border: "#fcd34d", text: "#92400e" };
  return { bg: "#f8fafc", border: "#cbd5e1", text: "#475569" };
}

function statusCardTone(status: AttendanceStatus): { bg: string; border: string } {
  if (status === "present") return { bg: "#ecfdf5", border: "#86efac" };
  if (status === "absent") return { bg: "#fef2f2", border: "#fca5a5" };
  if (status === "unsure") return { bg: "#fffbeb", border: "#fde68a" };
  return { bg: "#f8fafc", border: "#cbd5e1" };
}

type ProgramPart = {
  id: string;
  title: string;
  notes: string;
  items: Array<{ id: string; title: string; start_time?: string; end_time?: string; notes?: string }>;
};

function normalizeProgram(raw: unknown): ProgramPart[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  const partsRaw = Array.isArray(obj.sections) ? obj.sections : Array.isArray(obj.parts) ? obj.parts : [];
  const out: ProgramPart[] = [];
  for (let i = 0; i < partsRaw.length; i += 1) {
    const p = partsRaw[i];
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    const row = p as Record<string, unknown>;
    const itemsRaw = Array.isArray(row.items) ? row.items : Array.isArray(row.activities) ? row.activities : [];
    const items = itemsRaw
      .map((it, j) => {
        if (!it || typeof it !== "object" || Array.isArray(it)) return null;
        const item = it as Record<string, unknown>;
        return {
          id: String(item.id ?? `item-${i}-${j}`),
          title: String(item.title ?? item.name ?? `Activity ${j + 1}`),
          start_time: typeof item.start_time === "string" ? item.start_time : undefined,
          end_time: typeof item.end_time === "string" ? item.end_time : undefined,
          notes: typeof item.notes === "string" ? item.notes : undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    out.push({
      id: String(row.id ?? `part-${i}`),
      title: String(row.title ?? row.name ?? `Part ${i + 1}`),
      notes: typeof row.notes === "string" ? row.notes : "",
      items,
    });
  }
  return out;
}

function asAttachmentList(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
}

function asGroups(raw: unknown): Group[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Group[];
}

function asRosterMembers(raw: unknown): AttendanceMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as AttendanceMember[];
}

function eventCoverImageFromItem(ev: EventItem | null): string | null {
  if (!ev) return null;
  const row = ev as EventItem & {
    cover_image_url?: string | null;
    cover_image?: string | null;
    event_image_url?: string | null;
    image_url?: string | null;
  };
  const raw = row.cover_image_url || row.cover_image || row.event_image_url || row.image_url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeImageUri(raw.trim());
}

export default function EventDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isOnline, queueAttendanceUpdate } = useOfflineSync();

  const [tab, setTab] = useState<EventTab>("details");
  const [event, setEvent] = useState<EventItem | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<EventAttendanceRow[]>([]);
  const [audienceMembers, setAudienceMembers] = useState<AttendanceMember[]>([]);
  const [assignedGroups, setAssignedGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AttendanceFilter>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [attendanceView, setAttendanceView] = useState<AttendanceView>("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<null | "status" | "group">(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [downloadingAttachmentKey, setDownloadingAttachmentKey] = useState<string | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<AnchorRect | null>(null);
  const statusTriggerRef = useRef<View>(null);
  const groupTriggerRef = useRef<View>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [eventTypeRows, setEventTypeRows] = useState<EventTypeRow[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const cacheKey = `${EVENT_DETAIL_CACHE_PREFIX}${id}`;
        const cached = await getOfflineResourceCache<{
          event: EventItem | null;
          attendance: EventAttendanceRow[];
          members: AttendanceMember[];
          assigned_groups: Group[];
          filter_groups: Group[];
          eventTypeRows: EventTypeRow[];
        }>(cacheKey);
        if (mounted && cached?.data) {
          setEvent(cached.data.event ?? null);
          setAttendanceRows(Array.isArray(cached.data.attendance) ? cached.data.attendance : []);
          setAudienceMembers(asRosterMembers(cached.data.members));
          setAssignedGroups(
            Array.isArray(cached.data.filter_groups)
              ? cached.data.filter_groups
              : Array.isArray(cached.data.assigned_groups)
                ? cached.data.assigned_groups
                : []
          );
          setEventTypeRows(Array.isArray(cached.data.eventTypeRows) ? cached.data.eventTypeRows : []);
        }
        if (mounted && !cached?.data?.event) {
          const eventsListCached = await getOfflineResourceCache<{ events: EventItem[] }>("events:list");
          const fallbackEvent = (eventsListCached?.data?.events || []).find((e) => String(e.id) === String(id));
          if (fallbackEvent) {
            setEvent(fallbackEvent);
          }
        }

        try {
          const [detail, attendancePayload, typeRows] = await Promise.all([
            api.events.detail(id),
            api.events.attendance.get(id),
            api.eventTypes.list(),
          ]);
          if (!mounted) return;
          setEventTypeRows(
            [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          );
          setEvent(detail as EventItem | null);
          setAttendanceRows(Array.isArray(attendancePayload.attendance) ? attendancePayload.attendance : []);
          setAudienceMembers(asRosterMembers(attendancePayload.members));
          setAssignedGroups(
            Array.isArray(attendancePayload.filter_groups)
              ? attendancePayload.filter_groups
              : Array.isArray(attendancePayload.assigned_groups)
                ? attendancePayload.assigned_groups
                : []
          );
          await setOfflineResourceCache(
            cacheKey,
            await hydratePayloadWithOfflineImages({
              event: detail as EventItem | null,
              attendance: Array.isArray(attendancePayload.attendance) ? attendancePayload.attendance : [],
              members: asRosterMembers(attendancePayload.members),
              assigned_groups: Array.isArray(attendancePayload.assigned_groups)
                ? attendancePayload.assigned_groups
                : [],
              filter_groups: Array.isArray(attendancePayload.filter_groups) ? attendancePayload.filter_groups : [],
              eventTypeRows: [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
            })
          );
        } catch {
          // keep cached detail/attendance/event-type payload when offline
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const attendanceByMember = useMemo(() => {
    const map = new Map<string, EventAttendanceRow>();
    for (const row of attendanceRows) map.set(row.member_id, row);
    return map;
  }, [attendanceRows]);

  const effectiveStatus = useMemo(
    () => (memberId: string): AttendanceStatus =>
      (attendanceByMember.get(memberId)?.status as AttendanceStatus) || "not_marked",
    [attendanceByMember]
  );

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audienceMembers.filter((member) => {
      const name = memberLabel(member).toLowerCase();
      if (q && !name.includes(q)) return false;
      const st = effectiveStatus(member.id);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      const gids = Array.isArray(member.group_ids) ? member.group_ids : [];
      if (groupFilter !== "all" && !gids.includes(groupFilter)) return false;
      return true;
    });
  }, [audienceMembers, effectiveStatus, groupFilter, search, statusFilter]);

  const summary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let unsure = 0;
    let notMarked = 0;
    for (const member of audienceMembers) {
      const status = effectiveStatus(member.id);
      if (status === "present") present += 1;
      else if (status === "absent") absent += 1;
      else if (status === "unsure") unsure += 1;
      else notMarked += 1;
    }
    return { total: audienceMembers.length, present, absent, unsure, notMarked };
  }, [audienceMembers, effectiveStatus]);

  const allFilteredSelected =
    filteredMembers.length > 0 && filteredMembers.every((member) => selected.has(member.id));
  const someFilteredSelected = filteredMembers.some((member) => selected.has(member.id));

  const attachments = asAttachmentList(event?.attachments);
  const linkedGroups = Array.isArray(event?.linked_groups) ? (event?.linked_groups as Array<Record<string, unknown>>) : [];
  const programParts = normalizeProgram(event?.program_outline);
  const customFields =
    event?.custom_fields && typeof event.custom_fields === "object" && !Array.isArray(event.custom_fields)
      ? (event.custom_fields as Record<string, unknown>)
      : null;
  const start = (event?.start_time as string) || (event?.start_date as string) || null;
  const end = (event?.end_time as string) || (event?.end_date as string) || null;
  const startCountdown = start ? formatCalendarCountdown(start) : "";
  const heroDateTimeLine = start ? formatDateTimePrimaryLine(start, end) : "";
  const locationMode = event ? normalizeLocationTypeInput(event.location_type) : null;
  const locationBadgeLabel =
    event && locationMode ? locationModeDisplayLabel(event.location_type) : "";
  const locationTone = locationMode ? locationModeBadgeTone(locationMode) : null;
  const physicalLocation = physicalLocationLine(event);
  const meetingUrl =
    event && typeof event.online_meeting_url === "string" ? event.online_meeting_url.trim() : "";

  const statusOptions = useMemo(
    () => [
      { value: "all", label: "All statuses" },
      { value: "present", label: "Present" },
      { value: "absent", label: "Absent" },
      { value: "unsure", label: "Not sure" },
      { value: "not_marked", label: "Not marked" },
    ],
    []
  );
  const groupOptions = useMemo(
    () => [
      { value: "all", label: "All groups" },
      ...assignedGroups.map((g) => ({
        value: g.id,
        label: displayMemberWords(String(g.name || "Group")),
      })),
    ],
    [assignedGroups]
  );
  const pickerTitle = menuOpen === "status" ? "Status" : menuOpen === "group" ? "Group" : "";
  const pickerOptions = menuOpen === "status" ? statusOptions : menuOpen === "group" ? groupOptions : [];
  const pickerValue = menuOpen === "status" ? statusFilter : menuOpen === "group" ? groupFilter : "";
  const statusLabelValue = statusOptions.find((o) => o.value === statusFilter)?.label || "All statuses";
  const groupLabelValue = groupOptions.find((o) => o.value === groupFilter)?.label || "All groups";

  function openMenu(kind: "status" | "group") {
    const ref = kind === "status" ? statusTriggerRef : groupTriggerRef;
    ref.current?.measureInWindow((x, y, width, height) => {
      setFilterAnchor({ x, y, width, height });
      setMenuOpen(kind);
    });
  }

  async function applyStatusToSelected(status: AttendanceStatus) {
    if (!id || selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const updates = Array.from(selected).map((member_id) => ({ member_id, status }));
      if (!isOnline) {
        await queueAttendanceUpdate(id, updates);
        setAttendanceRows((prev) => {
          const next = [...prev];
          for (const memberId of selected) {
            const idx = next.findIndex((row) => row.member_id === memberId);
            if (idx === -1) {
              next.push({ id: `${memberId}-${status}-${Date.now()}`, member_id: memberId, status } as EventAttendanceRow);
            } else {
              next[idx] = { ...next[idx], status };
            }
          }
          return next;
        });
        setSelected(new Set());
        Alert.alert("Saved offline", "Attendance updates were queued and will sync when internet is available.");
        return;
      }

      const payload = await api.events.attendance.update(id, updates);
      if (Array.isArray(payload.attendance)) {
        setAttendanceRows(payload.attendance);
      } else {
        setAttendanceRows((prev) => {
          const next = [...prev];
          for (const memberId of selected) {
            const idx = next.findIndex((row) => row.member_id === memberId);
            if (idx === -1) {
              next.push({ id: `${memberId}-${status}-${Date.now()}`, member_id: memberId, status } as EventAttendanceRow);
            } else {
              next[idx] = { ...next[idx], status };
            }
          }
          return next;
        });
      }
      setSelected(new Set());
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const member of filteredMembers) next.delete(member.id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const member of filteredMembers) next.add(member.id);
      return next;
    });
  }

  const tabs: EventTab[] = ["details", "program", "files", "group", "attendance"];
  const coverUri = useMemo(() => {
    return eventCoverImageFromItem(event);
  }, [event]);

  async function reloadDetail() {
    if (!id) return;
    setLoading(true);
    try {
      try {
        const [detail, attendancePayload, typeRows] = await Promise.all([
          api.events.detail(id),
          api.events.attendance.get(id),
          api.eventTypes.list(),
        ]);
        setEventTypeRows(
          [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
        );
        setEvent(detail as EventItem | null);
        setAttendanceRows(Array.isArray(attendancePayload.attendance) ? attendancePayload.attendance : []);
        setAudienceMembers(asRosterMembers(attendancePayload.members));
        setAssignedGroups(
          Array.isArray(attendancePayload.filter_groups)
            ? attendancePayload.filter_groups
            : Array.isArray(attendancePayload.assigned_groups)
              ? attendancePayload.assigned_groups
              : []
        );
        await setOfflineResourceCache(
          `${EVENT_DETAIL_CACHE_PREFIX}${id}`,
          await hydratePayloadWithOfflineImages({
            event: detail as EventItem | null,
            attendance: Array.isArray(attendancePayload.attendance) ? attendancePayload.attendance : [],
            members: asRosterMembers(attendancePayload.members),
            assigned_groups: Array.isArray(attendancePayload.assigned_groups)
              ? attendancePayload.assigned_groups
              : [],
            filter_groups: Array.isArray(attendancePayload.filter_groups) ? attendancePayload.filter_groups : [],
            eventTypeRows: [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
          })
        );
      } catch {
        // keep current detail snapshot when offline
      }
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await reloadDetail();
    } finally {
      setRefreshing(false);
    }
  }

  const handleDownloadAttachment = useCallback(async (a: Record<string, unknown>, rowKey: string) => {
    const name = String(a.name || "Attachment");
    const storagePath = typeof a.storage_path === "string" ? a.storage_path.trim() : "";
    const url = typeof a.url === "string" ? a.url.trim() : "";
    setDownloadingAttachmentKey(rowKey);
    try {
      const path = eventAttachmentStoragePath({ storage_path: storagePath || null, url: url || null });
      if (path) {
        await shareEventAttachmentDownload({
          storagePath: path,
          filename: name,
          contentType: typeof a.content_type === "string" ? a.content_type : null,
        });
      } else if (url) {
        const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        await Linking.openURL(withScheme);
      } else {
        Alert.alert("Files", "This file cannot be downloaded.");
      }
    } catch (e: unknown) {
      Alert.alert("Download", e instanceof Error ? e.message : "Failed");
    } finally {
      setDownloadingAttachmentKey(null);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <FilterPickerModal
        visible={menuOpen !== null && filterAnchor !== null}
        title={pickerTitle}
        options={pickerOptions}
        selectedValue={pickerValue}
        anchorRect={filterAnchor}
        onSelect={(value) => {
          if (menuOpen === "status") setStatusFilter(value as AttendanceFilter);
          if (menuOpen === "group") setGroupFilter(value);
        }}
        onClose={() => {
          setMenuOpen(null);
          setFilterAnchor(null);
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.container, selected.size > 0 && styles.containerWithDock]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        <View style={styles.coverWrap}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Ionicons name="image-outline" size={48} color="#94a3b8" />
            </View>
          )}
          <View style={[styles.coverOverlayRow, { paddingTop: insets.top + 6 }]}>
            <Pressable onPress={() => router.back()} style={styles.coverIconBtn} hitSlop={12}>
              <Text style={styles.coverBackText}>‹</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityLabel="Edit event"
              onPress={() => setShowEditModal(true)}
              style={({ pressed }) => [styles.coverIconBtn, pressed && styles.coverIconBtnPressed]}
              hitSlop={12}
            >
              <Ionicons name="create-outline" size={sizes.headerIcon} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroEyebrow}>
            <View style={styles.heroEyebrowLeftWrap}>
              <Text style={styles.heroEyebrowType} numberOfLines={1}>
                {eventTypeDisplay(event, eventTypeRows)}
              </Text>
              {locationMode && locationTone && locationBadgeLabel ? (
                <View
                  style={[
                    styles.locationModePill,
                    { backgroundColor: locationTone.bg, borderColor: locationTone.border },
                  ]}
                >
                  <Text style={[styles.locationModePillText, { color: locationTone.text }]} numberOfLines={1}>
                    {locationBadgeLabel}
                  </Text>
                </View>
              ) : null}
            </View>
            {startCountdown ? (
              <Text style={styles.heroEyebrowRight} numberOfLines={1}>
                {startCountdown}
              </Text>
            ) : null}
          </View>
          <Text style={styles.heroTitle}>{eventTitle(event)}</Text>
          {heroDateTimeLine ? (
            <Text style={styles.heroDateTimeLine}>{heroDateTimeLine}</Text>
          ) : (
            <Text style={styles.heroDateTimeLineMuted}>No date scheduled</Text>
          )}
          {physicalLocation.trim() || meetingUrl ? (
            <View
              style={[
                styles.heroLocationRow,
                !physicalLocation.trim() && meetingUrl ? styles.heroLocationRowLinkOnly : null,
              ]}
            >
              {physicalLocation.trim() ? (
                <Text style={styles.heroLocation} numberOfLines={4}>
                  {physicalLocation}
                </Text>
              ) : null}
              {meetingUrl ? (
                <Pressable
                  style={({ pressed }) => [styles.heroMeetingLinkBtn, pressed && styles.heroMeetingLinkBtnPressed]}
                  onPress={() => void Linking.openURL(meetingUrlOpenable(meetingUrl))}
                  onLongPress={() => {
                    void Clipboard.setStringAsync(meetingUrl).then(() => Alert.alert("Link copied"));
                  }}
                  delayLongPress={380}
                  accessibilityRole="button"
                  accessibilityLabel="Open meeting link"
                  accessibilityHint="Opens in browser. Long press to copy the link."
                >
                  <Ionicons name="link" size={24} color={colors.accent} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentBar}>
          {tabs.map((t) => {
            const active = tab === t;
            return (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.segmentItem, active && styles.segmentItemActive]}>
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
                  {t[0].toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <Text style={styles.helper}>Loading event...</Text>
        ) : tab === "details" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Details</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>About Event</Text>
                <Text style={styles.infoValue}>{String((event?.notes as string) || "No description added yet.")}</Text>
              </View>
              {customFields && Object.keys(customFields).length > 0
                ? Object.entries(customFields).map(([k, v]) => (
                    <View key={k} style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{customFieldLabelFromKey(k)}</Text>
                      <Text style={styles.infoValue}>
                        {v != null && typeof v === "string" ? displayMemberWords(v) : String(v)}
                      </Text>
                    </View>
                  ))
                : null}
            </View>
        ) : tab === "program" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Program</Text>
              {programParts.length === 0 ? (
                <Text style={styles.helper}>No program items yet.</Text>
              ) : (
                programParts.map((part, idx) => (
                  <View key={part.id} style={styles.block}>
                    <Text style={styles.blockTitle}>Part {idx + 1}: {part.title}</Text>
                    {!!part.notes && <Text style={styles.bodyText}>{part.notes}</Text>}
                    {part.items.length === 0 ? (
                      <Text style={styles.bodyText}>No activities in this part.</Text>
                    ) : (
                      part.items.map((item) => (
                        <View key={item.id} style={styles.programItem}>
                          <Text style={styles.rowPrimary}>{displayMemberWords(item.title)}</Text>
                          <Text style={styles.rowMeta}>{[item.start_time, item.end_time].filter(Boolean).join(" - ") || "Time not set"}</Text>
                          {!!item.notes && <Text style={styles.bodyText}>{item.notes}</Text>}
                        </View>
                      ))
                    )}
                  </View>
                ))
              )}
            </View>
        ) : tab === "files" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Files</Text>
              {attachments.length === 0 ? (
                <Text style={styles.helper}>No files attached.</Text>
              ) : (
                attachments.map((a, idx) => {
                  const rowKey = `${String(a.storage_path || a.url || idx)}`;
                  const busy = downloadingAttachmentKey === rowKey;
                  return (
                    <Pressable
                      key={rowKey}
                      style={({ pressed }) => [styles.row, pressed && !busy && { opacity: 0.92 }]}
                      onPress={() => void handleDownloadAttachment(a, rowKey)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Download ${String(a.name || "file")}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowPrimary}>
                          {displayMemberWords(String(a.name || "Attachment"))}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {String(a.content_type || "Unknown type")}
                          {typeof a.size_bytes === "number" ? ` - ${a.size_bytes} bytes` : ""}
                        </Text>
                        <Text style={[styles.rowMeta, { marginTop: 4, color: colors.accent }]}>Tap to download</Text>
                      </View>
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Ionicons name="download-outline" size={22} color={colors.accent} />
                      )}
                    </Pressable>
                  );
                })
              )}
            </View>
        ) : tab === "group" ? (
            <View style={styles.card}>
              {linkedGroups.length === 0 ? (
                <Text style={styles.helper}>No linked ministries.</Text>
              ) : (
                linkedGroups.map((g, idx) => (
                  <Pressable
                    key={String(g.id || idx)}
                    style={styles.row}
                    onPress={() => g.id && router.push({ pathname: "/ministry/[id]", params: { id: String(g.id) } })}
                  >
                    <Text style={styles.rowPrimary}>{displayMemberWords(String(g.name || "Ministry"))}</Text>
                    <Text style={styles.rowMeta}>›</Text>
                  </Pressable>
                ))
              )}
            </View>
        ) : tab === "attendance" ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Attendance</Text>
              <Text style={styles.bodyText}>Roster members: {audienceMembers.length}</Text>
              <View style={styles.statsRow}>
                <Text style={styles.statPill}>Present {summary.present}</Text>
                <Text style={styles.statPill}>Absent {summary.absent}</Text>
                <Text style={styles.statPill}>Not sure {summary.unsure}</Text>
                <Text style={styles.statPill}>Not marked {summary.notMarked}</Text>
              </View>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search roster"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.filterRow}>
                <FilterTriggerButton
                  ref={statusTriggerRef}
                  valueLabel={statusLabelValue}
                  open={menuOpen === "status"}
                  accessibilityLabel={`Attendance status ${statusLabelValue}`}
                  onPress={() => openMenu("status")}
                />
                <FilterTriggerButton
                  ref={groupTriggerRef}
                  valueLabel={groupLabelValue}
                  open={menuOpen === "group"}
                  accessibilityLabel={`Attendance group ${groupLabelValue}`}
                  onPress={() => openMenu("group")}
                />
              </View>
              <View style={styles.attendanceHeaderRow}>
                <Pressable style={styles.selectAllBtn} onPress={toggleSelectAllFiltered}>
                  <Ionicons
                    name={allFilteredSelected ? "checkbox" : someFilteredSelected ? "remove-circle-outline" : "square-outline"}
                    size={18}
                    color={colors.accent}
                  />
                  <Text style={styles.selectAllText}>
                    Select all{filteredMembers.length !== audienceMembers.length ? ` (${filteredMembers.length})` : ""}
                  </Text>
                </Pressable>
                <View style={styles.viewToggle}>
                  <Pressable style={[styles.toggleBtn, attendanceView === "list" && styles.toggleBtnActive]} onPress={() => setAttendanceView("list")}>
                    <Ionicons name="list" size={16} color={attendanceView === "list" ? "#ffffff" : colors.textSecondary} />
                  </Pressable>
                  <Pressable style={[styles.toggleBtn, attendanceView === "grid" && styles.toggleBtnActive]} onPress={() => setAttendanceView("grid")}>
                    <Ionicons name="grid" size={16} color={attendanceView === "grid" ? "#ffffff" : colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
              {filteredMembers.length === 0 ? (
                <Text style={styles.helper}>No members match current filters.</Text>
              ) : attendanceView === "list" ? (
                filteredMembers.map((member) => {
                  const current = effectiveStatus(member.id);
                  const active = selected.has(member.id);
                  const tone = statusTone(current);
                  const cardTone = statusCardTone(current);
                  return (
                    <Pressable
                      key={member.id}
                      style={[
                        styles.attendanceRow,
                        { backgroundColor: cardTone.bg, borderColor: cardTone.border },
                        active && styles.attendanceRowSelected,
                      ]}
                      onPress={() => toggleSelected(member.id)}
                    >
                      <Ionicons name={active ? "checkbox" : "square-outline"} size={18} color={active ? colors.accent : colors.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowPrimary}>{memberLabel(member)}</Text>
                        <Text style={styles.rowMeta}>{statusLabel(current)}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                        <Text style={[styles.statusBadgeText, { color: tone.text }]}>{statusLabel(current)}</Text>
                      </View>
                    </Pressable>
                  );
                })
              ) : (
                <View style={styles.gridWrap}>
                  {filteredMembers.map((member) => {
                    const current = effectiveStatus(member.id);
                    const active = selected.has(member.id);
                    const tone = statusTone(current);
                    const cardTone = statusCardTone(current);
                    const imageUrl = typeof member.memberimage_url === "string" ? normalizeImageUri(member.memberimage_url) : null;
                    const initial = memberLabel(member).charAt(0).toUpperCase() || "M";
                    return (
                      <Pressable
                        key={member.id}
                        style={[
                          styles.gridCard,
                          { backgroundColor: cardTone.bg, borderColor: cardTone.border },
                          active && styles.gridCardSelected,
                        ]}
                        onPress={() => toggleSelected(member.id)}
                      >
                        <Ionicons name={active ? "checkbox" : "square-outline"} size={18} color={active ? colors.accent : colors.textSecondary} style={styles.gridCheckbox} />
                        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.avatar} /> : <MemberInitialAvatar initial={initial} size={52} />}
                        <Text style={styles.gridName} numberOfLines={2}>{memberLabel(member)}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                          <Text style={[styles.statusBadgeText, { color: tone.text }]}>{statusLabel(current)}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
        ) : null}
      </ScrollView>

      {selected.size > 0 ? (
        <View style={styles.bottomDock}>
          <Text style={styles.bottomDockTitle}>{selected.size} selected</Text>
          <Text style={styles.bottomDockSub}>Set attendance status for selected members</Text>
          <View style={styles.bottomDockActions}>
            {(
              [
                ["present", "Present"],
                ["absent", "Absent"],
                ["unsure", "Not sure"],
                ["not_marked", "Clear"],
              ] as Array<[AttendanceStatus, string]>
            ).map(([status, label]) => (
              <Pressable
                key={status}
                style={[styles.bottomActionBtn, saving && styles.bottomActionBtnDisabled]}
                disabled={saving}
                onPress={() => {
                  void applyStatusToSelected(status);
                }}
              >
                {saving ? <ActivityIndicator size="small" color="#111111" /> : <Text style={styles.bottomActionText}>{label}</Text>}
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.clearSelectionBtn} onPress={() => setSelected(new Set())}>
            <Text style={styles.clearSelectionText}>Clear selection</Text>
          </Pressable>
        </View>
      ) : null}

      <EventUpsertModal
        visible={showEditModal}
        editingEvent={event}
        onClose={() => setShowEditModal(false)}
        onSaved={() => {
          void reloadDetail();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 16, gap: 12, paddingBottom: 28 },
  containerWithDock: { paddingBottom: 220 },
  coverWrap: {
    marginHorizontal: -16,
    height: 220,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
  },
  coverImage: { width: "100%", height: "100%" },
  coverPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e2e8f0",
  },
  coverOverlayRow: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  coverIconBtn: {
    width: sizes.headerIconButton,
    height: sizes.headerIconButton,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  coverIconBtnPressed: { opacity: 0.88 },
  coverBackText: { color: colors.textPrimary, fontSize: type.title.size, fontWeight: type.bodyStrong.weight },
  heroCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heroEyebrowLeftWrap: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  heroEyebrowType: {
    flexShrink: 1,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  locationModePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  locationModePillText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: "700",
  },
  heroEyebrowRight: {
    flexShrink: 0,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.caption.weight,
  },
  heroTitle: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    letterSpacing: type.pageTitle.letterSpacing,
    color: colors.textPrimary,
  },
  heroDateTimeLine: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  heroDateTimeLineMuted: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  heroLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "stretch",
  },
  heroLocationRowLinkOnly: {
    justifyContent: "flex-end",
  },
  heroLocation: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.body.letterSpacing,
    flex: 1,
    minWidth: 0,
  },
  heroMeetingLinkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSurface,
    flexShrink: 0,
  },
  heroMeetingLinkBtnPressed: { opacity: 0.88 },
  countdown: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginTop: 2,
  },
  segmentBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    gap: 3,
    backgroundColor: colors.accentSurface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentBorder,
  },
  segmentItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.sm - 2,
    minHeight: 44,
    justifyContent: "center",
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
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { fontSize: type.bodyStrong.size, fontWeight: type.bodyStrong.weight, color: colors.textPrimary },
  bodyText: { fontSize: type.body.size, color: colors.textSecondary },
  block: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    backgroundColor: colors.card,
    gap: 4,
  },
  blockTitle: { fontSize: type.caption.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowPrimary: { fontSize: type.bodyStrong.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  rowMeta: { fontSize: type.caption.size, color: colors.textSecondary },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statPill: {
    fontSize: type.caption.size,
    color: colors.accent,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSurface,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    fontWeight: type.bodyStrong.weight,
  },
  infoRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#fafafa",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  infoLabel: { fontSize: type.caption.size, color: colors.textSecondary },
  infoValue: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  infoValueMuted: { fontSize: type.body.size, color: colors.textPrimary },
  locationDetailCol: { gap: 4, alignSelf: "stretch" },
  meetingLink: {
    fontSize: type.body.size,
    fontWeight: type.bodyStrong.weight,
    color: colors.accent,
    textDecorationLine: "underline",
  },
  infoValueCol: { flex: 1, alignItems: "flex-end", gap: 2 },
  programItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
    marginTop: 6,
    gap: 3,
  },
  searchWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: type.body.size,
    color: colors.textPrimary,
  },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  attendanceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  selectAllText: { fontSize: type.caption.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  viewToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 2,
    gap: 2,
  },
  toggleBtn: { width: 28, height: 28, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  toggleBtnActive: { backgroundColor: "#1f2937" },
  attendanceRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  attendanceRowSelected: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  statusBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: "600" },
  gridWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridCard: {
    width: "47%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 10,
    alignItems: "center",
    gap: 8,
  },
  gridCardSelected: {
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  gridCheckbox: { alignSelf: "flex-start" },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: "#f1f5f9" },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  gridName: { fontSize: type.caption.size, fontWeight: type.bodyStrong.weight, color: colors.textPrimary, textAlign: "center" },
  helper: { fontSize: type.body.size, color: colors.textSecondary },
  bottomDock: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 8,
  },
  bottomDockTitle: {
    fontSize: type.bodyStrong.size,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
    textAlign: "center",
  },
  bottomDockSub: { fontSize: type.caption.size, color: colors.textSecondary, textAlign: "center" },
  bottomDockActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  bottomActionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 78,
    alignItems: "center",
  },
  bottomActionBtnDisabled: { opacity: 0.7 },
  bottomActionText: { fontSize: type.caption.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  clearSelectionBtn: { alignItems: "center", paddingVertical: 6 },
  clearSelectionText: { fontSize: type.caption.size, color: colors.textSecondary, fontWeight: type.bodyStrong.weight },
});
