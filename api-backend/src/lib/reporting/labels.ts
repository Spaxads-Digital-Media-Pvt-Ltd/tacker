/**
 * Entity names on report rows (audit F-20): the offer / partner / advertiser / smart link behind a
 * row's id dimensions, as `row.labels[dim] = { ref, name }` — so a report page needn't load every
 * entity of the network just to show names. One indexed lookup per entity dimension, for exactly the
 * ids on the page, scoped to the network. Works on any provider's result (Postgres or ClickHouse).
 */
import { query } from '../db/pool.js';
import type { ReportResult } from './types.js';

const TABLE: Record<string, string> = {
  offer: 'offers', publisher: 'publishers', advertiser: 'advertisers', smartLink: 'smart_links',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function attachLabels(networkId: string, result: ReportResult): Promise<ReportResult> {
  const dims = result.groupBy.filter((d) => d in TABLE);
  if (!dims.length || !result.rows.length) return result;
  const names = new Map<string, Map<string, { ref: number | null; name: string }>>();
  for (const d of dims) {
    const ids = Array.from(new Set(result.rows.map((r) => r.dimensions[d]).filter((v): v is string => !!v && UUID_RE.test(v))));
    const { rows } = ids.length
      ? await query<{ id: string; ref: string | null; name: string }>(
        `SELECT id::text AS id, ref::text AS ref, name FROM ${TABLE[d]} WHERE network_id = $1 AND id = ANY($2::uuid[])`,
        [networkId, ids])
      : { rows: [] };
    names.set(d, new Map(rows.map((r) => [r.id, { ref: r.ref == null ? null : Number(r.ref), name: r.name }])));
  }
  for (const row of result.rows) {
    row.labels = Object.fromEntries(dims.map((d) => {
      const id = row.dimensions[d];
      return [d, id ? names.get(d)!.get(id) ?? null : null];
    }));
  }
  return result;
}
