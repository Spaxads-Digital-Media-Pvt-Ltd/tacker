/**
 * Tag dictionary helpers. Tags are unique per network by lower(name) (tags_network_name_key), so
 * lookups go straight to that index — never "load the list and search in JS", which silently missed
 * any tag past the ScopedDb list ceiling (500) and then hit the unique index as a 409 on re-create.
 */
import { query } from './pool.js';

export interface TagRow { id: string; network_id: string; name: string; color: string | null; created_at: string }

/** Find a tag by name (case-insensitive) in this network, creating it if missing — race-safe. */
export async function findOrCreateTag(networkId: string, name: string, color: string | null = null): Promise<TagRow> {
  const inserted = await query<TagRow>(
    `INSERT INTO tags (network_id, name, color) VALUES ($1, $2, $3)
     ON CONFLICT (network_id, lower(name)) DO NOTHING
     RETURNING *`,
    [networkId, name, color],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const { rows } = await query<TagRow>(
    `SELECT * FROM tags WHERE network_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [networkId, name],
  );
  return rows[0]!;
}
