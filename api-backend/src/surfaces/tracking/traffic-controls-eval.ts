/**
 * Real enforcement for Offers › Traffic Controls (see dashboard/traffic-controls/routes.ts for the
 * CRUD side) — evaluated against the click's own fields at /click. Rules ride along on the cached
 * OfferConfig (offer-cache.ts) so this stays off the synchronous-Postgres hot path (spec §5).
 */
import type { TrafficControlConfig } from './offer-cache.js';

export interface ClickFields {
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  referrer: string | null; ip: string | null; country: string | null;
  device: string | null; os: string | null; browser: string | null; userAgent: string | null;
}

function fieldValue(fields: ClickFields, variable: string): string | null {
  switch (variable) {
    case 'sub1': return fields.sub1;
    case 'sub2': return fields.sub2;
    case 'sub3': return fields.sub3;
    case 'sub4': return fields.sub4;
    case 'sub5': return fields.sub5;
    case 'referrer': return fields.referrer;
    case 'ip': return fields.ip;
    case 'country': return fields.country;
    case 'device': return fields.device;
    case 'os': return fields.os;
    case 'browser': return fields.browser;
    case 'user_agent': return fields.userAgent;
    default: return null;
  }
}

function matchesOne(value: string | null, method: string, needle: string): boolean {
  const v = (value ?? '').toLowerCase();
  const n = needle.toLowerCase();
  switch (method) {
    case 'begins_with': return v.startsWith(n);
    case 'contains': return v.includes(n);
    case 'not_contains': return !v.includes(n);
    case 'not_match': return v !== n;
    case 'ends_with': return v.endsWith(n);
    case 'exact_match': return v === n;
    default: return false;
  }
}

/** True if this rule's condition is met by the click (before Blacklist/Whitelist inversion). */
function conditionMet(fields: ClickFields, rule: TrafficControlConfig): boolean {
  if (rule.comparisonMethod === 'is_empty') {
    return rule.variables.some((v) => !fieldValue(fields, v));
  }
  if (!rule.comparisonMethod || rule.values.length === 0) return false;
  return rule.variables.some((v) => {
    const val = fieldValue(fields, v);
    return rule.values.some((needle) => matchesOne(val, rule.comparisonMethod!, needle));
  });
}

/** Returns the first rule that should divert this click, or null if none apply. */
export function evaluateTrafficControls(
  rules: TrafficControlConfig[], fields: ClickFields, publisherId: string | null,
): TrafficControlConfig | null {
  const now = Date.now();
  for (const rule of rules) {
    if (rule.effectiveFrom && now < Date.parse(rule.effectiveFrom)) continue;
    if (rule.effectiveTo && now > Date.parse(rule.effectiveTo)) continue;
    if (rule.partnerScope === 'specific' && (!publisherId || !rule.partnerIds.includes(publisherId))) continue;
    if (rule.variables.length === 0) continue;

    const met = conditionMet(fields, rule);
    const diverts = rule.controlType === 'blacklist' ? met : !met;
    if (diverts) return rule;
  }
  return null;
}
