/**
 * Server-side paged entity lists (Manage Offers / Partners / Advertisers).
 *
 * The plain `GET /api/offers|publishers|advertisers` keeps returning the whole (capped) array that
 * every picker in the SPA relies on. A caller that sends `?paged=1` instead gets ONE page of the
 * filtered, sorted set plus its metadata:
 *
 *   { ok: true, data: { rows: DTO[], total, page, pageSize, counts: { [group]: { [key]: n } } } }
 *
 * The SQL builders that use these helpers are pure (they return SQL text + a params array, with the
 * caller's network id ALWAYS `$1`), so they are unit-testable without a database. Every user value is
 * bound as a `$n` parameter; sort columns come from a whitelist map, never from the request.
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE } from './pagination.js';
import { query } from '../db/pool.js';

export const PAGED_DEFAULT_PAGE_SIZE = 50;
/** Deepest page a caller can ask for — keeps OFFSET bounded (200 × 10 000 = 2M rows). */
export const PAGED_MAX_PAGE = 10_000;

/** True when the request asked for the paged contract (`?paged=1|true`). */
export function isPagedRequest(rawQuery: Record<string, unknown>): boolean {
  const v = rawQuery['paged'];
  const s = String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase();
  return s === '1' || s === 'true';
}

/** Repeated (or single) free-text query values taken LITERALLY — no comma splitting and no trimming,
 * because they are exact stored values (a country name or payment term may contain commas). */
export function textList(max = 200) {
  return z.preprocess((v) => {
    if (v == null || v === '') return undefined;
    const raw = (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter((x) => x.trim() !== '');
    const parts = Array.from(new Set(raw));
    return parts.length ? parts : undefined;
  }, z.array(z.string().max(max)).max(MAX_PAGE_SIZE).optional());
}

/** Common paging/sort fields; each entity adds its own filters and its own sort enum. */
export function pagedBase<S extends readonly [string, ...string[]]>(sortKeys: S, defaultSort: S[number]) {
  return {
    paged: z.unknown().optional(),
    page: z.coerce.number().int().min(1).max(PAGED_MAX_PAGE).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGED_DEFAULT_PAGE_SIZE),
    sort: z.enum(sortKeys).default(defaultSort as never),
    dir: z.enum(['asc', 'desc']).default('desc'),
  };
}

/** Positional parameter collector: `$1` is always the network id. */
export class SqlParams {
  readonly values: unknown[];
  constructor(networkId: string) { this.values = [networkId]; }
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

export interface BuiltQuery { sql: string; params: unknown[] }
export interface BuiltPagedList {
  /** One page: `<select> <from> WHERE … ORDER BY … LIMIT $x OFFSET $y`. */
  page: BuiltQuery;
  /** Total of the filtered set — same FROM + WHERE (and same params) as `page`. */
  total: BuiltQuery;
  /** Badge/tab counts, each `SELECT key, n` grouped rows. */
  counts: Record<string, BuiltQuery>;
}

export interface PagedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, Record<string, number>>;
}

/**
 * Assemble the page + total queries from one WHERE. `orderBy` must be built from a whitelist by the
 * caller; a stable `id` tie-break is appended so equal sort keys never shuffle between pages.
 */
export function assemblePaged(opts: {
  select: string;
  from: string;
  where: string[];
  params: SqlParams;
  orderExpr: string;
  dir: 'asc' | 'desc';
  idExpr: string;
  page: number;
  pageSize: number;
}): { page: BuiltQuery; total: BuiltQuery } {
  const whereSql = opts.where.length ? `WHERE ${opts.where.join('\n   AND ')}` : '';
  const baseParams = [...opts.params.values];
  const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
  const limitIdx = baseParams.length + 1;
  return {
    page: {
      sql: `SELECT ${opts.select}\n  FROM ${opts.from}\n  ${whereSql}\n ORDER BY ${opts.orderExpr} ${dir} NULLS LAST, ${opts.idExpr} ${dir}\n LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
      params: [...baseParams, opts.pageSize, (opts.page - 1) * opts.pageSize],
    },
    total: {
      sql: `SELECT COUNT(*)::text AS n\n  FROM ${opts.from}\n  ${whereSql}`,
      params: baseParams,
    },
  };
}

/** A grouped count query (`SELECT <keyExpr> AS k, COUNT(*) …`) over its own WHERE. */
export function groupedCount(from: string, where: string[], params: SqlParams, keyExpr: string): BuiltQuery {
  const whereSql = where.length ? `WHERE ${where.join('\n   AND ')}` : '';
  return {
    sql: `SELECT ${keyExpr} AS k, COUNT(*)::text AS n\n  FROM ${from}\n  ${whereSql}\n GROUP BY 1`,
    params: [...params.values],
  };
}

/** Run a built paged list (page + total + counts in parallel) and map rows to DTOs. */
export async function runPagedList<R, T>(
  built: BuiltPagedList,
  q: { page: number; pageSize: number },
  toDto: (row: R) => T,
): Promise<PagedResult<T>> {
  const countEntries = Object.entries(built.counts);
  const [pageRes, totalRes, ...countRes] = await Promise.all([
    query(built.page.sql, built.page.params),
    query<{ n: string }>(built.total.sql, built.total.params),
    ...countEntries.map(([, c]) => query<{ k: string | null; n: string }>(c.sql, c.params)),
  ]);
  const counts: Record<string, Record<string, number>> = {};
  countEntries.forEach(([name], i) => {
    const group: Record<string, number> = {};
    for (const row of countRes[i]!.rows) if (row.k != null) group[row.k] = Number(row.n);
    counts[name] = group;
  });
  return {
    rows: (pageRes.rows as R[]).map(toDto),
    total: Number(totalRes.rows[0]?.n ?? 0),
    page: q.page,
    pageSize: q.pageSize,
    counts,
  };
}
