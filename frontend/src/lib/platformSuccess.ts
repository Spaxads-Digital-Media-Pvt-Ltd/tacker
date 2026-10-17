/**
 * Super Admin › Customer success — health statuses with their colours, the score's parts, and the shapes the
 * API returns (api-backend lib/platform/health.ts: usage 30 %, trend 15 %, sign-ins 20 %, billing 20 %,
 * onboarding 15 %; healthy ≥ 70, needs attention 40–69, at risk < 40).
 */
export type HealthStatus = 'healthy' | 'attention' | 'at_risk';

export const HEALTH: Record<HealthStatus, { label: string; chip: string; bar: string; text: string }> = {
  healthy: { label: 'Healthy', chip: 'bg-success-bg text-success-text', bar: 'bg-success', text: 'text-success-text' },
  attention: { label: 'Needs attention', chip: 'bg-warning-bg text-warning-text', bar: 'bg-warning', text: 'text-warning-text' },
  at_risk: { label: 'At risk', chip: 'bg-danger-bg text-danger-text', bar: 'bg-danger', text: 'text-danger-text' },
};

/** Accounts by health (GET /platform/success/summary `counts`, also the Overview's `health`). */
export interface HealthCounts {
  accounts: number; healthy: number; attention: number; at_risk: number; unscored: number; avg_score: number | null;
  mine: number; unassigned: number; onboarding_open: number; computed_at: string | null;
}

export const PARTS: { key: 'usage' | 'trend' | 'engagement' | 'billing' | 'onboarding'; label: string; weight: number; hint: string }[] = [
  { key: 'usage', label: 'Usage', weight: 30, hint: 'Clicks and conversions in the last 7 days' },
  { key: 'trend', label: 'Trend', weight: 15, hint: 'Clicks in the last 7 days against the 7 before' },
  { key: 'engagement', label: 'Sign-ins', weight: 20, hint: 'How recently anyone in the network signed in' },
  { key: 'billing', label: 'Billing', weight: 20, hint: 'Subscription and unpaid invoices' },
  { key: 'onboarding', label: 'Onboarding', weight: 15, hint: 'Setup milestones reached' },
];

export interface HealthSignals {
  clicks7d?: number; clicksPrev7d?: number; clicksToday?: number; clicks30d?: number; conversions7d?: number;
  lastLoginAt?: string | null; activeUsers14d?: number; subscriptionStatus?: string | null; cancelAtPeriodEnd?: boolean;
  overdueInvoices?: number; suspendedForBilling?: boolean; offers?: number; partners?: number;
}

export interface AccountRow {
  id: string; name: string; slug: string; status: string; suspended_reason: string | null; created_at: string;
  account_manager_id: string | null; account_manager_name: string | null; sales_owner_id: string | null; sales_owner_name: string | null;
  plan_name: string | null; subscription_status: string | null; trial_ends_at: string | null; tags: string[];
  health_score: number | null; health_status: HealthStatus | null; health_components: Partial<Record<(typeof PARTS)[number]['key'], number>>;
  health_signals: HealthSignals; onboarding_pct: number | null; health_computed_at: string | null; score_7d_ago: number | null;
}

export interface Milestone { key: string; label: string; done: boolean; at: string | null }
export interface NetworkNote { id: string; body: string; pinned: boolean; created_at: string; updated_at: string; author_id: string | null; author_name: string | null }
export interface AccountDetail extends AccountRow {
  onboarding: Milestone[]; milestones: { key: string; label: string }[];
  history: { day: string; score: number; status: HealthStatus }[]; notes: NetworkNote[];
}

/** Clicks this week against the week before, as "+12 %" / "−40 %" (null without a previous week). */
export function trendPct(s: HealthSignals): string | null {
  const prev = s.clicksPrev7d ?? 0;
  if (!prev) return null;
  const pct = Math.round((((s.clicks7d ?? 0) - prev) / prev) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %`;
}
