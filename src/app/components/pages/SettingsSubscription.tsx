import {
  ArrowRight,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  MoreVertical,
  Receipt,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  SUBSCRIPTION_PLANS,
  effectiveLimit,
  normalizeSubscriptionTier,
  type SubscriptionTierId,
} from '@/config/subscriptionPlans';
import { PAID_PLANS, PAID_PLAN_IDS, isBillingPlanId, type BillingPlanId } from '@/config/paidPlans';
import type { Organization } from '@/types';
import { billingApi } from '@/utils/api';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';

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

/** Badge label: Paystack Core SKU when set, else internal tier. */
function planBadgeLabel(tier: SubscriptionTierId, organization: Organization | null): string {
  const sp = organization?.subscription_plan;
  if (sp && isBillingPlanId(sp)) return PAID_PLANS[sp].title;
  return SUBSCRIPTION_PLANS[tier].label;
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

  const priceLine = useMemo(() => {
    if (organization?.subscription_plan && isBillingPlanId(organization.subscription_plan)) {
      const p = PAID_PLANS[organization.subscription_plan];
      return {
        amount: `GH₵ ${p.priceGhs.toLocaleString()}`,
        cadence: p.intervalLabel,
      };
    }
    return {
      amount: `GH₵ ${plan.price_ghs.toLocaleString()}`,
      cadence: 'Tier estimate (renew via Core plan below)',
    };
  }, [organization?.subscription_plan, plan.price_ghs]);

  const [liveInvoices, setLiveInvoices] = useState<
    { id: string; status: string; currency: string; amount_minor: number; created_at: string; paid_at: string | null; pdf_url: string | null }[]
  >([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  useEffect(() => {
    if (activeSub !== 'invoices' && activeSub !== 'overview') return;
    void (async () => {
      setInvoiceLoading(true);
      try {
        const r = (await billingApi.invoices()) as any;
        setLiveInvoices(Array.isArray(r?.invoices) ? r.invoices : []);
      } catch (e: unknown) {
        setLiveInvoices([]);
      } finally {
        setInvoiceLoading(false);
      }
    })();
  }, [activeSub]);

  const [manageLoading, setManageLoading] = useState(false);

  const startPaystackCheckout = async (billingPlanId: BillingPlanId = 'core_monthly') => {
    try {
      const callback_url = `${window.location.origin}/settings`;
      const r = (await billingApi.paystackInitialize({ billing_plan_id: billingPlanId, callback_url })) as {
        authorization_url?: string | null;
      };
      const url = typeof r?.authorization_url === 'string' ? r.authorization_url : '';
      if (!url) throw new Error('No checkout URL returned');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to start payment');
    }
  };

  const openPaystackManage = async () => {
    setManageLoading(true);
    try {
      const r = (await billingApi.paystackManageLink()) as { link?: string | null; message?: string };
      if (typeof r?.link === 'string' && r.link) {
        window.open(r.link, '_blank', 'noopener,noreferrer');
      } else {
        toast.message(r?.message || 'Complete a Paystack subscription first, or use the email from Paystack to manage billing.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not open Paystack');
    } finally {
      setManageLoading(false);
    }
  };

  const downloadInvoicePdf = (inv: {
    id: string;
    status: string;
    currency: string;
    amount_minor: number;
    created_at: string;
    paid_at: string | null;
  }) => {
    const orgName = organization?.name || 'SheepMug';
    const created = new Date(inv.created_at);
    const paid = inv.paid_at ? new Date(inv.paid_at) : null;
    const amount = (inv.amount_minor || 0) / 100;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 64;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('INVOICE', 48, y);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(orgName, pageW - 48, y, { align: 'right' });

    y += 28;
    doc.setDrawColor(230);
    doc.line(48, y, pageW - 48, y);
    y += 28;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Invoice ID', 48, y);
    doc.text('Status', pageW / 2, y);
    doc.text('Amount', pageW - 48, y, { align: 'right' });
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.text(inv.id, 48, y);
    doc.text(String(inv.status || '').toUpperCase(), pageW / 2, y);
    doc.text(`${inv.currency} ${amount.toFixed(2)}`, pageW - 48, y, { align: 'right' });

    y += 28;
    doc.setFont('helvetica', 'bold');
    doc.text('Created', 48, y);
    doc.text('Paid', pageW / 2, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.text(created.toLocaleString(), 48, y);
    doc.text(paid ? paid.toLocaleString() : '—', pageW / 2, y);

    y += 40;
    doc.setFont('helvetica', 'bold');
    doc.text('Notes', 48, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.text('Thank you for using SheepMug.', 48, y);

    const stamp = created.toISOString().slice(0, 10).replace(/-/g, '');
    doc.save(`Invoice_${stamp}_${inv.id.slice(0, 8)}.pdf`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Subscription</h2>
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
                    {planBadgeLabel(tier, organization)}
                  </span>
                  <span className="ml-2 text-sm font-medium text-gray-600">Plan</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900">{priceLine.amount}</span>
                <span className="text-gray-500">{priceLine.cadence}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {organization?.subscription_plan && isBillingPlanId(organization.subscription_plan)
                  ? `Billed as ${PAID_PLANS[organization.subscription_plan].intervalLabel.toLowerCase()} · Ghana Cedis via Paystack`
                  : 'Subscribe to a Core plan below — no free tier.'}
              </p>
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
                onClick={() => void startPaystackCheckout('core_monthly')}
              >
                Subscribe / change plan
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-500">Next payment</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">on {nextPayment}</p>
              <p className="mt-2 text-xs text-gray-500">Renewal dates come from Paystack once your subscription is active.</p>
              <button
                type="button"
                disabled={manageLoading}
                onClick={() => void openPaystackManage()}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-blue-600 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-60 sm:w-auto"
              >
                <ExternalLink className="h-4 w-4" />
                {manageLoading ? 'Opening…' : 'Manage in Paystack'}
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Invoices ({liveInvoices.length || DEMO_INVOICES.length})
            </h3>
            <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
              {invoiceLoading && liveInvoices.length === 0 ? (
                <li className="px-4 py-6 text-sm text-gray-500">Loading invoices…</li>
              ) : liveInvoices.length > 0 ? (
                liveInvoices.slice(0, 3).map((inv) => {
                  const created = new Date(inv.created_at);
                  const amt = (inv.amount_minor || 0) / 100;
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-8 w-8 shrink-0 text-gray-400" />
                        <div>
                          <p className="truncate text-sm font-medium text-gray-900">{inv.status.toUpperCase()}</p>
                          <p className="text-xs text-gray-500">
                            {created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {inv.currency} {amt.toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(inv)}
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
                  );
                })
              ) : (
                DEMO_INVOICES.map((inv) => (
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
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {activeSub === 'plans' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            SheepMug is billed through Paystack on <strong>Core</strong> plans (monthly, 6&nbsp;months, or yearly). All
            active subscriptions use full platform limits after payment.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PAID_PLAN_IDS.map((id) => {
              const p = PAID_PLANS[id];
              const lim = SUBSCRIPTION_PLANS.enterprise;
              const isCurrent =
                organization?.subscription_plan && isBillingPlanId(organization.subscription_plan)
                  ? organization.subscription_plan === id
                  : false;
              return (
                <div
                  key={id}
                  className={`flex flex-col rounded-2xl border p-5 shadow-sm ${
                    isCurrent ? 'border-blue-600 ring-2 ring-blue-100' : 'border-gray-200 bg-white'
                  }`}
                >
                  <h3 className="text-lg font-semibold text-gray-900">{p.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{p.intervalLabel}</p>
                  <p className="mt-3 text-2xl font-bold text-gray-900">
                    GH₵ {p.priceGhs.toLocaleString()}
                  </p>
                  {p.savingsLine ? (
                    <p className="mt-2 text-xs font-medium text-emerald-700">{p.savingsLine}</p>
                  ) : null}
                  <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-600">
                    <li>Up to {lim.max_members === 999999 ? 'Unlimited' : lim.max_members.toLocaleString()} members</li>
                    <li>{lim.max_groups === 999999 ? 'Unlimited' : lim.max_groups} groups</li>
                    <li>{lim.max_branches === 999999 ? 'Unlimited' : lim.max_branches} branches</li>
                  </ul>
                  <button
                    type="button"
                    className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                    onClick={() => void startPaystackCheckout(id)}
                  >
                    {isCurrent ? 'Renew / update' : 'Pay with Paystack'}
                  </button>
                  {isCurrent ? (
                    <p className="mt-3 text-center text-xs font-semibold uppercase tracking-wide text-blue-600">
                      Current billing plan
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
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
            Update your card or cancel renewal on Paystack&apos;s secure page. Use <strong>Manage in Paystack</strong> on the
            overview tab.
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


