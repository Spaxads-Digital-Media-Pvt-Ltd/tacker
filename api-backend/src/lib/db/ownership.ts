/**
 * Cross-tenant reference guard. Most FKs (users.id, publishers.id, offers.id …) are global, so the
 * database alone would accept another network's id in a create/update body. Call this for every
 * client-supplied foreign id before writing it.
 */
import { query } from './pool.js';
import { badRequest } from '../http/errors.js';

type OwnedTable = 'users' | 'publishers' | 'advertisers' | 'offers' | 'partner_tiers' | 'partner_channels' | 'questionnaires' | 'tracking_domains';

export async function assertSameNetwork(
  networkId: string, table: OwnedTable, id: string | null | undefined, field: string,
): Promise<void> {
  if (!id) return;
  const { rows } = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND network_id = $2 LIMIT 1`, [id, networkId]);
  if (!rows.length) throw badRequest(`${field} does not belong to this network`);
}
