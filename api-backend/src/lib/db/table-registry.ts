/**
 * Registry describing how each table is scoped (spec §3A — structural tenant + owner scoping).
 *
 * `ScopedDb` consults this to decide which scope columns to inject. Phase 1+ adds an entry for
 * every new table. If a table is queried through ScopedDb without an entry here, ScopedDb
 * throws (deny-by-default — spec §3A) rather than silently running an unscoped query.
 *
 * - `tenantColumn`: column holding `network_id` (tenant isolation — always present).
 * - `ownerColumn`:  optional column holding the owner identity for owner-level isolation
 *                   (publisher_id / advertiser_id / user_id). When set, ScopedDb REQUIRES an
 *                   owner id in scope and injects it.
 */
export interface TableScope {
  tenantColumn: string;
  ownerColumn?: string;
}

export const TABLE_SCOPES: Record<string, TableScope> = {
  // The tenant row itself; tenant-scoped by its own id.
  networks: { tenantColumn: 'id' },

  // Phase 1 entities. All tenant-scoped by network_id. Owner-level isolation for portal
  // (publisher/advertiser) reads is applied EXPLICITLY in the portal repositories and covered by
  // the cross-owner test suite — these tables are also accessed network-wide by admins, so an
  // unconditional ownerColumn here would wrongly block admin access. See spec §3A.
  users: { tenantColumn: 'network_id' },
  advertisers: { tenantColumn: 'network_id' },
  publishers: { tenantColumn: 'network_id' },
  offers: { tenantColumn: 'network_id' },
  offer_geo_rules: { tenantColumn: 'network_id' },
  offer_publisher_access: { tenantColumn: 'network_id' },
  tracking_domains: { tenantColumn: 'network_id' },
  audit_log: { tenantColumn: 'network_id' },

  // Phase 1A per-network platform data (admins may read their own; platform admins access any
  // network's rows via raw queries in the platform surface, spec §3C). platform_admins and
  // subscription_plans are GLOBAL (no network_id) and intentionally NOT registered here.
  subscriptions: { tenantColumn: 'network_id' },
  usage_records: { tenantColumn: 'network_id' },

  // Phase 2. High-volume; written by the worker via raw batch inserts, read (reporting) via
  // ScopedDb with network_id.
  clicks: { tenantColumn: 'network_id' },

  // Phase 3.
  conversions: { tenantColumn: 'network_id' },
  publisher_postbacks: { tenantColumn: 'network_id' },
  postback_logs: { tenantColumn: 'network_id' },

  // Phase 4 (money). ledger_entries is append-only (DB trigger blocks UPDATE/DELETE).
  ledger_entries: { tenantColumn: 'network_id' },
  payout_batches: { tenantColumn: 'network_id' },
  payouts: { tenantColumn: 'network_id' },

  // Phase 4A.
  api_keys: { tenantColumn: 'network_id' },

  // Phase 6.
  alerts: { tenantColumn: 'network_id' },
  fraud_rules: { tenantColumn: 'network_id' },

  // Phase 7.
  ai_conversations: { tenantColumn: 'network_id' },
  ai_messages: { tenantColumn: 'network_id' },

  // Feature-depth Wave 1: offer assets + goals + tags (all tenant-scoped by network_id).
  offer_goals: { tenantColumn: 'network_id' },
  offer_creatives: { tenantColumn: 'network_id' },
  offer_coupons: { tenantColumn: 'network_id' },
  offer_deals: { tenantColumn: 'network_id' },
  tags: { tenantColumn: 'network_id' },
  taggings: { tenantColumn: 'network_id' },

  // Feature-depth Wave 2/3: network-defined custom fields.
  custom_field_defs: { tenantColumn: 'network_id' },

  // Feature-depth follow-up: smart links, offline import/export.
  smart_links: { tenantColumn: 'network_id' },
  smart_link_items: { tenantColumn: 'network_id' },
  import_export_logs: { tenantColumn: 'network_id' },
};

export function getTableScope(table: string): TableScope {
  const scope = TABLE_SCOPES[table];
  if (!scope) {
    throw new Error(
      `Table "${table}" is not registered in TABLE_SCOPES. ` +
        `Register its tenant/owner scoping before querying it (spec §3A deny-by-default).`,
    );
  }
  return scope;
}
