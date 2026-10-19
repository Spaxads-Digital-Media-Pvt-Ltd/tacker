/**
 * Super Admin › Money — coupons and the revenue summary's shapes (api-backend revenue-routes.ts). Amounts are
 * text, never floats; per currency, never summed across currencies.
 */
import { money } from './platformBilling';

export interface Coupon {
  id: string; code: string; name: string; kind: 'percent' | 'amount'; percent_off: string | null; amount_off: string | null; currency: string | null;
  duration: 'once' | 'repeating' | 'forever'; duration_cycles: number | null; max_redemptions: number | null; redeemed: number;
  valid_until: string | null; status: 'active' | 'archived'; active_discounts: number; created_at: string;
}
/** "20% off" / "USD 50.00 off" */
export const couponOff = (c: Pick<Coupon, 'kind' | 'percent_off' | 'amount_off' | 'currency'>) =>
  (c.kind === 'percent' ? `${Number(c.percent_off)}% off` : `${money(c.amount_off, c.currency ?? '')} off`);
/** "the next invoice" / "3 invoices" / "every invoice" */
export const couponFor = (c: Pick<Coupon, 'duration' | 'duration_cycles'>) =>
  (c.duration === 'once' ? 'the next invoice' : c.duration === 'forever' ? 'every invoice' : `${c.duration_cycles} invoices`);


export interface Amount { currency: string; amount: string }
export interface RevenueSummary {
  mrr: { currency: string; amount: string; arr: string; customers: number; arpa: string }[];
  movements: { thisMonth: Movement[]; lastMonth: Movement[] };
  trend: { month: string; currency: string; mrr: string; customers: number }[];
  churn: { month: string; at_start: number; churned: number; rate: number | null }[];
  ltv: { currency: string; amount: string; avgMonthlyChurnPct: number }[] | null;
  collected: { month: string; currency: string; amount: string; refunded: string }[];
  invoiced: { month: string; currency: string; amount: string; invoices: number }[];
  outstanding: { currency: string; open: string; overdue: string; open_count: number }[];
  byPlan: { plan_id: string; plan_name: string; currency: string; customers: number; mrr: string }[];
  topCustomers: { network_id: string; name: string; currency: string; mrr: string; plan_name: string }[];
  trialConversion: { ended: number; converted: number; rate: number | null };
  renewals: { network_id: string; name: string; renews_at: string; plan_name: string; currency: string; amount: string; cancel_at_period_end: boolean }[];
  historySince: string | null;
}
export interface Movement {
  month: 'this' | 'last'; currency: string; new: string; expansion: string; contraction: string; churn: string; reactivation: string; net: string;
  new_count: number; churn_count: number;
}
