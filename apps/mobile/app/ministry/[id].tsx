import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EventItem, EventTypeRow, Group, GroupMemberItem, GroupRequestItem, TaskItem } from "@sheepmug/shared-api";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AnchorRect } from "../../components/FilterPickerModal";
import { FilterPickerModal } from "../../components/FilterPickerModal";
import { FilterTriggerButton } from "../../components/FilterTriggerButton";
import { MemberInitialAvatar } from "../../components/MemberInitialAvatar";
import { TaskAssignmentList } from "../../components/TaskAssignmentList";
import { CreateSubgroupModal } from "../../components/CreateSubgroupModal";
import { MinistriesGrid } from "../../components/MinistriesGrid";
import { api } from "../../lib/api";
import { formatEventLocationSummary } from "../../lib/eventLocation";
import { eventTypeSlugFromEvent, labelForEventTypeSlug, normalizeEventTypeSlug } from "../../lib/eventTypeDisplay";
import { getGroupShareUrls } from "../../lib/groupPublicUrls";
import { normalizeImageUri } from "../../lib/imageUri";
import {
  displayMemberWords,
  formatCalendarCountdown,
  formatCompactWeekdayDate,
  formatLongWeekdayDate,
  formatLongWeekdayDateTime,
} from "../../lib/memberDisplayFormat";
import { sortMinistriesGroups } from "../../lib/ministriesOrder";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../hooks/usePermissions";
import { getOfflineResourceCache, setOfflineResourceCache } from "../../lib/storage";
import { colors, radius, sizes, type } from "../../theme";

type MinistryTab = "subgroups" | "members" | "events" | "tasks" | "requests";

const TAB_ORDER: MinistryTab[] = ["members", "events", "tasks", "requests", "subgroups"];

function tabLabel(t: MinistryTab): string {
  if (t === "requests") return "Requests";
  return t[0].toUpperCase() + t.slice(1);
}

function joinRequestDisplayName(r: GroupRequestItem): string {
  const fn = (r.first_name || "").trim();
  const ln = (r.last_name || "").trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return (r.full_name || "").trim() || "Applicant";
}

function groupCoverUri(g: Group | null): string | null {
  if (!g) return null;
  const raw = (g as { cover_image_url?: string | null }).cover_image_url;
  return typeof raw === "string" && raw.trim() ? normalizeImageUri(raw.trim()) : null;
}

/** GET /api/group-members returns junction rows with nested `members` (see server + web `embeddedMemberName`). */
type GroupMemberApiRow = GroupMemberItem & {
  member_id?: string;
  members?:
    | {
        id?: string;
        first_name?: string | null;
        last_name?: string | null;
        memberimage_url?: string | null;
        status?: string | null;
      }
    | {
        id?: string;
        first_name?: string | null;
        last_name?: string | null;
        memberimage_url?: string | null;
        status?: string | null;
      }[]
    | null;
};

function embeddedMember(row: GroupMemberApiRow) {
  const m = row.members;
  if (Array.isArray(m)) return m[0] ?? null;
  if (m && typeof m === "object") return m;
  return null;
}

function groupMemberDirectoryId(row: GroupMemberApiRow): string {
  if (typeof row.member_id === "string" && row.member_id.trim()) return row.member_id.trim();
  const e = embeddedMember(row);
  if (e?.id && typeof e.id === "string") return e.id;
  return row.id;
}

function groupMemberDisplayName(row: GroupMemberApiRow): string {
  const e = embeddedMember(row);
  if (e) {
    const n = `${e.first_name || ""} ${e.last_name || ""}`.trim();
    if (n) return n;
  }
  const flat = `${row.first_name || ""} ${row.last_name || ""}`.trim();
  return flat || "Member";
}

