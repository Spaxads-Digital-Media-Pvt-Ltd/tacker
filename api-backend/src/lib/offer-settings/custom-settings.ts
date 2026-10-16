/**
 * Offer Custom Settings at runtime (audit F-12) — the per-partner overrides an admin sets under
 * Offers › Custom Settings (table offer_custom_settings, v2 columns from migration 1700000054000),
 * cached on the offer config (surfaces/tracking/offer-cache.ts) and applied by the tracking surface:
 *
 *   /click (app.ts)       Landing Pages  → replaces the destination for that partner
 *                         Caps (clicks)  → per-partner click caps (Redis counters, caps.ts)
 *   conversion (record.ts) Revenue & Payout → the partner's payout/revenue for that offer (or goal)
 *                         Caps (conversions/payout/revenue) → rejects past the cap
 *                         Throttle Rates → that share of conversions gets the setting's status
 *
 * Creatives are partner-facing assets, not runtime behaviour. A setting applies to a publisher when
 * it is active, inside its effective window, scoped to that partner (or all partners), and its
 * targeting (countries / devices / OS / browsers — the same click fields Traffic Controls use)
 * matches the click. A partner-specific setting beats an all-partners one; then oldest first.
 *
 * Pricing models: CPA / CPA_PPP (or none) = a fixed amount per conversion, like the offer default
 * payout; CPS / CPS_PPP = a percentage of the sale amount the S2S postback reports. The mixed
 * (CPA_CPS*) and non-conversion (CPC, CPM, PRV*) models need data this tracker doesn't have (a
 * second amount, impressions, …) — they are stored but not applied.
 */
import { percentOfMoney } from '../money.js';
import { addDays, isValidTimeZone, localDate, zonedDayStart } from '../reporting/time-zone.js';

export type CustomCategory = 'revenue_payout' | 'caps' | 'throttle_rates' | 'landing_pages' | 'creatives';
export const CAP_KINDS = ['clicks', 'conversions', 'payout', 'revenue'] as const;
export const CAP_INTERVALS = ['daily', 'weekly', 'monthly', 'global'] as const;
export type CapKind = (typeof CAP_KINDS)[number];
export type CapInterval = (typeof CAP_INTERVALS)[number];
export type CapsMatrix = Partial<Record<CapKind, Partial<Record<CapInterval, number>>>>;

export interface CustomTargeting { countries?: string[]; devices?: string[]; os?: string[]; browsers?: string[] }

