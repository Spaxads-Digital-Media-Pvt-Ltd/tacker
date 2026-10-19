/**
 * Partner status for the tracking surface (audit F-08). A pub_id used to be trusted as-is — a UUID
 * resolved to itself without checking the partner exists or is active — so pending, inactive and
 * made-up partners all booked approved conversions and ledger credits.
 *
 * Same load-through pattern as offer-cache.ts / ref-resolver.ts: Redis first, Postgres only on a
 * cold key (positive TTL 5 min, unknown partners cached briefly). The dashboard busts the key on
 * every status write (publishers PATCH / DELETE), so a status change applies on the next click.
 */
import { query } from '../../lib/db/pool.js';
import { getRedis } from '../../lib/redis.js';

const TTL = 300;
const NEG = ' ';
const NEG_TTL = 30;

export type PartnerStatus = 'active' | 'pending' | 'inactive';

export const partnerStatusKey = (networkId: string, publisherId: string) => `pubstatus:${networkId}:${publisherId}`;

/** The partner's status in this network, or null when no such partner exists here. */
export async function getPartnerStatus(networkId: string, publisherId: string): Promise<PartnerStatus | null> {
  const redis = getRedis();
  const key = partnerStatusKey(networkId, publisherId);
  const cached = await redis.get(key);
  if (cached === NEG) return null;
  if (cached) return cached as PartnerStatus;
  const { rows } = await query<{ status: PartnerStatus }>(
    'SELECT status FROM publishers WHERE network_id = $1 AND id = $2', [networkId, publisherId],
  );
  const status = rows[0]?.status ?? null;
  if (status) await redis.set(key, status, 'EX', TTL);
  else await redis.set(key, NEG, 'EX', NEG_TTL);
  return status;
}

/** Only an active partner of this network can earn. */
export async function isActivePartner(networkId: string, publisherId: string): Promise<boolean> {
  return (await getPartnerStatus(networkId, publisherId)) === 'active';
}

/** Bust the cached status after a partner's status changes or the partner is deleted. */
export async function invalidatePartnerStatus(networkId: string, publisherId: string): Promise<void> {
  await getRedis().del(partnerStatusKey(networkId, publisherId));
}
