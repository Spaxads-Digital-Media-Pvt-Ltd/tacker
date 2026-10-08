/**
 * Cross-tenant reference guard. Most FKs (users.id, publishers.id, offers.id …) are global, so the
 * database alone would accept another network's id in a create/update body. Call this for every
 * client-supplied foreign id before writing it.
 */
import { query } from './pool.js';
import { badRequest } from '../http/errors.js';

// partner_channels was folded into the Control Center catalog (segmentation_channels) — migration 065.
export type OwnedTable = 'users' | 'publishers' | 'advertisers' | 'offers' | 'partner_tiers' | 'segmentation_channels' | 'questionnaires' | 'tracking_domains';

export async function assertSameNetwork(
  networkId: string, table: OwnedTable, id: string | null | undefined, field: string,
): Promise<void> {
  if (!id) return;
  const { rows } = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND network_id = $2 LIMIT 1`, [id, networkId]);
  if (!rows.length) throw badRequest(`${field} does not belong to this network`);
}

/** Every id in `ids` must exist in `table` within this network — one count query per table. */
export async function assertAllSameNetwork(
  networkId: string, table: OwnedTable, ids: readonly string[] | null | undefined, field: string,
): Promise<void> {
  const unique = Array.from(new Set((ids ?? []).filter(Boolean)));
  if (!unique.length) return;
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE network_id = $1 AND id = ANY($2::uuid[])`,
    [networkId, unique],
  );
  if (Number(rows[0]?.n ?? 0) !== unique.length) throw badRequest(`${field} contains ids that do not belong to this network`);
}
