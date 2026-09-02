/**
 * Pin API — user-provided network API key stored in integrations settings and mirrored into
 * api_keys so the Public REST API accepts it immediately (same hash lookup path as minted keys).
 */
import { query } from '../db/pool.js';
import { hashKey, AUDIENCE_SCOPES } from '../apikeys/keys.js';

const PIN_META = { pinApi: true };

export async function syncPinApiKey(networkId: string, ownerId: string, pinApiKey: string): Promise<void> {
  // Remove prior Pin API rows (revoked rows still occupy key_hash unique index).
  await query(
    `DELETE FROM api_keys
      WHERE network_id = $1 AND audience = 'network' AND metadata @> $2::jsonb`,
    [networkId, JSON.stringify(PIN_META)],
  );

  let resolvedOwner = ownerId;
  if (!resolvedOwner) {
    const { rows } = await query<{ auth_user_id: string }>(
      `SELECT auth_user_id FROM users WHERE network_id = $1 AND role = 'admin' LIMIT 1`,
      [networkId],
    );
    resolvedOwner = rows[0]?.auth_user_id ?? networkId;
  }

  const keyHash = hashKey(pinApiKey);
  const prefix = `net_pin_${keyHash.slice(0, 8)}`;
  await query(
    `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, name, scopes, metadata, status)
     VALUES ($1, 'network', $2, $3, $4, 'Pin API', $5, $6::jsonb, 'active')
     ON CONFLICT (key_hash) DO UPDATE SET
       network_id = EXCLUDED.network_id, owner_id = EXCLUDED.owner_id, key_prefix = EXCLUDED.key_prefix,
       name = EXCLUDED.name, scopes = EXCLUDED.scopes, metadata = EXCLUDED.metadata, status = 'active'`,
    [networkId, resolvedOwner, prefix, keyHash, AUDIENCE_SCOPES.network, JSON.stringify(PIN_META)],
  );
}

export async function revokePinApiKey(networkId: string): Promise<void> {
  await query(
    `UPDATE api_keys SET status = 'revoked'
      WHERE network_id = $1 AND audience = 'network' AND metadata @> $2::jsonb`,
    [networkId, JSON.stringify(PIN_META)],
  );
}
