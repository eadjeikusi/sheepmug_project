import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronDown, Download, FileSpreadsheet, FileText, Plus, Users, X } from "lucide-react";
import { withBranchScope } from "@/utils/branchScopeHeaders";
import { downloadReportFromExportResponse, downloadReportWithAuth } from "@/utils/reportDownload";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { usePermissions } from "@/hooks/usePermissions";
import { DateRangePickerField } from "@/components/datetime/DateRangePickerField";
import { inclusiveLocalDayCount, localDayBoundsToIso, toIsoDateOnly } from "@/components/datetime/dateTimeFormat";
import { ReportGroupTreeModal, type GroupRow } from "@/components/reports/ReportGroupTreeModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/components/ui/utils";
import {
  displayMemberWords,
  formatPreviewCountPctCell,
  formatReportTableCellValueForPreview,
  getReportTableColumnLabel,
  mergeCountPctColumns,
  orderPreviewTableColumns,
} from "@sheepmug/shared-api";

function newDefaultReportDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return { start: toIsoDateOnly(start), end: toIsoDateOnly(end) };
}

function formatHistoryRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const s = formatDistanceToNowStrict(d, { addSuffix: true });
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatHistoryReportName(name: string | null | undefined): string {
  const t = (name && String(name).trim()) || "Generated report";
  return displayMemberWords(t);
}

type ReportType = "group" | "membership" | "leader";
type HistoryRow = {
  run_id: string;
  report_name: string;
  description: string;
  date: string | null;
  data_filtered: string;
  export: { csv_url: string | null; pdf_url: string | null; graph_url: string | null };
};

const REPORT_TYPES: Array<{
  value: ReportType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    value: "group",
    label: "Group report",
    description: "Attendance and events across selected groups and time range. Use for ministry or group health.",
    icon: <Users className="h-6 w-6 shrink-0" />,
  },
  {
    value: "membership",
    label: "Membership report",
    description: "Per-member tasks, attendance in range, and ministries. Filter by group, member type, or individuals.",
    icon: <Users className="h-6 w-6 shrink-0" />,
  },
  {
    value: "leader",
    label: "Leaders report",
    description: "Task metrics for a leader and the groups they lead in the selected window.",
    icon: <Users className="h-6 w-6 shrink-0" />,
  },
];

