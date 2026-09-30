/**
 * Short tracking-link ids. Offers and publishers carry a numeric `ref` (bigserial, never reused),
 * so links can use `offer_id=190&pub_id=6` instead of UUIDs. Resolution is Redis-first with a
 * load-through Postgres read on a miss — the same pattern as offer-cache.ts — and refs are
 * immutable, so a positive mapping never needs invalidating. Full UUIDs still pass straight through.
 */
import { query } from '../../lib/db/pool.js';
import { getRedis } from '../../lib/redis.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_RE = /^[1-9]\d{0,17}$/;
const TTL = 86_400;
const NEG = ' ';
const NEG_TTL = 30;

const TABLE = { offer: 'offers', publisher: 'publishers' } as const;
type Kind = keyof typeof TABLE;

async function lookupRef(kind: Kind, networkId: string, ref: string): Promise<string | null> {
  const redis = getRedis();
  const key = `${kind}ref:${networkId}:${ref}`;
  const cached = await redis.get(key);
  if (cached === NEG) return null;
  if (cached) return cached;
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM ${TABLE[kind]} WHERE network_id = $1 AND ref = $2::bigint LIMIT 1`,
    [networkId, ref],
  );
  const id = rows[0]?.id ?? null;
  if (id) await redis.set(key, id, 'EX', TTL);
  else await redis.set(key, NEG, 'EX', NEG_TTL);
  return id;
}

/** UUID → itself; numeric ref → the entity's UUID in this network; anything else → null. */
export async function resolveEntityId(kind: Kind, networkId: string, raw: string | null): Promise<string | null> {
  const v = raw?.trim();
  if (!v) return null;
  if (UUID_RE.test(v)) return v.toLowerCase();
  if (REF_RE.test(v)) return lookupRef(kind, networkId, v);
  return null;
}
