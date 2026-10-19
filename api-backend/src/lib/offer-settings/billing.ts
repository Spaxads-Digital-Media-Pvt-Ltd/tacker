/**
 * What an offer is priced on. The partner's payout follows the offer's payout model — per conversion, per
 * click (CPC) or per 1000 impressions (CPM); the advertiser's revenue follows Revenue › Revenue Action
 * (Impression / Click / Base Conversion Event). A partner's own Revenue & Payout custom setting (Offer Custom
 * Settings, no goal) decides for that partner instead: CPC → per click, CPM → per 1000 impressions, any other
 * model → per conversion.
 *
 * Per-click money is booked as one conversion per billable click (source 'click'), per-impression money as
 * bookings of the counted impressions (source 'impression') — tracking/conversions/volume-billing.ts. Those
 * "billing rows" carry money but aren't conversions: reports count their payout / revenue, not them. And a
 * conversion on such an offer has no BASE payout / revenue for the side priced per click / impression (its
 * event goals and an explicit S2S amount still price it) — or it would be paid twice.
 */
import type { RevenueSettings } from './index.js';
import { applicableSettings, type ClickAttrs, type CustomSettingConfig } from './custom-settings.js';

export type PricedAction = 'conversion' | 'click' | 'impression';

/** Conversion sources the tracker books itself for paid clicks / impressions. */
export const BILLING_SOURCES = ['click', 'impression'] as const;

/** SQL: the conversion is a billing row (a paid click or an impressions booking). */
export function billingRowSql(alias?: string): string {
  return `(${alias ? `${alias}.` : ''}source IN ('click', 'impression'))`;
}

export function actionOfModel(model: string | null | undefined): PricedAction {
  return model === 'CPC' ? 'click' : model === 'CPM' ? 'impression' : 'conversion';
}

export interface SidePricing {
  action: PricedAction;
  /** Per click / per 1000 impressions for those actions; null for 'conversion' (the conversion path prices it). */
  rate: string | null;
}
export interface ActionPricing { payout: SidePricing; revenue: SidePricing }

/**
 * How this partner is paid on this offer, and how the advertiser is billed. `resolved` are the rates frozen on
 * the click / impression (the partner's override, tier margin, country override, else the default) — the rate
 * of a per-click / per-impression side unless the partner's own custom setting names one.
 */
export function actionPricing(
  offer: { payoutModel: string; revenue?: Pick<RevenueSettings, 'revenueAction'> | null; customSettings?: CustomSettingConfig[] },
  publisherId: string | null, attrs: ClickAttrs, at: Date,
  resolved: { payout: string | null; revenue: string | null },
): ActionPricing {
  const own = publisherId
    ? applicableSettings(offer.customSettings, 'revenue_payout', publisherId, attrs, at).filter((s) => s.goalId == null)
    : [];
  const ownPayout = own.find((s) => s.payout != null);
  const ownRevenue = own.find((s) => s.revenue != null);
  const payout = ownPayout ? actionOfModel(ownPayout.payoutModel) : actionOfModel(offer.payoutModel);
  const revenue = ownRevenue ? actionOfModel(ownRevenue.revenueModel) : (offer.revenue?.revenueAction ?? 'conversion');
  return {
    payout: { action: payout, rate: payout === 'conversion' ? null : (ownPayout?.payout ?? resolved.payout) },
    revenue: { action: revenue, rate: revenue === 'conversion' ? null : (ownRevenue?.revenue ?? resolved.revenue) },
  };
}