export default function Reports() {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const canExport = can("export_data");
  const canGroup = can("report_group");
  const canMembers = can("report_members");
  const canLeaders = can("report_leaders");

  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultReportName, setResultReportName] = useState("");
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<HistoryRow | null>(null);

  const [reportType, setReportType] = useState<ReportType>("group");
  const [reportDateRange, setReportDateRange] = useState(() => newDefaultReportDateRange());
  const [selectedEventTypeSlugs, setSelectedEventTypeSlugs] = useState<string[]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectAllEvents, setSelectAllEvents] = useState(true);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectAllMembers, setSelectAllMembers] = useState(false);
  const [selectedMemberStatuses, setSelectedMemberStatuses] = useState<string[]>([]);
  const [leaderId, setLeaderId] = useState("");
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [eventTypeOptions, setEventTypeOptions] = useState<Array<{ name: string }>>([]);
  const [members, setMembers] = useState<Array<{ id: string; name: string; status?: string | null }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; title: string; event_type?: string | null }>>([]);
  const [leaders, setLeaders] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);

  const allowedTypes = useMemo(
    () => REPORT_TYPES.filter((t) => (t.value === "group" ? canGroup : t.value === "membership" ? canMembers : canLeaders)),
    [canGroup, canLeaders, canMembers]
  );

  useEffect(() => {
    if (step !== 3) setFiltersOpen(false);
  }, [step]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  const memberStatusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const m of members) {
      const raw = String(m.status || "").trim().toLowerCase();
      if (raw) s.add(raw);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [members]);

  const allEventTypeSlugs = useMemo(() => {
    const s = new Set<string>();
    for (const t of eventTypeOptions) {
      const n = String(t.name || "").trim();
      if (n) s.add(n.toLowerCase());
    }
    for (const e of events) {
      const n = String(e.event_type || "").trim();
      if (n) s.add(n.toLowerCase());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [eventTypeOptions, events]);

  const loadBaseData = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const branchHeaders = withBranchScope(selectedBranch?.id ?? null, headers);
    try {
      const [historyRes, groupsRes, membersRes, eventsRes, leadersRes, etRes] = await Promise.all([
        fetch("/api/reports/history-table?limit=50", { headers: branchHeaders }),
        fetch("/api/groups?tree=1", { headers: branchHeaders }),
        fetch("/api/members?limit=500", { headers: branchHeaders }),
        fetch("/api/events?limit=500", { headers: branchHeaders }),
        fetch("/api/reports/leaders", { headers: branchHeaders }),
        fetch("/api/event-types", { headers: branchHeaders }).catch(() => null),
      ]);
      const historyJson = await historyRes.json().catch(() => ({ rows: [] }));
      const groupsJson = await groupsRes.json().catch(() => []);
      const membersJson = await membersRes.json().catch(() => ({ members: [] }));
      const eventsJson = await eventsRes.json().catch(() => ({ events: [] }));
      const leadersJson = await leadersRes.json().catch(() => ({ leaders: [] }));
      setHistoryRows(Array.isArray(historyJson?.rows) ? historyJson.rows : []);

      if (etRes && etRes.ok) {
        const j = await etRes.json().catch(() => []);
        const list = Array.isArray(j) ? j : Array.isArray((j as { event_types?: unknown[] }).event_types) ? (j as { event_types: unknown[] }).event_types : [];
        setEventTypeOptions(
          (list as Array<{ name?: string }>)
            .map((r) => ({ name: String(r.name || "").trim() }))
            .filter((r) => r.name)
        );
      } else {
        setEventTypeOptions([]);
      }

      const groupRows = Array.isArray(groupsJson) ? groupsJson : Array.isArray((groupsJson as { groups?: unknown[] }).groups) ? (groupsJson as { groups: unknown[] }).groups : [];
      setGroups(
        (groupRows as { id?: string; name?: string; parent_group_id?: string | null }[])
          .map((g) => ({
            id: String(g.id || ""),
            name: String(g.name || "Group"),
            parent_group_id: g.parent_group_id != null && String(g.parent_group_id) ? String(g.parent_group_id) : null,
          }))
          .filter((g) => g.id)
      );

      const memberRows = Array.isArray((membersJson as { members?: unknown[] }).members) ? (membersJson as { members: any[] }).members : [];
      setMembers(
        memberRows
          .map((m: { id?: string; first_name?: string; last_name?: string; status?: string | null }) => ({
            id: String(m.id || ""),
            name: `${String(m.first_name || "").trim()} ${String(m.last_name || "").trim()}`.trim() || "Member",
            status: m.status,
          }))
          .filter((m) => m.id)
      );

      const eventRows = Array.isArray((eventsJson as { events?: unknown[] }).events) ? (eventsJson as { events: any[] }).events : Array.isArray(eventsJson) ? (eventsJson as any[]) : [];
      setEvents(
        eventRows
          .map((e: { id?: string; title?: string; event_type?: string | null }) => ({
            id: String(e.id || ""),
            title: String(e.title || "Event"),
            event_type: e.event_type != null && String(e.event_type) ? String(e.event_type) : null,
          }))
          .filter((e) => e.id)
      );

      const leaderRows = Array.isArray((leadersJson as { leaders?: unknown[] }).leaders) ? (leadersJson as { leaders: any[] }).leaders : [];
      setLeaders(
        leaderRows
          .map((l: { id?: string; first_name?: string; last_name?: string; email?: string | null }) => ({
            id: String(l.id || ""),
            name: `${String(l.first_name || "").trim()} ${String(l.last_name || "").trim()}`.trim() || String(l.email || "Leader"),
            email: l.email || null,
          }))
          .filter((l) => l.id)
      );
    } catch {
      // no-op
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [memberSearch, members]);

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase();
    const typeSet = new Set(selectedEventTypeSlugs);
    return events.filter((e) => {
      const et = String(e.event_type || "").toLowerCase();
      if (typeSet.size > 0 && !typeSet.has(et)) return false;
      if (!q) return true;
      return e.title.toLowerCase().includes(q);
    });
  }, [eventSearch, events, selectedEventTypeSlugs]);

  const resetFlow = () => {
    setStep(1);
    setError(null);
    setPreviewData(null);
    setLoading(false);
    setResultReportName("");
    setSavedRunId(null);
    setFiltersOpen(false);
    setGroupModalOpen(false);
    setReportDateRange(newDefaultReportDateRange());
    setSelectedEventTypeSlugs([]);
    setEventSearch("");
    setGroupIds([]);
    setSelectedEventIds([]);
    setSelectAllEvents(true);
    setMemberIds([]);
    setMemberSearch("");
    setSelectAllMembers(false);
    setSelectedMemberStatuses([]);
    setLeaderId("");
    if (allowedTypes.length > 0) setReportType(allowedTypes[0].value);
  };

  function currentFilters() {
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
      group_ids: reportType === "group" || reportType === "membership" ? groupIds : undefined,
      event_types: reportType === "membership" ? [] : selectedEventTypeSlugs.map((s) => s), // slugs are lowercase; server normalizes
      event_search: isMembership ? undefined : eventSearch || undefined,
      event_ids: isMembership ? undefined : selectAllEvents ? undefined : selectedEventIds,
      member_ids: isMembership && !selectAllMembers ? memberIds : undefined,
      select_all_members: isMembership ? selectAllMembers : undefined,
      member_statuses: isMembership && selectedMemberStatuses.length > 0 ? selectedMemberStatuses : undefined,
      leader_id: reportType === "leader" ? leaderId || undefined : undefined,
      attendance_statuses: ["present", "absent", "unsure", "not_marked"] as const,
    };
  }

  const branchHeaderJson = withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" });
  const downloadAuthHeaders = useMemo(
    () => (token ? withBranchScope(selectedBranch?.id ?? null, { Authorization: `Bearer ${token}` }) : null),
    [selectedBranch?.id, token],
  );

  async function runPreview() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/preview", {
        method: "POST",
        headers: branchHeaderJson,
        body: JSON.stringify({ report_type: reportType, filters: currentFilters() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Preview failed.");
      setPreviewData(body.preview || null);
      setSavedRunId(null);
      setResultReportName("");
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runSave() {
    if (!token) return;
    const name = resultReportName.trim();
    if (!name) {
      setError("Enter a report name to save to history.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: branchHeaderJson,
        body: JSON.stringify({
          name,
          description: "",
          report_type: reportType,
          filters: currentFilters(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Save failed.");
      setSavedRunId(body.run_id || null);
      if (body.report) setPreviewData(body.report);
      await loadBaseData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runExport(format: "csv" | "pdf") {
    if (!token) return;
    if (!canExport) {
      setError("You need Export data permission for CSV and PDF.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/exports", {
        method: "POST",
        headers: branchHeaderJson,
        body: JSON.stringify({
          run_id: savedRunId,
          format,
          report: {
            ...previewData,
            name: resultReportName.trim() || undefined,
            report_type: reportType,
          },
        }),
      });
      const expBody = (await res.json()) as {
        error?: string;
        content?: string;
        filename?: string;
        format?: "csv" | "pdf";
        file_url?: string;
      };
      if (!res.ok) throw new Error(expBody?.error || "Export failed.");
      if (expBody.content && expBody.filename && (expBody.format === "csv" || expBody.format === "pdf")) {
        downloadReportFromExportResponse({
          content: expBody.content,
          filename: expBody.filename,
          format: expBody.format,
        });
      } else if (expBody.file_url && downloadAuthHeaders) {
        await downloadReportWithAuth(
          expBody.file_url,
          downloadAuthHeaders,
          expBody.format === "pdf" ? "report.pdf" : "report.csv",
        );
      } else {
        throw new Error("Export response did not include a file.");
      }
      await loadBaseData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  const filterForm = (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs text-gray-500">Date range</p>
        <DateRangePickerField start={reportDateRange.start} end={reportDateRange.end} onChange={setReportDateRange} minSpanDays={1} maxSpanDays={3650} />
      </div>

      {reportType !== "membership" ? (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Event types</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="h-9 w-full justify-between text-left font-normal">
                {selectedEventTypeSlugs.length === 0
                  ? "All event types"
                  : `${selectedEventTypeSlugs.length} type(s) selected`}
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <div className="max-h-56 overflow-y-auto p-2">
                {allEventTypeSlugs.length === 0 ? (
                  <p className="p-2 text-xs text-gray-500">No event types found. Load events or configure event types in settings.</p>
                ) : (
                  allEventTypeSlugs.map((slug) => (
                    <label key={slug} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-800 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={selectedEventTypeSlugs.includes(slug)}
                        onChange={() => {
                          setSelectedEventTypeSlugs((prev) =>
                            prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
                          );
                        }}
                      />
                      <span className="capitalize">{slug}</span>
                    </label>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {reportType === "group" || reportType === "membership" ? (
        <div>
          <p className="mb-1 text-xs text-gray-500">Groups {reportType === "membership" ? "(optional; union with member selection below)" : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="text-xs" onClick={() => setGroupModalOpen(true)}>
              {groupIds.length === 0 ? "Select groups" : `${groupIds.length} group(s) selected`}
            </Button>
            {groupIds.length > 0 ? (
              <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setGroupIds([])}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {reportType === "group" ? (
        <>
          <input
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            placeholder="Search events"
            value={eventSearch}
            onChange={(e) => setEventSearch(e.target.value)}
          />
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={selectAllEvents} onChange={(e) => setSelectAllEvents(e.target.checked)} />
            Select all events
          </label>
          {!selectAllEvents ? (
            <div className="max-h-36 overflow-auto rounded-md border border-gray-200 p-2">
              {filteredEvents.map((ev) => (
                <label key={ev.id} className="mb-1 flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedEventIds.includes(ev.id)}
                    onChange={() => setSelectedEventIds((prev) => (prev.includes(ev.id) ? prev.filter((v) => v !== ev.id) : [...prev, ev.id]))}
                  />
                  {ev.title}
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {reportType === "membership" ? (
        <>
          {memberStatusOptions.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-gray-500">Member type (status)</p>
              <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 p-2">
                {memberStatusOptions.map((st) => (
                  <label key={st} className="mb-1 flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedMemberStatuses.includes(st)}
                      onChange={() =>
                        setSelectedMemberStatuses((prev) => (prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]))
                      }
                    />
                    {st}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <input
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            placeholder="Search members"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={selectAllMembers} onChange={(e) => setSelectAllMembers(e.target.checked)} />
            Select all members in scope (after group / type filters)
          </label>
          {!selectAllMembers ? (
            <div className="max-h-36 overflow-auto rounded-md border border-gray-200 p-2">
              {filteredMembers.map((m) => (
                <label key={m.id} className="mb-1 flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(m.id)}
                    onChange={() => setMemberIds((prev) => (prev.includes(m.id) ? prev.filter((v) => v !== m.id) : [...prev, m.id]))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {reportType === "leader" ? (
        <select className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
          <option value="">{leaders.length === 0 ? "No leaders found in your scope" : "Select leader"}</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.email ? ` (${l.email})` : ""}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <button
          type="button"
          onClick={() => {
            resetFlow();
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Create report
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="px-2 py-2 font-semibold">Report name</th>
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Export</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-gray-500" colSpan={3}>
                    No generated reports yet.
                  </td>
                </tr>
              ) : (
                historyRows.map((row) => (
                  <tr key={row.run_id} className="border-b border-gray-100">
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setHistoryDetail(row)}
                        className="text-left text-violet-700 hover:underline"
                      >
                        {formatHistoryReportName(row.report_name)}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-gray-700" title={row.date || undefined}>
                      {formatHistoryRelativeDate(row.date)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        {row.export?.csv_url && downloadAuthHeaders ? (
                          <button
                            type="button"
                            onClick={() =>
                              void downloadReportWithAuth(String(row.export!.csv_url), downloadAuthHeaders, "report.csv").catch(
                                (e) => setError(e instanceof Error ? e.message : "Download failed"),
                              )
                            }
                            className="text-violet-700 hover:underline"
                          >
                            CSV
                          </button>
                        ) : (
                          <span className="text-gray-400">CSV</span>
                        )}
                        {row.export?.pdf_url && downloadAuthHeaders ? (
                          <button
                            type="button"
                            onClick={() =>
                              void downloadReportWithAuth(String(row.export!.pdf_url), downloadAuthHeaders, "report.pdf").catch(
                                (e) => setError(e instanceof Error ? e.message : "Download failed"),
                              )
                            }
                            className="text-violet-700 hover:underline"
                          >
                            PDF
                          </button>
                        ) : (
                          <span className="text-gray-400">PDF</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!historyDetail} onOpenChange={(open) => !open && setHistoryDetail(null)}>
        <DialogContent className="!z-[200] max-h-[min(90vh,640px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{formatHistoryReportName(historyDetail?.report_name || "Report details")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">Description</p>
              <p className="whitespace-pre-wrap text-gray-800">
                {historyDetail?.description && String(historyDetail.description).trim() ? historyDetail.description : "—"}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-500">Data filtered</p>
              <p className="whitespace-pre-wrap break-words text-gray-800">
                {historyDetail?.data_filtered && String(historyDetail.data_filtered).trim() ? historyDetail.data_filtered : "—"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Create report — step {step} of 3</h3>
              <button type="button" className="text-xs text-gray-600" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>

            {step === 1 ? (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">Choose a report. You can set filters and generate results on the next step.</p>
                <div className="space-y-3">
                  {allowedTypes.map((t) => {
                    const active = reportType === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setReportType(t.value)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition",
                          active ? "border-violet-500 bg-violet-50" : "border-gray-200 bg-white hover:border-gray-300"
                        )}
                      >
                        <div className={active ? "text-violet-600" : "text-gray-500"}>{t.icon}</div>
                        <div className="min-w-0 flex-1">
                          <div className={cn("text-sm font-semibold", active ? "text-violet-900" : "text-gray-900")}>{t.label}</div>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600">{t.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <Button type="button" className="rounded-full bg-violet-500 text-white hover:bg-violet-600" onClick={() => setStep(2)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                {filterForm}
                <div className="flex justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)} className="rounded-full">
                    Back
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full bg-violet-500 text-white hover:bg-violet-600"
                    onClick={() => void runPreview()}
                    disabled={loading}
                  >
                    {loading ? "Generating…" : "Generate"}
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFiltersOpen(true)}
                    className="border-gray-200 text-xs font-medium text-gray-800"
                  >
                    Adjust filters
                  </Button>
                </div>
                {filtersOpen ? (
                  <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setFiltersOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="report-filters-dialog-title"
                  >
                    <div
                      className="max-h-[min(90vh,800px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <h3 id="report-filters-dialog-title" className="pr-2 text-base font-semibold text-gray-900">
                          Report filters
                        </h3>
                        <button
                          type="button"
                          onClick={() => setFiltersOpen(false)}
                          className="shrink-0 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                          aria-label="Close filters"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      {filterForm}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-700" htmlFor="report-result-name">
                    Report name
                  </label>
                  <input
                    id="report-result-name"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    placeholder="Name shown in history"
                    value={resultReportName}
                    onChange={(e) => setResultReportName(e.target.value)}
                  />
                </div>
                {savedRunId ? <p className="text-xs text-green-700">Saved to history. You can export below.</p> : null}
                <PreviewTable rows={previewData?.raw_preview_rows || []} kpis={previewData?.kpis || null} reportType={reportType} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="rounded-full bg-violet-600 text-white"
                    onClick={() => void runSave()}
                    disabled={loading}
                  >
                    {loading ? "Saving…" : "Save to history"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="inline-flex items-center gap-1 rounded-full"
                    onClick={() => void runExport("csv")}
                    disabled={loading || !canExport}
                    title={!canExport ? "Export permission required" : undefined}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Export CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="inline-flex items-center gap-1 rounded-full"
                    onClick={() => void runExport("pdf")}
                    disabled={loading || !canExport}
                    title={!canExport ? "Export permission required" : undefined}
                  >
                    <FileText className="h-4 w-4" />
                    Export PDF
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(2)} className="rounded-full">
                    Back
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full bg-violet-500 text-white"
                    onClick={() => void runPreview()}
                    disabled={loading}
                  >
                    {loading ? "Regenerating…" : "Apply filters & regenerate"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ReportGroupTreeModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        groups={groups}
        selectedIds={groupIds}
        onChangeSelectedIds={setGroupIds}
      />
    </div>
  );
}

/** Keys omitted from the in-modal preview grid (exports/API unchanged). */
const PREVIEW_TABLE_HIDDEN_COLUMNS = new Set<string>(["event_id"]);

function formatPreviewTableCell(
  row: Record<string, unknown>,
  columnKey: string,
  reportType: "group" | "membership" | "leader",
): string {
  const combined = formatPreviewCountPctCell(row, columnKey, reportType);
  if (combined !== null) return combined;
  return formatReportTableCellValueForPreview(row[columnKey], columnKey);
}

function pickPrimaryKpis(reportType: "group" | "membership" | "leader", kpis: Record<string, unknown> | null) {
  if (!kpis) return [] as Array<{ label: string; value: string | number }>;
  const fmtPct = (v: unknown) => `${Number(v ?? 0)}%`;
  const num = (v: unknown) => Number(v ?? 0);
  if (reportType === "group") {
    return [
      { label: "Events in range", value: num(kpis.events_in_range) },
      { label: "Active groups", value: num(kpis.active_groups) },
      { label: "Attendance rate", value: fmtPct(kpis.attendance_rate_pct) },
      { label: "Total attendance", value: num(kpis.attendance_total) },
    ];
  }
  if (reportType === "membership") {
    return [
      { label: "Total members", value: num(kpis.total_members) },
      { label: "Active members", value: num(kpis.active_members) },
      { label: "Open tasks", value: num(kpis.open_tasks) },
      { label: "Completed tasks", value: num(kpis.completed_tasks) },
    ];
  }
  return [
    { label: "Active groups", value: num(kpis.active_groups) },
    { label: "Open tasks", value: num(kpis.open_tasks) },
    { label: "Completed tasks", value: num(kpis.completed_tasks) },
    { label: "Task completion", value: fmtPct(kpis.task_completion_rate_pct) },
  ];
}

function PreviewTable({ rows, kpis, reportType }: { rows: Array<Record<string, unknown>>; kpis: Record<string, unknown> | null; reportType: "group" | "membership" | "leader" }) {
  const summary = pickPrimaryKpis(reportType, kpis);
  if (!rows || rows.length === 0) {
    return (
      <div className="space-y-3">
        {summary.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.map((k) => (
              <div key={k.label} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-[11px] font-medium text-gray-500">{k.label}</div>
                <div className="text-sm font-semibold text-gray-900">{k.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No preview rows for the selected filters.</div>
      </div>
    );
  }

  const columns = mergeCountPctColumns(
    orderPreviewTableColumns(reportType, Object.keys(rows[0])).filter((c) => !PREVIEW_TABLE_HIDDEN_COLUMNS.has(c)),
    reportType,
  );
  const visible = rows.slice(0, 50);
  return (
    <div className="space-y-3">
      {summary.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.map((k) => (
            <div key={k.label} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-[11px] font-medium text-gray-500">{k.label}</div>
              <div className="text-sm font-semibold text-gray-900">{k.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {reportType === "membership" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-950">
          <p className="font-semibold">This is the usual source of “wrong numbers”</p>
          <p className="mt-1 text-amber-950/90">
            The member profile <strong>Attendance rate</strong> card (e.g. 50% · past 12 months) is the same as column{" "}
            <strong>Use this to match profile: 12 mo. past rate</strong>. The column <strong>Not profile card: % for selected report dates only</strong> uses your
            <strong> report date range</strong> in the modal — it is supposed to differ unless you picked the same window on purpose.
          </p>
        </div>
      ) : null}
      <div className="max-h-[420px] overflow-auto rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              {columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold text-gray-700">
                  {getReportTableColumnLabel(c, reportType)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {visible.map((row, idx) => (
              <tr key={`row-${idx}`} className="hover:bg-gray-50">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {formatPreviewTableCell(row, c, reportType)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-gray-500">
        Showing {visible.length} of {rows.length} rows.
      </div>
    </div>
  );
}
