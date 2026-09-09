/**
 * ClickHouse analytics store (spec §2, §9, §10.1).
 *
 * Re-export the public surface — `getClickHouse`, `isClickHouseEnabled`, `pingClickHouse`,
 * `closeClickHouse` — so callers never need to know the internal module layout.
 */
export {
 getClickHouse,
 isClickHouseEnabled,
 pingClickHouse,
 closeClickHouse,
 createIsolatedClickHouseClient,
} from './client.js';

export { runMigrations } from './migrate.js';
