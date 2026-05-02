/**
 * Subscription tiers (resource limits only). There is no free tier — legacy DB values
 * `free` normalize to `basic`. Public pricing is defined in `paidPlans.ts` (Core monthly / 6mo / annual).
 */

export type SubscriptionTierId = 'basic' | 'pro' | 'enterprise';

export const DEFAULT_SUBSCRIPTION_TIER: SubscriptionTierId = 'basic';

export type PlanLimits = {
  max_members: number;
  max_groups: number;
  max_branches: number;
  max_events_per_month: number;
  max_staff: number;
};

export type SubscriptionPlanDef = PlanLimits & {
  id: SubscriptionTierId;
  label: string;
  /** Illustrative GHS for Super Admin revenue estimates (actual checkout uses PAID_PLANS). */
  price_ghs: number;
};

export const SUBSCRIPTION_PLANS: Record<SubscriptionTierId, SubscriptionPlanDef> = {
  basic: {
    id: 'basic',
    label: 'Core (entry)',
    price_ghs: 250,
    max_members: 200,
    max_groups: 10,
    max_branches: 2,
    max_events_per_month: 20,
    max_staff: 5,
  },
  pro: {
    id: 'pro',
    label: 'Core (growth)',
    price_ghs: 250,
    max_members: 1000,
    max_groups: 50,
    max_branches: 5,
    max_events_per_month: 100,
    max_staff: 15,
  },
  enterprise: {
    id: 'enterprise',
    label: 'Core (full limits)',
    price_ghs: 250,
    max_members: 999999,
    max_groups: 999999,
    max_branches: 999999,
    max_events_per_month: 999999,
    max_staff: 999999,
  },
};

export const SUBSCRIPTION_TIER_IDS: SubscriptionTierId[] = ['basic', 'pro', 'enterprise'];

const TIER_ALIASES: Record<string, SubscriptionTierId> = {
  basic: 'basic',
  pro: 'pro',
  enterprise: 'enterprise',
  // Paystack Core SKUs → full limits
  core_monthly: 'enterprise',
  core_6months: 'enterprise',
  core_annual: 'enterprise',
  // legacy / UI
  free: 'basic',
  Free: 'basic',
  Basic: 'basic',
  Pro: 'pro',
  Enterprise: 'enterprise',
};

export function normalizeSubscriptionTier(raw: string | null | undefined): SubscriptionTierId {
  if (!raw || typeof raw !== 'string') return DEFAULT_SUBSCRIPTION_TIER;
  const k = raw.trim().toLowerCase();
  if (k in SUBSCRIPTION_PLANS) return k as SubscriptionTierId;
  if (k === 'free') return 'basic';
  if (k === 'core_monthly' || k === 'core_6months' || k === 'core_annual') return 'enterprise';
  if (raw in TIER_ALIASES) return TIER_ALIASES[raw];
  return DEFAULT_SUBSCRIPTION_TIER;
}

export function getPlanDefaults(tier: SubscriptionTierId): PlanLimits {
  const p = SUBSCRIPTION_PLANS[tier];
  return {
    max_members: p.max_members,
    max_groups: p.max_groups,
    max_branches: p.max_branches,
    max_events_per_month: p.max_events_per_month,
    max_staff: p.max_staff,
  };
}

export type OrgLimitRow = {
  subscription_tier?: string | null;
  max_members?: number | null;
  max_groups?: number | null;
  max_branches?: number | null;
  max_events_per_month?: number | null;
  max_staff?: number | null;
};

export function effectiveLimit<K extends keyof PlanLimits>(org: OrgLimitRow, key: K): number {
  const override = org[key];
  if (typeof override === 'number' && override >= 0) return override;
  const tier = normalizeSubscriptionTier(org.subscription_tier ?? undefined);
  return SUBSCRIPTION_PLANS[tier][key];
}
