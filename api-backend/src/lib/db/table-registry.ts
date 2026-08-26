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
  offer_forwarding_rules: { tenantColumn: 'network_id' },
  offer_scheduled_actions: { tenantColumn: 'network_id' },
  tags: { tenantColumn: 'network_id' },
  taggings: { tenantColumn: 'network_id' },

  // Feature-depth Wave 2/3: network-defined custom fields.
  custom_field_defs: { tenantColumn: 'network_id' },

  // Feature-depth follow-up: smart links, offline import/export.
  smart_links: { tenantColumn: 'network_id' },
  smart_link_items: { tenantColumn: 'network_id' },
  import_export_logs: { tenantColumn: 'network_id' },

  // Offers-flyout parity: templates, groups, traffic controls, network-wide custom settings,
  // SmartSwitch rules + auto-logged history.
  offer_templates: { tenantColumn: 'network_id' },
  offer_groups: { tenantColumn: 'network_id' },
  traffic_controls: { tenantColumn: 'network_id' },
  offer_custom_settings: { tenantColumn: 'network_id' },
  smartswitch_rules: { tenantColumn: 'network_id' },
  smartswitch_history: { tenantColumn: 'network_id' },

  // Partner Tiers: payout margin + offer visibility groups.
  partner_tiers: { tenantColumn: 'network_id' },
  partner_tier_members: { tenantColumn: 'network_id' },
  partner_tier_offers: { tenantColumn: 'network_id' },

  // Offer Applications: approval workflow + reusable questionnaires.
  questionnaires: { tenantColumn: 'network_id' },
  questionnaire_fields: { tenantColumn: 'network_id' },

  // Traffic Blocking: per Partner+Offer sub-placement filter rules.
  traffic_blockings: { tenantColumn: 'network_id' },

  // Traffic Sources: reusable tracking-link parameter presets.
  traffic_sources: { tenantColumn: 'network_id' },

  // Reporting Adjustments: per-day manual overrides on top of real reported numbers.
  reporting_adjustments: { tenantColumn: 'network_id' },

  // Partner Invoices: Accounts Payable invoices generated per Partner/billing period.
  partner_invoices: { tenantColumn: 'network_id' },

  // Advertiser Link Templates: default landing page URL templates per Advertiser.
  advertiser_link_templates: { tenantColumn: 'network_id' },

  // Advertiser Postback Controls: rules that auto-accept/reject/hold incoming conversions.
  advertiser_postback_controls: { tenantColumn: 'network_id' },

  // Advertiser Invoices: Accounts Receivable invoices generated per Advertiser/billing period.
  advertiser_invoices: { tenantColumn: 'network_id' },

  // Advertiser Tiered Commissions: volume-based payout/revenue adjustment rules.
  advertiser_tiered_commissions: { tenantColumn: 'network_id' },

  // Custom Reporting Metrics: user-defined derived metrics (formula over the real base metrics).
  custom_metrics: { tenantColumn: 'network_id' },

  // Marketplace › Your Profile(s): one editable "how this network presents itself" row per network.
  marketplace_profiles: { tenantColumn: 'network_id' },

  // Communication Hub: email messages/templates/audiences + Partner Banners.
  email_templates: { tenantColumn: 'network_id' },
  audiences: { tenantColumn: 'network_id' },
  email_messages: { tenantColumn: 'network_id' },
  banners: { tenantColumn: 'network_id' },

  // Customer Value: Custom Data Points, Payout & Revenue Rules, and their real firing ledger.
  customer_data_points: { tenantColumn: 'network_id' },
  customer_value_rules: { tenantColumn: 'network_id' },
  customer_value_rule_firings: { tenantColumn: 'network_id' },
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
