import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  Search,
  Trash2,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import CreateEventModal from '../modals/CreateEventModal';

export interface EventRow {
  id: string;
  organization_id?: string | null;
  branch_id?: string | null;
  group_id?: string | null;
  title: string;
  start_time: string;
  end_time?: string | null;
  event_type?: string | null;
  location_type?: string | null;
  location_details?: string | null;
  notes?: string | null;
  cover_image_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  groups?: { name: string } | null;
}

function formatRange(start: string, end?: string | null) {
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return '—';
  const opts: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  };
  if (!end) return s.toLocaleString(undefined, opts);
  const e = new Date(end);
  if (Number.isNaN(e.getTime())) return s.toLocaleString(undefined, opts);
  return `${s.toLocaleString(undefined, opts)} → ${e.toLocaleString(undefined, opts)}`;
}

function typeBadgeClass(t: string | null | undefined) {
  const x = (t || '').toLowerCase();
  if (x === 'service') return 'bg-violet-50 text-violet-800 border-violet-200';
  if (x === 'meeting') return 'bg-blue-50 text-blue-800 border-blue-200';
  if (x === 'conference') return 'bg-amber-50 text-amber-900 border-amber-200';
  if (x === 'outreach') return 'bg-emerald-50 text-emerald-900 border-emerald-200';
  if (x === 'social') return 'bg-pink-50 text-pink-900 border-pink-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export default function Events() {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterWhen, setFilterWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [createOpen, setCreateOpen] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!token) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/events', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to load events');
      }
      setEvents(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const branchFiltered = useMemo(() => {
    if (!selectedBranch?.id) return events;
    return events.filter((ev) => !ev.branch_id || ev.branch_id === selectedBranch.id);
  }, [events, selectedBranch?.id]);

  const searchQl = searchQuery.trim().toLowerCase();

  const filteredEvents = useMemo(() => {
    const now = new Date();
    return branchFiltered.filter((ev) => {
      if (filterType !== 'all' && (ev.event_type || '').toLowerCase() !== filterType.toLowerCase()) {
        return false;
      }
      const start = new Date(ev.start_time);
      if (filterWhen === 'upcoming' && !Number.isNaN(start.getTime()) && start < now) return false;
      if (filterWhen === 'past' && !Number.isNaN(start.getTime()) && start >= now) return false;
      if (!searchQl) return true;
      const hay = [
        ev.title,
        ev.event_type,
        ev.location_details,
        ev.location_type,
        ev.groups && typeof ev.groups === 'object' && !Array.isArray(ev.groups) ? ev.groups.name : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQl);
    });
  }, [branchFiltered, filterType, filterWhen, searchQl]);

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
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

  return (
    <div className="flex flex-col flex-1 bg-gray-50/80 min-h-0">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Events</h1>
            <p className="mt-1 text-sm text-gray-500">Create, filter, and manage church events</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New event
          </button>
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
                className="w-full rounded-xl border border-gray-200 bg-gray-50/80 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="all">All types</option>
                <option value="service">Service</option>
                <option value="meeting">Meeting</option>
                <option value="conference">Conference</option>
                <option value="outreach">Outreach</option>
                <option value="social">Social</option>
                <option value="other">Other</option>
              </select>
              <select
                value={filterWhen}
                onChange={(e) => setFilterWhen(e.target.value as 'upcoming' | 'past' | 'all')}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="upcoming">Upcoming</option>
                <option value="past">Past</option>
                <option value="all">All dates</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-gray-500">Loading events…</p>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center text-sm text-gray-500">
              {branchFiltered.length === 0
                ? 'No events yet. Create one to get started.'
                : 'No events match your filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/90">
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Event
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Type
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      When
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Location
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Ministry
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => {
                    const g = ev.groups && typeof ev.groups === 'object' && !Array.isArray(ev.groups) ? ev.groups : null;
                    const ministryLabel = ev.group_id ? (g?.name?.trim() || '—') : 'All ministries';
                    const thumb = ev.cover_image_url?.trim();
                    const loc =
                      [ev.location_type, ev.location_details].filter(Boolean).join(' · ') || '—';

                    return (
                      <tr
                        key={ev.id}
                        className="border-b border-gray-100 transition-colors hover:bg-gray-50/80"
                      >
                        <td className="px-6 py-4 align-middle">
                          <div className="flex min-w-0 max-w-xs items-center gap-3">
                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-indigo-100 ring-1 ring-black/5">
                              {thumb ? (
                                <img src={thumb} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-indigo-700">
                                  <ImageIcon className="h-4 w-4 opacity-70" />
                                </div>
                              )}
                            </div>
                            <span className="truncate text-[14px] font-medium text-gray-900">{ev.title}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${typeBadgeClass(ev.event_type)}`}
                          >
                            {ev.event_type || 'other'}
                          </span>
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <span className="inline-flex items-center gap-1.5 text-[14px] text-gray-800">
                            <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="whitespace-nowrap">{formatRange(ev.start_time, ev.end_time)}</span>
                          </span>
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <span className="inline-flex items-start gap-1.5 text-[14px] text-gray-700">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="line-clamp-2 min-w-0">{loc}</span>
                          </span>
                        </td>
                        <td className="px-6 py-4 align-middle">
                          <span className="text-[14px] text-gray-800">{ministryLabel}</span>
                        </td>
                        <td className="px-6 py-4 align-middle text-right">
                          <button
                            type="button"
                            onClick={() => void handleDelete(ev.id, ev.title)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <CreateEventModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        token={token}
        onCreated={() => void fetchEvents()}
      />
    </div>
  );
}
