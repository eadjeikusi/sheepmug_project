import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../contexts/AuthContext";
import { useOfflineSync } from "../contexts/OfflineSyncContext";
import {
  clearOfflineResourceCaches,
  getOfflineBootstrapDone,
  getOfflineCacheSizeEstimate,
  getOfflineResourceCache,
  setOfflineBootstrapDone,
} from "../lib/storage";
import { HeaderIconCircle } from "../components/HeaderIconCircle";
import { colors, radius, sizes, type } from "../theme";
import { clearOfflineImageFiles, getOfflineImageCacheSizeBytes } from "../lib/offline/imageCache";
import { cancelLocalAttendanceReminders } from "../lib/localAttendanceReminders";
import { cancelLocalTaskReminders } from "../lib/localTaskReminders";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import type { OfflineQueueItem } from "../lib/offline/types";

function formatTimeAgo(ts: string | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Never";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

type CachedMembersPayload = {
  members?: unknown[];
};

type OfflineDisplayLookup = {
  memberNameById: Record<string, string>;
  taskTitleById: Record<string, string>;
  eventTitleByEventId: Record<string, string>;
};

const EMPTY_DISPLAY_LOOKUP: OfflineDisplayLookup = {
  memberNameById: {},
  taskTitleById: {},
  eventTitleByEventId: {},
};

function mergeMemberRowsIntoMap(rows: unknown, into: Record<string, string>): void {
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? o.member_id ?? "").trim();
    if (!id) continue;
    const first = String(o.first_name ?? "").trim();
    const last = String(o.last_name ?? "").trim();
    const full = `${first} ${last}`.trim();
    if (full) into[id] = displayMemberWords(full);
  }
}

function eventTitleFromCacheEvent(ev: unknown): string {
  if (!ev || typeof ev !== "object") return "";
  const o = ev as { name?: unknown; title?: unknown };
  const raw = String(o.name ?? o.title ?? "").trim();
  return raw ? displayMemberWords(raw) : "";
}

