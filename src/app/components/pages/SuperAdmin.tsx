import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2,
  Users,
  DollarSign,
  Search,
  Shield,
  TrendingUp,
  CreditCard,
  Loader2,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { superadminApi } from '@/utils/api';
import {
  DEFAULT_SUBSCRIPTION_TIER,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TIER_IDS,
  type SubscriptionTierId,
} from '@/config/subscriptionPlans';
import { PAID_PLANS, PAID_PLAN_IDS, DEFAULT_PAYSTACK_PLAN_CODES } from '@/config/paidPlans';
import { useApp } from '@/contexts/AppContext';
import { useBranch } from '@/contexts/BranchContext';
import type { Organization } from '@/types';

const SA_ACT_KEY = 'superadmin_act_as';

type Tab = 'organizations' | 'admins' | 'billing';

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
    tasks?: number;
    leaders?: number;
    reports?: number;
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
  /** When false, staff cannot use the app (super admins exempt). Default true if omitted. */
  is_enabled?: boolean;
};

type BranchStatRow = {
  branch_id: string;
  name: string;
  is_enabled?: boolean;
  stats: {
    members: number;
    groups: number;
    events_this_month: number;
    tasks: number;
    leaders: number;
    reports: number;
  };
};

function orgRowToOrganization(o: OrgRow): Organization {
  const now = new Date().toISOString();
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    subdomain: null,
    logo_url: o.logo_url ?? null,
    address: null,
    phone: null,
    email: null,
    website: null,
    timezone: 'Africa/Accra',
    currency: 'GHS',
    subscription_tier: o.subscription_tier,
    subscription_status: 'active',
    subscription_plan: o.subscription_tier || 'basic',
    trial_ends_at: null,
    settings: {},
    created_at: now,
    updated_at: now,
  };
}

