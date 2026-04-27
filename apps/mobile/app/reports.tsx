import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Dimensions } from "react-native";
import { BlurView } from "expo-blur";
import { useNavigation } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useTheme } from "../contexts/ThemeContext";
import { usePermissions } from "../hooks/usePermissions";
import { DatePickerField } from "../components/datetime/DatePickerField";
import { ReportHistoryTableSkeleton } from "../components/DataSkeleton";
import { ReportGroupTreeModal } from "../components/reports/ReportGroupTreeModal";
import { displayMemberWords, toTitleCaseWords } from "../lib/memberDisplayFormat";
import {
  applyReportDatePreset,
  inclusiveLocalDayCount,
  localDayBoundsToIso,
  newDefaultReportDateRangeYmd,
  type ReportDatePresetId,
} from "../lib/dateTimeFormat";
import type { ReportGroupRow } from "../lib/reportGroupTree";
import { colors, radius, type, type ThemeColors } from "../theme";
import { shareReportFromDownloadPath, shareReportFromExportResponse } from "../lib/downloadReportExport";
import {
  formatPreviewCountPctCell,
  formatReportTableCellValueForPreview,
  getReportTableColumnLabel,
  mergeCountPctColumns,
  orderPreviewTableColumns,
} from "@sheepmug/shared-api";

type ReportType = "group" | "membership" | "leader";

const REPORT_DATE_PRESETS: Array<{ id: ReportDatePresetId; label: string }> = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "thisMonth", label: "This month" },
  { id: "ytd", label: "Year to date" },
];

const REPORT_TYPES: Array<{ value: ReportType; label: string; blurb: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: "group", label: "Group report", blurb: "Attendance and events for selected groups and dates.", icon: "layers-outline" },
  { value: "membership", label: "Membership report", blurb: "Per-member tasks, attendance, and ministries. Filter by group, type, or individuals.", icon: "people-outline" },
  { value: "leader", label: "Leaders report", blurb: "Task metrics for a leader and their groups.", icon: "person-circle-outline" },
];

function formatDate(input: string | null | undefined) {
  if (!input) return "—";
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString();
}

/**
 * Relative time for history (Hermes may not ship `Intl.RelativeTimeFormat`; avoid it).
 * Style: "3 hours ago" / "In 2 days" — no "about" prefix.
 */
function formatHistoryRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = Date.now();
  const past = d.getTime() <= now;
  const secTotal = Math.floor(Math.abs(d.getTime() - now) / 1000);
  if (secTotal < 45) return past ? "Just now" : "Soon";

  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "—");

  const mins = Math.floor(secTotal / 60);
  if (mins < 60) {
    const u = mins === 1 ? "minute" : "minutes";
    return cap(past ? `${mins} ${u} ago` : `In ${mins} ${u}`);
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const u = hrs === 1 ? "hour" : "hours";
    return cap(past ? `${hrs} ${u} ago` : `In ${hrs} ${u}`);
  }
  const days = Math.floor(hrs / 24);
  if (days < 7) {
    const u = days === 1 ? "day" : "days";
    return cap(past ? `${days} ${u} ago` : `In ${days} ${u}`);
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    const u = weeks === 1 ? "week" : "weeks";
    return cap(past ? `${weeks} ${u} ago` : `In ${weeks} ${u}`);
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    const u = months === 1 ? "month" : "months";
    return cap(past ? `${months} ${u} ago` : `In ${months} ${u}`);
  }
  const years = Math.max(1, Math.floor(days / 365));
  const u = years === 1 ? "year" : "years";
  return cap(past ? `${years} ${u} ago` : `In ${years} ${u}`);
}

