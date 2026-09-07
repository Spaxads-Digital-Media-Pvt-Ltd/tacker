/** Shared types/constants for Offers › Custom Settings — matches the reference's real 5-category
 * "Manage Custom Settings" (Revenue & Payout / Caps / Throttle Rates / Landing Pages / Creatives),
 * each with its own field set rather than one generic name/event/value shape. Targeting is a
 * reduced, honest subset (Countries/Devices/OS/Browsers as free-text values, same convention as
 * Traffic Controls' own Variable+Values) — this app has no real geo/ISP/device lookup data for the
 * reference's full Platform/Device Type/Browser/Region/City/DMA/ISP tree. */
export interface Targeting { countries?: string[]; devices?: string[]; os?: string[]; browsers?: string[] }

export interface CustomSetting {
  id: string; ref: number; category: Category; name: string | null; offerId: string;
  partnerId: string | null; applyAllPartners: boolean; partnerIds: string[];
  description: string | null; publicDescription: string | null;
  status: 'active' | 'inactive' | 'deleted';
  effectiveFrom: string | null; effectiveTo: string | null;
  targeting: Targeting;
  applyCustomPayout: boolean; payoutModel: PayoutModel | null; payoutValue: string | null;
  applyCustomRevenue: boolean; revenueModel: PayoutModel | null; revenueValue: string | null;
  goalId: string | null; firePartnerPostback: boolean;
  caps: Record<string, Record<string, number>>;
  conversionStatus: 'rejected' | 'pending' | null; throttleRate: string | null; setParameterGoal: boolean;
  landingPageUrl: string | null;
  creativeType: string | null; creativeUrl: string | null; creativeThumbnailUrl: string | null;
  emailFrom: string | null; emailSubject: string | null;
  createdAt: string; updatedAt: string;
}

export const CATEGORIES = ['revenue_payout', 'caps', 'throttle_rates', 'landing_pages', 'creatives'] as const;
export type Category = (typeof CATEGORIES)[number];

export const TAB_LABEL: Record<Category, string> = {
  revenue_payout: 'Revenue & Payout', caps: 'Caps', throttle_rates: 'Throttle Rates',
  landing_pages: 'Landing Pages', creatives: 'Creatives',
};
export const ADD_LABEL: Record<Category, string> = {
  revenue_payout: 'Custom Revenue & Payout', caps: 'Custom Cap', throttle_rates: 'Custom Throttle Rate',
  landing_pages: 'Custom Landing Page', creatives: 'Custom Creative',
};
export const ADD_ROUTE: Record<Category, string> = {
  revenue_payout: 'revenue-payout', caps: 'caps', throttle_rates: 'throttle-rates', landing_pages: 'landing-pages', creatives: 'creatives',
};

export const PAYOUT_MODELS = [
  { value: 'CPA', label: 'CPA' },
  { value: 'CPA_PPP', label: 'CPA (Price Per Product)' },
  { value: 'CPA_CPS', label: 'CPA/CPS' },
  { value: 'CPA_CPS_PPP', label: 'CPA/CPS (Price Per Product)' },
  { value: 'CPC', label: 'CPC' },
  { value: 'CPM', label: 'CPM' },
  { value: 'CPS', label: 'CPS' },
  { value: 'CPS_PPP', label: 'CPS (Price Per Product)' },
  { value: 'PRV', label: 'PRV' },
  { value: 'PRV_PPP', label: 'PRV (Price Per Product)' },
] as const;
export type PayoutModel = (typeof PAYOUT_MODELS)[number]['value'];
export const payoutModelLabel = (m: string | null) => PAYOUT_MODELS.find((p) => p.value === m)?.label ?? m ?? '—';

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}

export const splitValues = (s: string): string[] => s.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
export const joinValues = (vs: string[] | undefined): string => (vs ?? []).join(', ');
