/**
 * Click-URL parameters captured verbatim onto the click (clicks.source_id / fbclid / gclid).
 * A blank or whitespace-only value is "not present" (NULL) — never stored as '' — and a blank
 * higher-precedence alias falls through to the next one (`source_id=&source=push` → "push").
 * Populated values are kept exactly as sent.
 */

import { isIP } from 'node:net';

/** Source aliases in precedence order (also what Traffic Blocking matches on). */
export const SOURCE_PARAMS = ['source_id', 'source', 'src'] as const;

/** A query / body value as a string — the first of a repeated param — else null. */
export function firstStr(v: unknown): string | null {
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

/** A plain IPv4 / IPv6 address, else null (a visitor IP passed on a server-to-server click, D2). */
export function asIp(v: string | null): string | null {
  const s = v?.trim() ?? '';
  return s && s.length <= 45 && isIP(s) ? s : null;
}

/** null for undefined / null / blank / whitespace-only; otherwise the value unchanged. */
export function blankToNull(v: string | null | undefined): string | null {
  return v == null || v.trim() === '' ? null : v;
}

/** First non-blank value among `keys` (first entry of a repeated param), or null. */
export function firstNonBlank(q: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const raw = q[k];
    const v = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : null;
    const value = blankToNull(v);
    if (value != null) return value;
  }
  return null;
}