export default function ReportsScreen() {
  const { can } = usePermissions();
  const canViewReports = can("report_view") || can("view_analytics");
  const canExportReports = can("export_data");
  const canGroup = can("report_group");
  const canMembers = can("report_members");
  const canLeaders = can("report_leaders");

  const [rows, setRows] = useState<any[]>([]);
  const [groups, setGroups] = useState<ReportGroupRow[]>([]);
  const [members, setMembers] = useState<Array<{ value: string; label: string; status?: string | null }>>([]);
  const [events, setEvents] = useState<Array<{ value: string; label: string; eventType?: string | null }>>([]);
  const [leaders, setLeaders] = useState<Array<{ value: string; label: string }>>([]);
  const [mergedEventTypeSlugs, setMergedEventTypeSlugs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [groupTreeOpen, setGroupTreeOpen] = useState(false);
  const [resultFiltersOpen, setResultFiltersOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [reportType, setReportType] = useState<ReportType>("group");
  const [resultReportName, setResultReportName] = useState("");
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [reportDateRange, setReportDateRange] = useState(() => newDefaultReportDateRangeYmd());
  const [selectedEventTypeSlugs, setSelectedEventTypeSlugs] = useState<string[]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectAllEvents, setSelectAllEvents] = useState(true);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [selectAllMembers, setSelectAllMembers] = useState(false);
  const [selectedMemberStatuses, setSelectedMemberStatuses] = useState<string[]>([]);
  const [selectedLeaderId, setSelectedLeaderId] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyDetail, setHistoryDetail] = useState<Record<string, unknown> | null>(null);
  const [eventTypesModalOpen, setEventTypesModalOpen] = useState(false);

  const navigation = useNavigation();
  const windowHeight = Dimensions.get("window").height;
  const { colors: themeColors, resolvedScheme } = useTheme();
  const openCreateRef = useRef<() => void>(() => {});

  const allowedTypes = useMemo(
    () => REPORT_TYPES.filter((t) => (t.value === "group" ? canGroup : t.value === "membership" ? canMembers : canLeaders)),
    [canGroup, canLeaders, canMembers]
  );
  const memberStatusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const m of members) {
      const x = String(m.status || "").trim().toLowerCase();
      if (x) s.add(x);
    }
    return [...s].sort();
  }, [members]);
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.label.toLowerCase().includes(q));
  }, [memberSearch, members]);
  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    const typeSet = new Set(selectedEventTypeSlugs);
    return events.filter((e) => {
      const et = String(e.eventType || "").toLowerCase();
      if (typeSet.size > 0 && !typeSet.has(et)) return false;
      if (!q) return true;
      return e.label.toLowerCase().includes(q);
    });
  }, [eventSearch, events, selectedEventTypeSlugs]);

  const filteredHistoryRows = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row: { report_name?: string; description?: string; data_filtered?: string }) => {
      const name = String(row?.report_name || "").toLowerCase();
      const desc = String(row?.description || "").toLowerCase();
      const dataF = String(row?.data_filtered || "").toLowerCase();
      return name.includes(q) || desc.includes(q) || dataF.includes(q);
    });
  }, [rows, historySearch]);

  const loadData = useCallback(async () => {
    if (!canViewReports) return;
    try {
      const [etList, history, groupRows, memberRows, eventRows, leadersResp] = await Promise.all([
        api.eventTypes.list().catch(() => [] as { name?: string }[]),
        api.reports.historyTable({ limit: 50 }),
        api.groups.list({ tree: true }),
        api.members.list({ limit: 500 }),
        api.events.list({ limit: 500 }),
        api.reports.listLeaders().catch(() => ({ leaders: [] as any[] })),
      ]);
      const rawRows: any[] = Array.isArray(history.rows) ? history.rows : [];
      const seenRun = new Set<string>();
      setRows(
        rawRows.filter((row) => {
          const id = String(row?.run_id ?? "").trim();
          if (!id) return true;
          if (seenRun.has(id)) return false;
          seenRun.add(id);
          return true;
        })
      );
      setGroups(
        (groupRows as { id?: string; name?: string; parent_group_id?: string | null }[])
          .map((g) => ({
            id: String(g.id || ""),
            name: String(g.name || "Group"),
            parent_group_id: g.parent_group_id != null && String(g.parent_group_id) ? String(g.parent_group_id) : null,
          }))
          .filter((g) => g.id)
      );
      const memRows = Array.isArray((memberRows as any)?.members) ? (memberRows as any).members : [];
      setMembers(
        memRows
          .map((m: any) => ({
            value: String(m.id || ""),
            label: `${String(m.first_name || "").trim()} ${String(m.last_name || "").trim()}`.trim() || "Member",
            status: m.status,
          }))
          .filter((m: any) => m.value)
      );
      const evtRows = Array.isArray((eventRows as any)?.events) ? (eventRows as any).events : Array.isArray(eventRows) ? (eventRows as any[]) : [];
      const typeSlugs = new Set<string>();
      for (const r of etList) {
        const n = String((r as { name?: string }).name || "").trim();
        if (n) typeSlugs.add(n.toLowerCase());
      }
      setEvents(
        evtRows
          .map((e: any) => {
            const et = e.event_type != null ? String(e.event_type) : "";
            if (et) typeSlugs.add(et.toLowerCase());
            return { value: String(e.id || ""), label: String(e.title || "Event"), eventType: e.event_type || null };
          })
          .filter((e: any) => e.value)
      );
      setMergedEventTypeSlugs([...typeSlugs].sort((a, b) => a.localeCompare(b)));
      const leaderRows = Array.isArray((leadersResp as any)?.leaders) ? (leadersResp as any).leaders : [];
      setLeaders(
        leaderRows
          .map((l: any) => ({
            value: String(l.id || ""),
            label: `${String(l.first_name || "").trim()} ${String(l.last_name || "").trim()}`.trim() || String(l.email || "Leader"),
          }))
          .filter((l: any) => l.value)
      );
    } catch {
      // fallback
    } finally {
      setInitialLoadDone(true);
    }
  }, [canViewReports]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  openCreateRef.current = () => {
    resetFlow();
    setOpen(true);
  };

  useLayoutEffect(() => {
    const headerStyle = { backgroundColor: themeColors.bg };
    const headerTitleStyle = { fontSize: 18, fontWeight: "600" as const, color: themeColors.textPrimary };
    if (!canViewReports) {
      navigation.setOptions({
        headerShown: true,
        title: "Reports",
        headerStyle,
        headerTitleStyle,
        headerTintColor: themeColors.textPrimary,
        headerRight: () => null,
      });
      return;
    }
    navigation.setOptions({
      headerShown: true,
      title: "Reports",
      headerStyle,
      headerTitleStyle,
      headerTintColor: themeColors.textPrimary,
      headerRight: () => (
        <Pressable
          onPress={() => openCreateRef.current()}
          style={({ pressed }) => [
            styles.headerCreateBtn,
            { backgroundColor: themeColors.accent },
            pressed && { opacity: 0.92 },
            Platform.OS === "android" && { elevation: 0 },
            Platform.OS === "ios" && { shadowOpacity: 0 },
          ]}
          accessibilityLabel="Create report"
          hitSlop={6}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.headerCreateBtnText}>Create report</Text>
        </Pressable>
      ),
    });
  }, [navigation, canViewReports, themeColors]);

  function resetFlow() {
    setStep(1);
    setError(null);
    setPreview(null);
    setLoading(false);
    setResultReportName("");
    setSavedRunId(null);
    setResultFiltersOpen(false);
    setGroupTreeOpen(false);
    setEventTypesModalOpen(false);
    setReportDateRange(newDefaultReportDateRangeYmd());
    setSelectedEventTypeSlugs([]);
    setEventSearch("");
    setSelectedGroupIds([]);
    setSelectedEventIds([]);
    setSelectAllEvents(true);
    setMemberSearch("");
    setSelectedMemberIds([]);
    setSelectAllMembers(false);
    setSelectedMemberStatuses([]);
    setSelectedLeaderId("");
    if (allowedTypes.length > 0) setReportType(allowedTypes[0].value);
  }

  function filtersPayload() {
    const isMembership = reportType === "membership";
    const span = inclusiveLocalDayCount(reportDateRange.start, reportDateRange.end);
    const localBounds = localDayBoundsToIso(reportDateRange.start, reportDateRange.end);
    return {
      range_days: span > 0 ? span : 90,
      range_start: reportDateRange.start,
      range_end: reportDateRange.end,
      range_start_utc: localBounds?.start,
      range_end_utc: localBounds?.end,
      client_clock_iso: new Date().toISOString(),
      group_ids: reportType === "group" || reportType === "membership" ? selectedGroupIds : undefined,
      event_types: isMembership ? [] : selectedEventTypeSlugs,
      event_search: isMembership ? undefined : eventSearch || undefined,
      event_ids: isMembership ? undefined : selectAllEvents ? undefined : selectedEventIds,
      member_ids: isMembership && !selectAllMembers ? selectedMemberIds : undefined,
      select_all_members: isMembership ? selectAllMembers : undefined,
      member_statuses: isMembership && selectedMemberStatuses.length > 0 ? selectedMemberStatuses : undefined,
      leader_id: reportType === "leader" ? selectedLeaderId || undefined : undefined,
      attendance_statuses: ["present", "absent", "unsure", "not_marked"] as const,
    };
  }

  function renderFilterFields() {
    return (
      <View style={styles.sectionGap}>
        <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Date range</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          {REPORT_DATE_PRESETS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setReportDateRange(applyReportDatePreset(p.id))}
              style={[styles.presetChip, { borderColor: themeColors.border, backgroundColor: themeColors.card }]}
            >
              <Text style={[styles.presetChipText, { color: themeColors.textPrimary }]}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.rangeRow}>
          <View style={styles.rangeHalf}>
            <Text style={[styles.rangeLabel, { color: themeColors.textSecondary }]}>Start</Text>
            <DatePickerField
              value={reportDateRange.start}
              onChange={(ymd) => setReportDateRange((r) => ({ ...r, start: ymd }))}
              placeholder="Start"
            />
          </View>
          <View style={styles.rangeHalf}>
            <Text style={[styles.rangeLabel, { color: themeColors.textSecondary }]}>End</Text>
            <DatePickerField
              value={reportDateRange.end}
              onChange={(ymd) => setReportDateRange((r) => ({ ...r, end: ymd }))}
              placeholder="End"
            />
          </View>
        </View>

        {reportType !== "membership" ? (
          <>
            <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Event types</Text>
            <Pressable
              onPress={() => setEventTypesModalOpen(true)}
              style={[styles.dropdownTrigger, { borderColor: themeColors.border, backgroundColor: themeColors.bg }]}
            >
              <Text style={{ color: themeColors.textPrimary, flex: 1, fontSize: 15 }} numberOfLines={1}>
                {mergedEventTypeSlugs.length === 0
                  ? "No types in scope"
                  : selectedEventTypeSlugs.length === 0
                    ? "All event types"
                    : `${selectedEventTypeSlugs.length} type${selectedEventTypeSlugs.length === 1 ? "" : "s"} selected`}
              </Text>
              <Ionicons name="chevron-down" size={20} color={themeColors.textSecondary} />
            </Pressable>
            <Text style={styles.subtleHint}>Choose types in the list. None selected means all types.</Text>
          </>
        ) : null}

        {(reportType === "group" || reportType === "membership") && (
          <>
            <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Groups</Text>
            <View style={styles.groupPickerRow}>
              <Pressable onPress={() => setGroupTreeOpen(true)} style={styles.groupPickerMain}>
                <Ionicons name="git-network-outline" size={18} color={themeColors.accent} />
                <Text style={styles.groupPickerText} numberOfLines={1}>
                  {selectedGroupIds.length === 0 ? "Select groups" : `${selectedGroupIds.length} group(s) selected`}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
              {selectedGroupIds.length > 0 ? (
                <Pressable
                  onPress={() => setSelectedGroupIds([])}
                  hitSlop={8}
                  style={styles.clearGroups}
                >
                  <Text style={styles.clearGroupsText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.subtleHint}>Subgroups are included when you select a parent.</Text>
          </>
        )}

        {reportType === "group" ? (
          <>
            <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Events</Text>
            <TextInput
              value={eventSearch}
              onChangeText={setEventSearch}
              placeholder="Search events"
              style={[styles.input, { borderColor: themeColors.border, color: themeColors.textPrimary, backgroundColor: themeColors.bg }]}
              placeholderTextColor={themeColors.textSecondary}
            />
            <Pressable onPress={() => setSelectAllEvents((v) => !v)} style={styles.toggleRow}>
              <Text style={styles.subtle}>{selectAllEvents ? "All events in range" : "Choose specific events"}</Text>
            </Pressable>
            {!selectAllEvents ? (
              <View style={styles.pickList}>
                {filteredEvents.map((e) => (
                  <Pressable
                    key={e.value}
                    onPress={() => setSelectedEventIds((p) => (p.includes(e.value) ? p.filter((x) => x !== e.value) : [...p, e.value]))}
                    style={styles.pickItem}
                  >
                    <Text style={styles.subtle}>
                      {selectedEventIds.includes(e.value) ? "☑" : "☐"} {e.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {reportType === "membership" ? (
          <>
            {memberStatusOptions.length > 0 ? (
              <>
                <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Member status</Text>
                <View style={styles.chipsWrap}>
                  {memberStatusOptions.map((st) => {
                    const on = selectedMemberStatuses.includes(st);
                    return (
                      <Pressable
                        key={st}
                        onPress={() => setSelectedMemberStatuses((p) => (p.includes(st) ? p.filter((x) => x !== st) : [...p, st]))}
                        style={[styles.chip, on && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextActive]}>{st}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary, marginTop: 4 }]}>Members</Text>
            <TextInput
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder="Search members"
              style={[styles.input, { borderColor: themeColors.border, color: themeColors.textPrimary, backgroundColor: themeColors.bg }]}
              placeholderTextColor={themeColors.textSecondary}
            />
            <Pressable onPress={() => setSelectAllMembers((v) => !v)} style={styles.toggleRow}>
              <Text style={styles.subtle}>{selectAllMembers ? "All members in scope" : "Pick specific members"}</Text>
            </Pressable>
            {!selectAllMembers ? (
              <View style={styles.pickList}>
                {filteredMembers.map((m) => (
                  <Pressable
                    key={m.value}
                    onPress={() => setSelectedMemberIds((p) => (p.includes(m.value) ? p.filter((x) => x !== m.value) : [...p, m.value]))}
                    style={styles.pickItem}
                  >
                    <Text style={styles.subtle}>
                      {selectedMemberIds.includes(m.value) ? "☑" : "☐"} {m.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {reportType === "leader" ? (
          <View>
            <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Leader</Text>
            <View style={styles.pickList}>
            {leaders.length === 0 ? (
              <Text style={styles.subtle}>No leaders in scope</Text>
            ) : (
              leaders.map((l) => (
                <Pressable key={l.value} onPress={() => setSelectedLeaderId(l.value)} style={styles.pickItem}>
                  <Text style={styles.subtle}>
                    {selectedLeaderId === l.value ? "◉" : "○"} {l.label}
                  </Text>
                </Pressable>
              ))
            )}
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  async function previewReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.reports.preview({ report_type: reportType, filters: filtersPayload() as any });
      setPreview(res.preview || null);
      setSavedRunId(null);
      setResultReportName("");
      setResultFiltersOpen(false);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveReport() {
    const name = resultReportName.trim();
    if (!name) {
      setError("Enter a report name to save to history.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await api.reports.generate({
        report_type: reportType,
        name,
        description: "",
        filters: filtersPayload() as any,
      } as any);
      setSavedRunId(out.run_id || null);
      if (out.report) setPreview(out.report);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function exportReport(fmt: "csv" | "pdf") {
    if (!canExportReports) {
      setError("You need export permission for CSV and PDF.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await api.reports.export({
        run_id: savedRunId || undefined,
        report: preview as any,
        format: fmt,
      } as any);
      await shareReportFromExportResponse(out);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!canViewReports) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: themeColors.bg }]} edges={["bottom"]}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Reports</Text>
          <Text style={styles.subtle}>You do not have permission to view reports.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: themeColors.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={[styles.historyCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
          <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Reports history</Text>
          <View
            style={[
              styles.historySearchRow,
              { backgroundColor: themeColors.bg, borderColor: themeColors.border },
            ]}
          >
            <Ionicons name="search" size={16} color={themeColors.textSecondary} />
            <TextInput
              value={historySearch}
              onChangeText={setHistorySearch}
              placeholder="Search by name, description, or filters"
              placeholderTextColor={themeColors.textSecondary}
              style={[styles.historySearchInput, { color: themeColors.textPrimary }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {historySearch.trim() ? (
              <Pressable onPress={() => setHistorySearch("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={themeColors.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.historyTableOuter}>
            <View style={styles.historyTableMin}>
              <View style={[styles.historyTableRow, styles.historyThead, { borderBottomColor: themeColors.border }]}>
                <Text style={[styles.historyTh, { color: themeColors.textSecondary, flex: 1.2, minWidth: 140 }]}>Report name</Text>
                <Text style={[styles.historyTh, { color: themeColors.textSecondary, width: 110 }]}>Date</Text>
                <Text style={[styles.historyTh, { color: themeColors.textSecondary, width: 100 }]}>Export</Text>
              </View>
              {!initialLoadDone ? (
                <ReportHistoryTableSkeleton rows={6} fillColor={themeColors.border} />
              ) : filteredHistoryRows.length === 0 ? (
                <View style={styles.historyEmptyRow}>
                  <Text style={[styles.subtle, { color: themeColors.textSecondary }]}>
                    {rows.length === 0 ? "No generated reports yet." : "No results match your search."}
                  </Text>
                </View>
              ) : (
                filteredHistoryRows.map((row: { run_id?: string; report_name?: string; description?: string; date?: string; export?: { csv_url?: string; pdf_url?: string } }, rowIndex: number) => {
                  const rid = String(row?.run_id ?? "");
                  return (
                    <View
                      key={rid || `row-${rowIndex}`}
                      style={[styles.historyTableRow, styles.historyTbodyRow, { borderBottomColor: themeColors.border }]}
                    >
                      <View style={{ flex: 1.2, minWidth: 140, minHeight: 44, justifyContent: "center" }}>
                        <Pressable
                          onPress={() => setHistoryDetail(row as Record<string, unknown>)}
                          style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
                        >
                          <Text style={[styles.rowTitle, { color: themeColors.accent }]} numberOfLines={2}>
                            {toTitleCaseWords(displayMemberWords(String(row?.report_name || "Generated report")))}
                          </Text>
                        </Pressable>
                        {row?.description && String(row.description).trim() ? (
                          <Text style={[styles.subtle, { color: themeColors.textSecondary }]} numberOfLines={1}>
                            {String(row.description)}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        style={[styles.historyTdDate, { color: themeColors.textPrimary, width: 110 }]}
                        numberOfLines={1}
                        accessibilityLabel={row?.date ? String(row.date) : undefined}
                      >
                        {formatHistoryRelativeDate(row?.date)}
                      </Text>
                      <View style={[styles.historyExportCell, { width: 100 }]}>
                        {row?.export?.csv_url ? (
                          <Pressable
                            onPress={() =>
                              void shareReportFromDownloadPath(String(row.export!.csv_url), "report.csv").catch((e) =>
                                setError(e instanceof Error ? e.message : "Download failed"),
                              )
                            }
                          >
                            <Text style={[styles.link, { color: themeColors.accent }]}>CSV</Text>
                          </Pressable>
                        ) : (
                          <Text style={[styles.linkOff, { color: themeColors.textSecondary }]}>CSV</Text>
                        )}
                        {row?.export?.pdf_url ? (
                          <Pressable
                            onPress={() =>
                              void shareReportFromDownloadPath(String(row.export!.pdf_url), "report.pdf").catch((e) =>
                                setError(e instanceof Error ? e.message : "Download failed"),
                              )
                            }
                          >
                            <Text style={[styles.link, { color: themeColors.accent }]}>PDF</Text>
                          </Pressable>
                        ) : (
                          <Text style={[styles.linkOff, { color: themeColors.textSecondary }]}>PDF</Text>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <BlurView
            intensity={resolvedScheme === "dark" ? 28 : 36}
            tint={resolvedScheme === "dark" ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            style={[StyleSheet.absoluteFill, styles.modalDimTouch]}
            onPress={() => {
              setOpen(false);
              setResultFiltersOpen(false);
            }}
            accessibilityLabel="Close sheet"
          />
          <View style={styles.modalForeground} pointerEvents="box-none">
            <View
              style={[
                styles.modalSheet,
                {
                  backgroundColor: themeColors.card,
                  minHeight: windowHeight * 0.88,
                  maxHeight: windowHeight * 0.96,
                  borderTopWidth: 0,
                },
              ]}
            >
            <View style={styles.modalHeader}>
              <Text style={[styles.cardTitle, { color: themeColors.textPrimary }]}>Create report</Text>
              <Pressable
                onPress={() => {
                  setOpen(false);
                  setResultFiltersOpen(false);
                }}
                hitSlop={10}
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.modalIconBtn, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name="close" size={24} color={themeColors.textSecondary} />
              </Pressable>
            </View>
            <Text style={[styles.stepBadge, { color: themeColors.textSecondary }]}>Step {step} of 3</Text>

            {step === 1 ? (
              <ScrollView contentContainerStyle={styles.sectionGap} showsVerticalScrollIndicator={false}>
                {allowedTypes.map((t) => {
                  const active = reportType === t.value;
                  return (
                    <Pressable
                      key={t.value}
                      onPress={() => setReportType(t.value)}
                      style={[styles.typeRow, active && styles.typeRowActive]}
                    >
                      <Ionicons name={t.icon} size={22} color={active ? themeColors.accent : themeColors.textPrimary} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={active ? [styles.typeLabel, styles.typeLabelActive] : styles.typeLabel}>{t.label}</Text>
                        <Text style={styles.subtle}>{t.blurb}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable onPress={() => setStep(2)} style={styles.fullBtn}>
                  <Text style={styles.fullBtnText}>Next</Text>
                </Pressable>
              </ScrollView>
            ) : null}

            {step === 2 ? (
              <ScrollView contentContainerStyle={styles.sectionGap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {renderFilterFields()}
                <View style={styles.rowBtns}>
                  <Pressable
                    onPress={() => setStep(1)}
                    style={[styles.ghostBtnFlat, { backgroundColor: themeColors.accentSurface }]}
                  >
                    <Text style={[styles.ghostBtnText, { color: themeColors.textPrimary }]}>Back</Text>
                  </Pressable>
                  <Pressable onPress={() => void previewReport()} style={[styles.fullBtn, loading && styles.disabledBtn]} disabled={loading}>
                    <Text style={styles.fullBtnText}>{loading ? "Generating…" : "Generate"}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}

            {step === 3 ? (
              <ScrollView
                contentContainerStyle={[styles.sectionGap, styles.resultScrollContent]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary }]}>Report name (for history)</Text>
                <TextInput
                  value={resultReportName}
                  onChangeText={setResultReportName}
                  placeholder="Name shown in history"
                  style={[styles.input, { borderColor: themeColors.border, color: themeColors.textPrimary, backgroundColor: themeColors.bg }]}
                  placeholderTextColor={themeColors.textSecondary}
                />
                {savedRunId ? <Text style={styles.savedNote}>Saved to history</Text> : null}
                <PreviewSummary kpis={preview?.kpis || null} reportType={reportType} themeColors={themeColors} />
                <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary, marginTop: 4 }]}>Preview</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  nestedScrollEnabled
                  style={styles.previewTableScroll}
                  contentContainerStyle={{ minHeight: 280, paddingBottom: 8 }}
                >
                  <View>
                    <PreviewMobileTable rows={preview?.raw_preview_rows || []} reportType={reportType} themeColors={themeColors} />
                  </View>
                </ScrollView>
                {!preview?.raw_preview_rows?.length ? (
                  <Text style={[styles.subtle, { color: themeColors.textSecondary }]}>No rows for these filters</Text>
                ) : null}

                <Pressable onPress={() => setResultFiltersOpen((v) => !v)} style={styles.adjustFiltersBtn}>
                  <Ionicons name={resultFiltersOpen ? "chevron-up" : "chevron-down"} size={18} color={themeColors.textPrimary} />
                  <Text style={[styles.adjustFiltersText, { color: themeColors.textPrimary }]}>
                    {resultFiltersOpen ? "Hide filters" : "Adjust filters"}
                  </Text>
                </Pressable>
                {resultFiltersOpen ? (
                  <View style={[styles.resultFiltersBox, { borderColor: themeColors.border, backgroundColor: themeColors.bg }]}>
                    {renderFilterFields()}
                  </View>
                ) : null}

                <View style={styles.rowBtns}>
                  <Pressable onPress={() => void saveReport()} style={[styles.fullBtn, styles.fullBtnFlex]} disabled={loading}>
                    <Ionicons name="save-outline" size={18} color="#fff" />
                    <Text style={styles.fullBtnText}>{loading ? "…" : "Save to history"}</Text>
                  </Pressable>
                </View>
                <View style={styles.rowBtns}>
                  <Pressable
                    onPress={() => void exportReport("csv")}
                    style={[
                      styles.ghostBtnFlat,
                      styles.exportBtn,
                      { backgroundColor: themeColors.accentSurface },
                      !canExportReports && styles.disabledBtn,
                    ]}
                    disabled={!canExportReports || loading}
                  >
                    <Ionicons name="document-text-outline" size={18} color={themeColors.textPrimary} />
                    <Text style={[styles.ghostBtnText, { color: themeColors.textPrimary }]}>CSV</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void exportReport("pdf")}
                    style={[
                      styles.ghostBtnFlat,
                      styles.exportBtn,
                      { backgroundColor: themeColors.accentSurface },
                      !canExportReports && styles.disabledBtn,
                    ]}
                    disabled={!canExportReports || loading}
                  >
                    <Ionicons name="document-outline" size={18} color={themeColors.textPrimary} />
                    <Text style={[styles.ghostBtnText, { color: themeColors.textPrimary }]}>PDF</Text>
                  </Pressable>
                </View>
                <View style={styles.rowBtns}>
                  <Pressable
                    onPress={() => setStep(2)}
                    style={[styles.ghostBtnFlat, { backgroundColor: themeColors.accentSurface }]}
                  >
                    <Text style={[styles.ghostBtnText, { color: themeColors.textPrimary }]}>Back to filters</Text>
                  </Pressable>
                  <Pressable onPress={() => void previewReport()} style={[styles.fullBtn, loading && styles.disabledBtn]} disabled={loading}>
                    <Text style={styles.fullBtnText}>{loading ? "Regenerating…" : "Apply & regenerate"}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={eventTypesModalOpen} transparent animationType="fade" onRequestClose={() => setEventTypesModalOpen(false)}>
        <View style={styles.eventTypeModalRoot}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.eventTypeModalDim]}
            onPress={() => setEventTypesModalOpen(false)}
          />
          <View
            style={[styles.eventTypeModalSheet, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}
            pointerEvents="box-none"
          >
            <View style={styles.eventTypeModalHeader}>
              <Text style={[styles.formSectionTitle, { color: themeColors.textPrimary, marginBottom: 0 }]}>Event types</Text>
              <Pressable onPress={() => setEventTypesModalOpen(false)} hitSlop={8}>
                <Text style={{ color: themeColors.accent, fontWeight: "700" }}>Done</Text>
              </Pressable>
            </View>
            <Text style={[styles.subtleHint, { marginBottom: 8 }]}>Select one or more. Leave all off to include every type.</Text>
            <ScrollView style={{ maxHeight: windowHeight * 0.45 }} keyboardShouldPersistTaps="handled">
              {mergedEventTypeSlugs.length === 0 ? (
                <Text style={[styles.subtle, { color: themeColors.textSecondary }]}>No event types in scope.</Text>
              ) : (
                mergedEventTypeSlugs.map((slug) => {
                  const on = selectedEventTypeSlugs.includes(slug);
                  return (
                    <Pressable
                      key={slug}
                      onPress={() =>
                        setSelectedEventTypeSlugs((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]))
                      }
                      style={[styles.eventTypeRow, { borderBottomColor: themeColors.border }]}
                    >
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? themeColors.accent : themeColors.textSecondary} />
                      <Text style={{ color: themeColors.textPrimary, flex: 1, fontSize: 15 }}>{toTitleCaseWords(slug)}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable
              onPress={() => setSelectedEventTypeSlugs([])}
              style={[styles.clearEventTypesBtn, { borderColor: themeColors.border }]}
            >
              <Text style={{ color: themeColors.textSecondary, fontWeight: "600", textAlign: "center" }}>Clear selection (all types)</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!historyDetail} transparent animationType="fade" onRequestClose={() => setHistoryDetail(null)}>
        <View style={styles.historyDetailRoot}>
          <Pressable
            style={styles.historyDetailDim}
            onPress={() => setHistoryDetail(null)}
            accessibilityLabel="Dismiss"
          />
          <View style={[styles.historyDetailCard, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
            <View style={styles.historyDetailHeader}>
              <Text style={[styles.historyDetailTitle, { color: themeColors.textPrimary }]} numberOfLines={2}>
                {displayMemberWords(String((historyDetail as { report_name?: string })?.report_name || "Report details"))}
              </Text>
              <Pressable onPress={() => setHistoryDetail(null)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={themeColors.textSecondary} />
              </Pressable>
            </View>
            {historyDetail?.date ? (
              <Text style={[styles.subtle, { color: themeColors.textSecondary, marginBottom: 8 }]}>
                Generated: {formatDate(String((historyDetail as { date?: string }).date))}
                {" · "}
                {formatHistoryRelativeDate(String((historyDetail as { date?: string }).date))}
              </Text>
            ) : null}
            <View style={styles.historyDetailBlock}>
              <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Description</Text>
              <Text style={[styles.historyDetailBody, { color: themeColors.textPrimary }]}>
                {(historyDetail as { description?: string })?.description && String((historyDetail as { description: string }).description).trim()
                  ? String((historyDetail as { description: string }).description)
                  : "—"}
              </Text>
            </View>
            <View style={styles.historyDetailBlock}>
              <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>Data filtered</Text>
              <Text style={[styles.historyDetailBody, { color: themeColors.textPrimary }]}>
                {(historyDetail as { data_filtered?: string })?.data_filtered && String((historyDetail as { data_filtered: string }).data_filtered).trim()
                  ? String((historyDetail as { data_filtered: string }).data_filtered)
                  : "—"}
              </Text>
            </View>
            <Pressable
              onPress={() => setHistoryDetail(null)}
              style={[styles.historyDetailCloseBtn, { backgroundColor: themeColors.accent }]}
            >
              <Text style={styles.headerCreateBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ReportGroupTreeModal
        visible={groupTreeOpen}
        onClose={() => setGroupTreeOpen(false)}
        groups={groups}
        selectedIds={selectedGroupIds}
        onChangeSelectedIds={setSelectedGroupIds}
      />
    </SafeAreaView>
  );
}

function PreviewSummary({
  kpis,
  reportType,
  themeColors,
}: {
  kpis: Record<string, unknown> | null;
  reportType: ReportType;
  themeColors: ThemeColors;
}) {
  if (!kpis) return null;
  const num = (v: unknown) => Number(v ?? 0);
  const pct = (v: unknown) => `${Number(v ?? 0)}%`;
  const tiles =
    reportType === "group"
      ? [
          { label: "Events", value: num(kpis.events_in_range) },
          { label: "Groups", value: num(kpis.active_groups) },
          { label: "Att. rate", value: pct(kpis.attendance_rate_pct) },
          { label: "Att. total", value: num(kpis.attendance_total) },
        ]
      : reportType === "membership"
        ? [
            { label: "Members", value: num(kpis.total_members) },
            { label: "Active", value: num(kpis.active_members) },
            { label: "Tasks open", value: num(kpis.open_tasks) },
            { label: "Tasks done", value: num(kpis.completed_tasks) },
          ]
        : [
            { label: "Groups", value: num(kpis.active_groups) },
            { label: "Tasks open", value: num(kpis.open_tasks) },
            { label: "Tasks done", value: num(kpis.completed_tasks) },
            { label: "Completion", value: pct(kpis.task_completion_rate_pct) },
          ];
  return (
    <View style={styles.kpiRow}>
      {tiles.map((t) => (
        <View
          key={t.label}
          style={[
            styles.kpiTile,
            { borderColor: themeColors.accentBorder, backgroundColor: themeColors.accentSurface },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: themeColors.textSecondary, fontWeight: "700" }]}>{t.label}</Text>
          <Text style={[styles.kpiValue, { color: themeColors.textPrimary }]}>{t.value}</Text>
        </View>
      ))}
    </View>
  );
}

const PREVIEW_TABLE_HIDDEN_KEYS = new Set<string>(["event_id"]);

function formatPreviewTableCell(
  row: Record<string, unknown>,
  columnKey: string,
  reportType: ReportType,
): string {
  const combined = formatPreviewCountPctCell(row, columnKey, reportType);
  if (combined !== null) return combined;
  return formatReportTableCellValueForPreview(row[columnKey], columnKey);
}

function withTitleCaseForPreviewCell(s: string): string {
  const t = s.trim();
  if (!t || t === "—" || /^[\d%s./\s-]+$/.test(t)) return s;
  if (t.length > 120) return s;
  return toTitleCaseWords(t);
}

function PreviewMobileTable({
  rows,
  reportType,
  themeColors,
}: {
  rows: Array<Record<string, unknown>>;
  reportType: ReportType;
  themeColors: ThemeColors;
}) {
  if (!rows || rows.length === 0) return null;
  const columns = mergeCountPctColumns(
    orderPreviewTableColumns(reportType, Object.keys(rows[0])).filter((c) => !PREVIEW_TABLE_HIDDEN_KEYS.has(c)),
    reportType,
  );
  const visible = rows.slice(0, 50);
  return (
    <View>
      <View style={[styles.tableHead, { borderBottomColor: themeColors.accentBorder }]}>
        {columns.map((c) => (
          <Text key={c} style={[styles.headCell, styles.tdCell, { color: themeColors.textPrimary, fontWeight: "700" }]}>
            {getReportTableColumnLabel(c, reportType)}
          </Text>
        ))}
      </View>
      {visible.map((row, idx) => (
        <View
          key={`pr-${idx}`}
          style={[styles.tableRow, { borderBottomColor: themeColors.border, backgroundColor: idx % 2 === 0 ? "transparent" : themeColors.accentSurface }]}
        >
          {columns.map((c) => (
            <Text key={c} style={[styles.tdCell, { color: themeColors.textSecondary, fontSize: 13 }]}>
              {withTitleCaseForPreviewCell(formatPreviewTableCell(row, c, reportType))}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, gap: 12, paddingBottom: 28 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyTitle: { ...type.h2, color: colors.textPrimary },
  headerCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 0,
  },
  headerCreateBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" as const },
  error: { ...type.caption, color: "#B91C1C", backgroundColor: "#FEE2E2", borderRadius: radius.md, padding: 8 },
  subtle: { ...type.caption, color: colors.textSecondary },
  fieldLabel: { ...type.caption, color: colors.textSecondary, fontWeight: "600", marginBottom: 4 },
  subtleHint: { ...type.caption, color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  savedNote: { ...type.caption, color: "#15803d", fontWeight: "600" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 12, gap: 8 },
  cardTitle: { ...type.bodyStrong, color: colors.textPrimary },
  historyCard: { borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 10 },
  historySearchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 10, marginTop: 2 },
  historySearchInput: { flex: 1, fontSize: 15, minHeight: 20, paddingVertical: 0, paddingHorizontal: 0 },
  historyTableOuter: { width: "100%" },
  historyTableMin: { width: "100%" },
  historyTableRow: { flexDirection: "row", alignItems: "flex-start" },
  historyThead: { borderBottomWidth: 1, paddingTop: 4, paddingBottom: 8, marginBottom: 2 },
  historyTh: { fontSize: 11, fontWeight: "600" as const },
  historyTbodyRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: 8, paddingBottom: 10, minHeight: 44 },
  historyEmptyRow: { paddingVertical: 20, paddingHorizontal: 2 },
  historyTdDate: { fontSize: 13, lineHeight: 18, paddingTop: 2 },
  historyExportCell: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 2 },
  historyDetailRoot: { flex: 1, justifyContent: "center" },
  historyDetailDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  historyDetailCard: { marginHorizontal: 20, zIndex: 1, maxHeight: 520, borderRadius: radius.lg, borderWidth: 1, padding: 16, width: "100%", maxWidth: 420, alignSelf: "center" },
  historyDetailHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  historyDetailTitle: { ...type.bodyStrong, fontSize: 18, lineHeight: 24, flex: 1, paddingRight: 8 },
  historyDetailBlock: { marginBottom: 12 },
  historyDetailBody: { ...type.body, marginTop: 4, lineHeight: 22 },
  historyDetailCloseBtn: { marginTop: 4, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 },
  headCell: { ...type.caption, color: colors.textSecondary },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#EEF2F7", paddingVertical: 8 },
  rowTitle: { ...type.bodyStrong, color: colors.textPrimary },
  link: { ...type.caption, color: colors.accent, fontWeight: "600" },
  linkOff: { ...type.caption, color: colors.textSecondary },
  modalRoot: { flex: 1 },
  modalDimTouch: { backgroundColor: "rgba(15, 23, 42, 0.12)" },
  modalForeground: { flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: 16,
    paddingBottom: 32,
  },
  modalIconBtn: { borderWidth: 0, padding: 4, borderRadius: 8, backgroundColor: "transparent" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  formSectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" as const, marginBottom: 8 },
  presetRow: { flexDirection: "row", gap: 8, paddingVertical: 4, paddingRight: 8 },
  presetChip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  presetChipText: { fontSize: 13, fontWeight: "600" as const },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  ghostBtnFlat: {
    flexDirection: "row",
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  resultScrollContent: { paddingBottom: 32, flexGrow: 1 },
  previewTableScroll: { marginVertical: 4 },
  eventTypeModalRoot: { flex: 1, justifyContent: "center", padding: 20 },
  eventTypeModalDim: { backgroundColor: "rgba(15, 23, 42, 0.4)" },
  eventTypeModalSheet: {
    zIndex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    maxHeight: "70%",
  },
  eventTypeModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  eventTypeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  clearEventTypesBtn: { marginTop: 8, borderRadius: radius.md, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 8 },
  stepBadge: { ...type.caption, color: colors.textSecondary, marginBottom: 8 },
  sectionGap: { gap: 12 },
  typeRow: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 4 },
  typeRowActive: { borderColor: colors.accent, backgroundColor: "#F5F3FF" },
  typeLabel: { ...type.caption, color: colors.textPrimary, fontWeight: "700" },
  typeLabelActive: { color: colors.accent },
  fullBtn: { flexDirection: "row", backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12, alignItems: "center", justifyContent: "center", gap: 8 },
  fullBtnFlex: { width: "100%" },
  fullBtnText: { ...type.caption, color: "#fff", fontWeight: "700" },
  ghostBtn: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 6 },
  exportBtn: { minWidth: "44%" },
  ghostBtnText: { ...type.caption, color: colors.textPrimary, fontWeight: "700" },
  rowBtns: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 10, color: colors.textPrimary, backgroundColor: colors.bg },
  rangeRow: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  rangeHalf: { flex: 1, minWidth: 0, gap: 4 },
  rangeLabel: { ...type.caption, color: colors.textSecondary, marginBottom: 2 },
  groupPickerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupPickerMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bg,
  },
  groupPickerText: { ...type.caption, color: colors.textPrimary, fontWeight: "500", flex: 1 },
  clearGroups: { paddingVertical: 6, paddingHorizontal: 4 },
  clearGroupsText: { ...type.caption, color: colors.accent, fontWeight: "700" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" },
  chipActive: { backgroundColor: "#EDE9FE", borderColor: "#C4B5FD" },
  chipText: { ...type.caption, color: colors.textPrimary },
  chipTextActive: { color: "#5B21B6" },
  pickList: { maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, gap: 6 },
  pickItem: { paddingVertical: 2 },
  toggleRow: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.bg },
  adjustFiltersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  adjustFiltersText: { ...type.caption, color: colors.textPrimary, fontWeight: "700" },
  resultFiltersBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, backgroundColor: colors.bg },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  kpiTile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6, minWidth: 80, backgroundColor: "#F8FAFC" },
  kpiLabel: { ...type.caption, color: colors.textSecondary, fontSize: 10 },
  kpiValue: { ...type.bodyStrong, color: colors.textPrimary, fontSize: 14 },
  tdCell: { minWidth: 110, paddingHorizontal: 6 },
  disabledBtn: { opacity: 0.6 },
});
