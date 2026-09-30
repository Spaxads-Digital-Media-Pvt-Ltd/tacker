/** Defaults for metadata-backed offer settings — identical to the backend's (offer-settings/index.ts). */
import type { OfferAttributionSettings, OfferEmailSettings, OfferRevenueSettings } from '../../../types';

export const DEFAULT_ATTRIBUTION: OfferAttributionSettings = {
  tracker24: { enabled: false, trackerId: null },
  ipqs: { enabled: false },
  throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 5, maxSeconds: 21600 },
  emailOwnership: false,
  viewThrough: false,
  serverSideClick: false,
};

export const DEFAULT_REVENUE: OfferRevenueSettings = {
  baseEventName: null,
  manualApproval: false,
  allowDuplicates: true,
  revenueAction: 'conversion',
  revenueType: 'fixed',
  revenuePct: null,
  pricePerProduct: false,
};

export const DEFAULT_EMAIL: OfferEmailSettings = {
  suppression: { enabled: false, fileUrl: null },
  ezepo: { enabled: false },
  optizmo: { enabled: false, listId: null },
  instructions: { enabled: false, text: null },
  optOut: { enabled: false, url: null },
};

export function withDefaults<T extends object>(defaults: T, stored: Partial<T> | null | undefined): T {
  const out = structuredClone(defaults) as Record<string, unknown>;
  for (const [k, v] of Object.entries(stored ?? {})) {
    const d = (defaults as Record<string, unknown>)[k];
    out[k] = d && typeof d === 'object' && v && typeof v === 'object' ? { ...(d as object), ...(v as object) } : v;
  }
  return out as T;
}

/** Problems that would make the API reject the settings — used to block saving with a clear message. */
export function settingsErrors(a: OfferAttributionSettings, r: OfferRevenueSettings, e: OfferEmailSettings): string[] {
  const out: string[] = [];
  const c = a.clickToConversion;
  if (c.enabled && c.maxSeconds != null && c.maxSeconds <= c.minSeconds) out.push('Attribution: max click-to-conversion time must be greater than the minimum.');
  if (a.throttle.enabled && (a.throttle.ratePct <= 0 || a.throttle.ratePct > 100)) out.push('Attribution: throttle rate must be between 0 and 100%.');
  if (r.revenueType !== 'fixed' && (r.revenuePct == null || r.revenuePct < 0 || r.revenuePct > 100)) out.push('Revenue: enter a revenue percentage between 0 and 100.');
  const isUrl = (u: string | null) => !u || /^https?:\/\/\S+$/i.test(u);
  if (!isUrl(e.suppression.fileUrl)) out.push('Email: suppression file URL must start with http(s)://');
  if (!isUrl(e.optOut.url)) out.push('Email: opt-out URL must start with http(s)://');
  return out;
}
