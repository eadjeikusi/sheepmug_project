import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { DatePickerField } from "../components/datetime/DatePickerField";
import { MemberInitialAvatar } from "../components/MemberInitialAvatar";
import { api } from "../lib/api";
import { displayMemberWords } from "../lib/memberDisplayFormat";
import { normalizeImageUri } from "../lib/imageUri";
import { usePermissions } from "../hooks/usePermissions";
import { setDashboardLastSeenCounts } from "../lib/storage";
import { useTheme } from "../contexts/ThemeContext";
import { FormModalOverlayHost, useFormModalOverlay } from "../contexts/FormModalOverlayContext";
import { ensurePhotoLibraryPermission } from "../lib/photoLibraryAccess";
import { uploadMemberImageFromUri } from "../lib/uploadMemberImage";
import { colors, radius, type } from "../theme";

type RequestFormData = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  location: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  occupation: string;
  dateJoined: string;
  profileImage: string;
  notes: string;
};

const EMPTY_FORM: RequestFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phoneNumber: "",
  location: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  dateOfBirth: "",
  gender: "",
  maritalStatus: "",
  occupation: "",
  dateJoined: "",
  profileImage: "",
  notes: "",
};

const GENDER_OPTIONS = [
  { value: "", label: "Select gender" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const MARITAL_OPTIONS = [
  { value: "", label: "Select status" },
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

const OPEN_REQUEST_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOpenRequestIdParam(raw: string | string[] | undefined): string {
  const s = typeof raw === "string" ? raw : Array.isArray(raw) && raw[0] ? String(raw[0]) : "";
  const t = s.trim();
  return OPEN_REQUEST_UUID_RE.test(t) ? t : "";
}

/** `typeof null === "object"` — use this instead of `typeof x === "object"` alone. */
function isPlainRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function getFormData(row: unknown): Record<string, unknown> {
  if (!isPlainRecord(row)) return {};
  const fd = row["form_data"];
  if (typeof fd === "object" && fd !== null && !Array.isArray(fd)) return fd as Record<string, unknown>;
  return {};
}

function extractFormData(row: unknown): RequestFormData {
  if (!isPlainRecord(row)) return { ...EMPTY_FORM };
  const fd = getFormData(row);
  const s = (a: unknown, b?: unknown) => String(a ?? b ?? "").trim();
  return {
    firstName: s(fd.firstName, fd.first_name),
    lastName: s(fd.lastName, fd.last_name),
    email: s(fd.email, row.email),
    phoneNumber: String(fd.phoneNumber ?? fd.phone ?? row.phone ?? "").trim(),
    location: s(fd.location),
    emergencyContactName: s(fd.emergencyContactName, fd.emergency_contact_name),
    emergencyContactPhone: s(fd.emergencyContactPhone, fd.emergency_contact_phone),
    dateOfBirth: s(fd.dateOfBirth, fd.date_of_birth),
    gender: s(fd.gender),
    maritalStatus: s(fd.maritalStatus, fd.marital_status),
    occupation: s(fd.occupation),
    dateJoined: s(fd.dateJoined, fd.date_joined),
    profileImage: s(fd.profileImage, fd.profile_image),
    notes: s(fd.notes),
  };
}

function displayNameFromForm(fd: RequestFormData): string {
  const n = `${fd.firstName} ${fd.lastName}`.trim();
  if (n) return n;
  if (fd.email) return fd.email;
  return "Member request";
}

function rowTitle(row: unknown): string {
  return displayNameFromForm(extractFormData(row));
}

function rowSubtitleSearch(row: unknown): string {
  const fd = extractFormData(row);
  return [fd.email, fd.phoneNumber, fd.location].filter(Boolean).join(" ");
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
    row.created_at ?? row.submitted_at ?? row.submittedDate ?? (row as { createdAt?: string }).createdAt;
  if (raw == null || !String(raw).trim()) return "";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function OptionPickModal({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const overlay = useFormModalOverlay();
  const { colors: themeColors } = useTheme();

  useLayoutEffect(() => {
    if (!visible) {
      overlay?.setOverlay(null);
      return;
    }
    if (!overlay) return;
    overlay.setOverlay(
      <View style={optStyles.optRoot}>
        <Pressable style={optStyles.optBackdropFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[optStyles.optCard, { backgroundColor: themeColors.card }]}>
          <Text style={[optStyles.optTitle, { color: themeColors.textPrimary }]}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={optStyles.optScroll}>
            {options.map((o) => (
              <Pressable
                key={o.value || "empty"}
                style={[
                  optStyles.optRow,
                  { borderTopColor: themeColors.border },
                  value === o.value && { backgroundColor: themeColors.accentSurface },
                ]}
                onPress={() => {
                  onSelect(o.value);
                  onClose();
                }}
              >
                <Text
                  style={[
                    optStyles.optRowText,
                    { color: themeColors.textPrimary },
                    value === o.value && { color: themeColors.accent, fontWeight: "600" },
                  ]}
                >
                  {o.label}
                </Text>
                {value === o.value ? <Ionicons name="checkmark" size={18} color={themeColors.accent} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    );
    return () => overlay.setOverlay(null);
  }, [visible, overlay, title, options, value, onSelect, onClose, themeColors]);

  if (overlay) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={optStyles.optRoot}>
        <Pressable style={optStyles.optBackdropFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <View style={[optStyles.optCard, { backgroundColor: themeColors.card }]}>
          <Text style={[optStyles.optTitle, { color: themeColors.textPrimary }]}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={optStyles.optScroll}>
            {options.map((o) => (
              <Pressable
                key={o.value || "empty"}
                style={[
                  optStyles.optRow,
                  { borderTopColor: themeColors.border },
                  value === o.value && { backgroundColor: themeColors.accentSurface },
                ]}
                onPress={() => {
                  onSelect(o.value);
                  onClose();
                }}
              >
                <Text
                  style={[
                    optStyles.optRowText,
                    { color: themeColors.textPrimary },
                    value === o.value && { color: themeColors.accent, fontWeight: "600" },
                  ]}
                >
                  {o.label}
                </Text>
                {value === o.value ? <Ionicons name="checkmark" size={18} color={themeColors.accent} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const optStyles = StyleSheet.create({
  optRoot: { flex: 1, justifyContent: "center", padding: 24 },
  optBackdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  optCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    maxHeight: "70%",
    paddingVertical: 12,
    zIndex: 2,
    elevation: 6,
  },
  optTitle: {
    fontSize: type.title.size,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingBottom: 8,
    color: colors.textPrimary,
  },
  optScroll: { maxHeight: 360 },
  optRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optRowText: { fontSize: type.body.size },
});

export default function MemberJoinRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ openRequestId?: string | string[] }>();
  const openRequestIdParam = useMemo(
    () => parseOpenRequestIdParam(params.openRequestId),
    [params.openRequestId]
  );
  const deepLinkWidenedFilterRef = useRef(false);
  const navigation = useNavigation();
  const { can } = usePermissions();
  const canView = can("view_member_requests") || can("approve_member_requests");
  const canApprove = can("approve_member_requests");

  const dobMaxDate = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999);
  }, []);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const [reviewRow, setReviewRow] = useState<Record<string, unknown> | null>(null);
  const [reviewRowIndex, setReviewRowIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [draftForm, setDraftForm] = useState<RequestFormData>(EMPTY_FORM);
  const [optionPickerKind, setOptionPickerKind] = useState<null | "gender" | "marital">(null);
  const [profileImageUploading, setProfileImageUploading] = useState(false);

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
      const list = await api.memberRequests
        .list(statusFilter === "all" ? undefined : { status: "pending" })
        .catch(() => []);
      const raw = Array.isArray(list) ? list : [];
      const arr = raw.filter((x): x is Record<string, unknown> => isPlainRecord(x));
      setRows(arr);
      const pendingCount = arr.filter((x) => String(x.status || "").toLowerCase() === "pending").length;
      await setDashboardLastSeenCounts({ memberRequests: pendingCount });
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
      const blob = `${rowTitle(row)} ${rowSubtitleSearch(row)} ${String(row.status || "")}`.toLowerCase();
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
    setDraftForm(extractFormData(row));
    setEditMode(false);
  }, []);

  /** Push / in-app notification: open review sheet for `openRequestId` route param. */
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
    openReviewSheet(rows[idx], idx);
    router.setParams({ openRequestId: "" });
  }, [canView, loading, openRequestIdParam, openReviewSheet, router, rows, statusFilter]);

  const closeReviewSheet = useCallback(() => {
    setReviewRow(null);
    setEditMode(false);
    setDraftForm(EMPTY_FORM);
    setOptionPickerKind(null);
  }, []);

  const runAction = useCallback(
    async (kind: "approve" | "reject", rid: string) => {
      if (!canApprove) return;
      setActingId(rid);
      try {
        if (kind === "approve") await api.memberRequests.approve(rid);
        else await api.memberRequests.reject(rid);
        setSelectedIds((s) => {
          const n = new Set(s);
          n.delete(rid);
          return n;
        });
        closeReviewSheet();
        await load();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        Alert.alert("Member request", msg);
      } finally {
        setActingId(null);
      }
    },
    [canApprove, closeReviewSheet, load]
  );

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
            if (kind === "approve") await api.memberRequests.approve(rid);
            else await api.memberRequests.reject(rid);
            ok += 1;
          } catch {
            failed += 1;
          }
        }
        clearSelection();
        await load();
        if (failed === 0) {
          Alert.alert("Member requests", `${ok} request(s) ${kind === "approve" ? "approved" : "rejected"}.`);
        } else {
          Alert.alert("Member requests", `${ok} done, ${failed} failed.`);
        }
      } finally {
        setBulkWorking(false);
      }
    },
    [canApprove, clearSelection, load, selectedIds, selectableIds]
  );

  const saveEdits = useCallback(async () => {
    if (!reviewRow || !canApprove) return;
    const rid = String(reviewRow.id ?? "");
    if (!rid) return;
    setActingId(rid);
    try {
      await api.memberRequests.update(rid, {
        form_data: { ...draftForm },
      });
      await load();
      setReviewRow((prev) =>
        prev && String(prev.id) === rid ? { ...prev, form_data: { ...draftForm } } : prev
      );
      setEditMode(false);
      Alert.alert("Member request", "Changes saved.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      Alert.alert("Member request", msg);
    } finally {
      setActingId(null);
    }
  }, [reviewRow, canApprove, draftForm, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const pickProfileImage = useCallback(async () => {
    if (!canApprove) return;
    if (!(await ensurePhotoLibraryPermission())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setProfileImageUploading(true);
    try {
      const url = await uploadMemberImageFromUri(result.assets[0].uri);
      setDraftForm((d) => ({ ...d, profileImage: url }));
    } catch (e) {
      Alert.alert("Member request", e instanceof Error ? e.message : "Could not upload image");
    } finally {
      setProfileImageUploading(false);
    }
  }, [canApprove]);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace("/(tabs)/dashboard");
  }, [navigation, router]);

  const reviewId = reviewRow ? String(reviewRow.id ?? requestIdOf(reviewRow, reviewRowIndex)) : "";
  const reviewPending = reviewRow ? isPending(reviewRow) : false;
  const sheetProfileUri = normalizeImageUri(draftForm.profileImage || null);

  const renderRow = useCallback(
    ({ item: row, index }: { item: Record<string, unknown>; index: number }) => {
      const id = requestIdOf(row, index);
      const fd = extractFormData(row);
      const rowProfileUri = normalizeImageUri(fd.profileImage || null);
      const name = displayMemberWords(displayNameFromForm(fd));
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
            {rowProfileUri ? (
              <Image source={{ uri: rowProfileUri }} style={styles.avatarImage} />
            ) : (
              <MemberInitialAvatar initial={fd.firstName?.[0] || fd.lastName?.[0] || "M"} size={40} />
            )}
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
          <Text style={styles.pageTitle}>Member join requests</Text>
          <Text style={styles.subhead}>Tap a row to review. Long-press to select.</Text>
        </View>
      </View>

      {!canView ? (
        <Text style={styles.muted}>You do not have permission to view member join requests.</Text>
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
                <Text style={styles.stickyCount}>
                  {selectedCount} selected
                </Text>
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
            <Text style={styles.muted}>No member join requests match your search/filter.</Text>
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
            <FormModalOverlayHost>
            <View style={styles.sheetCard}>
              <View style={styles.sheetGrab}>
                <View style={styles.sheetHandle} />
              </View>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>Review application</Text>
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
                <View style={styles.heroCard}>
                  {editMode && canApprove ? (
                    <Pressable
                      style={styles.heroImageWrap}
                      onPress={() => void pickProfileImage()}
                      disabled={profileImageUploading}
                      accessibilityLabel="Change profile photo"
                    >
                      {sheetProfileUri ? (
                        <Image source={{ uri: sheetProfileUri }} style={styles.heroImg} />
                      ) : (
                        <View style={styles.heroImgPlaceholder}>
                          <MemberInitialAvatar initial={draftForm.firstName?.[0] || "M"} size={72} />
                        </View>
                      )}
                      <View style={styles.heroPhotoEditBadge}>
                        {profileImageUploading ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Ionicons name="camera" size={18} color="#fff" />
                        )}
                      </View>
                    </Pressable>
                  ) : sheetProfileUri ? (
                    <Image source={{ uri: sheetProfileUri }} style={styles.heroImg} />
                  ) : (
                    <View style={styles.heroImgPlaceholder}>
                      <MemberInitialAvatar initial={draftForm.firstName?.[0] || "M"} size={72} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroName}>
                      {displayMemberWords(
                        `${draftForm.firstName} ${draftForm.lastName}`.trim() ||
                          (reviewRow ? rowTitle(reviewRow) : "Member request")
                      )}
                    </Text>
                    {!editMode ? (
                      <View style={styles.heroMetaGrid}>
                        <Text style={styles.heroMetaMuted}>Gender</Text>
                        <Text style={styles.heroMetaVal}>
                          {GENDER_OPTIONS.find((o) => o.value === draftForm.gender)?.label || "—"}
                        </Text>
                        <Text style={styles.heroMetaMuted}>Marital status</Text>
                        <Text style={styles.heroMetaVal}>
                          {MARITAL_OPTIONS.find((o) => o.value === draftForm.maritalStatus)?.label || "—"}
                        </Text>
                        <Text style={styles.heroMetaMuted}>Occupation</Text>
                        <Text style={styles.heroMetaVal} numberOfLines={2}>
                          {draftForm.occupation ? displayMemberWords(draftForm.occupation) : "—"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {editMode ? (
                  <View style={styles.formBlock}>
                    <Text style={styles.formSectionTitle}>Edit application details</Text>
                    <Text style={styles.inputLabel}>First name</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.firstName}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, firstName: t }))}
                    />
                    <Text style={styles.inputLabel}>Last name</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.lastName}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, lastName: t }))}
                    />
                    <Text style={styles.inputLabel}>Email</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.email}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, email: t }))}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <Text style={styles.inputLabel}>Phone number</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.phoneNumber}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, phoneNumber: t }))}
                      keyboardType="phone-pad"
                    />
                    <Text style={styles.inputLabel}>Location</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.location}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, location: t }))}
                    />
                    <Text style={styles.inputLabel}>Emergency contact name</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.emergencyContactName}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, emergencyContactName: t }))}
                    />
                    <Text style={styles.inputLabel}>Emergency contact phone</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.emergencyContactPhone}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, emergencyContactPhone: t }))}
                      keyboardType="phone-pad"
                    />
                    <Text style={styles.inputLabel}>Date of birth</Text>
                    <DatePickerField
                      value={draftForm.dateOfBirth}
                      onChange={(v) => setDraftForm((d) => ({ ...d, dateOfBirth: v }))}
                      placeholder="Date of birth"
                      maximumDate={dobMaxDate}
                    />
                    <Text style={styles.inputLabel}>Gender</Text>
                    <Pressable style={styles.fakeInput} onPress={() => setOptionPickerKind("gender")}>
                      <Text style={draftForm.gender ? styles.fakeInputText : styles.fakeInputPlaceholder}>
                        {GENDER_OPTIONS.find((o) => o.value === draftForm.gender)?.label || "Select gender"}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Text style={styles.inputLabel}>Marital status</Text>
                    <Pressable style={styles.fakeInput} onPress={() => setOptionPickerKind("marital")}>
                      <Text style={draftForm.maritalStatus ? styles.fakeInputText : styles.fakeInputPlaceholder}>
                        {MARITAL_OPTIONS.find((o) => o.value === draftForm.maritalStatus)?.label || "Select status"}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                    </Pressable>
                    <Text style={styles.inputLabel}>Occupation</Text>
                    <TextInput
                      style={styles.input}
                      value={draftForm.occupation}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, occupation: t }))}
                    />
                    <Text style={styles.inputLabel}>Date joined</Text>
                    <DatePickerField
                      value={draftForm.dateJoined}
                      onChange={(v) => setDraftForm((d) => ({ ...d, dateJoined: v }))}
                      placeholder="Date joined"
                    />
                    <Text style={styles.inputLabel}>Notes</Text>
                    <TextInput
                      style={[styles.input, styles.inputMultiline]}
                      value={draftForm.notes}
                      onChangeText={(t) => setDraftForm((d) => ({ ...d, notes: t }))}
                      multiline
                    />
                    <View style={styles.editActions}>
                      <Pressable
                        style={styles.btnSecondary}
                        onPress={() => {
                          setEditMode(false);
                          if (reviewRow) setDraftForm(extractFormData(reviewRow));
                        }}
                      >
                        <Text style={styles.btnSecondaryText}>Cancel edit</Text>
                      </Pressable>
                      <Pressable style={styles.btnPrimary} onPress={() => void saveEdits()} disabled={actingId === reviewId}>
                        <Text style={styles.btnPrimaryText}>Save changes</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.formBlock}>
                    <View style={styles.readHead}>
                      <Text style={styles.formSectionTitle}>Contact information</Text>
                      {reviewPending && canApprove ? (
                        <Pressable
                          onPress={() => setEditMode(true)}
                          style={styles.editLink}
                        >
                          <Ionicons name="create-outline" size={16} color={colors.accent} />
                          <Text style={styles.editLinkText}>Edit details</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <ReadField label="Email" value={draftForm.email || "—"} />
                    <ReadField label="Phone" value={draftForm.phoneNumber || "—"} />
                    <ReadField label="Location" value={draftForm.location || "—"} />
                    <ReadField label="Emergency contact name" value={draftForm.emergencyContactName || "—"} />
                    <ReadField label="Emergency contact phone" value={draftForm.emergencyContactPhone || "—"} />
                    <ReadField label="Date of birth" value={draftForm.dateOfBirth || "—"} />
                    <ReadField label="Date joined" value={draftForm.dateJoined || "—"} />
                    {draftForm.notes ? (
                      <View style={styles.notesBox}>
                        <Text style={styles.inputLabel}>Notes</Text>
                        <Text style={styles.notesText}>{draftForm.notes}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </ScrollView>

              {reviewPending && canApprove ? (
                <View style={styles.sheetFooter}>
                  <Pressable
                    style={styles.footerReject}
                    onPress={() => void runAction("reject", reviewId)}
                    disabled={actingId === reviewId}
                  >
                    <Text style={styles.footerRejectText}>Reject</Text>
                  </Pressable>
                  <Pressable
                    style={styles.footerApprove}
                    onPress={() => void runAction("approve", reviewId)}
                    disabled={actingId === reviewId}
                  >
                    <Text style={styles.footerApproveText}>Approve</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <OptionPickModal
              visible={optionPickerKind !== null}
              title={optionPickerKind === "marital" ? "Marital status" : "Gender"}
              options={optionPickerKind === "marital" ? MARITAL_OPTIONS : GENDER_OPTIONS}
              value={optionPickerKind === "marital" ? draftForm.maritalStatus : draftForm.gender}
              onSelect={(v) =>
                setDraftForm((d) =>
                  optionPickerKind === "marital" ? { ...d, maritalStatus: v } : { ...d, gender: v }
                )
              }
              onClose={() => setOptionPickerKind(null)}
            />
            </FormModalOverlayHost>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readField}>
      <Text style={styles.readLabel}>{label}</Text>
      <Text style={styles.readValue}>{value}</Text>
    </View>
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
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: "#efefef",
  },
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
  heroCard: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    marginBottom: 16,
  },
  heroImageWrap: { position: "relative", width: 96, height: 96 },
  heroImg: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: "#e5e7eb" },
  heroImgPlaceholder: { width: 96, height: 96, alignItems: "center", justifyContent: "center" },
  heroPhotoEditBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: radius.pill,
    padding: 6,
  },
  heroName: {
    fontSize: type.subtitle.size,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  heroMetaGrid: { gap: 6 },
  heroMetaMuted: { fontSize: 11, color: colors.textSecondary, textTransform: "uppercase" },
  heroMetaVal: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: "500" },
  formBlock: { gap: 0, marginBottom: 12 },
  formSectionTitle: { fontSize: type.bodyStrong.size, fontWeight: "700", color: colors.textPrimary, marginBottom: 10 },
  readHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  editLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  editLinkText: { fontSize: type.caption.size, fontWeight: "600", color: colors.accent },
  readField: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  readLabel: { fontSize: type.caption.size, color: colors.textSecondary, marginBottom: 4 },
  readValue: { fontSize: type.body.size, color: colors.textPrimary, fontWeight: "500" },
  notesBox: { marginTop: 12, padding: 12, backgroundColor: colors.accentSurface, borderRadius: radius.sm },
  notesText: { fontSize: type.body.size, color: colors.textPrimary },
  inputLabel: {
    fontSize: type.caption.size,
    color: colors.textSecondary,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: type.body.size,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: "top" },
  fakeInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.card,
  },
  fakeInputText: { fontSize: type.body.size, color: colors.textPrimary },
  fakeInputPlaceholder: { fontSize: type.body.size, color: colors.textSecondary },
  editActions: { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 8 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  btnSecondaryText: { fontWeight: "600", color: colors.textPrimary },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: "center" },
  btnPrimaryText: { fontWeight: "700", color: "#fff" },
  sheetFooter: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerReject: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
  },
  footerRejectText: { fontWeight: "700", color: "#b91c1c" },
  footerApprove: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
  },
  footerApproveText: { fontWeight: "700", color: "#fff" },
});
