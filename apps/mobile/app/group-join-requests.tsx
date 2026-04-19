import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { AnchorRect } from "../components/FilterPickerModal";
import { FilterPickerModal } from "../components/FilterPickerModal";
import { FilterTriggerButton } from "../components/FilterTriggerButton";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { api } from "../lib/api";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { usePermissions } from "../hooks/usePermissions";
import { setDashboardLastSeenCounts } from "../lib/storage";
import { colors, radius, type } from "../theme";

function statusLabel(raw: string): string {
  const cleaned = raw.trim().replace(/_/g, " ");
  if (!cleaned) return "Pending";
  return displayMemberWords(cleaned);
}

const OPEN_REQUEST_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOpenRequestIdParam(raw: string | string[] | undefined): string {
  const s = typeof raw === "string" ? raw : Array.isArray(raw) && raw[0] ? String(raw[0]) : "";
  const t = s.trim();
  return OPEN_REQUEST_UUID_RE.test(t) ? t : "";
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function requestIdOf(row: unknown, idx: number): string {
  if (!isPlainRecord(row)) return String(idx);
  return String(row.id ?? row.request_id ?? idx);
}

function isPending(row: unknown): boolean {
  if (!isPlainRecord(row)) return false;
  return String(row.status || "").toLowerCase() === "pending";
}

function submittedLabel(row: unknown): string {
  if (!isPlainRecord(row)) return "";
  const raw =
    row.created_at ?? row.requested_at ?? row.submitted_at ?? row.submittedDate ?? (row as { createdAt?: string }).createdAt;
  if (raw == null || !String(raw).trim()) return "";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function groupMinistryName(row: Record<string, unknown>): string {
  const groups = row.groups as { name?: string } | undefined;
  return (
    (groups && typeof groups.name === "string" && groups.name.trim()) ||
    (typeof row.group_name === "string" ? row.group_name : "") ||
    ""
  );
}

function applicantDisplayName(row: Record<string, unknown>): string {
  const fn = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const ln = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const n = `${fn} ${ln}`.trim();
  if (n) return displayMemberWords(n);
  return "Join request";
}

function applicantInitial(row: Record<string, unknown>): string {
  const fn = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const ln = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const c = fn[0] || ln[0] || "G";
  return c.toUpperCase();
}

function rowSubtitleSearch(row: Record<string, unknown>): string {
  return [groupMinistryName(row), typeof row.first_name === "string" ? row.first_name : "", typeof row.last_name === "string" ? row.last_name : ""]
    .filter(Boolean)
    .join(" ");
}

function formatDob(raw: unknown): string {
  if (raw == null || !String(raw).trim()) return "—";
  const d = new Date(String(raw));
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return String(raw);
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <View style={sheetStyles.readField}>
      <Text style={sheetStyles.readLabel}>{label}</Text>
      <Text style={sheetStyles.readValue}>{value}</Text>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  readField: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  readLabel: { fontSize: type.caption.size, color: colors.textSecondary, marginBottom: 4 },
  readValue: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: "500" },
  heroCard: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    marginBottom: 16,
    alignItems: "center",
  },
  heroName: {
    fontSize: type.subtitle.size,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  heroMeta: { fontSize: type.caption.size, color: colors.textSecondary },
});

