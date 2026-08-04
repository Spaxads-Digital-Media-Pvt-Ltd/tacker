import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Isolation suite must run in CI without external services (spec §3A) — keep it pure/unit.
    reporters: 'default',
    // Satisfy the fail-fast env validator (src/config/env.ts) without real infra. No connection
    // is opened at import time; these values are never dialed by the pure isolation tests.
    env: {
      NODE_ENV: 'test',
      // Overridden by the real env in CI/local when running DB-backed integration tests.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      // Fixed secret so tests can mint dashboard JWTs the auth middleware will accept.
      SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod',
      // Set to "1" (CI + local-with-DB) to run the live cross-tenant/cross-owner endpoint suite.
      INTEGRATION_DB: process.env.INTEGRATION_DB ?? '',
    },
  },
});
