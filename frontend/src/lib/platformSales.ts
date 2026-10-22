/**
 * Super Admin › Sales — the pipeline's vocabulary in the SPA (stages with their colours and win chance,
 * sources) and the shapes the API returns. Amounts are text, never floats (lib/platformBilling money()).
 */
import { useQuery } from './useApi';
export type Stage = 'new' | 'contacted' | 'qualified' | 'demo' | 'trial' | 'negotiation' | 'won' | 'lost';

export const STAGES: { key: Stage; label: string; chip: string; dot: string; chance: number }[] = [
  { key: 'new', label: 'New', chip: 'bg-info-bg text-info-text', dot: 'bg-info', chance: 10 },
  { key: 'contacted', label: 'Contacted', chip: 'bg-info-bg text-info-text', dot: 'bg-info-text', chance: 20 },
  { key: 'qualified', label: 'Qualified', chip: 'bg-accent-subtle text-accent-text', dot: 'bg-accent', chance: 40 },
  { key: 'demo', label: 'Demo', chip: 'bg-accent-subtle text-accent-text', dot: 'bg-accent-hover', chance: 50 },
  { key: 'trial', label: 'Trial', chip: 'bg-warning-bg text-warning-text', dot: 'bg-warning', chance: 60 },
  { key: 'negotiation', label: 'Negotiation', chip: 'bg-warning-bg text-warning-text', dot: 'bg-warning-text', chance: 80 },
  { key: 'won', label: 'Won', chip: 'bg-success-bg text-success-text', dot: 'bg-success', chance: 100 },
  { key: 'lost', label: 'Lost', chip: 'bg-danger-bg text-danger-text', dot: 'bg-danger', chance: 0 },
];
export const OPEN_STAGES: Stage[] = ['new', 'contacted', 'qualified', 'demo', 'trial', 'negotiation'];
export const stageOf = (k: string) => STAGES.find((s) => s.key === k) ?? STAGES[0]!;

export const SOURCES: { value: string; label: string }[] = [
  { value: 'website', label: 'Website form' }, { value: 'referral', label: 'Referral' }, { value: 'event', label: 'Event' },
  { value: 'outbound', label: 'Outbound' }, { value: 'partner', label: 'Partner' }, { value: 'inbound', label: 'Inbound call / email' },
  { value: 'manual', label: 'Added by hand' }, { value: 'other', label: 'Other' },
];
export const sourceLabel = (v: string) => SOURCES.find((s) => s.value === v)?.label ?? v;

export interface Lead {
  id: string; company: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null;
  country: string | null; source: string; stage: Stage; owner_id: string | null; owner_name: string | null; owner_email: string | null;
  plan_id: string | null; plan_name: string | null; expected_mrr: string | null; currency: string; monthly_clicks: number | null;
  tags: string[]; notes: string | null; message: string | null; next_step: string | null; next_step_at: string | null;
  lost_reason: string | null; network_id: string | null; network_name: string | null; network_slug: string | null;
  stage_changed_at: string; won_at: string | null; lost_at: string | null; created_at: string; updated_at: string; open_tasks: number;
}

export interface LeadActivity {
  id: string; kind: 'note' | 'call' | 'email' | 'meeting' | 'stage' | 'owner' | 'created' | 'converted' | 'inbound' | 'task' | 'quote';
  body: string | null; meta: Record<string, unknown>; created_at: string; actor_id: string | null; actor_name: string | null;
}

export interface PlatformTask {
  id: string; title: string; notes: string | null; kind: 'sales' | 'success' | 'support' | 'billing' | 'other';
  priority: 'low' | 'normal' | 'high'; status: 'open' | 'done'; due_at: string | null; completed_at: string | null; created_at: string;
  assignee_id: string | null; assignee_name: string | null; created_by: string | null; created_by_name: string | null;
  lead_id: string | null; lead_company: string | null; network_id: string | null; network_name: string | null;
}

export interface StaffMember { id: string; email: string; name: string | null; role_key: string; role_name: string }

export interface PerCurrencyAmount { currency: string; amount: string }

/** The pipeline's headline numbers (GET /platform/sales/summary, also the Overview's `sales`). */
export interface SalesKpis {
  open: number; new_this_month: number; won_this_month: number; won_90d: number; lost_90d: number; avg_cycle_days: number | null;
  overdue_next_steps: number; unassigned: number; win_rate_90d: number | null;
}
export interface SalesHeadline {
  kpis: SalesKpis;
  forecast: { currency: string; pipeline: string; weighted: string }[];
  wonThisMonth: { currency: string; amount: string; deals: number }[];
}

