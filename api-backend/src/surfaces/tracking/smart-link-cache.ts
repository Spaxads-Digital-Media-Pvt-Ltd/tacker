/**
 * Smart-link config for /sl, from Redis (load-through, like offer-cache.ts) — audit F-17b: the
 * resolver no longer reads Postgres per request. Busted by the smart-link CRUD and by the KPI worker
 * after it stores new weights; the TTL bounds anything else.
 */
import { getRedis } from '../../lib/redis.js';
import { query } from '../../lib/db/pool.js';

const TTL = 300;
const NEG = ' ';
const NEG_TTL = 60;

export interface SmartLinkItemConfig {
  offerId: string;
  weight: number;
  /** Computed by the KPI worker for KPI links (null = not yet → plain rotation). */
  kpiWeight: number | null;
  position: number | null;
  country: string | null;
}

export interface SmartLinkConfig {
  id: string;
  status: string;
  mechanism: 'kpi' | 'priority' | 'weight';
  catchAllOfferId: string | null;
  items: SmartLinkItemConfig[];
}

const key = (networkId: string, id: string) => `slcfg:${networkId}:${id}`;

export async function invalidateSmartLinkConfig(networkId: string, id: string): Promise<void> {
  await getRedis().del(key(networkId, id));
}

export async function getSmartLinkConfig(networkId: string, id: string): Promise<SmartLinkConfig | null> {
  const redis = getRedis();
  const cached = await redis.get(key(networkId, id));
  if (cached === NEG) return null;
  if (cached) return JSON.parse(cached) as SmartLinkConfig;

  const { rows } = await query<{ id: string; status: string; redirect_mechanism: SmartLinkConfig['mechanism']; catch_all_offer_id: string | null }>(
    'SELECT id, status, redirect_mechanism, catch_all_offer_id FROM smart_links WHERE id = $1 AND network_id = $2',
    [id, networkId]);
  const link = rows[0];
  if (!link) {
    await redis.set(key(networkId, id), NEG, 'EX', NEG_TTL);
    return null;
  }
  const items = await query<{ offer_id: string; weight: number; kpi_weight: number | null; position: number | null; country: string | null }>(
    `SELECT offer_id, weight, kpi_weight, position, country FROM smart_link_items
      WHERE smart_link_id = $1 AND network_id = $2 ORDER BY created_at, id`,
    [id, networkId]);
  const cfg: SmartLinkConfig = {
    id: link.id, status: link.status, mechanism: link.redirect_mechanism, catchAllOfferId: link.catch_all_offer_id,
    items: items.rows.map((i) => ({ offerId: i.offer_id, weight: i.weight, kpiWeight: i.kpi_weight, position: i.position, country: i.country })),
  };
  await redis.set(key(networkId, id), JSON.stringify(cfg), 'EX', TTL);
  return cfg;
}
