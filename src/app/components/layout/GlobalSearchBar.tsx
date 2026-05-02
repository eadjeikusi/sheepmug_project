import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Search, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { useMemberProfileModal } from '@/contexts/MemberProfileModalContext';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import { usePermissions } from '@/hooks/usePermissions';
import { pushSearchHistory, readSearchHistory } from '@/utils/globalSearchHistory';

type SearchKind = 'member' | 'event' | 'group' | 'family';

type SearchHit = {
  id: string;
  label: string;
  subtitle: string | null;
  kind: SearchKind;
};

type SearchResponse = {
  members: SearchHit[];
  events: SearchHit[];
  groups: SearchHit[];
  families: SearchHit[];
};

const KIND_LABEL: Record<SearchKind, string> = {
  member: 'Member',
  event: 'Event',
  group: 'Ministry',
  family: 'Family',
};

const KIND_BADGE: Record<SearchKind, string> = {
  member: 'bg-blue-100 text-blue-800 border-blue-200',
  event: 'bg-amber-100 text-amber-900 border-amber-200',
  group: 'bg-violet-100 text-violet-800 border-violet-200',
  family: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const DEBOUNCE_MS = 320;

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}

export default function GlobalSearchBar() {
  const { token } = useAuth();
  const { selectedBranch } = useBranch();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const memberProfile = useMemberProfileModal();

  /** Any of these allows using global search (API enforces per-type results). */
  const canSearch =
    can('view_members') || can('view_events') || can('view_groups') || can('view_families');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [history, setHistory] = useState<string[]>(() =>
    typeof window !== 'undefined' ? readSearchHistory() : [],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runFetch = useCallback(
    async (q: string) => {
      const t = q.trim();
      if (!token || !selectedBranch?.id || t.length < 2) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const url = new URL('/api/search', window.location.origin);
        url.searchParams.set('q', t);
        const res = await fetch(url.toString(), {
          headers: withBranchScope(selectedBranch.id, { Authorization: `Bearer ${token}` }),
        });
        const json = (await res.json().catch(() => null)) as SearchResponse | { error?: string } | null;
        if (!res.ok) {
          setData(null);
          return;
        }
        if (json && !('error' in json && json.error)) {
          setData(json as SearchResponse);
        } else {
          setData(null);
        }
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [token, selectedBranch?.id],
  );

  const debouncedFetch = useMemo(() => debounce(runFetch, DEBOUNCE_MS), [runFetch]);

  useEffect(() => {
    debouncedFetch(query);
  }, [query, debouncedFetch]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const flatResults = useMemo(() => {
    if (!data) return [];
    const out: SearchHit[] = [];
    for (const x of data.members || []) out.push({ ...x, kind: 'member' });
    for (const x of data.events || []) out.push({ ...x, kind: 'event' });
    for (const x of data.groups || []) out.push({ ...x, kind: 'group' });
    for (const x of data.families || []) out.push({ ...x, kind: 'family' });
    return out;
  }, [data]);

  const navigateToHit = useCallback(
    (h: SearchHit) => {
      pushSearchHistory(query.trim() || h.label);
      setHistory(readSearchHistory());
      setOpen(false);
      setQuery('');
      setData(null);
      if (h.kind === 'member') {
        void memberProfile.openMemberById(h.id);
      } else if (h.kind === 'event') {
        navigate(`/events/${encodeURIComponent(h.id)}`);
      } else if (h.kind === 'group') {
        navigate(`/groups/${encodeURIComponent(h.id)}`);
      } else {
        navigate('/members', { state: { openFamilyId: h.id } });
      }
    },
    [navigate, query, memberProfile],
  );

  const onPickHistory = (h: string) => {
    setQuery(h);
    setOpen(true);
    inputRef.current?.focus();
    void runFetch(h);
  };

  const showPanel = open && (query.trim().length >= 2 || history.length > 0);

  if (!canSearch) return null;

  return (
    <div className="relative w-full min-w-0 max-w-2xl flex-1 sm:mx-3" ref={wrapRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
            }
            if (e.key === 'Enter' && flatResults.length > 0) {
              e.preventDefault();
              navigateToHit(flatResults[0]);
            }
          }}
          placeholder="Search members, ministries, events, and families…"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-md border border-gray-200 bg-white py-2.5 pl-10 pr-9 text-base text-gray-900 transition-all placeholder:text-gray-500 hover:border-blue-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:min-h-0 sm:py-2 sm:text-[13px]"
          aria-label="Search members, ministries, events, and families"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            onClick={() => {
              setQuery('');
              setData(null);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div
          id="global-search-results"
          className="absolute left-0 right-0 top-full mt-1 z-[60] bg-white border border-gray-200 rounded-lg shadow-xl max-h-[min(70vh,420px)] overflow-y-auto"
          role="listbox"
        >
          {query.trim().length < 2 && history.length > 0 ? (
            <div className="p-2 border-b border-gray-100">
              <p className="px-2 py-1 text-[10px] font-semibold text-gray-500">Recent searches</p>
              <ul className="space-y-0.5">
                {history.map((h) => (
                  <li key={h}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-md text-sm text-gray-800 hover:bg-gray-50"
                      onClick={() => onPickHistory(h)}
                    >
                      {h}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {query.trim().length >= 2 ? (
            <div className="p-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  Searching…
                </div>
              ) : flatResults.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No matches.</p>
              ) : (
                <ul className="space-y-1">
                  {flatResults.map((h) => (
                    <li key={`${h.kind}-${h.id}`}>
                      <button
                        type="button"
                        role="option"
                        className="w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
                        onClick={() => navigateToHit(h)}
                      >
                        <span
                          className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${KIND_BADGE[h.kind]}`}
                        >
                          {KIND_LABEL[h.kind]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 truncate">{h.label}</span>
                          {h.subtitle ? (
                            <span className="block text-xs text-gray-500 truncate">{h.subtitle}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
