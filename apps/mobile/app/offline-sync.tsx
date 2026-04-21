import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useOfflineSync } from "../contexts/OfflineSyncContext";
import {
  clearOfflineResourceCaches,
  getOfflineBootstrapDone,
  getOfflineCacheSizeEstimate,
  getOfflineResourceCache,
  setOfflineBootstrapDone,
} from "../lib/storage";
import { colors, radius, type } from "../theme";
import { clearOfflineImageFiles, getOfflineImageCacheSizeBytes } from "../lib/offline/imageCache";
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

type CachedMemberRow = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
};

type CachedMembersPayload = {
  members?: CachedMemberRow[];
};

function memberNameByIdFromCacheRows(rows: CachedMemberRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    const full = `${String(row.first_name || "").trim()} ${String(row.last_name || "").trim()}`.trim();
    if (full) out[id] = displayMemberWords(full);
  }
  return out;
}

function memberNameFromLookup(memberId: string, memberNameById: Record<string, string>): string {
  const id = String(memberId || "").trim();
  if (!id) return "a member";
  return memberNameById[id] || "a member";
}

function summarizeOfflineAction(item: OfflineQueueItem, memberNameById: Record<string, string>): string {
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
      const status = String(row.status || "not marked").replaceAll("_", " ").toLowerCase();
      return `You marked ${memberName} ${status}`;
    }
    if (updates.length > 1) {
      const statuses = [...new Set(updates.map((u) => String(u.status || "").trim().toLowerCase()).filter(Boolean))];
      if (statuses.length === 1) {
        return `You marked ${updates.length} members ${statuses[0].replaceAll("_", " ")}`;
      }
      return `You updated attendance for ${updates.length} members`;
    }
    return "You updated event attendance";
  }

  if (item.operation === "task_patch") {
    const taskType = String(item.payload.task_type || "task").trim().toLowerCase();
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

  return item.operation.replace(/_/g, " ");
}

export default function OfflineSyncScreen() {
  const router = useRouter();
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
  const [memberNameById, setMemberNameById] = useState<Record<string, string>>({});

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
      const cached = await getOfflineResourceCache<CachedMembersPayload>("members:list");
      const rows = Array.isArray(cached?.data?.members) ? cached?.data?.members : [];
      if (!mounted) return;
      setMemberNameById(memberNameByIdFromCacheRows(rows));
    })();
    return () => {
      mounted = false;
    };
  }, [lastSyncAt, queueItems.length]);

  const handleDownloadPress = useCallback(() => {
    void (async () => {
      const alreadyDownloaded = await getOfflineBootstrapDone();
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
  }, [startBackgroundDownload]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Offline Sync</Text>
          <View style={{ width: 62 }} />
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
                        await setOfflineBootstrapDone(false);
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
            savedMembers.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>
                    {String(item.payload.first_name || "")} {String(item.payload.last_name || "")}
                  </Text>
                  <Text style={styles.itemMeta}>Queued: {formatTimeAgo(item.created_at)}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Actions</Text>
          {pendingItems.length === 0 ? (
            <Text style={styles.emptyText}>No pending actions.</Text>
          ) : (
            pendingItems.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{summarizeOfflineAction(item, memberNameById)}</Text>
                  <Text style={styles.itemMeta}>Queued: {formatTimeAgo(item.created_at)}</Text>
                </View>
                <Text style={styles.pendingPill}>{item.status}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Failed Actions</Text>
          {failedItems.length === 0 ? (
            <Text style={styles.emptyText}>No failed actions.</Text>
          ) : (
            failedItems.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{summarizeOfflineAction(item, memberNameById)}</Text>
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
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recently Synced</Text>
          {syncedItems.length === 0 ? (
            <Text style={styles.emptyText}>No synced actions yet.</Text>
          ) : (
            syncedItems.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{summarizeOfflineAction(item, memberNameById)}</Text>
                  <Text style={styles.itemMeta}>Synced: {formatTimeAgo(item.synced_at)}</Text>
                </View>
                <Text style={styles.syncedPill}>synced</Text>
              </View>
            ))
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
  backBtn: {
    minWidth: 62,
    minHeight: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 8,
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
