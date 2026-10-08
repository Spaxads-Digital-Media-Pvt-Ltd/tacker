/**
 * Zod building blocks for list/report filter query strings, so every filter endpoint parses the
 * same way and invalid input becomes a 422 validation error (never a Postgres cast error → 500, never SQL text).
 *
 *   csvList(z.string().uuid())         "a,b"  → ['a','b']   (also accepts repeated ?x=a&x=b)
 *   queryBool                          "true"/"1" → true, "false"/"0" → false (z.coerce.boolean
 *                                      would turn "false" into true)
 *   queryDate                          ISO date or datetime, validated
 */
import { z, type ZodTypeAny } from 'zod';

const MAX_LIST = 200;

/** Comma-separated (or repeated) query param → validated, de-duplicated array; empty → undefined. */
export function csvList<T extends ZodTypeAny>(item: T) {
  return z.preprocess((v) => {
    if (v == null || v === '') return undefined;
    const raw = Array.isArray(v) ? v.flatMap((x) => String(x).split(',')) : String(v).split(',');
    const parts = Array.from(new Set(raw.map((s) => s.trim()).filter(Boolean)));
    return parts.length ? parts : undefined;
  }, z.array(item).max(MAX_LIST).optional());
}

export const queryBool = z.preprocess((v) => {
  if (v == null || v === '') return undefined;
  const s = String(Array.isArray(v) ? v[0] : v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return s; // left as a string so the boolean check rejects it with a clear message
}, z.boolean().optional());

/** True only for a real calendar day — Date.parse rolls 2024-02-30 over to March instead of failing. */
function realDay(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** YYYY-MM-DD or a full ISO-8601 datetime, on a real calendar day. */
export const queryDate = z.string().max(40).refine(
  (s) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s)) && realDay(s.slice(0, 10)),
  { message: 'must be an ISO date (YYYY-MM-DD) or datetime' },
);