function attendanceOutcomePhrase(statusRaw: unknown): string {
  const s = String(statusRaw || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "");
  if (s === "present") return "present";
  if (s === "absent") return "absent";
  if (s === "unsure") return "not sure";
  if (s === "notmarked" || s === "") return "not marked";
  return String(statusRaw || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ");
}

function memberNameFromLookup(memberId: string, memberNameById: Record<string, string>): string {
  const id = String(memberId || "").trim();
  if (!id) return "a member";
  return memberNameById[id] || "a member";
}

function formatAttendanceMemberList(names: string[], total: number): string {
  const known = names.filter((n) => n && n !== "a member");
  if (known.length === 0) {
    return `${total} member${total === 1 ? "" : "s"}`;
  }
  if (known.length === total) {
    if (total === 1) return known[0];
    if (total === 2) return `${known[0]} and ${known[1]}`;
    if (total === 3) return `${known[0]}, ${known[1]}, and ${known[2]}`;
    return `${known[0]}, ${known[1]}, and ${total - 2} others`;
  }
  if (known.length === 1) {
    return `${known[0]} and ${total - 1} other${total === 2 ? "" : "s"}`;
  }
  return `${known[0]}, ${known[1]}, and ${total - 2} other${total === 2 ? "" : "s"}`;
}

function summarizeOfflineAction(item: OfflineQueueItem, lookup: OfflineDisplayLookup): string {
  const { memberNameById, taskTitleById } = lookup;
  if (item.operation === "member_create") {
    const first = String(item.payload.first_name || "").trim();
    const last = String(item.payload.last_name || "").trim();
    const full = `${first} ${last}`.trim();
    return full ? `You added ${displayMemberWords(full)}` : "You added a member";
  }

  if (item.operation === "attendance_update") {
    const updates = Array.isArray(item.payload.updates)
      ? (item.payload.updates as Array<{ member_id?: unknown; status?: unknown }>)
      : [];
    if (updates.length === 1) {
      const row = updates[0];
      const memberName = memberNameFromLookup(String(row.member_id || ""), memberNameById);
      const phrase = attendanceOutcomePhrase(row.status);
      return `You marked ${memberName} ${phrase}`;
    }
    if (updates.length > 1) {
      const statuses = [...new Set(updates.map((u) => String(u.status || "").trim().toLowerCase()).filter(Boolean))];
      if (statuses.length === 1) {
        const phrase = attendanceOutcomePhrase(statuses[0]);
        const names = updates.map((u) => memberNameFromLookup(String(u.member_id || ""), memberNameById));
        const label = formatAttendanceMemberList(names, updates.length);
        return `You marked ${label} ${phrase}`;
      }
      return `You updated attendance for ${updates.length} members`;
    }
    return "You updated event attendance";
  }

  if (item.operation === "task_patch") {
    const taskId = String(item.payload.task_id || "").trim();
    const title = taskId ? taskTitleById[taskId] : "";
    const taskType = String(item.payload.task_type || "task").trim().toLowerCase();
    const kind = taskType === "group" ? "group to-do" : "member to-do";
    if (title) {
      return `You updated ${kind}: ${title}`;
    }
    return taskType === "group" ? "You updated a group to-do list" : "You updated a member to-do list";
  }

  if (item.operation === "member_note_create") {
    const memberName = memberNameFromLookup(String(item.payload.member_id || ""), memberNameById);
    return `You added a note for ${memberName}`;
  }
  if (item.operation === "member_note_update") {
    const memberName = memberNameFromLookup(String(item.payload.member_id || ""), memberNameById);
    return `You updated a note for ${memberName}`;
  }
  if (item.operation === "member_note_delete") {
    const memberName = memberNameFromLookup(String(item.payload.member_id || ""), memberNameById);
    return `You deleted a note for ${memberName}`;
  }

  return String(item.operation).replace(/_/g, " ");
}

function offlineActionSubtitle(item: OfflineQueueItem, lookup: OfflineDisplayLookup): string | null {
  if (item.operation === "attendance_update") {
    const eventId = String(item.payload.event_id || "").trim();
    if (!eventId) return null;
    const t = lookup.eventTitleByEventId[eventId];
    return t ? `Event: ${t}` : null;
  }
  return null;
}

async function buildOfflineDisplayLookup(queueItems: OfflineQueueItem[]): Promise<OfflineDisplayLookup> {
  const memberNameById: Record<string, string> = {};
  const taskTitleById: Record<string, string> = {};
  const eventTitleByEventId: Record<string, string> = {};

  const cachedMembers = await getOfflineResourceCache<CachedMembersPayload>("members:list");
  const listRows = Array.isArray(cachedMembers?.data?.members) ? cachedMembers.data.members : [];
  mergeMemberRowsIntoMap(listRows, memberNameById);

  const eventIds = new Set<string>();
  const memberIdsToBackfill = new Set<string>();

  for (const it of queueItems) {
    if (it.operation === "attendance_update") {
      const eid = String(it.payload.event_id || "").trim();
      if (eid) eventIds.add(eid);
      const updates = Array.isArray(it.payload.updates) ? it.payload.updates : [];
      for (const u of updates) {
        const mid = String((u as { member_id?: unknown }).member_id || "").trim();
        if (mid) memberIdsToBackfill.add(mid);
      }
    }
    if (
      it.operation === "member_note_create" ||
      it.operation === "member_note_update" ||
      it.operation === "member_note_delete"
    ) {
      const mid = String(it.payload.member_id || "").trim();
      if (mid) memberIdsToBackfill.add(mid);
    }
  }

  await Promise.all(
    [...eventIds].map(async (eid) => {
      const cached = await getOfflineResourceCache<{
        event?: unknown;
        members?: unknown;
      }>(`event:detail:${eid}`);
      if (cached?.data?.members) mergeMemberRowsIntoMap(cached.data.members, memberNameById);
      const title = eventTitleFromCacheEvent(cached?.data?.event);
      if (title) eventTitleByEventId[eid] = title;
    })
  );

  const tasksCached = await getOfflineResourceCache<{ tasks?: Array<{ id?: string; title?: string }> }>("tasks:list");
  const taskRows = Array.isArray(tasksCached?.data?.tasks) ? tasksCached.data.tasks : [];
  for (const t of taskRows) {
    const id = String(t?.id || "").trim();
    if (!id) continue;
    const raw = String(t?.title || "").trim();
    if (raw) taskTitleById[id] = displayMemberWords(raw);
  }

  for (const mid of memberIdsToBackfill) {
    if (memberNameById[mid]) continue;
    const d = await getOfflineResourceCache<{
      member?: { id?: string; member_id?: string; first_name?: string | null; last_name?: string | null };
    }>(`member:detail:${mid}`);
    const m = d?.data?.member;
    mergeMemberRowsIntoMap(m ? [m] : [], memberNameById);
  }

  return { memberNameById, taskTitleById, eventTitleByEventId };
}

export default function OfflineSyncScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    isOnline,
    checking,
    syncing,
    queueItems,
    pendingCount,
    failedCount,
    lastSyncAt,
    syncNow,
    retryItem,
    discardItem,
    downloadRunning,
    downloadProgressText,
    startBackgroundDownload,
  } = useOfflineSync();

  const pendingItems = useMemo(
    () => queueItems.filter((x) => x.status === "pending" || x.status === "syncing"),
    [queueItems]
  );
  const failedItems = useMemo(() => queueItems.filter((x) => x.status === "failed"), [queueItems]);
  const syncedItems = useMemo(() => queueItems.filter((x) => x.status === "synced").slice(-20).reverse(), [queueItems]);
  const savedMembers = useMemo(
    () => pendingItems.filter((x) => x.operation === "member_create"),
    [pendingItems]
  );
  const [cacheBytes, setCacheBytes] = useState(0);
  const [imageBytes, setImageBytes] = useState(0);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [displayLookup, setDisplayLookup] = useState<OfflineDisplayLookup>(EMPTY_DISPLAY_LOOKUP);

  const refreshCacheSize = useCallback(async () => {
    setCacheLoading(true);
    try {
      const [estimate, imageSize] = await Promise.all([
        getOfflineCacheSizeEstimate(),
        getOfflineImageCacheSizeBytes(),
      ]);
      setCacheBytes(estimate.bytes);
      setImageBytes(imageSize);
    } finally {
      setCacheLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOnline || syncing) return;
    if (pendingCount === 0 && failedCount === 0) return;
    void syncNow();
  }, [isOnline, syncing, pendingCount, failedCount, syncNow]);

  useEffect(() => {
    void refreshCacheSize();
  }, [refreshCacheSize, queueItems.length, lastSyncAt]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const lookup = await buildOfflineDisplayLookup(queueItems);
      if (!mounted) return;
      setDisplayLookup(lookup);
    })();
    return () => {
      mounted = false;
    };
  }, [lastSyncAt, queueItems]);

  const handleDownloadPress = useCallback(() => {
    void (async () => {
      const uid = user?.id ?? null;
      const alreadyDownloaded = uid ? await getOfflineBootstrapDone(uid) : false;
      if (!alreadyDownloaded) {
        await startBackgroundDownload();
        return;
      }
      Alert.alert(
        "Offline data already downloaded",
        "This device already has full offline data. Download again to refresh with the latest updates?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Download again",
            onPress: () => {
              void startBackgroundDownload();
            },
          },
        ]
      );
    })();
  }, [startBackgroundDownload, user?.id]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel="Go back"
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <HeaderIconCircle pointerEvents="none">
                <Ionicons name="chevron-back" size={sizes.headerIcon} color={colors.textPrimary} />
              </HeaderIconCircle>
              <Text style={styles.backBtnText}>Back</Text>
            </Pressable>
          </View>
          <Text style={[styles.title, { flexShrink: 0 }]} numberOfLines={1}>
            Offline Sync
          </Text>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: isOnline ? "#16a34a" : "#dc2626" }]} />
            <Text style={styles.statusText}>{isOnline ? "Online" : "Offline mode"}</Text>
            {checking ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          </View>
          <Text style={styles.metaText}>Last synced: {formatTimeAgo(lastSyncAt)}</Text>
          <Text style={styles.metaText}>Pending: {pendingCount}  Failed: {failedCount}</Text>
          <Text style={styles.metaText}>
            Local cache size: {cacheLoading ? "Calculating..." : formatBytes(cacheBytes)}
          </Text>
          <Text style={styles.metaText}>Image cache size: {cacheLoading ? "Calculating..." : formatBytes(imageBytes)}</Text>

          <Pressable
            style={[styles.primaryBtn, syncing && styles.btnDisabled]}
            onPress={() => void syncNow()}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="sync-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>{isOnline ? "Sync now" : "Try sync now"}</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, (downloadRunning || syncing) && styles.btnDisabled]}
            onPress={handleDownloadPress}
            disabled={downloadRunning || syncing}
          >
            {downloadRunning ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Download all data now</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.metaText}>Download progress: {downloadProgressText}</Text>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => {
              Alert.alert(
                "Clear cached data",
                "This removes downloaded offline data from this device. You can download it again.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear cache",
                    style: "destructive",
                    onPress: () => {
                      void (async () => {
                        await clearOfflineResourceCaches();
                        await clearOfflineImageFiles();
                        await cancelLocalTaskReminders();
                        await cancelLocalAttendanceReminders();
                        await setOfflineBootstrapDone(user?.id ?? null, false);
                        await refreshCacheSize();
                        Alert.alert("Cache cleared", "Offline cache has been cleared.");
                        router.replace("/offline-setup");
                      })();
                    },
                  },
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={15} color="#b91c1c" />
            <Text style={styles.secondaryBtnText}>Clear cached data</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Saved Members</Text>
          {savedMembers.length === 0 ? (
            <Text style={styles.emptyText}>No offline-saved members pending sync.</Text>
          ) : (
            savedMembers.map((item) => {
              const first = String(item.payload.first_name || "").trim();
              const last = String(item.payload.last_name || "").trim();
              const full = `${first} ${last}`.trim();
              const title = full ? `You added ${displayMemberWords(full)}` : "You added a member";
              return (
                <View key={item.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{title}</Text>
                    <Text style={styles.itemMeta}>Queued: {formatTimeAgo(item.created_at)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Actions</Text>
          {pendingItems.length === 0 ? (
            <Text style={styles.emptyText}>No pending actions.</Text>
          ) : (
            pendingItems.map((item) => {
              const sub = offlineActionSubtitle(item, displayLookup);
              return (
                <View key={item.id} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{summarizeOfflineAction(item, displayLookup)}</Text>
                    {sub ? <Text style={styles.itemMeta}>{sub}</Text> : null}
                    <Text style={styles.itemMeta}>Queued: {formatTimeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={styles.pendingPill}>{item.status}</Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Failed Actions</Text>
          {failedItems.length === 0 ? (
            <Text style={styles.emptyText}>No failed actions.</Text>
          ) : (
            failedItems.map((item) => {
              const sub = offlineActionSubtitle(item, displayLookup);
              return (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{summarizeOfflineAction(item, displayLookup)}</Text>
                  {sub ? <Text style={styles.itemMeta}>{sub}</Text> : null}
                  <Text style={styles.itemMeta}>{item.last_error || "Failed to sync."}</Text>
                </View>
                <View style={styles.failedActions}>
                  <Pressable style={styles.inlineBtn} onPress={() => void retryItem(item.id)}>
                    <Text style={styles.inlineBtnText}>Retry</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.inlineBtn, styles.inlineDanger]}
                    onPress={() => {
                      Alert.alert("Discard action", "Remove this failed offline action?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Discard", style: "destructive", onPress: () => void discardItem(item.id) },
                      ]);
                    }}
                  >
                    <Text style={styles.inlineDangerText}>Discard</Text>
                  </Pressable>
                </View>
              </View>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recently Synced</Text>
          {syncedItems.length === 0 ? (
            <Text style={styles.emptyText}>No synced actions yet.</Text>
          ) : (
            syncedItems.map((item) => {
              const sub = offlineActionSubtitle(item, displayLookup);
              return (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{summarizeOfflineAction(item, displayLookup)}</Text>
                  {sub ? <Text style={styles.itemMeta}>{sub}</Text> : null}
                  <Text style={styles.itemMeta}>Synced: {formatTimeAgo(item.synced_at)}</Text>
                </View>
                <Text style={styles.syncedPill}>synced</Text>
              </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, gap: 12, paddingBottom: 26 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtnText: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textPrimary,
    fontWeight: "600",
  },
  title: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
  },
  statusCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: type.bodyStrong.size, color: colors.textPrimary, fontWeight: type.bodyStrong.weight },
  metaText: { fontSize: type.caption.size, color: colors.textSecondary },
  primaryBtn: {
    marginTop: 2,
    minHeight: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: "#fff", fontSize: type.body.size, fontWeight: "700" },
  secondaryBtn: {
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtnText: { color: "#b91c1c", fontSize: type.caption.size, fontWeight: "700" },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  sectionTitle: {
    fontSize: type.bodyStrong.size,
    color: colors.textPrimary,
    fontWeight: type.bodyStrong.weight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  emptyText: { padding: 12, fontSize: type.body.size, color: colors.textSecondary },
  itemRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemTitle: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: "600" },
  itemMeta: { marginTop: 2, fontSize: type.caption.size, color: colors.textSecondary },
  pendingPill: {
    fontSize: 11,
    color: "#92400e",
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    textTransform: "capitalize",
  },
  syncedPill: {
    fontSize: 11,
    color: "#166534",
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#86efac",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  failedActions: { flexDirection: "row", gap: 8 },
  inlineBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#f8fafc",
  },
  inlineBtnText: { fontSize: type.caption.size, color: colors.textPrimary, fontWeight: "600" },
  inlineDanger: { borderColor: "#fecaca", backgroundColor: "#fff1f2" },
  inlineDangerText: { fontSize: type.caption.size, color: "#b91c1c", fontWeight: "600" },
});
