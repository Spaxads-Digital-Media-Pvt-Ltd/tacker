-- Create the analytics database (spec §3B, §10.1).
-- Idempotent: safe to re-run. Phase 8 runs this before 0001/0002 when the cluster is fresh.

CREATE DATABASE IF NOT EXISTS tracker;
