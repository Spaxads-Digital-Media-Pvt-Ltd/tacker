/**
 * Geo-rule evaluation (spec §5 step 4, §7). Given an offer's geo rules and the click's country,
 * decide allow/deny and surface any geo-specific payout/revenue/destination overrides.
 *
 * Semantics:
 * - No rules → allow.
 * - Geo unknown (no GeoIP database, no override, no Cloudflare country) → FAIL-OPEN allow.
 * - The most specific rule wins: country + region ("US" + "CA", or "US-CA") › the country alone › '*'.
 *   A region is the ISO subdivision code the GeoIP database gives (US states "CA", "NY"; GB "ENG", "SCT"…).
 * - No matching rule but allow-rules exist (allow-list mode) → deny (not on the list). A click whose
 *   region is unknown never matches a region rule.
 */
import type { GeoRuleConfig } from './offer-cache.js';

export interface GeoDecision {
 allowed: boolean;
 payoutOverride: string | null;
 revenueOverride: string | null;
 destinationOverride: string | null;
}

const ALLOW: GeoDecision = { allowed: true, payoutOverride: null, revenueOverride: null, destinationOverride: null };

/** "us-ca" / "US-CA" / "CA" (for country US) → "CA"; blank → null. */
export function ruleRegion(country: string, region: string | null | undefined): string | null {
 const r = (region ?? '').trim().toUpperCase();
 if (!r) return null;
 const prefix = `${country.trim().toUpperCase()}-`;
 return r.startsWith(prefix) ? r.slice(prefix.length) : r;
}

export function evaluateGeoRules(
 rules: GeoRuleConfig[],
 country: string | null,
 geoAvailable: boolean,
 region: string | readonly (string | null)[] | null = null,
): GeoDecision {
 if (rules.length === 0) return ALLOW;
 if (!geoAvailable) return ALLOW; // fail-open when we genuinely can't determine geo

 const cc = (country ?? '').toUpperCase();
 // The click's region as code and / or name (the database may give either): a rule matches either.
 const regions = (Array.isArray(region) ? region : [region]).filter((x): x is string => !!x).map((x) => x.trim().toUpperCase());
 const forCountry = cc ? rules.filter((r) => r.country.toUpperCase() === cc) : [];
 const exactRegion = regions.length ? forCountry.find((r) => { const rr = ruleRegion(r.country, r.region); return rr !== null && regions.includes(rr); }) : undefined;
 const countryOnly = forCountry.find((r) => ruleRegion(r.country, r.region) === null);
 const wildcard = rules.find((r) => r.country === '*');
 const matched = exactRegion ?? countryOnly ?? wildcard;

 if (matched) {
 if (matched.action === 'deny') return { ...ALLOW, allowed: false };
 return {
 allowed: true,
 payoutOverride: matched.payoutOverride,
 revenueOverride: matched.revenueOverride,
 destinationOverride: matched.destinationOverride,
 };
 }

 // No match. If this offer uses an allow-list, an unmatched country is denied.
 const hasAllowList = rules.some((r) => r.action === 'allow');
 return { ...ALLOW, allowed: !hasAllowList };
}

/**
 * Resolve the country override from query params, enforcing the production boundary.
 * In production: always null (test_geo and geo are ignored — A-5 finding).
 * In dev/test: geo=XX takes priority, then test_geo=XX; uppercased 2-char code or null.
 */
export function resolveForcedGeo(
 nodeEnv: string,
 geoParam: string | null,
 testGeoParam: string | null,
): string | null {
 if (nodeEnv === 'production') return null;
 const raw = (geoParam ?? testGeoParam ?? '').trim();
 return raw.toUpperCase().slice(0, 2) || null;
}

/** The region part of a dev override `geo=US-CA` (dev / test only; null in production or without one). */
export function resolveForcedRegion(nodeEnv: string, geoParam: string | null, testGeoParam: string | null): string | null {
 if (nodeEnv === 'production') return null;
 const m = /^[A-Za-z]{2}-([A-Za-z0-9]{1,3})$/.exec((geoParam ?? testGeoParam ?? '').trim());
 return m ? m[1]!.toUpperCase() : null;
}