/** One active custom setting as cached on the offer config. */
export interface CustomSettingConfig {
  id: string;
  category: CustomCategory;
  /** Applies to every partner, or only to `partnerIds`. */
  allPartners: boolean;
  partnerIds: string[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  targeting: CustomTargeting;
  // Revenue & Payout
  payoutModel: string | null;
  payout: string | null;
  revenueModel: string | null;
  revenue: string | null;
  goalId: string | null;
  firePartnerPostback: boolean;
  // Caps
  caps: CapsMatrix;
  // Throttle Rates
  throttleRate: string | null;
  conversionStatus: 'rejected' | 'pending' | null;
  // Landing Pages
  landingPageUrl: string | null;
}

/** The click attributes targeting is evaluated against. */
export interface ClickAttrs { country: string | null; device: string | null; os: string | null; browser: string | null }

const inList = (list: string[] | undefined, v: string | null): boolean =>
  !list?.length || (v != null && list.some((x) => x.toLowerCase() === v.toLowerCase()));

export function targetingMatches(t: CustomTargeting, a: ClickAttrs): boolean {
  return inList(t.countries, a.country) && inList(t.devices, a.device) && inList(t.os, a.os) && inList(t.browsers, a.browser);
}

const inWindow = (s: CustomSettingConfig, at: Date): boolean =>
  (!s.effectiveFrom || new Date(s.effectiveFrom) <= at) && (!s.effectiveTo || at < new Date(s.effectiveTo));

/** Settings of `category` that apply to this publisher + click at `at` — partner-specific first. */
export function applicableSettings(
  all: CustomSettingConfig[] | undefined, category: CustomCategory, publisherId: string, attrs: ClickAttrs, at: Date,
): CustomSettingConfig[] {
  const hits = (all ?? []).filter((s) => s.category === category
    && (s.allPartners || s.partnerIds.includes(publisherId))
    && inWindow(s, at) && targetingMatches(s.targeting, attrs));
  return [...hits.filter((s) => !s.allPartners), ...hits.filter((s) => s.allPartners)];
}

const FIXED_MODELS = new Set(['CPA', 'CPA_PPP']);
const PERCENT_MODELS = new Set(['CPS', 'CPS_PPP']);

/**
 * A custom amount under its pricing model: fixed (CPA, or no model) → as is; percentage (CPS) → that
 * share of `saleAmount`; anything else, or a percentage with no sale amount → null (not applied).
 */
export function priceFor(model: string | null, value: string | null, saleAmount: string | null): string | null {
  if (value == null) return null;
  if (model == null || FIXED_MODELS.has(model)) return value;
  if (PERCENT_MODELS.has(model)) return saleAmount == null ? null : percentOfMoney(saleAmount, value);
  return null;
}

export interface CustomPricing { payout: string | null; revenue: string | null; firePartnerPostback: boolean; settingIds: string[] }

/**
 * The Revenue & Payout overrides for this conversion. A setting tied to a goal applies when that goal
 * fired; one without a goal applies to the base conversion (no event goal, or the default goal).
 * The first applicable setting that prices each of payout / revenue wins.
 */
export function customPricing(
  settings: CustomSettingConfig[] | undefined,
  args: { publisherId: string; attrs: ClickAttrs; clickAt: Date; eventGoalId: string | null; defaultGoalId: string | null; saleAmount: string | null },
): CustomPricing | null {
  const applicable = applicableSettings(settings, 'revenue_payout', args.publisherId, args.attrs, args.clickAt)
    .filter((s) => (args.eventGoalId
      ? s.goalId === args.eventGoalId
      : s.goalId == null || s.goalId === args.defaultGoalId));
  let payout: string | null = null;
  let revenue: string | null = null;
  let firePartnerPostback = true;
  const ids: string[] = [];
  for (const s of applicable) {
    const p: string | null = payout == null ? priceFor(s.payoutModel, s.payout, args.saleAmount) : null;
    const r: string | null = revenue == null ? priceFor(s.revenueModel, s.revenue, args.saleAmount) : null;
    if (p == null && r == null) continue;
    if (p != null) payout = p;
    if (r != null) revenue = r;
    if (!s.firePartnerPostback) firePartnerPostback = false;
    ids.push(s.id);
    if (payout != null && revenue != null) break;
  }
  return ids.length ? { payout, revenue, firePartnerPostback, settingIds: ids } : null;
}

/**
 * The time zone a cap's "day" (week, month) is counted in: the offer's Cap time zone, else the
 * network's (Settings › General — "Daily caps reset at midnight in [zone]"), else UTC. A stored value
 * that isn't a valid IANA zone is skipped, never thrown on.
 */
export function capTimeZoneOf(offerZone: string | null | undefined, networkZone?: string | null): string {
  if (isValidTimeZone(offerZone)) return offerZone;
  if (isValidTimeZone(networkZone)) return networkZone;
  return 'UTC';
}

/** The local date (YYYY-MM-DD) the current cap window starts on in `tz`; null = all time. */
function capWindowStartDate(interval: CapInterval, now: Date, tz: string): string | null {
  const today = localDate(now, tz);
  if (interval === 'daily') return today;
  if (interval === 'weekly') return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (interval === 'monthly') return `${today.slice(0, 8)}01`;
  return null;
}

/** Start of the current cap window in the cap time zone (day, ISO week from Monday, month — local
 * midnight in `tz`, UTC by default); null = all time. */
export function capWindowStart(interval: CapInterval, now = new Date(), tz = 'UTC'): Date | null {
  const date = capWindowStartDate(interval, now, tz);
  return date ? zonedDayStart(date, tz) : null;
}

/** Redis key suffix for the current cap window (its local start date in `tz`) + how long that bucket
 * must live (seconds; 0 = forever). */
export function capBucket(interval: CapInterval, now = new Date(), tz = 'UTC'): { bucket: string; ttl: number } {
  const date = capWindowStartDate(interval, now, tz);
  if (!date) return { bucket: 'all', ttl: 0 };
  const days = interval === 'daily' ? 2 : interval === 'weekly' ? 8 : 32;
  return { bucket: `${interval}:${date.replace(/-/g, '')}`, ttl: days * 24 * 60 * 60 };
}

/** The positive limits of one cap kind, by interval. */
export function capLimits(caps: CapsMatrix, kind: CapKind): [CapInterval, number][] {
  const w = caps[kind] ?? {};
  return CAP_INTERVALS.flatMap((i) => (typeof w[i] === 'number' && w[i]! > 0 ? [[i, w[i]!] as [CapInterval, number]] : []));
}
