-- Phase 0 foundation migration: the tenant root table (`networks`) + extensions.
-- Indexes ship WITH the first migration of every table (spec §3B). Entity tables (users,
-- advertisers, publishers, offers, …) land in Phase 1; platform tables in Phase 1A.

-- Up Migration

-- gen_random_uuid() for UUID public IDs (spec §4). pgcrypto ships with Postgres/Supabase.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE networks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended', 'deleted')),
  default_currency text NOT NULL DEFAULT 'USD',
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Slug is the tenant's stable public handle (used for subdomain provisioning, spec §3D).
CREATE UNIQUE INDEX networks_slug_key ON networks (slug);
CREATE INDEX networks_status_idx ON networks (status);

-- Down Migration

DROP TABLE IF EXISTS networks;
-- pgcrypto left installed intentionally (other objects may depend on it).
