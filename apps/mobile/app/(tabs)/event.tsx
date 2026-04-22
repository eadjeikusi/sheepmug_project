import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { EventItem, EventTypeRow, Group } from "@sheepmug/shared-api";
import { useRouter } from "expo-router";
import { useOfflineSync } from "../../contexts/OfflineSyncContext";
import { FilterResultsChips, HeaderCountTile, type FilterResultChip } from "../../components/FilterResultsSection";
import { FormModalShell } from "../../components/FormModalShell";
import { HeaderIconCircleButton } from "../../components/HeaderIconCircle";
import { EventUpsertModal } from "../../components/EventUpsertModal";
import { api } from "../../lib/api";
import { normalizeImageUri } from "../../lib/imageUri";
import { colors, radius, sizes, type } from "../../theme";
import {
  eventTypeSlugFromEvent,
  labelForEventTypeSlug,
  normalizeEventTypeSlug,
} from "../../lib/eventTypeDisplay";
import { formatEventLocationSummary } from "../../lib/eventLocation";
import {
  displayMemberWords,
  formatCalendarCountdown,
  formatLongWeekdayDateTime,
} from "../../lib/memberDisplayFormat";
import { getOfflineResourceCache, setOfflineResourceCache } from "../../lib/storage";
import { hydratePayloadWithOfflineImages } from "../../lib/offline/imageCache";

type WhenMode = "upcoming" | "past";
const PAGE_SIZE = 10;
const EVENTS_CACHE_KEY = "events:list";

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
  const r = e as EventItem & {
    cover_image_url?: string | null;
    cover_image?: string | null;
    event_image_url?: string | null;
    image_url?: string | null;
  };
  const raw = r.cover_image_url || r.cover_image || r.event_image_url || r.image_url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeImageUri(raw.trim());
}

