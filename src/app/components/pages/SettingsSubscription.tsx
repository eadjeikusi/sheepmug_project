import {
  ArrowRight,
  CreditCard,
  Download,
  FileText,
  MapPin,
  MoreVertical,
  Receipt,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { SUBSCRIPTION_PLANS, effectiveLimit, normalizeSubscriptionTier, type SubscriptionTierId } from '@/config/subscriptionPlans';
import type { Organization } from '@/types';

export type SubscriptionSubTab =
  | 'overview'
  | 'plans'
  | 'userOverview'
  | 'invoices'
  | 'payment'
  | 'billing';

const SUB_TABS: { id: SubscriptionSubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Plans' },
  { id: 'userOverview', label: 'User overview' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payment', label: 'Payment details' },
  { id: 'billing', label: 'Billing address' },
];

/** Display label for tier (maps to reference "Business"-style naming). */
function tierDisplayName(tier: SubscriptionTierId): string {
  const labels: Record<SubscriptionTierId, string> = {
    free: 'Starter',
    basic: 'Team',
    pro: 'Business',
    enterprise: 'Enterprise',
  };
  return labels[tier] ?? tier;
}

type DemoInvoice = { id: string; file: string; date: string; amount: string };

const DEMO_INVOICES: DemoInvoice[] = [
  { id: '1', file: 'Invoice_2024/11.pdf', date: 'Nov 02, 2024', amount: '$10.00' },
  { id: '2', file: 'Invoice_2024/10.pdf', date: 'Oct 01, 2024', amount: '$10.00' },
  { id: '3', file: 'Invoice_2024/09.pdf', date: 'Sep 02, 2024', amount: '$10.00' },
];

type Props = {
  activeSub: SubscriptionSubTab;
  onSubChange: (sub: SubscriptionSubTab) => void;
  organization: Organization | null;
  /** Optional live member count for usage bar; falls back to demo split. */
  memberCount?: number | null;
};

export function SettingsSubscription({ activeSub, onSubChange, organization, memberCount }: Props) {
  const tier = normalizeSubscriptionTier(organization?.subscription_tier ?? organization?.subscription_plan ?? undefined);
  const plan = SUBSCRIPTION_PLANS[tier];
  const maxMembers = effectiveLimit(
    {
      subscription_tier: organization?.subscription_tier,
      max_members: organization?.max_members ?? null,
    },
    'max_members',
  );
  const used = typeof memberCount === 'number' && memberCount >= 0 ? Math.min(memberCount, maxMembers) : Math.min(12, maxMembers);
  const pct = maxMembers > 0 ? Math.min(100, Math.round((used / maxMembers) * 100)) : 0;

  const nextPayment = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }, []);

  const priceDisplay = tier === 'free' ? '$0' : `$${Math.round(plan.price_ghs / 5) || 10}`;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Subscription</h2>
        <p className="text-sm text-gray-500 mt-1">Plan, usage, and billing. Live payment processing is coming soon.</p>
      </div>

      <div
        className="flex flex-wrap gap-1 border-b border-gray-200"
        role="tablist"
        aria-label="Subscription sections"
      >
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeSub === t.id}
            onClick={() => onSubChange(t.id)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeSub === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeSub === 'overview' && (
        <div className="space-y-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center rounded-md bg-gray-900 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                    {tierDisplayName(tier)}
                  </span>
                  <span className="ml-2 text-sm font-medium text-gray-600">Plan</span>
                </div>
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900">{priceDisplay}</span>
                <span className="text-gray-500">/month</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">Illustrative pricing until Hubtel billing is connected.</p>
              <div className="mt-6">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>
                    {used} of {maxMembers} users
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <button
                type="button"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 sm:w-auto"
              >
                Upgrade plan
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Next payment</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">on {nextPayment}</p>
              <p className="mt-2 text-xs text-gray-500">Date is projected; no charge until payment integration is live.</p>
              <button
                type="button"
                className="mt-6 w-full rounded-xl border-2 border-blue-600 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 sm:w-auto"
              >
                Manage payments
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Invoices ({DEMO_INVOICES.length})</h3>
            <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
              {DEMO_INVOICES.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-8 w-8 shrink-0 text-gray-400" />
                    <div>
                      <p className="truncate text-sm font-medium text-gray-900">{inv.file}</p>
                      <p className="text-xs text-gray-500">
                        Date of invoice <span className="font-semibold text-gray-800">{inv.date}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      aria-label="More actions"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {activeSub === 'plans' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(SUBSCRIPTION_PLANS) as SubscriptionTierId[]).map((id) => {
            const p = SUBSCRIPTION_PLANS[id];
            const active = id === tier;
            return (
              <div
                key={id}
                className={`rounded-2xl border p-5 shadow-sm ${active ? 'border-blue-600 ring-2 ring-blue-100' : 'border-gray-200 bg-white'}`}
              >
                <h3 className="text-lg font-semibold text-gray-900">{p.label}</h3>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {p.price_ghs === 0 ? 'Free' : `GH₵ ${p.price_ghs}`}
                  {p.price_ghs > 0 && <span className="text-sm font-normal text-gray-500">/mo</span>}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-600">
                  <li>Up to {p.max_members.toLocaleString()} members</li>
                  <li>{p.max_groups} groups</li>
                  <li>{p.max_branches} branch{p.max_branches === 1 ? '' : 'es'}</li>
                </ul>
                {active && (
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-blue-600">Current plan</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeSub === 'userOverview' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Users className="mx-auto h-10 w-10 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">User overview</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
            Seat usage and role breakdown will appear here when organization analytics are connected to billing.
          </p>
        </div>
      )}

      {activeSub === 'invoices' && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-6 py-4 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-gray-400" />
            <h3 className="font-semibold text-gray-900">All invoices</h3>
          </div>
          <ul className="divide-y divide-gray-100">
            {DEMO_INVOICES.map((inv) => (
              <li key={inv.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-8 w-8 text-gray-400 shrink-0" />
                  <div>
                    <p className="font-medium text-gray-900">{inv.file}</p>
                    <p className="text-sm text-gray-500">{inv.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-gray-900">{inv.amount}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeSub === 'payment' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <CreditCard className="h-10 w-10 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Payment details</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-lg">
            Card and wallet management will be available when Hubtel (or your chosen provider) is connected. No charges are
            processed in this environment yet.
          </p>
        </div>
      )}

      {activeSub === 'billing' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <MapPin className="h-10 w-10 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">Billing address</h3>
          <p className="mt-2 text-sm text-gray-500 max-w-lg">
            Use your organization profile address for now, or add a dedicated billing address when invoicing goes live.
          </p>
          {organization?.address && (
            <p className="mt-4 text-sm text-gray-800 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">{organization.address}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function isSubscriptionSubTab(value: string | null | undefined): value is SubscriptionSubTab {
  if (!value) return false;
  return SUB_TABS.some((t) => t.id === value);
}
