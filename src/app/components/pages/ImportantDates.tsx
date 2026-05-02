import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search } from 'lucide-react';
import { Link } from 'react-router';
import { useMemberProfileModal } from '@/contexts/MemberProfileModalContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';
import type { UpcomingImportantDateItem } from '@/types';
import { ImportantDatesListSkeleton } from '@/components/skeletons/data-skeletons';

const RANGE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
];

export default function ImportantDates() {
  const memberProfile = useMemberProfileModal();
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
    <div className="w-full min-w-0 space-y-5 p-4 sm:p-6 md:p-8">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">All Important Dates</h1>
          <p className="text-sm text-gray-500 mt-1">{countLabel}</p>
        </div>
        <Link
          to="/members"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 sm:w-auto"
        >
          Back to Members
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member or date title..."
            className="min-h-11 w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-base sm:text-sm"
          />
        </div>
        <div className="flex max-w-full items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-0.5 -mx-0.5 px-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setRangeDays(opt.id)}
              className={`shrink-0 px-3 py-2 sm:py-1.5 rounded-full text-sm border ${
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
          <ImportantDatesListSkeleton rows={7} />
        ) : items.length === 0 ? (
          <div className="p-10 text-sm text-gray-500 text-center">No upcoming important dates found.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void memberProfile.openMemberById(item.member_id)}
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
