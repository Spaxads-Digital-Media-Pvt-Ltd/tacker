-- Purged networks (D3): after the grace period a soft-deleted network can be purged for good; its
-- money ledger stays (append-only — ledger_entries keep their network_id, which no network row backs
-- any more). This tombstone, written in the purge transaction, keeps who the network was and when it
-- went, so Super Admin › Networks can still list it and hand out its retained ledger (CSV).
-- Platform-level: no network_id FK (the network is gone) and not tenant-scoped.

-- Up Migration

CREATE TABLE purged_networks (
  id                       uuid PRIMARY KEY,            -- the purged network's id (= ledger_entries.network_id)
  name                     text NOT NULL,
  slug                     text NOT NULL,
  default_currency         text,
  created_at               timestamptz,
  deleted_at               timestamptz,
  exported_at              timestamptz,
  purged_at                timestamptz NOT NULL DEFAULT now(),
  purged_by                uuid,                         -- platform_admins.id
  ledger_entries_retained  integer NOT NULL DEFAULT 0,
  auth_users_deleted       integer NOT NULL DEFAULT 0,
  rows_deleted             jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX purged_networks_purged_at_idx ON purged_networks (purged_at DESC);

-- Down Migration

DROP TABLE IF EXISTS purged_networks;
