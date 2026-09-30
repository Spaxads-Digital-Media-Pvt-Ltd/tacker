/**
 * Offer targeting enforcement (Edit Offer › Targeting), evaluated on /click against the click's
 * own UA / Accept-Language / IP / geo fields — no I/O, rules ride on the cached OfferConfig.
 *
 * include = the click's value must match one listed value; exclude = it must match none.
 * Geo-sourced dimensions FAIL OPEN when the data source isn't loaded (same convention as
 * geo-rules.ts): without a GeoIP db we can't tell, so we don't block. Country honours the dev
 * `geo=XX` override. A known-but-missing value (e.g. no User-Agent) never satisfies an include.
 */
import type { OfferTargeting, TargetingKey } from '../../lib/offer-settings/index.js';
import { normalizePostal } from '../../lib/offer-settings/postal.js';
import { ipInRange, normalizeIp } from '../../lib/offer-settings/ip-match.js';

export interface TargetingContext {
  platform: string | null;
  browser: string | null;
  deviceBrand: string | null;
  osVersion: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  dma: string | null;
  mobileCarrier: string | null;
  isp: string | null;
  zip: string | null;
  ip: string | null;
}

export interface TargetingAvailability {
  /** GeoIP city db loaded (region/city/dma/isp/zip). */
  geo: boolean;
  /** Country is known (geo db loaded OR forced via dev override). */
  country: boolean;
  /** Mobile-carrier db loaded. */
  carrier: boolean;
}

const ci = (s: string) => s.trim().toLowerCase();

/** First language tag of an Accept-Language header, e.g. "en-US,en;q=0.9" → "en-us". */
export function primaryLanguage(header: string | null | undefined): string | null {
  const first = (header ?? '').split(',')[0]?.split(';')[0]?.trim();
  return first ? first.toLowerCase() : null;
}

function matches(key: TargetingKey, rule: string, ctx: TargetingContext): boolean {
  switch (key) {
    case 'ipExact': return ctx.ip != null && normalizeIp(ctx.ip) === normalizeIp(rule);
    case 'ipRange': return ctx.ip != null && ipInRange(ctx.ip, rule);
    case 'zip': {
      if (!ctx.zip) return false;
      const z = normalizePostal(ctx.zip);
      const r = normalizePostal(rule);
      return z === r || z === r.split('-')[0];
    }
    case 'osVersion': {
      if (!ctx.osVersion) return false;
      const v = ci(ctx.osVersion); const r = ci(rule);
      return v === r || v.startsWith(`${r}.`);
    }
    case 'language': {
      if (!ctx.language) return false;
      const r = ci(rule);
      return ctx.language === r || (!r.includes('-') && ctx.language.split('-')[0] === r);
    }
    case 'region': {
      if (!ctx.region) return false;
      const r = ci(rule);
      return ci(ctx.region) === r || (ctx.country != null && `${ci(ctx.country)}-${ci(ctx.region)}` === r);
    }
    case 'isp': return ctx.isp != null && ci(ctx.isp).includes(ci(rule));
    default: {
      const v = ctx[key as keyof TargetingContext];
      return v != null && ci(v) === ci(rule);
    }
  }
}

function available(key: TargetingKey, avail: TargetingAvailability): boolean {
  switch (key) {
    case 'country': return avail.country;
    case 'region': case 'city': case 'dma': case 'isp': case 'zip': return avail.geo;
    case 'mobileCarrier': return avail.carrier;
    default: return true;
  }
}

export interface TargetingDecision { allowed: boolean; failedOn: TargetingKey | null }

export function evaluateTargeting(
  targeting: OfferTargeting | null | undefined,
  ctx: TargetingContext,
  avail: TargetingAvailability,
): TargetingDecision {
  if (!targeting) return { allowed: true, failedOn: null };
  for (const [key, rule] of Object.entries(targeting) as [TargetingKey, { mode: 'include' | 'exclude'; values: string[] }][]) {
    if (!rule || rule.values.length === 0 || !available(key, avail)) continue;
    const hit = rule.values.some((v) => matches(key, v, ctx));
    if (rule.mode === 'include' ? !hit : hit) return { allowed: false, failedOn: key };
  }
  return { allowed: true, failedOn: null };
}
