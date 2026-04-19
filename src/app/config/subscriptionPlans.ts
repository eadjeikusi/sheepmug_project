/**
 * Default subscription tiers and resource limits (GHS pricing is illustrative).
 * Per-org overrides live on organizations.max_* columns (null = use tier default).
 */

export type SubscriptionTierId = 'free' | 'basic' | 'pro' | 'enterprise';

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
  price_ghs: number;
};

export const SUBSCRIPTION_PLANS: Record<SubscriptionTierId, SubscriptionPlanDef> = {
  free: {
    id: 'free',
    label: 'Free',
    price_ghs: 0,
    max_members: 50,
    max_groups: 3,
    max_branches: 1,
    max_events_per_month: 5,
    max_staff: 2,
  },
  basic: {
    id: 'basic',
    label: 'Basic',
    price_ghs: 50,
    max_members: 200,
    max_groups: 10,
    max_branches: 2,
    max_events_per_month: 20,
    max_staff: 5,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    price_ghs: 150,
    max_members: 1000,
    max_groups: 50,
    max_branches: 5,
    max_events_per_month: 100,
    max_staff: 15,
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    price_ghs: 400,
    max_members: 999999,
    max_groups: 999999,
    max_branches: 999999,
    max_events_per_month: 999999,
    max_staff: 999999,
  },
};

const TIER_ALIASES: Record<string, SubscriptionTierId> = {
  free: 'free',
  basic: 'basic',
  pro: 'pro',
  enterprise: 'enterprise',
  // legacy / UI strings
  Free: 'free',
  Basic: 'basic',
  Pro: 'pro',
  Enterprise: 'enterprise',
};

export function normalizeSubscriptionTier(raw: string | null | undefined): SubscriptionTierId {
  if (!raw || typeof raw !== 'string') return 'free';
  const k = raw.trim().toLowerCase();
  if (k in SUBSCRIPTION_PLANS) return k as SubscriptionTierId;
  if (raw in TIER_ALIASES) return TIER_ALIASES[raw];
  return 'free';
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

export function effectiveLimit<K extends keyof PlanLimits>(
  org: OrgLimitRow,
  key: K,
): number {
  const override = org[key];
  if (typeof override === 'number' && override >= 0) return override;
  const tier = normalizeSubscriptionTier(org.subscription_tier ?? undefined);
  return SUBSCRIPTION_PLANS[tier][key];
}