export default function GroupJoinRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ openRequestId?: string | string[] }>();
  const openRequestIdParam = useMemo(() => parseOpenRequestIdParam(params.openRequestId), [params.openRequestId]);
  const deepLinkWidenedFilterRef = useRef(false);
  const { can } = usePermissions();
  const canView = can("view_group_requests") || can("approve_group_requests");
  const canApprove = can("approve_group_requests");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [reviewRow, setReviewRow] = useState<Record<string, unknown> | null>(null);
  const [reviewRowIndex, setReviewRowIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const filterRef = useRef<View>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!canView) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.groupRequests
        .list(statusFilter === "all" ? undefined : { status: "pending" })
        .catch(() => []);
      const arr = Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
      setRows(arr);
      const pendingCount = arr.filter((x) => String(x.status || "").toLowerCase() === "pending").length;
      await setDashboardLastSeenCounts({ groupRequests: pendingCount });
    } finally {
      setLoading(false);
    }
  }, [canView, statusFilter]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (cancelled) return;
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (!isPlainRecord(row)) return false;
      const blob = `${applicantDisplayName(row)} ${rowSubtitleSearch(row)} ${String(row.status || "")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  const selectableIds = useMemo(() => {
    if (!canApprove) return [] as string[];
    return filteredRows.filter(isPending).map((row, idx) => requestIdOf(row, idx));
  }, [filteredRows, canApprove]);

  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectableIds.length === 0) return;
    setSelectedIds((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });
  }, [selectableIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const openReviewSheet = useCallback((row: Record<string, unknown>, index: number) => {
    setReviewRow(row);
    setReviewRowIndex(index);
  }, []);

  const closeReviewSheet = useCallback(() => {
    setReviewRow(null);
  }, []);

  useEffect(() => {
    if (!openRequestIdParam || !canView || loading) {
      if (!openRequestIdParam) deepLinkWidenedFilterRef.current = false;
      return;
    }
    const idx = rows.findIndex((r) => String(r?.id) === openRequestIdParam);
    if (idx < 0) {
      if (statusFilter === "pending" && !deepLinkWidenedFilterRef.current) {
        deepLinkWidenedFilterRef.current = true;
        setStatusFilter("all");
        return;
      }
      deepLinkWidenedFilterRef.current = false;
      router.setParams({ openRequestId: "" });
      return;
    }
    deepLinkWidenedFilterRef.current = false;
    openReviewSheet(rows[idx] as Record<string, unknown>, idx);
    router.setParams({ openRequestId: "" });
  }, [canView, loading, openRequestIdParam, openReviewSheet, router, rows, statusFilter]);

  const runAction = useCallback(
    async (kind: "approve" | "reject" | "ignore", rid: string) => {
      if (!canApprove) return;
      setActingId(rid);
      try {
        if (kind === "approve") await api.groupRequests.approve(rid);
        else if (kind === "reject") await api.groupRequests.reject(rid);
        else await api.groupRequests.ignore(rid);
        setSelectedIds((s) => {
          const n = new Set(s);
          n.delete(rid);
          return n;
        });
        closeReviewSheet();
        await load();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request action failed";
        Alert.alert("Group request", msg);
      } finally {
        setActingId(null);
      }
    },
    [canApprove, closeReviewSheet, load]
  );

  function confirmThenAction(kind: "approve" | "reject" | "ignore", rid: string) {
    const go = () => void runAction(kind, rid);

    if (kind === "reject") {
      Alert.alert("Decline request", "Decline this join request?", [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: go },
      ]);
      return;
    }
    if (kind === "ignore") {
      Alert.alert(
        "Ignore request",
        "Ignore removes it from the pending list without adding them to the group.",
        [{ text: "Cancel", style: "cancel" }, { text: "Ignore", onPress: go }]
      );
      return;
    }
    void go();
  }

  const runBulk = useCallback(
    async (kind: "approve" | "reject") => {
      if (!canApprove) return;
      const ids = Array.from(selectedIds).filter((id) => selectableIds.includes(id));
      if (ids.length === 0) return;
      setBulkWorking(true);
      let ok = 0;
      let failed = 0;
      try {
        for (const rid of ids) {
          try {
            if (kind === "approve") await api.groupRequests.approve(rid);
            else await api.groupRequests.reject(rid);
            ok += 1;
          } catch {
            failed += 1;
          }
        }
        clearSelection();
        await load();
        if (failed === 0) {
          Alert.alert("Group join requests", `${ok} request(s) ${kind === "approve" ? "approved" : "rejected"}.`);
        } else {
          Alert.alert("Group join requests", `${ok} done, ${failed} failed.`);
        }
      } finally {
        setBulkWorking(false);
      }
    },
    [canApprove, clearSelection, load, selectedIds, selectableIds]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      router.replace("/(tabs)/dashboard");
    }
  }, [navigation, router]);

  const reviewId = reviewRow ? String(reviewRow.id ?? requestIdOf(reviewRow, reviewRowIndex)) : "";
  const reviewPending = reviewRow ? isPending(reviewRow) : false;
  const reviewGid = reviewRow
    ? typeof reviewRow.group_id === "string"
      ? reviewRow.group_id
      : reviewRow.group_id != null
        ? String(reviewRow.group_id)
        : ""
    : "";

  const renderRow = useCallback(
    ({ item: row, index }: { item: Record<string, unknown>; index: number }) => {
      const id = requestIdOf(row, index);
      const name = applicantDisplayName(row);
      const statusRaw = String(row.status || "pending");
      const meta = displayMemberWords(statusRaw.replace(/_/g, " "));
      const sub = submittedLabel(row);
      const selected = selectedIds.has(id);
      const pending = isPending(row);

      const onRowPress = () => {
        if (selectedCount > 0) {
          if (pending && canApprove) toggleSelect(id);
          return;
        }
        openReviewSheet(row, index);
      };

      const onLongPress = () => {
        if (!canApprove || !pending) return;
        toggleSelect(id);
      };

      return (
        <Pressable
          style={[styles.row, selected && styles.rowSelected]}
          onPress={onRowPress}
          onLongPress={onLongPress}
          delayLongPress={350}
        >
          <View style={styles.rowTop}>
            <MemberInitialAvatar initial={applicantInitial(row)} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={2}>
                {name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {sub ? `${meta} · ${sub}` : meta}
              </Text>
            </View>
            {selectedCount > 0 && pending && canApprove ? (
              <View style={[styles.selectCircle, selected && styles.selectCircleActive]}>
                {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [canApprove, openReviewSheet, selectedCount, selectedIds, toggleSelect]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.navHeader}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerTextBlock}>
          <Text style={styles.pageTitle}>Group join requests</Text>
          <Text style={styles.subhead}>Tap a row to review. Long-press to select.</Text>
        </View>
      </View>
      {!canView ? (
        <Text style={styles.muted}>You do not have permission to view group join requests.</Text>
      ) : loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <View style={styles.main}>
          {selectedCount > 0 && canApprove ? (
            <View style={[styles.stickyBulk, { paddingTop: 8 }]}>
              <View style={styles.stickyBulkLeft}>
                <Pressable onPress={toggleSelectAll} style={styles.stickySelectAll} hitSlop={6}>
                  <Ionicons
                    name={allSelectableSelected ? "checkbox" : "square-outline"}
                    size={22}
                    color={colors.accent}
                  />
                  <Text style={styles.stickySelectAllText}>{allSelectableSelected ? "Clear all" : "Select all"}</Text>
                </Pressable>
                <Text style={styles.stickyCount}>{selectedCount} selected</Text>
              </View>
              <View style={styles.stickyBulkActions}>
                {bulkWorking ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <>
                    <Pressable style={[styles.stickyBtn, styles.stickyBtnDanger]} onPress={() => void runBulk("reject")}>
                      <Text style={styles.stickyBtnDangerText}>Reject</Text>
                    </Pressable>
                    <Pressable style={[styles.stickyBtn, styles.stickyBtnPrimary]} onPress={() => void runBulk("approve")}>
                      <Text style={styles.stickyBtnPrimaryText}>Approve</Text>
                    </Pressable>
                    <Pressable onPress={clearSelection} hitSlop={10} accessibilityLabel="Clear selection">
                      <Ionicons name="close" size={22} color={colors.textSecondary} />
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ) : null}

          <View style={styles.toolbarRow}>
            <View style={styles.toolbarSearch}>
              <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search requests..."
                placeholderTextColor={colors.textSecondary}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <FilterTriggerButton
              ref={filterRef}
              open={menuOpen}
              valueLabel={statusFilter === "all" ? "All" : "Pending"}
              accessibilityLabel="Filter status"
              onPress={() => {
                filterRef.current?.measureInWindow((x, y, w, h) => {
                  setAnchor({ x, y, width: w, height: h });
                  setMenuOpen(true);
                });
              }}
            />
          </View>
          <FilterPickerModal
            visible={menuOpen && anchor !== null}
            title="Status"
            options={[
              { value: "pending", label: "Pending" },
              { value: "all", label: "All" },
            ]}
            selectedValue={statusFilter}
            anchorRect={anchor}
            onSelect={(v) => setStatusFilter(v as "pending" | "all")}
            onClose={() => {
              setMenuOpen(false);
              setAnchor(null);
            }}
          />
          {filteredRows.length === 0 ? (
            <Text style={styles.muted}>No group join requests match your search/filter.</Text>
          ) : (
            <FlatList
              style={styles.listFlex}
              data={filteredRows}
              keyExtractor={(row, index) => requestIdOf(row, index)}
              renderItem={renderRow}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
            />
          )}
        </View>
      )}

      <Modal visible={reviewRow !== null} animationType="slide" transparent onRequestClose={closeReviewSheet}>
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetBackdropFill} onPress={closeReviewSheet} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.sheetKb, { paddingBottom: insets.bottom, flex: 1 }]}
          >
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrab}>
                <View style={styles.sheetHandle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Review group join request</Text>
                <Pressable onPress={closeReviewSheet} hitSlop={12}>
                  <Ionicons name="close" size={24} color={colors.textPrimary} />
                </Pressable>
              </View>
              {reviewRow ? (
                <Text style={styles.sheetSubmitted}>
                  {submittedLabel(reviewRow) ? `Submitted ${submittedLabel(reviewRow)}` : ""}
                </Text>
              ) : null}

              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {reviewRow ? (
                  <>
                    <View style={sheetStyles.heroCard}>
                      <MemberInitialAvatar initial={applicantInitial(reviewRow)} size={72} />
                      <View style={{ flex: 1 }}>
                        <Text style={sheetStyles.heroName}>{applicantDisplayName(reviewRow)}</Text>
                        <Text style={sheetStyles.heroMeta} numberOfLines={2}>
                          {groupMinistryName(reviewRow)
                            ? displayMemberWords(groupMinistryName(reviewRow))
                            : "Ministry"}
                        </Text>
                      </View>
                    </View>
                    <ReadField label="Ministry" value={groupMinistryName(reviewRow) ? displayMemberWords(groupMinistryName(reviewRow)) : "—"} />
                    <ReadField label="Status" value={statusLabel(String(reviewRow.status || ""))} />
                    <ReadField label="Date of birth" value={formatDob(reviewRow.dob)} />
                    {reviewGid ? (
                      <Pressable
                        style={styles.openMinistryLink}
                        onPress={() => {
                          closeReviewSheet();
                          router.push({ pathname: "/ministry/[id]", params: { id: reviewGid } });
                        }}
                      >
                        <Ionicons name="open-outline" size={18} color={colors.accent} />
                        <Text style={styles.openMinistryLinkText}>Open ministry</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
              </ScrollView>

              {reviewPending && canApprove ? (
                actingId === reviewId ? (
                  <View style={styles.sheetFooterWorking}>
                    <ActivityIndicator color={colors.accent} />
                  </View>
                ) : (
                  <View style={styles.sheetFooterTriple}>
                    <Pressable style={styles.footerReject} onPress={() => confirmThenAction("reject", reviewId)}>
                      <Text style={styles.footerRejectText}>Reject</Text>
                    </Pressable>
                    <Pressable style={styles.footerIgnore} onPress={() => confirmThenAction("ignore", reviewId)}>
                      <Text style={styles.footerIgnoreText}>Ignore</Text>
                    </Pressable>
                    <Pressable style={styles.footerApprove} onPress={() => confirmThenAction("approve", reviewId)}>
                      <Text style={styles.footerApproveText}>Approve</Text>
                    </Pressable>
                  </View>
                )
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, paddingHorizontal: 16 },
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 8 },
  headerTextBlock: { flex: 1, minWidth: 0 },
  pageTitle: {
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    fontWeight: type.pageTitle.weight,
    color: colors.textPrimary,
  },
  subhead: {
    marginTop: 4,
    fontSize: type.caption.size,
    color: colors.textSecondary,
  },
  stickyBulk: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    zIndex: 4,
  },
  stickyBulkLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  stickySelectAll: { flexDirection: "row", alignItems: "center", gap: 6 },
  stickySelectAllText: { fontSize: type.bodyStrong.size, fontWeight: "600", color: colors.accent },
  stickyCount: { fontSize: type.caption.size, color: colors.textSecondary },
  stickyBulkActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  stickyBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm },
  stickyBtnPrimary: { backgroundColor: colors.accent },
  stickyBtnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: type.caption.size },
  stickyBtnDanger: { backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#fecaca" },
  stickyBtnDangerText: { color: "#991b1b", fontWeight: "700", fontSize: type.caption.size },
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
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
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: type.body.size,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  muted: { marginTop: 16, fontSize: type.body.size, color: colors.textSecondary },
  listFlex: { flex: 1 },
  listContent: { paddingBottom: 24, paddingTop: 4 },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 74,
    padding: 14,
    marginBottom: 4,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: {
    fontSize: type.subtitle.size,
    lineHeight: type.subtitle.lineHeight,
    fontWeight: type.subtitle.weight,
    color: colors.textPrimary,
  },
  meta: {
    fontSize: type.caption.size,
    lineHeight: type.caption.lineHeight,
    color: colors.textSecondary,
    marginTop: 4,
  },
  selectCircle: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  selectCircleActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheetKb: { width: "100%", maxHeight: "92%" },
  sheetCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "100%",
    width: "100%",
    zIndex: 2,
    elevation: 16,
    paddingBottom: 8,
  },
  sheetGrab: { alignItems: "center", paddingTop: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  sheetTitle: { fontSize: type.title.size, fontWeight: "700", color: colors.textPrimary },
  sheetSubmitted: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { paddingHorizontal: 18, paddingBottom: 12 },
  openMinistryLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    alignSelf: "flex-start",
  },
  openMinistryLinkText: { fontSize: type.body.size, fontWeight: "600", color: colors.accent },
  sheetFooterWorking: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: "center",
  },
  sheetFooterTriple: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerReject: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  footerRejectText: { fontWeight: "700", color: "#b91c1c", fontSize: 13 },
  footerIgnore: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  footerIgnoreText: { fontWeight: "700", color: colors.textPrimary, fontSize: 13 },
  footerApprove: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  footerApproveText: { fontWeight: "700", color: "#fff", fontSize: 13 },
});
