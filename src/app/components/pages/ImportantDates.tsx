import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';
import type { UpcomingImportantDateItem } from '@/types';

const RANGE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

export default function ImportantDates() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const [items, setItems] = useState<UpcomingImportantDateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const url = new URL('/api/important-dates/upcoming', window.location.origin);
      url.searchParams.set('range_days', String(rangeDays));
      if (search.trim()) url.searchParams.set('q', search.trim());
      const res = await fetch(url.toString(), {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw?.error === 'string' ? raw.error : 'Failed to load');
      const rows = (raw as { items?: UpcomingImportantDateItem[] }).items;
      setItems(Array.isArray(rows) ? rows : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [rangeDays, search, selectedBranch?.id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const countLabel = useMemo(() => `${items.length} upcoming`, [items.length]);

  return (
    <div className="p-6 md:p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">All Important Dates</h1>
          <p className="text-sm text-gray-500 mt-1">{countLabel}</p>
        </div>
        <button
          onClick={() => navigate('/members')}
          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
        >
          Back to Members
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member or date title..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRangeDays(opt.id)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                rangeDays === opt.id
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="p-10 text-sm text-gray-500 text-center">Loading important dates...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-sm text-gray-500 text-center">No upcoming important dates found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate('/members', { state: { openMemberId: item.member_id } })}
                className="w-full text-left p-4 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.member_display_name}</p>
                    <p className="text-sm text-gray-700 mt-0.5">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5" />
                      {formatLongWeekdayDate(item.occurs_on) || item.occurs_on}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                    {item.days_until === 0 ? 'Today' : `${item.days_until}d`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