function firstValidMemberImageUri(m: GroupMemberItem): string | null {
  const candidates = [m.avatar_url, m.member_url, (m as { profile_image?: string }).profile_image];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function groupMemberImageUri(row: GroupMemberApiRow): string | null {
  const fromFlat = firstValidMemberImageUri(row);
  if (fromFlat) return fromFlat;
  const e = embeddedMember(row);
  const raw = e?.memberimage_url;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function groupMemberStatusLabel(row: GroupMemberApiRow): string {
  const e = embeddedMember(row);
  if (e?.status != null && String(e.status).trim()) return String(e.status);
  return String(row.status || "active");
}

/** —— Events list (parity with `event` tab) —— */
type WhenFilter = "all" | "upcoming" | "past";
const WHEN_OPTIONS: { id: WhenFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
];

function eventTitle(e: EventItem): string {
  const r = e as EventItem & { title?: string };
  return displayMemberWords(String(r.title || e.name || "Untitled event"));
}

function eventStartMs(e: EventItem): number | null {
  const r = e as EventItem & { start_time?: string | null };
  const raw = r.start_time ?? e.start_date;
  if (!raw || !String(raw).trim()) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

function eventTypeLabel(e: EventItem, rows: EventTypeRow[]): string | null {
  return labelForEventTypeSlug(eventTypeSlugFromEvent(e), rows);
}

function formatEventListMeta(e: EventItem): string {
  const r = e as EventItem & {
    start_time?: string | null;
    location_details?: string | null;
    online_meeting_url?: string | null;
    location?: string | null;
    groups?: { name?: string | null } | null;
  };
  const raw = r.start_time ?? e.start_date;
  let dateLine = "";
  if (raw && String(raw).trim()) {
    dateLine = formatLongWeekdayDateTime(String(raw)) || "";
  }
  const countdown = raw && String(raw).trim() ? formatCalendarCountdown(String(raw)) : "";
  const loc = formatEventLocationSummary(r).trim();
  const g = r.groups;
  const groupName =
    g && typeof g === "object" && g !== null && typeof g.name === "string" ? g.name.trim() : "";
  const groupDisplay = groupName ? displayMemberWords(groupName) : "";
  return [dateLine, countdown, loc, groupDisplay].filter(Boolean).join(" · ");
}

function eventCoverImageUrl(e: EventItem): string | null {
  const r = e as EventItem & { cover_image_url?: string | null };
  const raw = r.cover_image_url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeImageUri(raw.trim());
}

function eventSearchBlob(e: EventItem): string {
  const r = e as Record<string, unknown>;
  const g = r.groups;
  let groupName = "";
  if (g && typeof g === "object" && g !== null && "name" in g) {
    groupName = String((g as { name?: unknown }).name ?? "");
  }
  const parts: string[] = [];
  for (const x of [eventTitle(e), r.event_type, r.location_details, r.location, r.online_meeting_url, r.notes, groupName]) {
    if (x != null && String(x).trim()) parts.push(String(x).toLowerCase());
  }
  return parts.join(" ");
}

function EventCoverThumb({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={eventStyles.thumbPlaceholder} accessibilityLabel="No event image">
        <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={eventStyles.thumbImage}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

const HEADER_LINK_MENU_W = 232;

export default function MinistryDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { id, highlight: highlightParam, tab: tabParam, openRequestId: openRequestIdParam } = useLocalSearchParams<{
    id: string;
    highlight?: string;
    tab?: string;
    openRequestId?: string;
  }>();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canApproveGroupRequests = can("approve_group_requests");
  const canViewGroupRequests = can("view_group_requests") || can("approve_group_requests");
  const canManageGroups = can("manage_groups");

  const canSeeMinistryTasksTab = useMemo(() => {
    if (user?.is_org_owner === true || user?.is_super_admin === true) return true;
    return (
      can("view_group_tasks") ||
      can("view_member_tasks") ||
      can("monitor_group_tasks") ||
      can("manage_group_tasks") ||
      can("manage_group_task_checklist") ||
      can("complete_group_task_checklist") ||
      can("monitor_member_tasks") ||
      can("manage_member_tasks") ||
      can("manage_member_task_checklist") ||
      can("complete_member_task_checklist")
    );
  }, [can, user?.is_org_owner]);

  const visibleTabs = useMemo(() => {
    const base = TAB_ORDER.filter((t) => t !== "tasks" || canSeeMinistryTasksTab);
    if (!canViewGroupRequests) return base.filter((t) => t !== "requests");
    return base;
  }, [canSeeMinistryTasksTab, canViewGroupRequests]);

  const [tab, setTab] = useState<MinistryTab>("members");
  const [group, setGroup] = useState<Group | null>(null);
  const isAllMembersGroup = useMemo(
    () => (group as { system_kind?: string | null } | null)?.system_kind === "all_members",
    [group],
  );
  const [subgroups, setSubgroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<GroupMemberApiRow[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventTypeRows, setEventTypeRows] = useState<EventTypeRow[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [requests, setRequests] = useState<GroupRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [requestModal, setRequestModal] = useState<GroupRequestItem | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerMenuRect, setHeaderMenuRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [linkQrKind, setLinkQrKind] = useState<null | "public" | "join">(null);
  const [createSubgroupOpen, setCreateSubgroupOpen] = useState(false);
  const overflowMenuRef = useRef<View>(null);

  const [memberSearch, setMemberSearch] = useState("");
  const [assignedRangeStart, setAssignedRangeStart] = useState("");
  const [assignedRangeEnd, setAssignedRangeEnd] = useState("");
  const [pulseHighlightIds, setPulseHighlightIds] = useState<string[]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [whenFilter, setWhenFilter] = useState<WhenFilter>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [eventMenuOpen, setEventMenuOpen] = useState<null | "when" | "type">(null);
  const [eventFilterAnchor, setEventFilterAnchor] = useState<AnchorRect | null>(null);
  const eventWhenTriggerRef = useRef<View>(null);
  const eventTypeTriggerRef = useRef<View>(null);

  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const cacheKey = `ministry:detail:${id}`;
      const cached = await getOfflineResourceCache<{
        group: Group | null;
        subgroups: Group[];
        members: GroupMemberApiRow[];
        events: EventItem[];
        eventTypeRows: EventTypeRow[];
        tasks: TaskItem[];
        requests: GroupRequestItem[];
      }>(cacheKey);
      if (cached?.data) {
        setGroup(cached.data.group ?? null);
        setSubgroups(Array.isArray(cached.data.subgroups) ? sortMinistriesGroups(cached.data.subgroups) : []);
        setMembers(Array.isArray(cached.data.members) ? cached.data.members : []);
        setEvents(Array.isArray(cached.data.events) ? cached.data.events : []);
        setEventTypeRows(Array.isArray(cached.data.eventTypeRows) ? cached.data.eventTypeRows : []);
        setTasks(Array.isArray(cached.data.tasks) ? cached.data.tasks : []);
        setRequests(Array.isArray(cached.data.requests) ? cached.data.requests : []);
      }
      const [detail, sgRows, memberRows, eventRows, typeRows, taskRowsResult, requestRows] = await Promise.all([
        api.groups.detail(id),
        api.groups.list({ parent_group_id: id, limit: 100 }),
        api.groups.members(id),
        api.groups.events(id),
        api.eventTypes.list(),
        canSeeMinistryTasksTab
          ? (async () => {
              try {
                const rows = await api.groups.tasks(id);
                return { rows, error: null as string | null };
              } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Could not load group tasks";
                return { rows: [] as TaskItem[], error: message };
              }
            })()
          : Promise.resolve({ rows: [] as TaskItem[], error: null as string | null }),
        api.groups.requests(id),
      ]);
      setGroup((detail ?? null) as Group | null);
      setSubgroups(Array.isArray(sgRows) ? sortMinistriesGroups(sgRows) : []);
      setMembers(memberRows);
      setEvents(eventRows);
      setEventTypeRows(
        [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      );
      setTasks(taskRowsResult.rows);
      setTaskLoadError(taskRowsResult.error);
      setRequests(requestRows);
      await setOfflineResourceCache(cacheKey, {
        group: (detail ?? null) as Group | null,
        subgroups: Array.isArray(sgRows) ? sgRows : [],
        members: Array.isArray(memberRows) ? memberRows : [],
        events: Array.isArray(eventRows) ? eventRows : [],
        eventTypeRows: [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
        tasks: taskRowsResult.rows,
        requests: Array.isArray(requestRows) ? requestRows : [],
      });
    } catch {
      // keep cached state when offline/network errors happen
    } finally {
      setLoading(false);
    }
  }, [id, canSeeMinistryTasksTab]);

  useEffect(() => {
    void (async () => {
      if (!id) return;
      await loadAll();
    })();
  }, [id, loadAll]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(visibleTabs[0] ?? "members");
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    const t = typeof tabParam === "string" ? tabParam.trim().toLowerCase() : "";
    if (t === "requests" && visibleTabs.includes("requests")) {
      setTab("requests");
    }
  }, [tabParam, visibleTabs]);

  const parsedOpenRequestId = useMemo(() => {
    const raw =
      typeof openRequestIdParam === "string"
        ? openRequestIdParam
        : Array.isArray(openRequestIdParam) && openRequestIdParam[0]
          ? String(openRequestIdParam[0])
          : "";
    const t = raw.trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t : "";
  }, [openRequestIdParam]);

  /** Push / in-app: open request detail modal for `openRequestId` (same pattern as member join requests). */
  useEffect(() => {
    if (!parsedOpenRequestId || !canViewGroupRequests || loading) return;
    const rq = requests.find((r) => r.id === parsedOpenRequestId);
    if (!rq) {
      router.setParams({ openRequestId: undefined });
      return;
    }
    setRequestModal(rq);
    router.setParams({ openRequestId: undefined });
  }, [parsedOpenRequestId, canViewGroupRequests, loading, requests, router]);

  const { publicPageUrl, joinPageUrl } = useMemo(() => getGroupShareUrls(group), [group]);
  const coverUri = useMemo(() => groupCoverUri(group), [group]);

  const linkQrUrl = useMemo(() => {
    if (linkQrKind === "public") return publicPageUrl;
    if (linkQrKind === "join") return joinPageUrl;
    return "";
  }, [linkQrKind, publicPageUrl, joinPageUrl]);

  const qrImageUrl = useMemo(() => {
    const u = linkQrUrl.trim();
    if (!u) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(u)}`;
  }, [linkQrUrl]);

  const linkQrModalCopy = useMemo(() => {
    if (linkQrKind === "public") {
      return {
        subtitle:
          "Scan this code to open this ministry’s public page. Visitors can see your group’s public information.",
        emptyHint: !group?.public_link_slug?.toString().trim()
          ? "Add a public slug on the web ministry settings to enable this link."
          : "Public page is turned off or unavailable.",
        openLabel: "Open public page URL",
        unavailableTitle: "Public page unavailable",
      };
    }
    if (linkQrKind === "join") {
      return {
        subtitle:
          "Scan this code to open the self-serve join request form. New applicants can submit their details here.",
        emptyHint: "Enable the join link for this group on the web to share a join URL.",
        openLabel: "Open join request URL",
        unavailableTitle: "Join link unavailable",
      };
    }
    return null;
  }, [linkQrKind, group?.public_link_slug]);

  const closeHeaderMenu = useCallback(() => {
    setHeaderMenuOpen(false);
    setHeaderMenuRect(null);
  }, []);

  const openHeaderMenu = useCallback(() => {
    overflowMenuRef.current?.measureInWindow((x, y, w, h) => {
      setHeaderMenuRect({ x, y, width: w, height: h });
      setHeaderMenuOpen(true);
    });
  }, []);

  const eventTypeFilterOptions = useMemo(() => {
    return eventTypeRows
      .map((r) => {
        const slug = normalizeEventTypeSlug(r.slug);
        if (!slug) return null;
        return {
          slug,
          label: displayMemberWords(String(r.name || r.slug)) || slug,
        };
      })
      .filter((x): x is { slug: string; label: string } => Boolean(x));
  }, [eventTypeRows]);

  useEffect(() => {
    if (eventTypeFilter === "all") return;
    if (!eventTypeFilterOptions.some((o) => o.slug === eventTypeFilter)) setEventTypeFilter("all");
  }, [eventTypeFilterOptions, eventTypeFilter]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    const now = Date.now();
    return events.filter((e) => {
      if (q && !eventSearchBlob(e).includes(q)) return false;
      const startMs = eventStartMs(e);
      if (whenFilter === "upcoming") {
        if (startMs === null) return false;
        if (startMs < now) return false;
      } else if (whenFilter === "past") {
        if (startMs === null) return false;
        if (startMs >= now) return false;
      }
      if (eventTypeFilter !== "all") {
        const slug = eventTypeSlugFromEvent(e);
        if (slug !== eventTypeFilter) return false;
      }
      return true;
    });
  }, [events, eventSearch, whenFilter, eventTypeFilter]);

  const whenLabel = WHEN_OPTIONS.find((o) => o.id === whenFilter)?.label ?? "All";
  const typeButtonLabel =
    eventTypeFilter === "all"
      ? "All"
      : eventTypeFilterOptions.find((o) => o.slug === eventTypeFilter)?.label ?? "Type";

  const highlightMemberIds = useMemo(() => {
    const h = typeof highlightParam === "string" ? highlightParam : Array.isArray(highlightParam) ? highlightParam[0] : "";
    if (!h?.trim()) return [] as string[];
    return h
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [highlightParam]);

  function memberAssignedMs(m: GroupMemberApiRow): number | null {
    const r = m as Record<string, unknown>;
    const raw = r.joined_at ?? r.created_at ?? r.joined_date;
    if (raw == null || !String(raw).trim()) return null;
    const t = new Date(String(raw)).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    let list = members;
    if (q) {
      list = members.filter((m) => {
        const blob = `${groupMemberDisplayName(m)} ${groupMemberStatusLabel(m)}`.toLowerCase();
        return blob.includes(q);
      });
    }
    if (assignedRangeStart || assignedRangeEnd) {
      const startMs = assignedRangeStart
        ? new Date(`${assignedRangeStart}T00:00:00`).getTime()
        : null;
      const endMs = assignedRangeEnd
        ? new Date(`${assignedRangeEnd}T23:59:59.999`).getTime()
        : null;
      list = list.filter((m) => {
        const ms = memberAssignedMs(m);
        if (ms == null) return false;
        if (startMs != null && Number.isFinite(startMs) && ms < startMs) return false;
        if (endMs != null && Number.isFinite(endMs) && ms > endMs) return false;
        return true;
      });
    }
    return [...list].sort((a, b) => {
      const ma = memberAssignedMs(a);
      const mb = memberAssignedMs(b);
      if (ma != null && mb != null) return mb - ma;
      if (mb != null) return 1;
      if (ma != null) return -1;
      return 0;
    });
  }, [members, memberSearch, assignedRangeStart, assignedRangeEnd]);

  useEffect(() => {
    if (highlightMemberIds.length === 0) return;
    setTab("members");
    setPulseHighlightIds(highlightMemberIds);
    const t = setTimeout(() => setPulseHighlightIds([]), 4000);
    return () => clearTimeout(t);
  }, [highlightMemberIds.join(",")]);

  async function runRequestAction(kind: "approve" | "reject" | "ignore", requestId: string) {
    if (!canApproveGroupRequests) return;
    const go = () =>
      (async () => {
        setActingId(requestId);
        try {
          if (kind === "approve") await api.groupRequests.approve(requestId);
          else if (kind === "reject") await api.groupRequests.reject(requestId);
          else await api.groupRequests.ignore(requestId);
          setRequestModal(null);
          await loadAll();
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Request failed";
          Alert.alert("Group request", msg);
        } finally {
          setActingId(null);
        }
      })();

    if (kind === "reject") {
      Alert.alert("Decline request", "Decline this join request?", [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => void go() },
      ]);
      return;
    }
    if (kind === "ignore") {
      Alert.alert(
        "Ignore request",
        "Ignore removes it from the pending list without adding them to the group.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Ignore", onPress: () => void go() },
        ]
      );
      return;
    }
    await go();
  }

  const busy = actingId !== null;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  const eventPickerTitle = eventMenuOpen === "when" ? "When" : eventMenuOpen === "type" ? "Type" : "";
  const eventPickerOptions =
    eventMenuOpen === "when"
      ? WHEN_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
      : eventMenuOpen === "type"
        ? [
            { value: "all", label: "All" },
            ...eventTypeFilterOptions.map((o) => ({ value: o.slug, label: o.label })),
          ]
        : [];
  const eventPickerSelected =
    eventMenuOpen === "when" ? whenFilter : eventMenuOpen === "type" ? eventTypeFilter : "";

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        keyboardShouldPersistTaps="handled"
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
            <View ref={overflowMenuRef} collapsable={false}>
              <Pressable
                accessibilityLabel="Public page and join link options"
                onPress={openHeaderMenu}
                style={({ pressed }) => [styles.coverIconBtn, pressed && styles.coverIconBtnPressed]}
                hitSlop={12}
              >
                <Ionicons name="ellipsis-vertical" size={sizes.headerIcon} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.title}>{displayMemberWords(String(group?.name || "Ministry"))}</Text>
          <Text style={styles.subtitle}>
            {group?.description?.trim() ? displayMemberWords(group.description) : "No description"}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.segmentScroll}
        >
          <View style={styles.segmentWrap}>
            {visibleTabs.map((t) => {
              const active = tab === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                >
                  <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]} numberOfLines={1}>
                    {tabLabel(t)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
        ) : tab === "subgroups" ? (
          <View style={styles.tabPanel}>
            {canManageGroups && !isAllMembersGroup ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create subgroup"
                onPress={() => setCreateSubgroupOpen(true)}
                style={({ pressed }) => [styles.createSubgroupBtn, pressed && styles.createSubgroupBtnPressed]}
              >
                <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.createSubgroupBtnText}>Create subgroup</Text>
              </Pressable>
            ) : null}
            {subgroups.length === 0 ? (
              <Text style={styles.helper}>
                {canManageGroups && !isAllMembersGroup
                  ? "No subgroups under this ministry yet."
                  : "No subgroups under this ministry."}
              </Text>
            ) : (
              <MinistriesGrid
                groups={subgroups}
                onPressItem={(g) => router.push({ pathname: "/ministry/[id]", params: { id: g.id } })}
              />
            )}
          </View>
        ) : tab === "members" ? (
          <View style={styles.tabPanel}>
            <View style={styles.toolbarSearch}>
              <Ionicons name="search" size={sizes.headerIcon} color={colors.textSecondary} style={styles.searchIcon} />
              <TextInput
                value={memberSearch}
                onChangeText={setMemberSearch}
                placeholder="Search…"
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.assignedDateRow}>
              <Text style={styles.assignedDateLabel}>Assigned from</Text>
              <TextInput
                value={assignedRangeStart}
                onChangeText={setAssignedRangeStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                style={styles.assignedDateInput}
                autoCorrect={false}
              />
              <Text style={styles.assignedDateLabel}>to</Text>
              <TextInput
                value={assignedRangeEnd}
                onChangeText={setAssignedRangeEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                style={styles.assignedDateInput}
                autoCorrect={false}
              />
              {(assignedRangeStart || assignedRangeEnd) && (
                <Pressable onPress={() => { setAssignedRangeStart(""); setAssignedRangeEnd(""); }}>
                  <Text style={styles.clearDates}>Clear</Text>
                </Pressable>
              )}
            </View>
            {filteredMembers.length === 0 ? (
              <Text style={styles.helper}>
                {members.length === 0
                  ? "No members in this ministry"
                  : assignedRangeStart || assignedRangeEnd
                    ? "No members in this assigned date range."
                    : "No members match your search."}
              </Text>
            ) : (
              filteredMembers.map((m) => {
                const mid = groupMemberDirectoryId(m);
                const imageUri = normalizeImageUri(groupMemberImageUri(m));
                const displayName = groupMemberDisplayName(m);
                const initial = (displayName.trim()[0] || "M").toUpperCase();
                const rowHighlight =
                  pulseHighlightIds.includes(mid) || highlightMemberIds.includes(mid);
                const r = m as Record<string, unknown>;
                const assignedRaw = r.joined_at ?? r.created_at ?? r.joined_date;
                const assignedLabel =
                  assignedRaw != null && String(assignedRaw).trim()
                    ? formatCompactWeekdayDate(String(assignedRaw))
                    : "";
                return (
                  <Pressable
                    key={mid}
                    style={[styles.memberRow, rowHighlight && styles.memberRowHighlight]}
                    onPress={() => router.push({ pathname: "/member/[id]", params: { id: mid } })}
                  >
                    <View style={styles.memberRowTop}>
                      {imageUri ? (
                        <Image source={{ uri: imageUri }} style={styles.memberAvatar} />
                      ) : (
                        <MemberInitialAvatar initial={initial} size={40} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>
                          {displayMemberWords(displayName)}
                        </Text>
                        <Text style={styles.memberMeta}>
                          {assignedLabel
                            ? `Assigned ${assignedLabel} · ${displayMemberWords(
                                groupMemberStatusLabel(m).replace(/_/g, " ")
                              )}`
                            : displayMemberWords(groupMemberStatusLabel(m).replace(/_/g, " "))}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : tab === "events" ? (
          <View style={styles.tabPanel}>
            <View style={styles.toolbarRow}>
              <View style={styles.toolbarSearch}>
                <Ionicons name="search" size={sizes.headerIcon} color={colors.textSecondary} style={styles.searchIcon} />
                <TextInput
                  value={eventSearch}
                  onChangeText={setEventSearch}
                  placeholder="Search…"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.toolbarFilters}>
                <FilterTriggerButton
                  ref={eventWhenTriggerRef}
                  open={eventMenuOpen === "when"}
                  valueLabel={whenLabel}
                  accessibilityLabel={`When, ${whenLabel}. Double tap to change.`}
                  onPress={() => {
                    eventWhenTriggerRef.current?.measureInWindow((x, y, w, h) => {
                      setEventFilterAnchor({ x, y, width: w, height: h });
                      setEventMenuOpen("when");
                    });
                  }}
                />
                <FilterTriggerButton
                  ref={eventTypeTriggerRef}
                  open={eventMenuOpen === "type"}
                  valueLabel={typeButtonLabel}
                  accessibilityLabel={`Type, ${typeButtonLabel}. Double tap to change.`}
                  onPress={() => {
                    eventTypeTriggerRef.current?.measureInWindow((x, y, w, h) => {
                      setEventFilterAnchor({ x, y, width: w, height: h });
                      setEventMenuOpen("type");
                    });
                  }}
                />
              </View>
            </View>
            <FilterPickerModal
              visible={eventMenuOpen !== null && eventFilterAnchor !== null}
              title={eventPickerTitle}
              options={eventPickerOptions}
              selectedValue={eventPickerSelected}
              anchorRect={eventFilterAnchor}
              onSelect={(v) => {
                if (eventMenuOpen === "when") setWhenFilter(v as WhenFilter);
                else if (eventMenuOpen === "type") setEventTypeFilter(v);
              }}
              onClose={() => {
                setEventMenuOpen(null);
                setEventFilterAnchor(null);
              }}
            />
            {filteredEvents.length === 0 ? (
              <Text style={styles.helper}>
                {events.length === 0 ? "No events linked" : "No events match your search or filters."}
              </Text>
            ) : (
              filteredEvents.map((item) => {
                const typeLbl = eventTypeLabel(item, eventTypeRows);
                const meta = formatEventListMeta(item);
                const coverThumb = eventCoverImageUrl(item);
                return (
                  <Pressable
                    key={item.id}
                    style={({ pressed }) => [eventStyles.card, pressed && eventStyles.cardPressed]}
                    onPress={() => router.push({ pathname: "/event/[id]", params: { id: item.id } })}
                  >
                    <View style={eventStyles.cardRow}>
                      <EventCoverThumb uri={coverThumb} />
                      <View style={eventStyles.cardMain}>
                        <View style={eventStyles.cardTop}>
                          <Text style={eventStyles.cardTitle} numberOfLines={2}>
                            {eventTitle(item)}
                          </Text>
                          {typeLbl ? (
                            <View style={eventStyles.typePill}>
                              <Text style={eventStyles.typePillText} numberOfLines={1}>
                                {typeLbl}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {meta ? (
                          <Text style={eventStyles.cardMeta} numberOfLines={2}>
                            {meta}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : tab === "tasks" ? (
          <View style={styles.tabPanel}>
            {!canSeeMinistryTasksTab ? (
              <Text style={styles.helper}>You do not have permission to view tasks for this ministry.</Text>
            ) : id ? (
              <TaskAssignmentList
                variant="group"
                groupId={String(id)}
                tasks={tasks}
                setTasks={setTasks}
                pageLoading={loading}
                taskLoadError={taskLoadError}
                onAfterGroupTaskCreated={() => void loadAll()}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Join requests</Text>
            {!canViewGroupRequests ? (
              <Text style={styles.helper}>You do not have permission to view group join requests.</Text>
            ) : requests.length === 0 ? (
              <Text style={styles.helper}>No pending requests</Text>
            ) : (
              requests.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.row}
                  onPress={() => setRequestModal(r)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowPrimary}>{displayMemberWords(joinRequestDisplayName(r))}</Text>
                    <Text style={styles.rowMeta}>
                      {r.requested_at || r.created_at
                        ? formatLongWeekdayDateTime(String(r.requested_at || r.created_at))
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.pill}>
                    {displayMemberWords(String(r.status || "pending").replace(/_/g, " "))}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        )}
      </ScrollView>
      <Modal visible={headerMenuOpen} transparent animationType="fade" onRequestClose={closeHeaderMenu}>
        <View style={styles.headerMenuRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeHeaderMenu} accessibilityLabel="Dismiss menu" />
          {headerMenuRect ? (
            <View
              style={[
                styles.headerDropdownCard,
                {
                  top: headerMenuRect.y + headerMenuRect.height + 6,
                  left: Math.min(
                    Math.max(12, headerMenuRect.x + headerMenuRect.width - HEADER_LINK_MENU_W),
                    windowWidth - HEADER_LINK_MENU_W - 12
                  ),
                  width: HEADER_LINK_MENU_W,
                },
              ]}
              pointerEvents="box-none"
            >
              <Pressable
                style={({ pressed }) => [styles.headerDropdownRow, pressed && styles.headerDropdownRowPressed]}
                onPress={() => {
                  closeHeaderMenu();
                  setLinkQrKind("public");
                }}
              >
                <Ionicons name="globe-outline" size={22} color={colors.textPrimary} />
                <Text style={styles.headerDropdownLabel}>Public Page</Text>
              </Pressable>
              <View style={styles.headerDropdownDivider} />
              <Pressable
                style={({ pressed }) => [styles.headerDropdownRow, pressed && styles.headerDropdownRowPressed]}
                onPress={() => {
                  closeHeaderMenu();
                  setLinkQrKind("join");
                }}
              >
                <Ionicons name="link-outline" size={22} color={colors.textPrimary} />
                <Text style={styles.headerDropdownLabel}>Join Request Link</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={linkQrKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLinkQrKind(null)}
      >
        <View style={styles.qrPopupBackdrop}>
          <View style={styles.qrModalCard}>
            <View style={styles.qrBadge}>
              <Ionicons name="qr-code-outline" size={24} color={colors.accent} />
            </View>

            <Text style={styles.qrModalTitle}>Scan QR code</Text>
            <Text style={styles.qrModalSubtitle}>
              {linkQrModalCopy?.subtitle ?? ""}
            </Text>
            <Text style={styles.qrWebHint}>
              Set EXPO_PUBLIC_WEB_ORIGIN to your web app URL so the QR matches your live site.
            </Text>

            {qrImageUrl ? (
              <View style={styles.qrImageWrap}>
                <Image source={{ uri: qrImageUrl }} style={styles.qrImage} />
              </View>
            ) : (
              <Text style={styles.qrEmptyHint}>{linkQrModalCopy?.emptyHint ?? ""}</Text>
            )}

            <View style={styles.qrDividerWrap}>
              <View style={styles.qrDividerLine} />
              <Text style={styles.qrDividerText}>or use this URL manually</Text>
              <View style={styles.qrDividerLine} />
            </View>

            <View style={styles.qrUrlRow}>
              <Text numberOfLines={2} style={styles.qrUrlText}>
                {linkQrUrl.trim() || linkQrModalCopy?.emptyHint || "—"}
              </Text>
              <Pressable
                style={styles.qrUrlActionBtn}
                onPress={() =>
                  linkQrUrl.trim()
                    ? void Linking.openURL(linkQrUrl.trim()).catch(() =>
                        Alert.alert("Unable to open URL", linkQrUrl.trim())
                      )
                    : Alert.alert(
                        linkQrModalCopy?.unavailableTitle ?? "Unavailable",
                        linkQrModalCopy?.emptyHint ?? "This link is not available yet."
                      )
                }
              >
                <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Pressable
              style={styles.qrPrimaryBtn}
              onPress={() =>
                linkQrUrl.trim()
                  ? void Linking.openURL(linkQrUrl.trim()).catch(() =>
                      Alert.alert("Unable to open URL", linkQrUrl.trim())
                    )
                  : Alert.alert(
                      linkQrModalCopy?.unavailableTitle ?? "Unavailable",
                      linkQrModalCopy?.emptyHint ?? "This link is not available yet."
                    )
              }
            >
              <Text style={styles.qrPrimaryBtnText}>{linkQrModalCopy?.openLabel ?? "Open URL"}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </Pressable>

            {qrImageUrl ? (
              <Pressable
                style={styles.qrDownloadBtn}
                onPress={() =>
                  void Linking.openURL(qrImageUrl).catch(() =>
                    Alert.alert("Unable to download QR", "Could not open QR image link.")
                  )
                }
              >
                <Ionicons name="download-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.qrDownloadBtnText}>Download QR image</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.qrCloseBtn} onPress={() => setLinkQrKind(null)}>
              <Text style={styles.qrCloseBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={requestModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setRequestModal(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRequestModal(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {requestModal ? (
              <>
                <Text style={styles.modalTitle}>{joinRequestDisplayName(requestModal)}</Text>
                {requestModal.email ? (
                  <Text style={styles.modalLine}>Email: {String(requestModal.email)}</Text>
                ) : null}
                <Text style={styles.modalLine}>
                  Date of birth:{" "}
                  {requestModal.dob && String(requestModal.dob).trim()
                    ? formatLongWeekdayDate(String(requestModal.dob)) || "—"
                    : "—"}
                </Text>
                <Text style={styles.modalLine}>
                  Requested:{" "}
                  {requestModal.requested_at || requestModal.created_at
                    ? formatLongWeekdayDateTime(String(requestModal.requested_at || requestModal.created_at)) || "—"
                    : "—"}
                </Text>
                <Text style={styles.modalLine}>
                  Source:{" "}
                  {requestModal.member_id ? (
                    <Text style={styles.tagMatch}>Directory match</Text>
                  ) : (
                    <Text style={styles.tagGuest}>Guest application</Text>
                  )}
                </Text>
                {requestModal.groups && typeof requestModal.groups === "object" && requestModal.groups !== null ? (
                  <Text style={styles.modalLine}>
                    Group: {String((requestModal.groups as { name?: string }).name || "—")}
                  </Text>
                ) : null}
                {typeof requestModal.member_id === "string" && requestModal.member_id.length > 0 ? (
                  <Pressable
                    style={styles.viewMemberBtn}
                    onPress={() => {
                      const mid = requestModal.member_id as string;
                      setRequestModal(null);
                      router.push({ pathname: "/member/[id]", params: { id: mid } });
                    }}
                  >
                    <Text style={styles.viewMemberBtnText}>View member</Text>
                  </Pressable>
                ) : null}
                <View style={styles.modalActions}>
                  <Pressable
                    style={[styles.approveBtn, (busy || !canApproveGroupRequests) && styles.btnDisabled]}
                    disabled={busy || !canApproveGroupRequests}
                    onPress={() => void runRequestAction("approve", requestModal.id)}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.ignoreBtn, (busy || !canApproveGroupRequests) && styles.btnDisabled]}
                    disabled={busy || !canApproveGroupRequests}
                    onPress={() => void runRequestAction("ignore", requestModal.id)}
                  >
                    <Text style={styles.ignoreBtnText}>Ignore</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.declineBtn, (busy || !canApproveGroupRequests) && styles.btnDisabled]}
                    disabled={busy || !canApproveGroupRequests}
                    onPress={() => void runRequestAction("reject", requestModal.id)}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </Pressable>
                </View>
                <Pressable style={styles.modalClose} onPress={() => setRequestModal(null)}>
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {id ? (
        <CreateSubgroupModal
          visible={createSubgroupOpen}
          onClose={() => setCreateSubgroupOpen(false)}
          onCreated={() => void loadAll()}
          parentGroupId={id}
          parentGroupName={String(group?.name ?? "")}
        />
      ) : null}
    </SafeAreaView>
  );
}

const eventStyles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  cardPressed: { opacity: 0.94 },
  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  thumbImage: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: "#f1f5f9",
  },
  thumbPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  typePill: {
    maxWidth: "40%",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "#f1f5f9",
  },
  typePillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
  },
  cardMeta: {
    marginTop: 6,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.caption.letterSpacing,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 16, gap: 12, paddingBottom: 28 },
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    padding: 14,
    gap: 6,
  },
  title: { fontSize: type.h2.size, lineHeight: type.h2.lineHeight, fontWeight: type.h2.weight, color: colors.textPrimary },
  subtitle: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.body.letterSpacing,
  },
  segmentScroll: { paddingVertical: 4, gap: 0 },
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
  tabPanel: { gap: 8 },
  sectionTitle: { fontSize: type.bodyStrong.size, fontWeight: type.bodyStrong.weight, color: colors.textPrimary },
  mutedSmall: { fontSize: type.caption.size, color: colors.textSecondary, lineHeight: 18 },
  headerMenuRoot: { flex: 1 },
  headerDropdownCard: {
    position: "absolute",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  headerDropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  headerDropdownRowPressed: { opacity: 0.85, backgroundColor: colors.bg },
  headerDropdownLabel: {
    flex: 1,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: colors.textPrimary,
  },
  headerDropdownDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 14,
  },
  qrPopupBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  qrModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: "#fff",
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: "#eceff3",
    alignItems: "center",
  },
  qrBadge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#dbe0ff",
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -46,
    marginBottom: 10,
  },
  qrModalTitle: {
    fontSize: type.title.size,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.weight,
    color: colors.textPrimary,
    letterSpacing: type.title.letterSpacing,
    textAlign: "center",
  },
  qrModalSubtitle: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    letterSpacing: type.body.letterSpacing,
  },
  qrWebHint: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  qrImageWrap: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    padding: 8,
  },
  qrImage: {
    width: 210,
    height: 210,
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  qrEmptyHint: {
    marginTop: 14,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  qrDividerWrap: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    gap: 8,
  },
  qrDividerLine: { flex: 1, height: 1, backgroundColor: "#e8ebf0" },
  qrDividerText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    letterSpacing: type.caption.letterSpacing,
  },
  qrUrlRow: {
    width: "100%",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    borderRadius: radius.sm,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 10,
    paddingRight: 6,
    gap: 8,
  },
  qrUrlText: {
    flex: 1,
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  qrUrlActionBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  qrPrimaryBtn: {
    width: "100%",
    marginTop: 14,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  qrPrimaryBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  qrDownloadBtn: {
    width: "100%",
    marginTop: 10,
    minHeight: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  qrDownloadBtnText: {
    color: colors.textPrimary,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    fontWeight: type.bodyStrong.weight,
  },
  qrCloseBtn: {
    marginTop: 10,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  qrCloseBtnText: {
    color: colors.textSecondary,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.weight,
  },
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  toolbarSearch: {
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
  toolbarFilters: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 6,
    alignItems: "stretch",
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  /** Match `(tabs)/members.tsx` `row` / `rowTop` / `avatarImage` / `name` / `meta` for list density. */
  memberRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 74,
    padding: 14,
    marginBottom: 4,
  },
  memberRowHighlight: {
    borderWidth: 2,
    borderColor: "#f59e0b",
  },
  assignedDateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  assignedDateLabel: { fontSize: type.caption.size, color: colors.textSecondary },
  assignedDateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 110,
    fontSize: type.caption.size,
    color: colors.textPrimary,
  },
  clearDates: { fontSize: type.caption.size, color: colors.accent },
  memberRowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
  },
  memberAvatarStub: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    fontWeight: type.bodyStrong.weight,
    color: "#3b3b3f",
  },
  memberName: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  memberMeta: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginTop: 4,
    letterSpacing: type.caption.letterSpacing,
  },
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
  pill: {
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
  createSubgroupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginBottom: 10,
  },
  createSubgroupBtnPressed: { opacity: 0.92 },
  createSubgroupBtnText: {
    color: "#ffffff",
    fontSize: type.bodyStrong.size,
    fontWeight: "700",
  },
  helper: { fontSize: type.body.size, color: colors.textSecondary },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { fontSize: type.h2.size, fontWeight: type.h2.weight, color: colors.textPrimary },
  modalLine: { fontSize: type.body.size, color: colors.textSecondary },
  tagMatch: { color: "#065f46", fontWeight: type.bodyStrong.weight },
  tagGuest: { color: "#92400e", fontWeight: type.bodyStrong.weight },
  viewMemberBtn: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#93c5fd",
  },
  viewMemberBtnText: { color: "#1d4ed8", fontWeight: type.bodyStrong.weight, fontSize: type.body.size },
  modalActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  approveBtn: {
    backgroundColor: "#16a34a",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  approveBtnText: { color: "#fff", fontWeight: type.bodyStrong.weight },
  ignoreBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  ignoreBtnText: { color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  declineBtn: {
    backgroundColor: "#dc2626",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  declineBtnText: { color: "#fff", fontWeight: type.bodyStrong.weight },
  btnDisabled: { opacity: 0.5 },
  modalClose: { marginTop: 8, alignItems: "center", paddingVertical: 8 },
  modalCloseText: { color: colors.accent, fontWeight: type.bodyStrong.weight, fontSize: type.body.size },
});
