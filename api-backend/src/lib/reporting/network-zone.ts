/**
 * The network's report time zone — Settings › General › Timezone, UTC when unset or invalid. Reports
 * default to it (D7: the SPA reads it from GET /api/me), scheduled reports run in it, and the
 * dashboard tiles' "today" is its day.
 */
import { query } from '../db/pool.js';
import { isValidTimeZone } from './time-zone.js';

export async function networkTimeZone(networkId: string): Promise<string> {
  const { rows } = await query<{ tz: string | null }>(`SELECT settings->'general'->>'timezone' AS tz FROM networks WHERE id = $1`, [networkId]);
  const tz = rows[0]?.tz;
  return isValidTimeZone(tz) ? tz : 'UTC';
}
