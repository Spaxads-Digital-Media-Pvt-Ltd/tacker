/**
 * Non-component helpers shared by the server-paged Manage Offers / Partners / Advertisers pages
 * (GET /api/offers|publishers|advertisers?paged=1 → PagedList<T>).
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { PagedList } from '../../types';

export type PagedParams = Record<string, string | number | boolean | readonly string[] | null | undefined>;

/** `base?paged=1&…` — arrays become REPEATED params (free-text values may contain commas), empty
 * values are dropped. */
export function pagedPath(base: string, params: PagedParams): string {
  const qs = new URLSearchParams({ paged: '1' });
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    if (Array.isArray(v)) { for (const x of v) if (x !== '') qs.append(k, x); continue; }
    qs.append(k, String(v));
  }
  return `${base}?${qs.toString()}`;
}

/** Most rows an export walks before stopping (200-row pages). */
export const EXPORT_MAX_ROWS = 10_000;
const EXPORT_PAGE_SIZE = 200;

/** Every row matching `params` (same filters/sort as the table), page by page, up to EXPORT_MAX_ROWS. */
export async function fetchAllPages<T>(base: string, params: PagedParams): Promise<{ rows: T[]; total: number; capped: boolean }> {
  const rows: T[] = [];
  let total = 0;
  for (let page = 1; rows.length < EXPORT_MAX_ROWS; page++) {
    const res = await api.get<PagedList<T>>(pagedPath(base, { ...params, page, pageSize: EXPORT_PAGE_SIZE }));
    total = res.total;
    rows.push(...res.rows);
    if (res.rows.length < EXPORT_PAGE_SIZE || rows.length >= total) break;
  }
  return { rows: rows.slice(0, EXPORT_MAX_ROWS), total, capped: total > EXPORT_MAX_ROWS };
}

/** `value`, settled for `ms` — keeps a fetch from firing on every keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Split a "sort:dir" value into the API's sort + dir params. */
export function sortParams(v: string): { sort: string; dir: 'asc' | 'desc' } {
  const [sort, dir] = v.split(':');
  return { sort: sort || 'createdAt', dir: dir === 'asc' ? 'asc' : 'desc' };
}