function EventCoverThumb({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={styles.thumbPlaceholder} accessibilityLabel="No event image">
        <Ionicons name="image-outline" size={22} color={colors.textSecondary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.thumbImage}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
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

function eventPrimaryGroupId(e: EventItem): string | null {
  const rawGroupId = (e as { group_id?: unknown }).group_id;
  if (typeof rawGroupId === "string" && rawGroupId.trim()) return rawGroupId.trim();
  const nested = (e as { groups?: unknown }).groups;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const maybeId = (nested as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

function eventGroupIds(e: EventItem): string[] {
  const ids = new Set<string>();
  const one = eventPrimaryGroupId(e);
  if (one) ids.add(one);
  const many = (e as { group_ids?: unknown }).group_ids;
  if (Array.isArray(many)) {
    for (const id of many) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return [...ids];
}

function eventMatchesWhenFilters(e: EventItem, whenModes: Set<WhenMode>): boolean {
  if (whenModes.size === 0) return true;
  const startMs = eventStartMs(e);
  if (startMs === null) return false;
  const now = Date.now();
  const isUp = startMs >= now;
  const isPast = startMs < now;
  if (whenModes.has("upcoming") && isUp) return true;
  if (whenModes.has("past") && isPast) return true;
  return false;
}

export default function EventScreen() {
  const router = useRouter();
  const { isOnline } = useOfflineSync();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [whenModes, setWhenModes] = useState<Set<WhenMode>>(() => new Set());
  const [selectedEventTypeSlugs, setSelectedEventTypeSlugs] = useState<Set<string>>(() => new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<Group[]>([]);
  const [eventTypeRows, setEventTypeRows] = useState<EventTypeRow[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftWhenModes, setDraftWhenModes] = useState<Set<WhenMode>>(() => new Set());
  const [draftSelectedEventTypeSlugs, setDraftSelectedEventTypeSlugs] = useState<Set<string>>(() => new Set());
  const [draftSelectedGroupIds, setDraftSelectedGroupIds] = useState<Set<string>>(() => new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [eventsTotalCount, setEventsTotalCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const cached = await getOfflineResourceCache<{
          events: EventItem[];
          total_count: number;
          groups: Group[];
          event_types: EventTypeRow[];
        }>(EVENTS_CACHE_KEY);
        if (mounted && cached?.data) {
          setEvents(Array.isArray(cached.data.events) ? cached.data.events : []);
          setEventsTotalCount(Number(cached.data.total_count || 0));
          setHasMore(Array.isArray(cached.data.events) && cached.data.events.length === PAGE_SIZE);
          setGroups(Array.isArray(cached.data.groups) ? cached.data.groups : []);
          setEventTypeRows(Array.isArray(cached.data.event_types) ? cached.data.event_types : []);
        }
        try {
          const [eventPayload, groupRows, typeRows] = await Promise.all([
            api.events.list({ offset: 0, limit: PAGE_SIZE }),
            api.groups.list({ tree: true, limit: 100 }).catch(() => [] as Group[]),
            api.eventTypes.list().catch(() => [] as EventTypeRow[]),
          ]);
          if (!mounted) return;
          const { events: data, total_count } = eventPayload;
          setEvents(data);
          setEventsTotalCount(total_count);
          setHasMore(data.length === PAGE_SIZE);
          setGroups(groupRows);
          setEventTypeRows(
            [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          );
          await setOfflineResourceCache(EVENTS_CACHE_KEY, {
            ...(await hydratePayloadWithOfflineImages({
              events: data,
              total_count,
              groups: groupRows,
              event_types: [...typeRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
            })),
          });
        } catch {
          // keep cached events when offline
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function reloadEvents() {
    setLoading(true);
    try {
      const [eventPayload, groupRows, typeRows] = await Promise.all([
        api.events.list({ offset: 0, limit: PAGE_SIZE }).catch(() => null),
        api.groups.list({ tree: true, limit: 100 }).catch(() => null),
        api.eventTypes.list().catch(() => null),
      ]);
      if (!eventPayload) return;
      const { events: data, total_count } = eventPayload;
      const safeGroups = Array.isArray(groupRows) ? groupRows : groups;
      const safeTypes = Array.isArray(typeRows) ? typeRows : eventTypeRows;
      setEvents(data);
      setEventsTotalCount(total_count);
      setHasMore(data.length === PAGE_SIZE);
      setGroups(safeGroups);
      setEventTypeRows(
        [...safeTypes].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      );
      await setOfflineResourceCache(EVENTS_CACHE_KEY, {
        ...(await hydratePayloadWithOfflineImages({
          events: data,
          total_count,
          groups: safeGroups,
          event_types: [...safeTypes].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
        })),
      });
    } finally {
      setLoading(false);
    }
  }

  const loadMoreEvents = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const payload = await api.events.list({ offset: events.length, limit: PAGE_SIZE }).catch(() => null);
      if (!payload) return;
      const { events: next, total_count } = payload;
      setEvents((prev) => {
        const merged = [...prev, ...next];
        void (async () => {
          await setOfflineResourceCache(
            EVENTS_CACHE_KEY,
            await hydratePayloadWithOfflineImages({
              events: merged,
              total_count,
              groups,
              event_types: eventTypeRows,
            })
          );
        })();
        return merged;
      });
      setEventsTotalCount(total_count);
      setHasMore(next.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [events.length, hasMore, loading, loadingMore, groups, eventTypeRows]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await reloadEvents();
    } finally {
      setRefreshing(false);
    }
  }

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

  const groupFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const g of groups) {
      const id = String(g.id || "").trim();
      if (!id) continue;
      const name = String(g.name || "Ministry").trim() || "Ministry";
      if (!byId.has(id)) byId.set(id, name);
    }
    for (const e of events) {
      const nested = (e as { groups?: unknown }).groups;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const id = String((nested as { id?: unknown }).id || "").trim();
        const name = String((nested as { name?: unknown }).name || "").trim();
        if (id && name && !byId.has(id)) byId.set(id, name);
      }
    }
    const list = [...byId.entries()].map(([id, name]) => ({ id, label: name }));
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [groups, events]);

  useEffect(() => {
    const valid = new Set(eventTypeFilterOptions.map((o) => o.slug));
    setSelectedEventTypeSlugs((prev) => {
      const next = new Set<string>();
      for (const s of prev) {
        if (valid.has(s)) next.add(s);
      }
      return next;
    });
  }, [eventTypeFilterOptions]);

  useEffect(() => {
    const valid = new Set(groupFilterOptions.map((g) => g.id));
    setSelectedGroupIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next;
    });
  }, [groupFilterOptions]);

  useEffect(() => {
    if (!filterOpen) return;
    setDraftWhenModes(new Set(whenModes));
    setDraftSelectedEventTypeSlugs(new Set(selectedEventTypeSlugs));
    setDraftSelectedGroupIds(new Set(selectedGroupIds));
    // Seed draft when opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid resetting draft while editing
  }, [filterOpen]);

  const liveApplyCount = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (q && !eventSearchBlob(e).includes(q)) return false;
      if (!eventMatchesWhenFilters(e, draftWhenModes)) return false;
      if (draftSelectedEventTypeSlugs.size > 0) {
        const slug = eventTypeSlugFromEvent(e);
        if (!slug || !draftSelectedEventTypeSlugs.has(slug)) return false;
      }
      if (draftSelectedGroupIds.size > 0) {
        const ids = eventGroupIds(e);
        if (!ids.some((id) => draftSelectedGroupIds.has(id))) return false;
      }
      return true;
    }).length;
  }, [events, search, draftWhenModes, draftSelectedEventTypeSlugs, draftSelectedGroupIds]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (q && !eventSearchBlob(e).includes(q)) return false;
      if (!eventMatchesWhenFilters(e, whenModes)) return false;
      if (selectedEventTypeSlugs.size > 0) {
        const slug = eventTypeSlugFromEvent(e);
        if (!slug || !selectedEventTypeSlugs.has(slug)) return false;
      }
      if (selectedGroupIds.size > 0) {
        const ids = eventGroupIds(e);
        if (!ids.some((id) => selectedGroupIds.has(id))) return false;
      }
      return true;
    });
  }, [events, search, whenModes, selectedEventTypeSlugs, selectedGroupIds]);

  const eventHeaderCount = useMemo(() => {
    if (
      search.trim() ||
      whenModes.size > 0 ||
      selectedEventTypeSlugs.size > 0 ||
      selectedGroupIds.size > 0
    ) {
      return filteredEvents.length;
    }
    return eventsTotalCount;
  }, [search, whenModes, selectedEventTypeSlugs, selectedGroupIds, filteredEvents.length, eventsTotalCount]);

  const hasAppliedFilters =
    whenModes.size > 0 || selectedEventTypeSlugs.size > 0 || selectedGroupIds.size > 0;

  const openFiltersModal = useCallback(() => setFilterOpen(true), []);

  const filterChips = useMemo((): FilterResultChip[] => {
    const chips: FilterResultChip[] = [];
    if (whenModes.has("upcoming")) {
      chips.push({ key: "when-upcoming", label: "Upcoming", onLabelPress: openFiltersModal });
    }
    if (whenModes.has("past")) {
      chips.push({ key: "when-past", label: "Past", onLabelPress: openFiltersModal });
    }
    for (const slug of [...selectedEventTypeSlugs].sort((a, b) => a.localeCompare(b))) {
      const lab = eventTypeFilterOptions.find((o) => o.slug === slug)?.label ?? slug;
      chips.push({ key: `type:${slug}`, label: lab, onLabelPress: openFiltersModal });
    }
    const sortedGids = [...selectedGroupIds].sort((a, b) => {
      const na = groupFilterOptions.find((g) => g.id === a)?.label || a;
      const nb = groupFilterOptions.find((g) => g.id === b)?.label || b;
      return na.localeCompare(nb);
    });
    for (const id of sortedGids) {
      const lab = groupFilterOptions.find((g) => g.id === id)?.label || "Ministry";
      chips.push({ key: `group:${id}`, label: lab, onLabelPress: openFiltersModal });
    }
    return chips;
  }, [whenModes, selectedEventTypeSlugs, selectedGroupIds, groupFilterOptions, openFiltersModal, eventTypeFilterOptions]);

  const clearAppliedFilters = useCallback(() => {
    setWhenModes(new Set());
    setSelectedEventTypeSlugs(new Set());
    setSelectedGroupIds(new Set());
  }, []);

  const removeFilterByKey = useCallback((key: string) => {
    if (key === "when-upcoming") {
      setWhenModes((prev) => {
        const n = new Set(prev);
        n.delete("upcoming");
        return n;
      });
      return;
    }
    if (key === "when-past") {
      setWhenModes((prev) => {
        const n = new Set(prev);
        n.delete("past");
        return n;
      });
      return;
    }
    if (key.startsWith("type:")) {
      const slug = key.slice("type:".length);
      setSelectedEventTypeSlugs((prev) => {
        const n = new Set(prev);
        n.delete(slug);
        return n;
      });
      return;
    }
    if (key.startsWith("group:")) {
      const id = key.slice("group:".length);
      setSelectedGroupIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }, []);

  function toggleSearch() {
    if (showSearch) {
      setShowSearch(false);
      setSearch("");
      Keyboard.dismiss();
    } else {
      setShowSearch(true);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Events</Text>
              <HeaderCountTile count={eventHeaderCount} />
            </View>
          </View>
          <View style={styles.headerActions}>
            <HeaderIconCircleButton
              accessibilityLabel="Create event"
              onPress={() => {
                if (!isOnline) {
                  Alert.alert("Offline limitation", "Creating events is only available online.");
                  return;
                }
                setShowCreateModal(true);
              }}
            >
              <Ionicons name="add-outline" size={sizes.headerIcon} color={colors.textPrimary} />
            </HeaderIconCircleButton>
            <HeaderIconCircleButton
              accessibilityLabel={hasAppliedFilters ? "Edit filters" : "Open filters"}
              accessibilityState={{ selected: hasAppliedFilters }}
              active={hasAppliedFilters}
              onPress={() => setFilterOpen(true)}
            >
              <Ionicons
                name={hasAppliedFilters ? "filter" : "filter-outline"}
                size={sizes.headerIcon}
                color={hasAppliedFilters ? colors.accent : colors.textPrimary}
              />
            </HeaderIconCircleButton>
            <HeaderIconCircleButton
              accessibilityLabel={showSearch ? "Close search" : "Search events"}
              active={showSearch}
              onPress={toggleSearch}
            >
              <Ionicons
                name={showSearch ? "close-outline" : "search-outline"}
                size={sizes.headerIcon}
                color={colors.textPrimary}
              />
            </HeaderIconCircleButton>
          </View>
        </View>
      </View>

      {showSearch ? (
        <View style={styles.searchRow}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Filter results by text"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <HeaderIconCircleButton accessibilityLabel="Trim search text" onPress={() => setSearch((v) => v.trim())}>
            <Ionicons name="search-outline" size={sizes.headerIcon} color={colors.textPrimary} />
          </HeaderIconCircleButton>
        </View>
      ) : null}

      <View style={styles.filterResultsWrap}>
        <FilterResultsChips
          chips={filterChips}
          onRemoveChip={removeFilterByKey}
          onClearAll={clearAppliedFilters}
        />
      </View>

      <FormModalShell
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        subtitle="Refine event list"
        variant="compact"
        headerIcon="options-outline"
        footer={
          <View style={styles.filterFooter}>
            <Pressable
              style={styles.filterClearBtn}
              onPress={() => {
                setDraftWhenModes(new Set());
                setDraftSelectedEventTypeSlugs(new Set());
                setDraftSelectedGroupIds(new Set());
              }}
            >
              <Text style={styles.filterClearBtnText}>Clear</Text>
            </Pressable>
            <Pressable
              style={styles.filterApplyBtn}
              onPress={() => {
                setWhenModes(new Set(draftWhenModes));
                setSelectedEventTypeSlugs(new Set(draftSelectedEventTypeSlugs));
                setSelectedGroupIds(new Set(draftSelectedGroupIds));
                setFilterOpen(false);
              }}
            >
              <Text style={styles.filterApplyBtnText}>Apply ({liveApplyCount})</Text>
            </Pressable>
          </View>
        }
      >
        <View style={styles.liveCountRow}>
          <Text style={styles.liveCountText}>{liveApplyCount} events match current selection</Text>
        </View>

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>When</Text>
          <Text style={styles.filterHint}>Select one or both, or any time for no date filter</Text>
          <View style={styles.groupListWrap}>
            <Pressable
              style={[styles.filterPill, draftWhenModes.size === 0 && styles.filterPillActive]}
              onPress={() => setDraftWhenModes(new Set())}
            >
              <View style={[styles.pillDot, draftWhenModes.size === 0 && styles.pillDotActive]}>
                {draftWhenModes.size === 0 ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
              </View>
              <Text style={[styles.filterPillText, draftWhenModes.size === 0 && styles.filterPillTextActive]}>
                Any time
              </Text>
            </Pressable>
            {(["upcoming", "past"] as const).map((mode) => {
              const active = draftWhenModes.has(mode);
              return (
                <Pressable
                  key={mode}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  onPress={() => {
                    setDraftWhenModes((prev) => {
                      const next = new Set(prev);
                      if (next.has(mode)) next.delete(mode);
                      else next.add(mode);
                      return next;
                    });
                  }}
                >
                  <View style={[styles.pillDot, active && styles.pillDotActive]}>
                    {active ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {mode === "upcoming" ? "Upcoming" : "Past"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.filterSectionDivider} />

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>Event type</Text>
          <Text style={styles.filterHint}>Select one or more types from organization settings</Text>
          <View style={styles.groupListWrap}>
            <Pressable
              style={[styles.filterPill, draftSelectedEventTypeSlugs.size === 0 && styles.filterPillActive]}
              onPress={() => setDraftSelectedEventTypeSlugs(new Set())}
            >
              <View style={[styles.pillDot, draftSelectedEventTypeSlugs.size === 0 && styles.pillDotActive]}>
                {draftSelectedEventTypeSlugs.size === 0 ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
              </View>
              <Text
                style={[
                  styles.filterPillText,
                  draftSelectedEventTypeSlugs.size === 0 && styles.filterPillTextActive,
                ]}
              >
                All types
              </Text>
            </Pressable>
            {eventTypeFilterOptions.map((opt) => {
              const active = draftSelectedEventTypeSlugs.has(opt.slug);
              return (
                <Pressable
                  key={opt.slug}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  onPress={() => {
                    setDraftSelectedEventTypeSlugs((prev) => {
                      const next = new Set(prev);
                      if (next.has(opt.slug)) next.delete(opt.slug);
                      else next.add(opt.slug);
                      return next;
                    });
                  }}
                >
                  <View style={[styles.pillDot, active && styles.pillDotActive]}>
                    {active ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]} numberOfLines={1}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.filterSectionDivider} />

        <View style={styles.filterBlock}>
          <Text style={styles.filterSectionTitle}>Ministry</Text>
          <Text style={styles.filterHint}>Select one or more ministries</Text>
          <View style={styles.groupListWrap}>
            <Pressable
              style={[styles.filterPill, draftSelectedGroupIds.size === 0 && styles.filterPillActive]}
              onPress={() => setDraftSelectedGroupIds(new Set())}
            >
              <View style={[styles.pillDot, draftSelectedGroupIds.size === 0 && styles.pillDotActive]}>
                {draftSelectedGroupIds.size === 0 ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
              </View>
              <Text
                style={[
                  styles.filterPillText,
                  draftSelectedGroupIds.size === 0 && styles.filterPillTextActive,
                ]}
              >
                All ministries
              </Text>
            </Pressable>
            {groupFilterOptions.map((g) => {
              const active = draftSelectedGroupIds.has(g.id);
              return (
                <Pressable
                  key={g.id}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  onPress={() => {
                    setDraftSelectedGroupIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    });
                  }}
                >
                  <View style={[styles.pillDot, active && styles.pillDotActive]}>
                    {active ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
                  </View>
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]} numberOfLines={1}>
                    {g.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </FormModalShell>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.helper}>Loading events…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredEvents}
          keyExtractor={(item) => item.id}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          onEndReached={() => void loadMoreEvents()}
          onEndReachedThreshold={0.35}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const typeLbl = eventTypeLabel(item, eventTypeRows);
            const meta = formatEventListMeta(item);
            const coverUri = eventCoverImageUrl(item);
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push({ pathname: "/event/[id]", params: { id: item.id } })}
              >
                <View style={styles.cardRow}>
                  <EventCoverThumb uri={coverUri} />
                  <View style={styles.cardMain}>
                    <View style={styles.cardTop}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {eventTitle(item)}
                      </Text>
                      {typeLbl ? (
                        <View style={styles.typePill}>
                          <Text style={styles.typePillText} numberOfLines={1}>
                            {typeLbl}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {meta ? (
                      <Text style={styles.cardMeta} numberOfLines={2}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.helper}>
              {events.length === 0 ? "No events yet." : "No events match your search or filters."}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null
          }
        />
      )}
      <EventUpsertModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSaved={() => {
          void reloadEvents();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  headerTitleWrap: { flex: 1, paddingRight: 10, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    justifyContent: "flex-end",
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginTop: 8 },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textPrimary,
  },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
    letterSpacing: type.pageTitle.letterSpacing,
  },
  filterResultsWrap: {
    paddingHorizontal: 16,
  },
  loadingBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
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
  helper: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    marginTop: 16,
    letterSpacing: type.body.letterSpacing,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  footerLoader: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  filterFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  liveCountRow: {
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 10,
    backgroundColor: colors.accentSurface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  liveCountText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
  },
  filterClearBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  filterClearBtnText: {
    color: colors.textPrimary,
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
  },
  filterApplyBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  filterApplyBtnText: {
    color: "#fff",
    fontSize: type.bodyStrong.size,
    fontWeight: type.bodyStrong.weight,
  },
  filterBlock: { marginBottom: 16, gap: 8 },
  filterSectionTitle: {
    fontSize: type.bodyStrong.size,
    lineHeight: type.bodyStrong.lineHeight,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
  },
  filterSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.accentBorder,
    marginBottom: 14,
  },
  filterHint: {
    marginTop: 4,
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
  },
  groupListWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    minHeight: 36,
    paddingHorizontal: 12,
    maxWidth: "100%",
  },
  filterPillActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  pillDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pillDotActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  filterPillText: {
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: colors.textSecondary,
    fontWeight: type.body.weight,
  },
  filterPillTextActive: {
    color: colors.accent,
    fontWeight: type.bodyStrong.weight,
  },
});
