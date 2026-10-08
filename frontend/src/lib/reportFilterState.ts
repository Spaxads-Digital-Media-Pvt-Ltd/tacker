/** Report filter state helpers shared by the report pages (URL round-trip + stored-data cleaning). */
import type { FilterValues } from '../shared-components/primitives/CategorizedFilters';

/** Keep only `{ key: string[] }` entries — anything else in stored/URL data is dropped. */
export function cleanFilterValues(v: unknown): FilterValues {
  const out: FilterValues = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const vals = arr.filter((x): x is string => typeof x === 'string' && x !== '');
    if (vals.length) out[k] = vals;
  }
  return out;
}

/**
 * Report filter state ⇄ URL, so "Copy Link", reload and back/forward keep every applied filter:
 * filters as `f.<category>=a,b`, exclusions as `x.<category>=a,b`.
 */
export function readUrlFilters(sp: URLSearchParams, prefix: 'f' | 'x'): FilterValues {
  const out: FilterValues = {};
  sp.forEach((value, key) => {
    if (!key.startsWith(`${prefix}.`)) return;
    const vals = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (vals.length) out[key.slice(prefix.length + 1)] = vals;
  });
  return out;
}

export function writeUrlFilters(next: URLSearchParams, prefix: 'f' | 'x', values: FilterValues): void {
  for (const [k, vals] of Object.entries(values)) if (vals?.length) next.set(`${prefix}.${k}`, vals.join(','));
}

/** Strict calendar day (YYYY-MM-DD) — Date.parse would roll 2026-02-30 over into March. */
export function isYmd(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A report date param from the URL as YYYY-MM-DD: a datetime has its time portion stripped
 * (`2026-10-01T00:00:00.000Z` → `2026-10-01`); anything that isn't a real calendar day → `fallback`.
 */
export function readUrlDate(sp: URLSearchParams, key: string, fallback: string): string {
  const raw = sp.get(key);
  const day = raw ? raw.trim().split(/[T ]/)[0] : null;
  return isYmd(day) ? day : fallback;
}

/**
 * First non-empty value among several (legacy) id params — e.g. `offerId` (what the legacy
 * /app/reports/:type redirects and "Open … Report" links send) — as a de-duplicated id list.
 * Comma lists are split, so `offerId=a,b` → ['a', 'b'].
 */
export function readUrlIds(sp: URLSearchParams, ...keys: string[]): string[] {
  for (const k of keys) {
    const vals = sp.getAll(k).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
    if (vals.length) return Array.from(new Set(vals));
  }
  return [];
}

/** Metric filters ⇄ URL as `mf.<metric>=<op>:<value>` (e.g. `mf.clicks=>=:100`). */
export type UrlMetricOp = '>' | '>=' | '<' | '<=';
export type UrlMetricFilters = Partial<Record<string, { op: UrlMetricOp; value: string }>>;
const METRIC_OPS: UrlMetricOp[] = ['>=', '<=', '>', '<'];

export function readUrlMetricFilters<T extends UrlMetricFilters>(sp: URLSearchParams, allowedKeys: readonly string[]): T {
  const out: UrlMetricFilters = {};
  const allowed = new Set(allowedKeys);
  sp.forEach((raw, key) => {
    if (!key.startsWith('mf.')) return;
    const k = key.slice(3);
    if (!allowed.has(k)) return;
    const sep = raw.indexOf(':');
    if (sep < 0) return;
    const op = raw.slice(0, sep) as UrlMetricOp;
    const value = raw.slice(sep + 1).trim();
    if (!METRIC_OPS.includes(op) || value === '' || Number.isNaN(Number(value))) return;
    out[k] = { op, value };
  });
  return out as T;
}

export function writeUrlMetricFilters(next: URLSearchParams, mf: UrlMetricFilters): void {
  for (const [k, e] of Object.entries(mf)) if (e && e.value !== '' && !Number.isNaN(Number(e.value))) next.set(`mf.${k}`, `${e.op}:${e.value}`);
}

/** "Others › Ignore Fail Traffic" ⇄ URL as `ignoreFail=1`. */
export const IGNORE_FAIL_PARAM = 'ignoreFail';
export function readUrlFlag(sp: URLSearchParams, key: string): boolean {
  const v = sp.get(key);
  return v === '1' || v === 'true';
}

/**
 * Absolute link to the current page carrying `params` (empty values dropped; arrays become repeated
 * params). Params listed in `keep` (default: the analytics `tab`) are carried over from the current
 * URL so a link to a tabbed page reopens the same tab.
 */
export function reportLink(
  params: Record<string, string | number | boolean | null | undefined | readonly string[]>,
  keep: readonly string[] = ['tab'],
): string {
  const cur = new URLSearchParams(window.location.search);
  const next = new URLSearchParams();
  for (const k of keep) { const v = cur.get(k); if (v) next.set(k, v); }
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '' || v === false) continue;
    if (Array.isArray(v)) { for (const x of v as readonly string[]) if (x) next.append(k, x); continue; }
    next.set(k, v === true ? '1' : String(v));
  }
  const s = next.toString();
  return `${window.location.origin}${window.location.pathname}${s ? `?${s}` : ''}`;
}

/** Write `values` as `f.<category>` params into a plain object for `reportLink`. */
export function urlFilterParams(prefix: 'f' | 'x', values: FilterValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, vals] of Object.entries(values)) if (vals?.length) out[`${prefix}.${k}`] = vals.join(',');
  return out;
}
