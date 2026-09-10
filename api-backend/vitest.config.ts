import { defineConfig } from 'vitest/config';

export default defineConfig({
 test: {
 environment: 'node',
 include: ['test/**/*.test.ts'],
 reporters: 'default',
 env: {
 NODE_ENV: 'test',
 PLATFORM_ADMIN_JWT_SECRET: process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret-do-not-use-in-prod',
 DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
 REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
 SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod',
 INTEGRATION_DB: process.env.INTEGRATION_DB ?? '',
 },
 },
});
