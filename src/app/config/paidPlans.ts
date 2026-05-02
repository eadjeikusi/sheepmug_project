/**
 * Public SaaS pricing (GHS) + Paystack plan code keys.
 * Map env `paystack_plan_codes_json` in Super Admin to these keys, or rely on defaults below.
 */

export type BillingPlanId = 'core_monthly' | 'core_6months' | 'core_annual';

export type PaidPlanDef = {
  id: BillingPlanId;
  title: string;
  /** Short label for badges */
  intervalLabel: string;
  priceGhs: number;
  /** Shown on landing / signup; omit on landing if you prefer minimal copy */
  savingsLine: string | null;
  /** Key inside paystack_plan_codes_json */
  paystackPlanKey: BillingPlanId;
  /** Maps to org limits after payment */
  grantsTier: 'enterprise';
};

export const PAID_PLANS: Record<BillingPlanId, PaidPlanDef> = {
  core_monthly: {
    id: 'core_monthly',
    title: 'Core Plan',
    intervalLabel: 'Monthly',
    priceGhs: 250,
    savingsLine: null,
    paystackPlanKey: 'core_monthly',
    grantsTier: 'enterprise',
  },
  core_6months: {
    id: 'core_6months',
    title: '6 Months',
    intervalLabel: 'Every 6 months',
    priceGhs: 1400,
    savingsLine: 'Save 100 GHS vs paying monthly',
    paystackPlanKey: 'core_6months',
    grantsTier: 'enterprise',
  },
  core_annual: {
    id: 'core_annual',
    title: 'All Year Bundle',
    intervalLabel: 'Yearly',
    priceGhs: 2750,
    savingsLine: 'Save 250 GHS vs paying monthly for a full year',
    paystackPlanKey: 'core_annual',
    grantsTier: 'enterprise',
  },
};

/** Default Paystack plan codes (override via platform `paystack_plan_codes_json`). */
export const DEFAULT_PAYSTACK_PLAN_CODES: Record<BillingPlanId, string> = {
  core_monthly: 'PLN_oq4yor3nzk9qyyq',
  core_6months: 'PLN_kz4ruokve5bmndp',
  core_annual: 'PLN_67e7q52alonejtk',
};

export const PAID_PLAN_IDS = Object.keys(PAID_PLANS) as BillingPlanId[];

export function isBillingPlanId(raw: string | null | undefined): raw is BillingPlanId {
  return raw === 'core_monthly' || raw === 'core_6months' || raw === 'core_annual';
}

export function getPaidPlan(id: BillingPlanId): PaidPlanDef {
  return PAID_PLANS[id];
}
