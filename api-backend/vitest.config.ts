import { defineConfig } from 'vitest/config';

export default defineConfig({
 test: {
  environment: 'node',
  include: ['test/**/*.test.ts'],
  // supertest binds its test servers to 127.0.0.1 (not a wildcard socket another local process can
  // shadow) — test/setup/loopback.ts.
  setupFiles: ['test/setup/loopback.ts'],
  reporters: 'default',
  fileParallelism: false,
  // Integration tests run real Postgres / Redis / workers: 5 s flaked on a busy machine (dev servers up).
  testTimeout: 15_000,
  hookTimeout: 30_000,
  env: {
   NODE_ENV: 'test',
   // Tests never read the developer's .env (as in CI, which has none): its real keys — e.g. the Supabase
   // service-role key — would otherwise fill every var not pinned here. Test-only overrides go in .env.test.
   DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH ?? '.env.test',
   PLATFORM_ADMIN_JWT_SECRET: process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret-do-not-use-in-prod',
   // Test-only settings encryption key (32 bytes hex) — never use outside tests.
   SETTINGS_ENC_KEY: process.env.SETTINGS_ENC_KEY ?? '7465737420736574746e6773206b6579202d20646f206e6f74207573652121ff',
   IMPERSONATION_JWT_SECRET: process.env.IMPERSONATION_JWT_SECRET ?? 'impersonation-test-secret-do-not-use-in-prod',
   DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
   // A Redis database of the tests' own: a developer's running `npm run dev` workers (db 0) would
   // otherwise take the tests' BullMQ jobs (click-persist, email) and time tests out. CI sets REDIS_URL.
   REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379/15',
   SUPABASE_URL: process.env.SUPABASE_URL ?? 'https://test.supabase.co',
   SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod',
   INTEGRATION_DB: process.env.INTEGRATION_DB ?? '',
   // Reports read the raw tables unless a test opts in to the rollups (F-20 tests do, per provider).
   REPORTING_ROLLUPS: process.env.REPORTING_ROLLUPS ?? 'off',
  },
 },
});
