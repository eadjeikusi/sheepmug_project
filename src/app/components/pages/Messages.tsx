import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Send, Users, Plus, Smartphone } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { OrgBulkMessageRow } from '@/types';
import BulkSmsComposeModal from '../modals/BulkSmsComposeModal';
import { FilterResultChips, type FilterChipItem } from '../FilterResultChips';
import { formatNotificationDateTime } from '@/utils/dateDisplayFormat';

type FilterTab = 'all' | 'pending' | 'scheduled' | 'recurring';

export default function Messages() {
  const { token, authLoading } = useAuth();
  const { selectedBranch } = useBranch();

  const [rows, setRows] = useState<OrgBulkMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token || authLoading) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${window.location.origin}/api/org/messages`, {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load messages');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, selectedBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      const label = r.metadata?.recipient_label || r.recipient_type || '';
      const subj = r.subject || '';
      const body = r.content || '';
      const matchesSearch =
        !q ||
        label.toLowerCase().includes(q) ||
        subj.toLowerCase().includes(q) ||
        body.toLowerCase().includes(q);

      const freq = r.metadata?.recurrence?.frequency;
      const isRecurring = !!(freq && freq !== 'none');

      if (filterTab === 'pending') return matchesSearch && r.status === 'pending_external';
      if (filterTab === 'scheduled') return matchesSearch && r.status === 'scheduled';
      if (filterTab === 'recurring') return matchesSearch && isRecurring;
      return matchesSearch;
    });
  }, [rows, searchQuery, filterTab]);

  const clearMessageFilters = useCallback(() => {
    setSearchQuery('');
    setFilterTab('all');
  }, []);

  const messageFilterChips = useMemo((): FilterChipItem[] => {
    const chips: FilterChipItem[] = [];
    const q = searchQuery.trim();
    if (q) {
      chips.push({
        id: 'search',
        label: `Search: "${q.length > 48 ? `${q.slice(0, 48)}…` : q}"`,
        onRemove: () => setSearchQuery(''),
      });
    }
    if (filterTab !== 'all') {
      const tabLabel =
        filterTab === 'pending'
          ? 'Pending'
          : filterTab === 'scheduled'
            ? 'Scheduled'
            : 'Recurring';
      chips.push({
        id: 'tab',
        label: `View: ${tabLabel}`,
        onRemove: () => setFilterTab('all'),
      });
    }
    return chips;
  }, [searchQuery, filterTab]);

  const statusBadge = (r: OrgBulkMessageRow) => {
    const freq = r.metadata?.recurrence?.frequency;
    const recurring = freq && freq !== 'none';
    if (recurring) {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-800 border-blue-200">
          Recurring
        </span>
      );
    }
    if (r.status === 'scheduled') {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium border bg-amber-50 text-amber-800 border-amber-200">
          Scheduled
        </span>
      );
    }
    if (r.status === 'pending_external') {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium border bg-slate-50 text-slate-800 border-slate-200">
          Pending
        </span>
      );
    }
    return (
      <span className="px-3 py-1 rounded-full text-xs font-medium border bg-gray-50 text-gray-700 border-gray-200">
        {r.status}
      </span>
    );
  };

  const displayDate = (r: OrgBulkMessageRow) => {
    const iso = r.scheduled_for || r.created_at;
    try {
      return formatNotificationDateTime(iso) || '—';
    } catch {
      return '—';
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="font-semibold text-gray-900 text-[20px]">Bulk SMS</h1>
          <p className="mt-2 text-gray-500">Send SMS to members and groups (delivery via Hubtel — not connected yet)</p>
        </div>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm text-[12px] sm:w-auto"
        >
          <Plus className="w-5 h-5 mr-2" />
          Compose SMS
        </button>
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="w-full min-w-0 sm:max-w-md sm:flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by label, recipients, or body…"
              className="min-h-11 w-full pl-10 pr-4 py-2.5 text-base bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all sm:text-sm"
            />
          </div>
        </div>

        <div className="flex max-w-full items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth rounded-xl border border-gray-200 bg-white p-1 sm:flex-wrap sm:overflow-x-visible">
          {(
            [
              ['all', 'All'],
              ['pending', 'Pending'],
              ['scheduled', 'Scheduled'],
              ['recurring', 'Recurring'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilterTab(id)}
              className={`shrink-0 px-4 py-2 rounded-lg font-medium transition-all text-[13px] ${
                filterTab === id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {messageFilterChips.length > 0 ? (
        <FilterResultChips chips={messageFilterChips} onClearAll={clearMessageFilters} />
      ) : null}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto touch-pan-x overscroll-x-contain">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600">
                  Label / body
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600">
                  Recipients
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600">
                  Date
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600">
                  Channel
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length > 0 ? (
                filtered.map((message, index) => (
                  <motion.tr
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{message.subject || '(no label)'}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{message.content}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                          <Users className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-[13px]">
                            {message.metadata?.recipient_label || message.recipient_type}
                          </p>
                          <p className="text-xs text-gray-500">
                            {message.metadata?.recipient_count ?? '—'} recipients
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{displayDate(message)}</td>
                    <td className="px-6 py-4">{statusBadge(message)}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
                        <Smartphone className="w-3.5 h-3.5" />
                        SMS
                      </span>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                        <Send className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500 font-medium">No messages found</p>
                      <p className="text-sm text-gray-400 mt-1">Compose an SMS to save a draft (Hubtel delivery pending)</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BulkSmsComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        mode="free"
        onSaved={() => void load()}
      />
    </div>
  );
}