export interface PipelineColumn { stage: Stage; count: number; mrr: PerCurrencyAmount[]; leads: Lead[] }

export const TASK_KINDS: { value: PlatformTask['kind']; label: string; section: string | null }[] = [
  { value: 'sales', label: 'Sales', section: 'sales' }, { value: 'success', label: 'Customer success', section: 'success' },
  { value: 'support', label: 'Support', section: 'support' }, { value: 'billing', label: 'Billing', section: 'billing' },
  { value: 'other', label: 'Other', section: null },
];

/** A date-time input's value ("2026-10-20T15:00", local) from an ISO string, and back. */
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** The platform team's active members — owners, assignees, account managers. */
export const useStaff = () => useQuery<StaffMember[]>('/platform/staff');

/** The total behind a paged list (lib/api.ts puts the pagination meta on the array). */
export const totalOf = (rows: unknown): number => ((rows as { pagination?: { total?: number } } | null)?.pagination?.total ?? (Array.isArray(rows) ? rows.length : 0));

// ---------- Quotes ----------
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
export type BillingInterval = 'month' | 'year' | 'once';
export interface QuoteLine { description: string; quantity: number; unitPrice: string; amount: string }
/** A quote as staff see it (GET /platform/sales/quotes…). `status` already reads 'expired' when it is. */
export interface Quote {
  id: string; number: string; lead_id: string; title: string; currency: string; lines: QuoteLine[];
  subtotal: string; discount_pct: string; discount: string; tax_rate: string; tax: string; total: string;
  billing_interval: BillingInterval; notes: string | null; terms: string | null; valid_until: string; status: QuoteStatus;
  public_token: string; sent_at: string | null; sent_to: string | null; viewed_at: string | null; responded_at: string | null;
  responder_name: string | null; decline_reason: string | null; created_at: string; link: string | null;
  company?: string; owner_name?: string | null;
}
export const QUOTE_STATUS: Record<QuoteStatus, { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'bg-page text-fg-secondary ring-1 ring-inset ring-border' },
  sent: { label: 'Sent', chip: 'bg-info-bg text-info-text' },
  accepted: { label: 'Accepted', chip: 'bg-success-bg text-success-text' },
  declined: { label: 'Declined', chip: 'bg-danger-bg text-danger-text' },
  expired: { label: 'Expired', chip: 'bg-warning-bg text-warning-text' },
};
export const INTERVALS: { value: BillingInterval; label: string; suffix: string }[] = [
  { value: 'month', label: 'Monthly', suffix: 'per month' }, { value: 'year', label: 'Yearly', suffix: 'per year' }, { value: 'once', label: 'One-off', suffix: 'one-off' },
];
export const intervalSuffix = (v: string) => INTERVALS.find((i) => i.value === v)?.suffix ?? '';

/**
 * The quote's totals while it's being written — the same integer-cent, half-up rules as the API
 * (lib/platform/quotes.ts quoteTotals), which is what's saved. null while a field isn't a valid amount yet.
 */
export function previewQuoteTotals(lines: { quantity: string; unitPrice: string }[], discountPct: string, taxRate: string): { subtotal: string; discount: string; tax: string; total: string } | null {
  const cents = (t: string) => { const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(t.trim()); return m ? BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0')) : null; };
  const text = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
  let subtotal = 0n;
  for (const l of lines) {
    const unit = cents(l.unitPrice);
    if (unit === null || !/^\d+$/.test(l.quantity.trim())) return null;
    subtotal += unit * BigInt(l.quantity.trim());
  }
  const d = cents(discountPct || '0');
  const t = cents(taxRate || '0');
  if (d === null || t === null) return null;
  const discount = (subtotal * d + 5000n) / 10000n;
  const tax = ((subtotal - discount) * t + 5000n) / 10000n;
  return { subtotal: text(subtotal), discount: text(discount), tax: text(tax), total: text(subtotal - discount + tax) };
}

// ---------- Team: quotas and commissions ----------
export interface SalesTeamMember {
  id: string; name: string; email: string; role_name: string;
  comp: { commissionPct: string; commissionMonths: number | null } | null;
  quota: { currency: string; target: string }[];
  won: { currency: string; amount: string; deals: number }[];
  commission: { currency: string; paid: string; amount: string }[];
}
export interface CommissionMonth { month: string; currency: string; paid: string; invoices: number; commission: string }
