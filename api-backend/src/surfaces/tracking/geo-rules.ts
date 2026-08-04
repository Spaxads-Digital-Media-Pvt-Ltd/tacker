/**
 * Geo-rule evaluation (spec §5 step 4, §7). Given an offer's geo rules and the click's country,
 * decide allow/deny and surface any geo-specific payout/revenue/destination overrides.
 *
 * Semantics:
 *  - No rules → allow.
 *  - Geo DB unavailable (dev/no mmdb) → FAIL-OPEN allow (can't evaluate country).
 *  - Exact country rule beats a '*' default rule.
 *  - No matching rule but allow-rules exist (allow-list mode) → deny (not on the list).
 */
import type { GeoRuleConfig } from './offer-cache.js';

export interface GeoDecision {
  allowed: boolean;
  payoutOverride: string | null;
  revenueOverride: string | null;
  destinationOverride: string | null;
}

const ALLOW: GeoDecision = { allowed: true, payoutOverride: null, revenueOverride: null, destinationOverride: null };

export function evaluateGeoRules(
  rules: GeoRuleConfig[],
  country: string | null,
  geoAvailable: boolean,
): GeoDecision {
  if (rules.length === 0) return ALLOW;
  if (!geoAvailable) return ALLOW; // fail-open when we genuinely can't determine geo

  const cc = (country ?? '').toUpperCase();
  const exact = rules.find((r) => r.country.toUpperCase() === cc);
  const wildcard = rules.find((r) => r.country === '*');
  const matched = exact ?? wildcard;

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
