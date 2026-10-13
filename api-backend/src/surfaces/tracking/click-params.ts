/**
 * Click-URL parameters captured verbatim onto the click (clicks.source_id / fbclid / gclid).
 * A blank or whitespace-only value is "not present" (NULL) — never stored as '' — and a blank
 * higher-precedence alias falls through to the next one (`source_id=&source=push` → "push").
 * Populated values are kept exactly as sent.
 */

/** Source aliases in precedence order (also what Traffic Blocking matches on). */
export const SOURCE_PARAMS = ['source_id', 'source', 'src'] as const;

/** null for undefined / null / blank / whitespace-only; otherwise the value unchanged. */
export function blankToNull(v: string | null | undefined): string | null {
  return v == null || v.trim() === '' ? null : v;
}

type Headers = Record<string, string | string[] | undefined>;
const headerValues = (h: Headers, name: string): string[] => {
  const v = h[name];
  return (Array.isArray(v) ? v : v == null ? [] : [v]).map((s) => s.toLowerCase());
};

/**
 * A browser SPECULATIVE load of the link — not a person clicking it. Chrome prefetches / prerenders
 * a URL pasted or typed into the address bar (and Speculation Rules links) before the real
 * navigation on Enter, sending `Sec-Purpose: prefetch` (or `prefetch;prerender`); older forms are
 * `Purpose: prefetch`, Safari's `X-Purpose: preview` and Firefox's `X-Moz: prefetch`. Counting it
 * recorded every pasted visit twice.
 */
export function isSpeculativeLoad(headers: Headers): boolean {
  return headerValues(headers, 'sec-purpose').some((v) => v.split(';').some((t) => t.trim() === 'prefetch'))
    || headerValues(headers, 'purpose').some((v) => v.trim() === 'prefetch')
    || headerValues(headers, 'x-purpose').some((v) => v.trim() === 'preview')
    || headerValues(headers, 'x-moz').some((v) => v.trim() === 'prefetch');
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