export default function SuperAdmin() {
  const navigate = useNavigate();
  const { setCurrentOrganization } = useApp();
  const { refreshBranches } = useBranch();
  const [tab, setTab] = useState<Tab>('organizations');
  const [stats, setStats] = useState<SuperStats | null>(null);
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
  const [editTier, setEditTier] = useState<SubscriptionTierId>(DEFAULT_SUBSCRIPTION_TIER);
  const [editMax, setEditMax] = useState({
    max_members: '' as string,
    max_groups: '' as string,
    max_branches: '' as string,
    max_events_per_month: '' as string,
    max_staff: '' as string,
  });
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [branchStatsByOrg, setBranchStatsByOrg] = useState<Record<string, BranchStatRow[]>>({});
  const [branchStatsLoading, setBranchStatsLoading] = useState<string | null>(null);
  const [orgEnableBusyId, setOrgEnableBusyId] = useState<string | null>(null);
  const [branchEnableBusyKey, setBranchEnableBusyKey] = useState<string | null>(null);
  const [userRows, setUserRows] = useState<unknown[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [adminForm, setAdminForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
  });
  const [adminSubmitting, setAdminSubmitting] = useState(false);
  const [paymentsCfg, setPaymentsCfg] = useState<{
    paystack?: { has_secret_key?: boolean; has_public_key?: boolean; plan_codes?: Record<string, string> };
    crypto?: { encrypted_storage?: boolean };
  } | null>(null);
  const [paystackSecretKey, setPaystackSecretKey] = useState('');
  const [paystackPublicKey, setPaystackPublicKey] = useState('');
  const [paystackPlanCodes, setPaystackPlanCodes] = useState<Record<string, string>>({
    basic: '',
    pro: '',
    enterprise: '',
    core_monthly: '',
    core_6months: '',
    core_annual: '',
  });
  const [paymentsSaving, setPaymentsSaving] = useState(false);

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
  }, [loadStats]);

  useEffect(() => {
    if (tab === 'organizations') void loadOrgs();
  }, [tab, loadOrgs]);

  useEffect(() => {
    if (tab === 'billing') {
      void (async () => {
        try {
          const c = (await superadminApi.paymentConfig()) as any;
          setPaymentsCfg(c);
          const codes = (c?.paystack?.plan_codes && typeof c.paystack.plan_codes === 'object' ? c.paystack.plan_codes : {}) as Record<
            string,
            string
          >;
          setPaystackPlanCodes((prev) => ({ ...prev, ...codes }));
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'Failed to load payment config');
        }
      })();
    }
  }, [tab]);

  useEffect(() => {
    if (tab === 'admins') {
      void (async () => {
        try {
          const r = (await superadminApi.users({
            search: userSearch.trim() || undefined,
            superadmin_only: true,
          })) as { users: unknown[] };
          setUserRows(r.users || []);
        } catch (e: unknown) {
          toast.error(e instanceof Error ? e.message : 'Failed to load admins');
        }
      })();
    }
  }, [tab, userSearch]);

  const toggleOrgBranches = async (org: OrgRow) => {
    if (expandedOrgId === org.id) {
      setExpandedOrgId(null);
      return;
    }
    setExpandedOrgId(org.id);
    if (branchStatsByOrg[org.id]) return;
    setBranchStatsLoading(org.id);
    try {
      const d = (await superadminApi.orgById(org.id)) as { branch_stats?: BranchStatRow[] };
      setBranchStatsByOrg((prev) => ({ ...prev, [org.id]: d.branch_stats || [] }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load branches');
    } finally {
      setBranchStatsLoading(null);
    }
  };

  const setOrgEnabled = useCallback(async (orgId: string, enabled: boolean) => {
    setOrgEnableBusyId(orgId);
    try {
      await superadminApi.patchOrg(orgId, { is_enabled: enabled });
      setOrgs((prev) => prev.map((x) => (x.id === orgId ? { ...x, is_enabled: enabled } : x)));
      setDetailOrg((d) =>
        d && String(d.organization.id) === orgId
          ? { ...d, organization: { ...d.organization, is_enabled: enabled } }
          : d,
      );
      toast.success(enabled ? 'Organization enabled' : 'Organization disabled');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setOrgEnableBusyId(null);
    }
  }, []);

  const setBranchEnabled = useCallback(async (orgId: string, row: BranchStatRow, enabled: boolean) => {
    const key = `${orgId}:${row.branch_id}`;
    setBranchEnableBusyKey(key);
    try {
      await superadminApi.patchBranch(row.branch_id, { is_enabled: enabled });
      setBranchStatsByOrg((prev) => ({
        ...prev,
        [orgId]: (prev[orgId] || []).map((r) =>
          r.branch_id === row.branch_id ? { ...r, is_enabled: enabled } : r,
        ),
      }));
      toast.success(enabled ? 'Branch enabled' : 'Branch disabled');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBranchEnableBusyKey(null);
    }
  }, []);

  const openBranchDashboard = (org: OrgRow, branchId: string) => {
    try {
      localStorage.setItem(SA_ACT_KEY, JSON.stringify({ organization_id: org.id, branch_id: branchId }));
      setCurrentOrganization(orgRowToOrganization(org));
      void refreshBranches();
      navigate('/');
      toast.success('Opened dashboard for selected branch');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to switch context');
    }
  };

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
      const t = String(d.organization.subscription_tier || DEFAULT_SUBSCRIPTION_TIER).toLowerCase();
      setEditTier(SUBSCRIPTION_TIER_IDS.includes(t as SubscriptionTierId) ? (t as SubscriptionTierId) : DEFAULT_SUBSCRIPTION_TIER);
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
    { id: 'organizations', label: 'Organizations', icon: Building2 },
    { id: 'admins', label: 'Admins', icon: Users },
    { id: 'billing', label: 'Billing & plans', icon: CreditCard },
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

      {tab === 'organizations' && statsLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}
      {tab === 'organizations' && !statsLoading && stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['Orgs', stats.total_organizations],
              ['Members', stats.total_members],
              ['Branches', stats.total_branches],
              ['Groups', stats.total_groups],
              ['Staff', stats.total_staff],
              ['Events (30d)', stats.events_last_30_days],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
              <p className="text-lg font-semibold text-gray-900">{typeof n === 'number' ? n.toLocaleString() : n}</p>
            </div>
          ))}
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
              {SUBSCRIPTION_TIER_IDS.map((tid) => (
                <option key={tid} value={tid}>
                  {tid}
                </option>
              ))}
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
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-2 py-3 font-semibold w-10"></th>
                    <th className="text-left px-4 py-3 font-semibold">Organization</th>
                    <th className="text-left px-4 py-3 font-semibold">Tier</th>
                    <th className="text-center px-2 py-3 font-semibold text-xs w-[72px]">On</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Mmb</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Grp</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Br</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Evt</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Task</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Ldr</th>
                    <th className="text-right px-2 py-3 font-semibold text-xs">Rpt</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <Fragment key={o.id}>
                      <tr className="border-b border-gray-50 hover:bg-gray-50/80">
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            aria-label="Toggle branches"
                            onClick={() => void toggleOrgBranches(o)}
                            className="rounded p-1 text-gray-600 hover:bg-gray-100"
                          >
                            {expandedOrgId === o.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void openOrg(o.id)}
                            className="w-full rounded-lg -m-1 p-1 text-left hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            title="Manage subscription tier and limits"
                          >
                            <p className="font-medium text-gray-900">{o.name}</p>
                            <p className="text-xs text-gray-500">{o.slug}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 capitalize">{o.subscription_tier || DEFAULT_SUBSCRIPTION_TIER}</td>
                        <td className="px-2 py-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            checked={o.is_enabled !== false}
                            disabled={orgEnableBusyId === o.id}
                            title="Organization enabled"
                            aria-label={`Organization ${o.name} enabled`}
                            onChange={(e) => void setOrgEnabled(o.id, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.members}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.groups}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.branches}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.events_this_month}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.tasks ?? '—'}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.leaders ?? '—'}</td>
                        <td className="px-2 py-3 text-right text-xs">{o.usage.reports ?? '—'}</td>
                      </tr>
                      {expandedOrgId === o.id ? (
                        <tr key={`${o.id}-exp`} className="bg-gray-50/90">
                          <td colSpan={11} className="px-4 py-3">
                            {branchStatsLoading === o.id ? (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading branches…
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-gray-700">Branches</p>
                                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                                  <table className="w-full min-w-[800px] text-xs">
                                    <thead>
                                      <tr className="border-b bg-gray-50 text-left">
                                        <th className="px-3 py-2">Branch</th>
                                        <th className="px-2 py-2 text-center">On</th>
                                        <th className="px-2 py-2 text-right">Mmb</th>
                                        <th className="px-2 py-2 text-right">Grp</th>
                                        <th className="px-2 py-2 text-right">Evt</th>
                                        <th className="px-2 py-2 text-right">Task</th>
                                        <th className="px-2 py-2 text-right">Ldr</th>
                                        <th className="px-2 py-2 text-right">Rpt</th>
                                        <th className="px-3 py-2 text-right">Open app</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(branchStatsByOrg[o.id] || []).map((row) => (
                                        <tr key={row.branch_id} className="border-b border-gray-100">
                                          <td className="px-3 py-2 font-medium text-gray-900">{row.name}</td>
                                          <td className="px-2 py-2 text-center">
                                            <input
                                              type="checkbox"
                                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              checked={row.is_enabled !== false}
                                              disabled={branchEnableBusyKey === `${o.id}:${row.branch_id}`}
                                              title="Branch enabled"
                                              aria-label={`Branch ${row.name} enabled`}
                                              onChange={(e) => void setBranchEnabled(o.id, row, e.target.checked)}
                                            />
                                          </td>
                                          <td className="px-2 py-2 text-right">{row.stats.members}</td>
                                          <td className="px-2 py-2 text-right">{row.stats.groups}</td>
                                          <td className="px-2 py-2 text-right">{row.stats.events_this_month}</td>
                                          <td className="px-2 py-2 text-right">{row.stats.tasks}</td>
                                          <td className="px-2 py-2 text-right">{row.stats.leaders}</td>
                                          <td className="px-2 py-2 text-right">{row.stats.reports}</td>
                                          <td className="px-3 py-2 text-right">
                                            <button
                                              type="button"
                                              onClick={() => openBranchDashboard(o, row.branch_id)}
                                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
                                            >
                                              <ExternalLink className="h-3 w-3" />
                                              Dashboard
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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

      {tab === 'admins' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Add platform admin</h2>
            <p className="mt-1 text-xs text-gray-500">
              Creates a staff profile with super-admin access in your organization. If{' '}
              <code className="rounded bg-gray-100 px-1">AUTH_EMAIL_AUTO_CONFIRM=false</code>, Supabase sends a confirmation
              email before first login.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-sm">
                <span className="text-gray-600">First name</span>
                <input
                  value={adminForm.first_name}
                  onChange={(e) => setAdminForm((p) => ({ ...p, first_name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">Last name</span>
                <input
                  value={adminForm.last_name}
                  onChange={(e) => setAdminForm((p) => ({ ...p, last_name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">Email</span>
                <input
                  type="email"
                  autoComplete="off"
                  value={adminForm.email}
                  onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={adminForm.password}
                  onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={adminSubmitting}
              onClick={() => {
                void (async () => {
                  try {
                    setAdminSubmitting(true);
                    const res = (await superadminApi.createAdmin({
                      first_name: adminForm.first_name.trim(),
                      last_name: adminForm.last_name.trim(),
                      email: adminForm.email.trim(),
                      password: adminForm.password,
                    })) as { note?: string; verification_email_sent?: boolean };
                    toast.success(
                      res.verification_email_sent
                        ? 'Admin created — confirmation email sent.'
                        : 'Admin created.',
                    );
                    setAdminForm({ first_name: '', last_name: '', email: '', password: '' });
                    const r = (await superadminApi.users({
                      search: userSearch.trim() || undefined,
                      superadmin_only: true,
                    })) as { users: unknown[] };
                    setUserRows(r.users || []);
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Failed to create admin');
                  } finally {
                    setAdminSubmitting(false);
                  }
                })();
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {adminSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create admin
            </button>
          </div>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Search admins by email or name…"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-base sm:text-sm"
            />
          </div>
          <div className="overflow-x-auto touch-pan-x overscroll-x-contain rounded-2xl border border-gray-100 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Active</th>
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
              <p className="text-xs text-gray-500 mb-4">
                Uses each org&apos;s <span className="font-mono text-gray-700">subscription_tier</span> and default tier
                prices from <code className="rounded bg-gray-100 px-1">subscriptionPlans</code>. Paystack Core
                checkouts (monthly / 6&nbsp;mo / annual) are billed on their own cadence — see Core plans below.
              </p>
              <ul className="space-y-2 text-sm">
                {SUBSCRIPTION_TIER_IDS.map((tid) => {
                  const n = stats.orgs_by_tier?.[tid] ?? 0;
                  const price = SUBSCRIPTION_PLANS[tid].price_ghs;
                  const label = SUBSCRIPTION_PLANS[tid].label;
                  return (
                    <li key={tid} className="flex justify-between border-b border-gray-100 py-2">
                      <span>
                        <span className="font-medium text-gray-900">{label}</span>{' '}
                        <span className="text-gray-500 capitalize">({tid})</span>
                      </span>
                      <span>
                        {n} × ₵{price} = <strong>₵{(n * price).toLocaleString()}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Default tier limits</h2>
              <p className="text-xs text-gray-500 mb-4">
                Org overrides use <span className="font-mono">organizations.max_*</span>. Paystack Core plans grant{' '}
                <strong>enterprise</strong> limits after checkout.
              </p>
              <ul className="text-xs text-gray-600 space-y-2 font-mono">
                {SUBSCRIPTION_TIER_IDS.map((tid) => {
                  const p = SUBSCRIPTION_PLANS[tid];
                  return (
                    <li key={tid}>
                      <strong className="capitalize text-gray-900">{p.label}</strong> ({tid}): members {p.max_members},
                      groups {p.max_groups}, branches {p.max_branches}, events/mo {p.max_events_per_month}, staff{' '}
                      {p.max_staff}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Paystack Core plans (checkout)
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              These are the paid SKUs from <code className="rounded bg-gray-100 px-1">paidPlans.ts</code>. Checkout sends{' '}
              <span className="font-mono">billing_plan_id</span> (e.g. <span className="font-mono">core_monthly</span>).
              Each maps to Paystack plan codes in the section below.
            </p>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Plan</th>
                    <th className="px-4 py-2 font-semibold">Billing</th>
                    <th className="px-4 py-2 font-semibold text-right">Price (GHS)</th>
                    <th className="px-4 py-2 font-semibold">Grants</th>
                  </tr>
                </thead>
                <tbody>
                  {PAID_PLAN_IDS.map((id) => {
                    const p = PAID_PLANS[id];
                    return (
                      <tr key={id} className="border-b border-gray-50">
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-900">{p.title}</span>
                          <p className="text-xs font-mono text-gray-500">{id}</p>
                        </td>
                        <td className="px-4 py-2 text-gray-700">{p.intervalLabel}</td>
                        <td className="px-4 py-2 text-right tabular-nums">₵{p.priceGhs.toLocaleString()}</td>
                        <td className="px-4 py-2 capitalize text-gray-700">{p.grantsTier} limits</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-gray-600">
              {PAID_PLAN_IDS.map((id) => {
                const p = PAID_PLANS[id];
                if (!p.savingsLine) return null;
                return (
                  <li key={`save-${id}`}>
                    <strong className="text-gray-800">{p.title}:</strong> {p.savingsLine}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-600" />
              Paystack keys
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Stored {paymentsCfg?.crypto?.encrypted_storage ? 'encrypted' : 'as plaintext (set PLATFORM_SECRET_KEY)'}.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Paystack secret key</span>
                <input
                  value={paystackSecretKey}
                  onChange={(e) => setPaystackSecretKey(e.target.value)}
                  placeholder={paymentsCfg?.paystack?.has_secret_key ? 'Configured (enter to rotate)' : 'sk_...'}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Paystack public key</span>
                <input
                  value={paystackPublicKey}
                  onChange={(e) => setPaystackPublicKey(e.target.value)}
                  placeholder={paymentsCfg?.paystack?.has_public_key ? 'Configured (enter to rotate)' : 'pk_...'}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
              </label>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Plan codes — Core (subscriptions)</h3>
              <p className="text-xs text-gray-500 mb-3">
                Required for Paystack initialize / subscription flows. Default codes from app config are shown as
                placeholders when empty.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PAID_PLAN_IDS.map((tid) => {
                  const p = PAID_PLANS[tid];
                  const def = DEFAULT_PAYSTACK_PLAN_CODES[tid];
                  return (
                    <label key={tid} className="block">
                      <span className="text-xs font-medium text-gray-700">
                        {p.title} <span className="font-mono text-gray-500">({tid})</span>
                      </span>
                      <input
                        value={paystackPlanCodes[tid] || ''}
                        onChange={(e) => setPaystackPlanCodes((prev) => ({ ...prev, [tid]: e.target.value }))}
                        placeholder={def || 'PLN_...'}
                        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Plan codes — Tiers (optional)</h3>
              <p className="text-xs text-gray-500 mb-3">Only if you use Paystack plans keyed by subscription tier name.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SUBSCRIPTION_TIER_IDS.map((tid) => (
                  <label key={tid} className="block">
                    <span className="text-xs font-medium text-gray-700 capitalize">{tid} plan code</span>
                    <input
                      value={paystackPlanCodes[tid] || ''}
                      onChange={(e) => setPaystackPlanCodes((p) => ({ ...p, [tid]: e.target.value }))}
                      placeholder="PLN_..."
                      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                disabled={paymentsSaving}
                onClick={() => {
                  void (async () => {
                    try {
                      setPaymentsSaving(true);
                      await superadminApi.patchPaymentConfig({
                        paystack_secret_key: paystackSecretKey.trim() || undefined,
                        paystack_public_key: paystackPublicKey.trim() || undefined,
                        paystack_plan_codes: paystackPlanCodes,
                      });
                      toast.success('Saved');
                      setPaystackSecretKey('');
                      setPaystackPublicKey('');
                      const c = (await superadminApi.paymentConfig()) as any;
                      setPaymentsCfg(c);
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : 'Save failed');
                    } finally {
                      setPaymentsSaving(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm disabled:opacity-60"
              >
                {paymentsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Paystack config
              </button>
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
            <p className="text-sm text-gray-500 mb-3">{String(detailOrg.organization.slug ?? '')}</p>

            <label className="mb-4 flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={detailOrg.organization.is_enabled !== false}
                disabled={orgEnableBusyId === String(detailOrg.organization.id)}
                onChange={(e) => void setOrgEnabled(String(detailOrg.organization.id), e.target.checked)}
              />
              <span className="font-medium text-gray-800">Organization enabled</span>
              <span className="text-xs text-gray-500">Staff blocked when off. Super admins exempt.</span>
            </label>

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
              <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
                <span>Tasks: {detailOrg.usage.tasks ?? '—'}</span>
                <span>Leaders: {detailOrg.usage.leaders ?? '—'}</span>
                <span>Reports: {detailOrg.usage.reports ?? '—'}</span>
              </div>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">Subscription tier</label>
            <select
              value={editTier}
              onChange={(e) => setEditTier(e.target.value as SubscriptionTierId)}
              className="w-full mb-4 px-3 py-2 border border-gray-200 rounded-xl text-sm"
            >
              {SUBSCRIPTION_TIER_IDS.map((tid) => (
                <option key={tid} value={tid}>
                  {SUBSCRIPTION_PLANS[tid].label} (₵{SUBSCRIPTION_PLANS[tid].price_ghs}/mo est.)
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
