/**
 * Paging through `/api/reports` (and the detail list endpoints) past the API's 200-row page cap —
 * pure, so `node --test` runs the real code (lib/__tests__/reportPaging.test.ts). Used by
 * ReportPageKit's `fetchAllPages` (exports) and `useGraphRows` (every Performance Graph).
 */

/** The API's page-size ceiling (api-backend lib/http/pagination.ts MAX_PAGE_SIZE). */
export const REPORT_PAGE_SIZE = 200;

/**
 * Max day (or hour) points a Performance Graph pages in. A single `limit=200` request kept only the
 * oldest 200 active days (the API orders a day/hour series chronologically) and silently dropped
 * every newer one; past this cap the graph says so instead (`graphCappedNote`).
 */
export const GRAPH_DAY_CAP = 1000;

/** One page: a plain array (detail endpoints) or `{ rows, total }` (/api/reports). */
export type PageResponse<T> = T[] | { rows?: T[]; total?: number } | null | undefined;

/**
 * Fetch pages sequentially (so a big load never floods the API) until the source is exhausted or
 * `cap` rows are collected. `capped` is true only when rows were left behind (or may have been —
 * a source without `total` that filled exactly `cap`).
 */
export async function pageThrough<T>(
  get: (limit: number, offset: number) => Promise<PageResponse<T>>,
  pageSize: number,
  cap: number,
): Promise<{ rows: T[]; capped: boolean; total: number | null }> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < cap; offset += pageSize) {
    const limit = Math.min(pageSize, cap - offset);
    const res = await get(limit, offset);
    const page = Array.isArray(res) ? res : (res?.rows ?? []);
    if (!Array.isArray(res) && typeof res?.total === 'number') total = res.total;
    rows.push(...page);
    if (page.length < limit) return { rows, capped: false, total };
    if (total != null && rows.length >= total) return { rows, capped: false, total };
  }
  // Collected exactly `cap` rows — capped unless the source is known to hold no more.
  return { rows, capped: total == null || total > rows.length, total };
}

/** The note a capped Performance Graph shows above the chart. */
export function graphCappedNote(shown: number, unit: 'days' | 'hours'): string {
  return `Graph shows the first ${shown.toLocaleString('en-US')} ${unit} — narrow the date range to see the rest.`;
}
