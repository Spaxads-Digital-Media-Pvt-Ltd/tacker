/**
 * Real enforcement for Partners › Traffic Blocking (see dashboard/traffic-blocking/routes.ts for the
 * CRUD side) — evaluated against the click's own fields at /click. Rules ride along on the cached
 * OfferConfig (offer-cache.ts) so this stays off the synchronous-Postgres hot path (spec §5).
 *
 * A rule is per (offer, publisher). `filters` is keyed by click field with a per-field match; a
 * matching rule REJECTS the click (divert), the same outcome as a blacklist Traffic Control. Fields
 * are OR-combined within a rule — mirroring how Traffic Controls' blacklist matches on *any*
 * variable — so each enabled field acts as its own reject condition.
 *
 * Only the click fields the hot path already carries are matchable: sub1..sub5 and Source ID
 * (source_id / source / src query param). Rules on sub6..sub10 have no click-flow field yet and are
 * skipped (the dashboard hides those columns by default too).
 */
import type { TrafficBlockingConfig } from './offer-cache.js';

export interface BlockingClickFields {
  sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null;
  sourceId: string | null;
}

const MATCHERS: Record<string, (v: string, n: string) => boolean> = {
  begins_with: (v, n) => v.startsWith(n),
  contains: (v, n) => v.includes(n),
  does_not_contain: (v, n) => !v.includes(n),
  does_not_match: (v, n) => v !== n,
  ends_with: (v, n) => v.endsWith(n),
  exact_match: (v, n) => v === n,
};

function fieldMatches(value: string | null, matchType: string, needle: string | null): boolean {
  const v = (value ?? '').toLowerCase();
  if (matchType === 'is_empty') return v.length === 0;
  return MATCHERS[matchType]?.(v, (needle ?? '').toLowerCase()) ?? false;
}

/** True when an active Traffic Blocking rule for this publisher rejects the click. */
export function isTrafficBlocked(
  rules: TrafficBlockingConfig[], publisherId: string | null, fields: BlockingClickFields,
): boolean {
  if (!publisherId || rules.length === 0) return false;
  const supported: Record<string, string | null> = {
    sub1: fields.sub1, sub2: fields.sub2, sub3: fields.sub3, sub4: fields.sub4, sub5: fields.sub5,
    sourceId: fields.sourceId,
  };
  for (const rule of rules) {
    if (rule.publisherId !== publisherId) continue;
    for (const [key, f] of Object.entries(rule.filters)) {
      if (!(key in supported) || !f?.matchType) continue;
      if (fieldMatches(supported[key] ?? null, f.matchType, f.value)) return true;
    }
  }
  return false;
}
