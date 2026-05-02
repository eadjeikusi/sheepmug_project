import type { SubscriptionSubTab } from '@/app/components/pages/SettingsSubscription';

const SUB_IDS: SubscriptionSubTab[] = ['overview', 'plans', 'userOverview', 'invoices', 'payment', 'billing'];

export const isSubscriptionSubTab = (value: string | null | undefined): value is SubscriptionSubTab => {
  if (!value) return false;
  return SUB_IDS.includes(value as SubscriptionSubTab);
};

