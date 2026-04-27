import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  Search,
  Trash2,
  Pencil,
  Image as ImageIcon,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import CreateEventModal from '../modals/CreateEventModal';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';
import { displayTitleWords } from '@/utils/displayText';
import { formatEventRangeLabel, formatCalendarCountdown } from '@/utils/dateDisplayFormat';
import { formatEventLocationSummary } from '@/utils/eventLocation';
import { EventsTableSkeleton } from '@/components/skeletons/data-skeletons';

export interface EventAttachmentItem {
  /** Stored bucket path for same-origin download (`/api/download-event-file`). */
  storage_path?: string | null;
  /** Legacy: direct URL (e.g. Supabase public). Prefer `storage_path` for new uploads. */
  url?: string | null;
  name: string;
  size_bytes?: number;
  content_type?: string | null;
  uploaded_at?: string | null;
}

export interface EventRow {
  id: string;
  organization_id?: string | null;
  branch_id?: string | null;
  group_id?: string | null;
  group_ids?: string[];
  linked_groups?: { id: string; name: string }[];
  title: string;
  start_time: string;
  end_time?: string | null;
  event_type?: string | null;
  location_type?: string | null;
  location_details?: string | null;
  online_meeting_url?: string | null;
  notes?: string | null;
  cover_image_url?: string | null;
  program_outline?: Record<string, unknown> | null;
  attachments?: EventAttachmentItem[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  groups?: { name: string } | null;
  assigned_member_ids?: string[];
  custom_fields?: Record<string, unknown> | null;
}

function formatRange(start: string, end?: string | null) {
  return formatEventRangeLabel(start, end);
}

const PAGE_SIZE = 10;

function typeBadgeClass(t: string | null | undefined) {
  const x = (t || '').toLowerCase();
  if (x === 'service') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (x === 'meeting') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (x === 'conference') return 'bg-amber-50 text-amber-900 border-amber-200';
  if (x === 'outreach') return 'bg-blue-50 text-blue-900 border-blue-200';
  if (x === 'social') return 'bg-pink-50 text-pink-900 border-pink-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function isHexColor(c: string | null | undefined): c is string {
  if (!c || typeof c !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

/** Text used for list search — must match enriched API fields (linked ministries, about text, etc.). */
function eventSearchHay(ev: EventRow, typeDisplayName: string): string {
  const legacyGroupName =
    ev.groups && typeof ev.groups === 'object' && !Array.isArray(ev.groups)
      ? String((ev.groups as { name?: string }).name || '')
      : '';
  const linkedNames = (ev.linked_groups ?? []).map((g) => String(g.name || '').trim()).filter(Boolean);
  return [
    ev.title,
    ev.event_type,
    typeDisplayName,
    ev.location_details,
    ev.location_type,
    legacyGroupName,
    ...linkedNames,
    ev.notes,
    ev.online_meeting_url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function ministryTableLabel(ev: EventRow): { line: string; title: string } {
  const linked = (ev.linked_groups ?? [])
    .map((g) => String(g.name || '').trim())
    .filter(Boolean);
  if (linked.length > 0) {
    const parts = linked.map((n) => displayTitleWords(n));
    const title = parts.join(', ');
    const line =
      parts.length <= 2
        ? title
        : `${parts[0]}, ${parts[1]} +${parts.length - 2}`;
    return { line, title };
  }
  const g = ev.groups && typeof ev.groups === 'object' && !Array.isArray(ev.groups) ? ev.groups : null;
  const legacy = g?.name?.trim();
  if (ev.group_id && legacy) {
    const n = displayTitleWords(legacy);
    return { line: n, title: n };
  }
  const nIds = ev.group_ids?.length ?? 0;
  if (nIds > 0) {
    const t = `${nIds} linked ${nIds === 1 ? 'ministry' : 'ministries'}`;
    return { line: t, title: t };
  }
  const assignN = ev.assigned_member_ids?.length ?? 0;
  if (assignN > 0) {
    return { line: 'Members only', title: 'Members only roster' };
  }
  return { line: 'All ministries', title: 'No ministry link' };
}

function compareEventsOrder(
  a: EventRow,
  b: EventRow,
  when: 'upcoming' | 'past' | 'all',
): number {
  const tA = new Date(a.start_time).getTime();
  const tB = new Date(b.start_time).getTime();
  const startA = Number.isNaN(tA) ? 0 : tA;
  const startB = Number.isNaN(tB) ? 0 : tB;
  if (when === 'upcoming') return startA - startB;
  if (when === 'past') return startB - startA;
  const cA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cB = b.created_at ? new Date(b.created_at).getTime() : 0;
  if (cB !== cA) return cB - cA;
  const uA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
  const uB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
  if (uB !== uA) return uB - uA;
  return startB - startA;
}

interface EventTypeRow {
  id: string;
  slug: string;
  name: string;
  color?: string | null;
}

export default function Events() {
  const { token } = useAuth();
  const { can } = usePermissions();
  const { selectedBranch } = useBranch();
  const location = useLocation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterWhen, setFilterWhen] = useState<'upcoming' | 'past' | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<EventRow | null>(null);
  const [eventTypesList, setEventTypesList] = useState<EventTypeRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedEventsCountRef = useRef(0);

  useEffect(() => {
    loadedEventsCountRef.current = events.length;
  }, [events.length]);

  const fetchEvents = useCallback(async (reset = true) => {
    if (!token || !can('view_events')) {
      setEvents([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(true);
      return;
    }
    if (reset) {
      setLoading(true);
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : loadedEventsCountRef.current;
      const res = await fetch(`/api/events?offset=${offset}&limit=${PAGE_SIZE}`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load events');
      }
      const rows = Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
      setEvents((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load events');
      if (reset) {
        setEvents([]);
      }
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [token, selectedBranch?.id, can]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void fetchEvents(false);
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchEvents, hasMore, loading, loadingMore]);

  useEffect(() => {
    const editId = (location.state as { editEventId?: string } | null)?.editEventId;
    if (!editId) return;
    const found = events.find((e) => e.id === editId);
    if (found) {
      setEditEvent(found);
      setCreateOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, events, navigate]);

  useEffect(() => {
    if (!token || !can('view_events')) {
      setEventTypesList([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/event-types', {
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data)) {
          if (!cancelled) setEventTypesList([]);
          return;
        }
        if (!cancelled) {
          setEventTypesList(
            data.map((row: Record<string, unknown>) => ({
              id: String(row.id ?? ''),
              slug: String(row.slug ?? ''),
              name: String(row.name ?? row.slug ?? ''),
              color: (typeof row.color === 'string' ? row.color : null) as string | null,
            })),
          );
        }
      } catch {
        if (!cancelled) setEventTypesList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, selectedBranch?.id, can]);

  const typeMetaBySlug = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const t of eventTypesList) {
      const s = (t.slug || '').trim().toLowerCase();
      if (!s) continue;
      m.set(s, { name: t.name?.trim() || t.slug, color: t.color ?? null });
    }
    return m;
  }, [eventTypesList]);

  /** Same source as Settings → Event types and Create/Edit event: `/api/event-types` only (slug + display name). */
  const typeSelectOptions = useMemo(() => {
    const fromApi = eventTypesList
      .filter((t) => String(t.slug || '').trim())
      .map((t) => ({
        value: t.slug.trim(),
        label: displayTitleWords(t.name.trim() || t.slug),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return [{ value: 'all', label: 'All Types' }, ...fromApi];
  }, [eventTypesList]);

  const branchFiltered = useMemo(() => {
    if (!selectedBranch?.id) return events;
    return events.filter((ev) => !ev.branch_id || ev.branch_id === selectedBranch.id);
  }, [events, selectedBranch?.id]);

  const searchQl = searchQuery.trim().toLowerCase();

  const filteredEvents = useMemo(() => {
    const now = new Date();
    const filtered = branchFiltered.filter((ev) => {
      if (filterType !== 'all' && (ev.event_type || '').toLowerCase() !== filterType.toLowerCase()) {
        return false;
      }
      const start = new Date(ev.start_time);
      if (filterWhen === 'upcoming' && !Number.isNaN(start.getTime()) && start < now) return false;
      if (filterWhen === 'past' && !Number.isNaN(start.getTime()) && start >= now) return false;
      if (!searchQl) return true;
      const slug = (ev.event_type || '').toLowerCase();
      const typeName = typeMetaBySlug.get(slug)?.name ?? '';
      const hay = eventSearchHay(ev, typeName);
      return hay.includes(searchQl);
    });
    return [...filtered].sort((a, b) => compareEventsOrder(a, b, filterWhen));
  }, [branchFiltered, filterType, filterWhen, searchQl, typeMetaBySlug]);

  const eventFilterChips = useMemo((): FilterChipItem[] => {
    const chips: FilterChipItem[] = [];
    const sq = searchQuery.trim();
    if (sq) {
      chips.push({
        id: 'search',
        label: `Search: "${sq.length > 48 ? `${sq.slice(0, 48)}…` : sq}"`,
        onRemove: () => setSearchQuery(''),
      });
    }
    if (filterType !== 'all') {
      const opt = typeSelectOptions.find((o) => o.value === filterType);
      chips.push({
        id: 'type',
        label: `Type: ${opt?.label ?? filterType}`,
        onRemove: () => setFilterType('all'),
      });
    }
    if (filterWhen !== 'all') {
      chips.push({
        id: 'when',
        label: `When: ${filterWhen === 'upcoming' ? 'Upcoming' : 'Past'}`,
        onRemove: () => setFilterWhen('all'),
      });
    }
    return chips;
  }, [searchQuery, filterType, filterWhen, typeSelectOptions]);

  const clearAllEventFilters = useCallback(() => {
    setSearchQuery('');
    setFilterType('all');
    setFilterWhen('all');
  }, []);

  const handleDelete = async (id: string, title: string) => {
    if (!token || !can('delete_events')) return;
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Delete failed');
      }
      toast.success('Event deleted');
      void fetchEvents();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (!can('view_events')) {
    return (
      <div className="flex flex-col flex-1 bg-gray-50/80 min-h-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
          <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Events</h1>
          <p className="mt-2 text-sm text-gray-600">You do not have permission to view events.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-gray-50/80 min-h-0">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Events</h1>
            <p className="mt-1 text-sm text-gray-500">Create, filter, and manage church events</p>
          </div>
          {can('add_events') ? (
          <button
            type="button"
            onClick={() => {
              setEditEvent(null);
              setCreateOpen(true);
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Event
          </button>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block min-w-0 w-full lg:max-w-md">
              <span className="sr-only">Search events</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title, location, ministry…"
                className="min-h-11 w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {typeSelectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={filterWhen}
                onChange={(e) => setFilterWhen(e.target.value as 'upcoming' | 'past' | 'all')}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">All Dates</option>
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
              </select>
            </div>
          </div>

          {eventFilterChips.length > 0 ? (
            <FilterResultChips chips={eventFilterChips} onClearAll={clearAllEventFilters} className="mb-4" />
          ) : null}

          {!loading && events.length > branchFiltered.length ? (
            <p className="mb-4 text-xs text-amber-800/90">
              {events.length - branchFiltered.length} event(s) belong to another branch. Use the branch selector in the app
              header to switch branches.
            </p>
          ) : null}

          {!loading && branchFiltered.length > 0 && filteredEvents.length < branchFiltered.length ? (
            <p className="mb-4 text-xs text-gray-500">
              Showing {filteredEvents.length} of {branchFiltered.length} events for this branch. Try{' '}
              <button
                type="button"
                className="font-medium text-blue-600 underline decoration-blue-600/30 hover:text-blue-800"
                onClick={() => {
                  setFilterWhen('all');
                  setFilterType('all');
                  setSearchQuery('');
                }}
              >
                clearing filters
              </button>{' '}
              if something is missing.
            </p>
          ) : null}

          {loading ? (
            <EventsTableSkeleton rows={8} />
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-sm text-gray-500">
              {branchFiltered.length === 0
                ? 'No events yet. Create one to get started.'
                : 'No events match your filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-xl border border-gray-100">
              <table className="w-full min-w-[640px] table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/90">
                    <th className="w-[26%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      Event
                    </th>
                    <th className="w-[14%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      Type
                    </th>
                    <th className="w-[22%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      When
                    </th>
                    <th className="w-[18%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      Location
                    </th>
                    <th className="w-[12%] min-w-0 px-3 py-3 text-left text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      Ministry
                    </th>
                    <th className="w-[8%] min-w-0 px-3 py-3 text-right text-xs font-semibold text-gray-500 md:px-4 md:py-4">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => {
                    const ministry = ministryTableLabel(ev);
                    const thumb = ev.cover_image_url?.trim();
                    const locRaw = formatEventLocationSummary(ev) || '—';
                    const loc =
                      locRaw === '—' ? '—' : displayTitleWords(locRaw.replace(/_/g, ' '));
                    const typeSlug = (ev.event_type || '').trim().toLowerCase();
                    const typeMeta = typeMetaBySlug.get(typeSlug);
                    const typeLabel = displayTitleWords(
                      typeMeta?.name || (typeSlug ? typeSlug.replace(/-/g, ' ') : 'other'),
                    );
                    const typeColor = typeMeta?.color;
                    const whenStr = formatRange(ev.start_time, ev.end_time);
                    const whenCountdown = formatCalendarCountdown(ev.start_time);

                    return (
                      <tr
                        key={ev.id}
                        className="border-b border-gray-100 transition-colors hover:bg-gray-50/80"
                      >
                        <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                          <div className="flex min-w-0 max-w-full items-center gap-2 md:gap-3">
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-blue-100 ring-1 ring-black/5 md:h-10 md:w-10">
                              {thumb ? (
                                <img src={thumb} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-blue-700">
                                  <ImageIcon className="h-4 w-4 opacity-70" />
                                </div>
                              )}
                            </div>
                            <Link
                              to={`/events/${ev.id}`}
                              className="min-w-0 truncate text-left text-[14px] font-medium text-gray-900 hover:text-blue-700 hover:underline decoration-blue-600/30 underline-offset-2"
                              title={displayTitleWords(ev.title)}
                            >
                              {displayTitleWords(ev.title)}
                            </Link>
                          </div>
                        </td>
                        <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4">
                          {isHexColor(typeColor) ? (
                            <span
                              className="inline-flex max-w-full min-w-0 items-center rounded-full border px-2 py-1 text-xs font-medium"
                              style={{
                                backgroundColor: `${typeColor}22`,
                                color: typeColor,
                                borderColor: `${typeColor}55`,
                              }}
                              title={typeLabel}
                            >
                              <span className="truncate">{typeLabel}</span>
                            </span>
                          ) : (
                            <span
                              className={`inline-flex max-w-full min-w-0 items-center rounded-full border px-2 py-1 text-xs font-medium ${typeBadgeClass(ev.event_type)}`}
                              title={typeLabel}
                            >
                              <span className="truncate">{typeLabel}</span>
                            </span>
                          )}
                        </td>
                        <td
                          className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4"
                          title={whenStr}
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-gray-800 md:text-[14px]">
                              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                              <span className="min-w-0 truncate">{whenStr}</span>
                            </div>
                            {whenCountdown ? (
                              <span className="pl-5 text-[11px] text-gray-500 truncate">{whenCountdown}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4" title={loc}>
                          <div className="flex min-w-0 items-start gap-1.5 text-[13px] text-gray-700 md:text-[14px]">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="line-clamp-2 min-w-0 break-words">{loc}</span>
                          </div>
                        </td>
                        <td
                          className="min-w-0 px-3 py-3 align-middle md:px-4 md:py-4"
                          title={ministry.title}
                        >
                          <span className="line-clamp-2 break-words text-[13px] text-gray-800 md:text-[14px]">
                            {ministry.line}
                          </span>
                        </td>
                        <td className="min-w-0 px-3 py-3 align-middle text-right md:px-4 md:py-4">
                          <div className="flex justify-end gap-1">
                            <Link
                              to={`/events/${ev.id}`}
                              title="View event"
                              aria-label="View event"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                            {can('edit_events') ? (
                            <button
                              type="button"
                              onClick={() => {
                                setCreateOpen(false);
                                setEditEvent(ev);
                              }}
                              title="Edit event"
                              aria-label="Edit event"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            ) : null}
                            {can('delete_events') ? (
                            <button
                              type="button"
                              onClick={() => void handleDelete(ev.id, ev.title)}
                              title="Delete event"
                              aria-label="Delete event"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && hasMore ? <div ref={sentinelRef} className="h-6" /> : null}
          {!loading && loadingMore ? (
            <p className="py-3 text-center text-xs text-gray-500">Loading more events…</p>
          ) : null}
        </div>
      </div>

      <CreateEventModal
        isOpen={createOpen || Boolean(editEvent)}
        editingEvent={editEvent}
        onClose={() => {
          setCreateOpen(false);
          setEditEvent(null);
        }}
        token={token}
        onCreated={() => void fetchEvents()}
        onUpdated={() => void fetchEvents()}
      />

    </div>
  );
}
