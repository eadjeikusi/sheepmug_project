import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Users,
  DollarSign,
  Search,
  Shield,
  TrendingUp,
  GitBranch,
  LayoutDashboard,
  CreditCard,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { superadminApi } from '@/utils/api';
import { SUBSCRIPTION_PLANS, type SubscriptionTierId } from '@/config/subscriptionPlans';

type Tab = 'overview' | 'organizations' | 'branches' | 'users' | 'billing';

type SuperStats = {
  total_organizations: number;
  total_members: number;
  total_branches: number;
  total_staff: number;
  total_groups: number;
  events_last_30_days: number;
  orgs_by_tier?: Record<string, number>;
};

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  subscription_tier: string;
  created_at?: string;
  usage: {
    members: number;
    groups: number;
    branches: number;
    events_this_month: number;
    staff: number;
  };
  limits: {
    max_members: number;
    max_groups: number;
    max_branches: number;
    max_events_per_month: number;
    max_staff: number;
  };
  overrides: {
    max_members: number | null;
    max_groups: number | null;
    max_branches: number | null;
    max_events_per_month: number | null;
    max_staff: number | null;
  };
};

export default function SuperAdmin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<SuperStats | null>(null);
  const [growth, setGrowth] = useState<Record<string, number>>({});
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsTotal, setOrgsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [detailOrg, setDetailOrg] = useState<{
    organization: Record<string, unknown>;
    usage: OrgRow['usage'];
    limits: OrgRow['limits'];
    branches: unknown[];
    staff: unknown[];
  } | null>(null);
  const [editTier, setEditTier] = useState<SubscriptionTierId>('free');
  const [editMax, setEditMax] = useState({
    max_members: '' as string,
    max_groups: '' as string,
    max_branches: '' as string,
    max_events_per_month: '' as string,
    max_staff: '' as string,
  });
  const [branchRows, setBranchRows] = useState<unknown[]>([]);
  const [userRows, setUserRows] = useState<unknown[]>([]);
  const [userSearch, setUserSearch] = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const s = (await superadminApi.stats()) as SuperStats;
      setStats(s);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadGrowth = useCallback(async () => {
    try {
      const g = (await superadminApi.growth()) as { new_orgs_by_month?: Record<string, number> };
      setGrowth(g.new_orgs_by_month || {});
    } catch {
      /* optional */
    }
  }, []);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await superadminApi.orgs({
        page,
        pageSize: 15,
        search: search.trim() || undefined,
        tier: tierFilter === 'all' ? undefined : tierFilter,
      })) as { organizations: OrgRow[]; total: number };
      setOrgs(res.organizations || []);
      setOrgsTotal(res.total ?? 0);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [page, search, tierFilter]);

  useEffect(() => {
    void loadStats();
    void loadGrowth();
  }, [loadStats, loadGrowth]);

  useEffect(() => {
    if (tab === 'organizations') void loadOrgs();
  }, [tab, loadOrgs]);

  useEffect(() => {
    if (tab === 'branches') {
      void (async () => {
        try {
          const r = (await superadminApi.branches()) as { branches: unknown[] };
          setBranchRows(r.branches || []);
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'Failed to load branches');
        }
      })();
    }
  }, [tab]);

  useEffect(() => {
    if (tab === 'users') {
      void (async () => {
        try {
          const r = (await superadminApi.users({ search: userSearch.trim() || undefined })) as { users: unknown[] };
          setUserRows(r.users || []);
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'Failed to load users');
        }
      })();
    }
  }, [tab, userSearch]);

  const openOrg = async (id: string) => {
    try {
      const d = (await superadminApi.orgById(id)) as {
        organization: Record<string, unknown>;
        usage: OrgRow['usage'];
        limits: OrgRow['limits'];
        branches: unknown[];
        staff: unknown[];
      };
      setDetailOrg(d);
      const t = String(d.organization.subscription_tier || 'free').toLowerCase();
      setEditTier(
        t === 'basic' || t === 'pro' || t === 'enterprise' || t === 'free' ? (t as SubscriptionTierId) : 'free',
      );
      setEditMax({
        max_members: d.organization.max_members != null ? String(d.organization.max_members) : '',
        max_groups: d.organization.max_groups != null ? String(d.organization.max_groups) : '',
        max_branches: d.organization.max_branches != null ? String(d.organization.max_branches) : '',
        max_events_per_month:
          d.organization.max_events_per_month != null ? String(d.organization.max_events_per_month) : '',
        max_staff: d.organization.max_staff != null ? String(d.organization.max_staff) : '',
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load organization');
    }
  };

  const saveOrgDetail = async () => {
    if (!detailOrg) return;
    const id = String(detailOrg.organization.id);
    try {
      const body: Record<string, unknown> = { subscription_tier: editTier };
      const n = (s: string) => (s.trim() === '' ? null : parseInt(s, 10));
      body.max_members = n(editMax.max_members);
      body.max_groups = n(editMax.max_groups);
      body.max_branches = n(editMax.max_branches);
      body.max_events_per_month = n(editMax.max_events_per_month);
      body.max_staff = n(editMax.max_staff);
      await superadminApi.patchOrg(id, body);
      toast.success('Organization updated');
      setDetailOrg(null);
      void loadStats();
      void loadOrgs();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const pct = (u: number, lim: number) => (lim <= 0 ? 0 : Math.min(100, Math.round((u / lim) * 100)));

  const tabs: { id: Tab; label: string; icon: typeof Shield }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'organizations', label: 'Organizations', icon: Building2 },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'users', label: 'Staff', icon: Users },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 md:p-8">
      <div className="flex min-w-0 items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-600 rounded-xl flex items-center justify-center">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">SuperAdmin</h1>
          <p className="text-sm text-gray-500">Cross-tenant platform management</p>
        </div>
      </div>

      <div className="mb-8 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-gray-200 pb-2">
        <div className="flex min-w-min flex-nowrap gap-2 sm:flex-wrap">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
        </div>
      </div>

      {tab === 'overview' && statsLoading && (
        <div className="flex justify-center py-24">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
      )}
      {tab === 'overview' && !statsLoading && !stats && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-8 text-center text-sm text-amber-900">
          <p className="mb-3">Could not load platform stats.</p>
          <button
            type="button"
            onClick={() => void loadStats()}
            className="rounded-xl bg-amber-600 px-4 py-2 text-white text-sm font-medium hover:bg-amber-700"
          >
            Retry
          </button>
        </div>
      )}
      {tab === 'overview' && !statsLoading && stats && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Organizations</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.total_organizations}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Members (all orgs)</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.total_members.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Branches</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.total_branches}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Staff profiles</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.total_staff}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Ministry groups</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.total_groups}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <p className="text-sm text-gray-500 mb-1">Events (last 30 days)</p>
              <p className="text-3xl font-semibold text-gray-900">{stats.events_last_30_days}</p>
              <p className="text-xs text-blue-600 mt-2 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Platform-wide
              </p>
            </div>
          </div>
          {Object.keys(growth).length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">New organizations by month</h2>
              <div className="flex flex-wrap gap-3">
                {Object.entries(growth)
                  .sort()
                  .slice(-12)
                  .map(([m, c]) => (
                    <div key={m} className="px-3 py-2 bg-gray-50 rounded-lg text-sm">
                      <span className="text-gray-500">{m}</span>{' '}
                      <span className="font-semibold text-gray-900">{c}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'organizations' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="search"
                placeholder="Search name or slug…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadOrgs()}
                className="min-h-11 w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-base sm:text-sm"
              />
            </div>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="min-h-11 w-full border border-gray-200 bg-white px-3 py-2 text-sm rounded-xl sm:w-auto"
            >
              <option value="all">All tiers</option>
              <option value="free">free</option>
              <option value="basic">basic</option>
              <option value="pro">pro</option>
              <option value="enterprise">enterprise</option>
            </select>
            <button
              type="button"
              onClick={() => void loadOrgs()}
              className="min-h-11 w-full bg-blue-600 px-4 py-2 text-sm text-white rounded-xl sm:w-auto"
            >
              Search
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-2xl border border-gray-100 bg-white">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Organization</th>
                    <th className="text-left px-4 py-3 font-semibold">Tier</th>
                    <th className="text-right px-4 py-3 font-semibold">Members</th>
                    <th className="text-right px-4 py-3 font-semibold">Groups</th>
                    <th className="text-right px-4 py-3 font-semibold">Branches</th>
                    <th className="text-right px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{o.name}</p>
                        <p className="text-xs text-gray-500">{o.slug}</p>
                      </td>
                      <td className="px-4 py-3 capitalize">{o.subscription_tier || 'free'}</td>
                      <td className="px-4 py-3 text-right">
                        {o.usage.members} / {o.limits.max_members}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {o.usage.groups} / {o.limits.max_groups}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {o.usage.branches} / {o.limits.max_branches}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void openOrg(o.id)}
                          className="text-blue-600 hover:underline"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm text-gray-600">
                <span>
                  Page {page} — {orgsTotal} orgs total
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page * 15 >= orgsTotal}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'branches' && (
        <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-2xl border border-gray-100 bg-white">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3">Branch</th>
                <th className="text-left px-4 py-3">Organization</th>
                <th className="text-left px-4 py-3">Main</th>
              </tr>
            </thead>
            <tbody>
              {branchRows.map((b) => {
                const row = b as Record<string, unknown>;
                return (
                  <tr key={String(row.id)} className="border-b border-gray-50">
                    <td className="px-4 py-3">{String(row.name ?? '')}</td>
                    <td className="px-4 py-3">{String(row.organization_name ?? row.organization_id ?? '')}</td>
                    <td className="px-4 py-3">{row.is_main_branch ? 'Yes' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <input
            type="search"
            placeholder="Search email or name…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="min-h-11 w-full max-w-md border border-gray-200 px-3 py-2 text-base sm:text-sm rounded-xl"
          />
          <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-2xl border border-gray-100 bg-white">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Active</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((u) => {
                  const row = u as Record<string, unknown>;
                  return (
                    <tr key={String(row.id)} className="border-b border-gray-50">
                      <td className="px-4 py-3">
                        {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3">{String(row.email ?? '')}</td>
                      <td className="px-4 py-3">
                        {row.is_active === false ? (
                          <span className="text-red-600">Suspended</span>
                        ) : (
                          <span className="text-blue-700">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'billing' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-blue-600" />
                Revenue estimate (GHS / month)
              </h2>
              <p className="text-xs text-gray-500 mb-4">Sum of plan prices × orgs per tier (Hubtel integration pending).</p>
              <ul className="space-y-2 text-sm">
                {(['free', 'basic', 'pro', 'enterprise'] as const).map((tid) => {
                  const n = stats.orgs_by_tier?.[tid] ?? 0;
                  const price = SUBSCRIPTION_PLANS[tid].price_ghs;
                  return (
                    <li key={tid} className="flex justify-between border-b border-gray-100 py-2">
                      <span className="capitalize">{tid}</span>
                      <span>
                        {n} × ₵{price} = <strong>₵{(n * price).toLocaleString()}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Default plan limits</h2>
              <ul className="text-xs text-gray-600 space-y-2 font-mono">
                {(['free', 'basic', 'pro', 'enterprise'] as const).map((tid) => {
                  const p = SUBSCRIPTION_PLANS[tid];
                  return (
                    <li key={tid}>
                      <strong className="capitalize text-gray-900">{tid}</strong>: members {p.max_members}, groups{' '}
                      {p.max_groups}, branches {p.max_branches}, events/mo {p.max_events_per_month}, staff {p.max_staff}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {detailOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {String(detailOrg.organization.name ?? 'Organization')}
              </h2>
              <button type="button" onClick={() => setDetailOrg(null)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{String(detailOrg.organization.slug ?? '')}</p>

            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-semibold text-gray-800">Usage vs limits</h3>
              {(
                [
                  ['Members', 'members', 'max_members'],
                  ['Groups', 'groups', 'max_groups'],
                  ['Branches', 'branches', 'max_branches'],
                  ['Events (this month)', 'events_this_month', 'max_events_per_month'],
                  ['Staff', 'staff', 'max_staff'],
                ] as const
              ).map(([label, uKey, lKey]) => {
                const u = detailOrg.usage[uKey];
                const lim = detailOrg.limits[lKey];
                return (
                  <div key={uKey}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>{label}</span>
                      <span>
                        {u} / {lim}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct(u, lim) >= 90 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${pct(u, lim)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">Subscription tier</label>
            <select
              value={editTier}
              onChange={(e) => setEditTier(e.target.value as SubscriptionTierId)}
              className="w-full mb-4 px-3 py-2 border border-gray-200 rounded-xl text-sm"
            >
              {(['free', 'basic', 'pro', 'enterprise'] as const).map((tid) => (
                <option key={tid} value={tid}>
                  {SUBSCRIPTION_PLANS[tid].label} (₵{SUBSCRIPTION_PLANS[tid].price_ghs}/mo)
                </option>
              ))}
            </select>

            <p className="text-xs text-gray-500 mb-2">
              Override limits (leave blank to use tier defaults). Set a number to cap that resource for this org.
            </p>
            {(
              [
                ['max_members', 'Max members'],
                ['max_groups', 'Max groups'],
                ['max_branches', 'Max branches'],
                ['max_events_per_month', 'Max events / month'],
                ['max_staff', 'Max staff'],
              ] as const
            ).map(([key, lab]) => (
              <label key={key} className="block mb-2">
                <span className="text-xs text-gray-600">{lab}</span>
                <input
                  type="number"
                  min={0}
                  className="w-full mt-0.5 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                  value={editMax[key]}
                  onChange={(e) => setEditMax((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder="(default)"
                />
              </label>
            ))}

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => void saveOrgDetail()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
              <button
                type="button"
                onClick={() => setDetailOrg(null)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
