/**
 * Platform billing (the platform's invoices to its tenant networks) — shared by the Super Admin console
 * and the tenant's Settings › Billing. Amounts arrive as decimal text and are shown without ever passing
 * through a float. Pure — no React (lib/__tests__/platformBilling.test.ts).
 */

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: 'month' | 'year';
  trial_days: number;
  description: string | null;
  limits: Record<string, number | string | boolean>;
  /** Per started block over a limit, charged at renewal: { clicks: { per: 1000, price: "0.50" } }. */
  overage?: Partial<Record<'clicks' | 'conversions' | 'events', { per: number; price: string }>>;
  status: 'active' | 'archived';
  subscribers: number;
}

export interface PlatformInvoice {
  id: string;
  number: string;
  network_id: string;
  description: string;
  currency: string;
  subtotal: string;
  tax_rate?: string;
  tax: string;
  total: string;
  status: 'open' | 'paid' | 'void';
  overdue: boolean;
  issued_at: string;
  due_at: string;
  suspend_at: string;
  paid_at: string | null;
  paid_amount?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  period_start: string | null;
  period_end: string | null;
  void_reason?: string | null;
  bill_to?: { name: string; slug: string; email: string | null };
  notes?: string | null;
  /** Super Admin list only. */
  network_name?: string | null;
  network_status?: string | null;
  network_suspended_reason?: string | null;
}

export interface InvoiceSummaryRow {
  currency: string;
  open_count: number;
  open_total: string;
  overdue_count: number;
  overdue_total: string;
  collected_this_month: string;
}

export interface BillingSettings {
  invoicePrefix: string;
  dueDays: number;
  graceDays: number;
  taxRate: string;
  autoSuspend: boolean;
  seller: { name: string; address: string; taxId: string; email: string };
  paymentInstructions: string;
}

/** One line of an invoice: the plan, overage, a discount (negative), a one-off charge. Amounts are text. */
export interface InvoiceLine { kind: 'plan' | 'overage' | 'discount' | 'addon' | 'setup' | 'one_off'; description: string; quantity: string; unit_amount: string; amount: string }
/** Credit against a paid invoice (a refund or a goodwill credit). */
export interface CreditNote { id?: string; number: string; amount: string; currency: string; reason: string; refunded: boolean; refund_method?: string | null; refund_reference?: string | null; created_at: string }

/** The printed copy: the invoice, its lines and credit notes, who bills it and how to pay. */
export interface InvoiceDocumentData {
  invoice: PlatformInvoice;
  lines?: InvoiceLine[];
  creditNotes?: CreditNote[];
  seller: BillingSettings['seller'];
  paymentInstructions: string;
}

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];
export const paymentMethodLabel = (m: string | null | undefined): string => PAYMENT_METHODS.find((p) => p.value === m)?.label ?? (m ?? '—');

/** "1234567.8" → "1,234,567.80" — grouped from the text itself, never via a float. */
export function formatAmount(amount: string | number | null | undefined): string {
  const raw = String(amount ?? '0').trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!m) return raw;
  const int = (m[2] || '0').replace(/^0+(?=\d)/, '');
  const frac = ((m[3] ?? '') + '00').slice(0, 2);
  return `${m[1]}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export const money = (amount: string | number | null | undefined, currency: string): string => `${currency} ${formatAmount(amount)}`;

/** Whole cents (a plan price) → decimal text, without floats. */
export function centsToAmount(cents: number): string {
  const c = Math.trunc(Math.abs(cents));
  return `${cents < 0 ? '-' : ''}${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

/** "99" / "99.5" / "99.50" → 9950 cents; null when it isn't an amount. */
export function amountToCents(text: string): number | null {
  const m = /^\s*(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
}

export const planPrice = (p: Pick<PlatformPlan, 'price_cents' | 'currency' | 'billing_interval'>): string =>
  p.price_cents === 0 ? 'Free' : `${money(centsToAmount(p.price_cents), p.currency)} / ${p.billing_interval === 'year' ? 'year' : 'month'}`;

/** What an invoice's state is, in words — "Overdue" is an open invoice past its due date. */
export const invoiceState = (i: Pick<PlatformInvoice, 'status' | 'overdue'>): 'overdue' | 'open' | 'paid' | 'void' =>
  i.status === 'open' && i.overdue ? 'overdue' : i.status;

export const day = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '—');

/**
 * Badge props for a billing state on the shared Badge (whose colours key off its value): billing words
 * mapped onto the existing tones, so other pages' badges keep their colours.
 */
const BADGE_OF: Record<string, { value: string; label: string }> = {
  open: { value: 'pending', label: 'Open' },
  overdue: { value: 'overdue', label: 'Overdue' },
  paid: { value: 'approved', label: 'Paid' },
  void: { value: 'archived', label: 'Void' },
  trialing: { value: 'trialing', label: 'Trial' },
  active: { value: 'active', label: 'Active' },
  past_due: { value: 'past_due', label: 'Past due' },
  canceled: { value: 'inactive', label: 'Canceled' },
};
export const billingBadge = (state: string): { value: string; label: string } => BADGE_OF[state] ?? { value: state, label: state };
