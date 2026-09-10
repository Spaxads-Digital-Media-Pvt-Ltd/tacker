/**
 * HTTP-level integration tests for platform-admin auth (A-1 finding).
 *
 * Proves the A-1 boundary with actual HTTP requests against the built Express app:
 * - Valid platform-admin JWT → GET /platform/me → 200 + identity
 * - Tenant Supabase JWT (forged kind=platform_admin) → 401 (not 200)
 * - Wrong-secret HS256 JWT → 401
 * - Expired token → 401
 * - No token at all → 401
 * - Inactive admin (DB) → 403
 *
 * The critical assertion: a Supabase tenant JWT signed with SUPABASE_JWT_SECRET
 * but carrying forged kind=platform_admin MUST be rejected. This was the actual
 * vulnerability — verifySupabaseJwt was being used for both tenant and platform-admin paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { closeDb } from '../../src/lib/db/pool.js';
import { canConnect } from '../helpers/db.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

const PA_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret-do-not-use-in-prod';
const SUPABASE_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-prod';

let app: Express;

async function me(token: string | null): Promise<{ status: number; body: unknown }> {
 const res = token
 ? await request(app).get('/platform/me').set('Authorization', `Bearer ${token}`)
 : await request(app).get('/platform/me');
 const parsed = JSON.parse(res.text);
 return { status: res.status, body: parsed };
}

d('Platform-admin auth HTTP boundary (A-1)', () => {
 beforeAll(async () => {
 if (!(await canConnect())) throw new Error('Postgres unreachable — skip DB-backed A-1 HTTP tests');
 app = buildPlatformAdminApp();
 });

 afterAll(async () => {
 await closeDb();
 });

 // --- Valid token ---
 it('valid platform-admin JWT returns 200 with identity', async () => {
 const adminId = 'test-pa-http-1';
 await query(
 `INSERT INTO platform_admins (id, email, status, auth_provider, password_hash)
 VALUES ($1, $2, 'active', 'local', $3)
 ON CONFLICT (id) DO UPDATE SET status = 'active', auth_provider = 'local'`,
 [adminId, `pa-http-1@test.local`, await hashPassword('test-pass-1')],
 );
 const token = await signPlatformAdminToken(adminId);
 const { status, body } = await me(token);
 expect(status).toBe(200);
 expect((body as { ok: boolean }).ok).toBe(true);
 expect((body as { data: { identity: { platformAdminId: string } } }).data.identity.platformAdminId).toBe(adminId);
 });

 // --- Tenant Supabase JWT with forged kind=platform_admin (THE actual vulnerability) ---
 it('REJECTS a tenant Supabase JWT even with forged kind=platform_admin', async () => {
 const tenantToken = jwt.sign(
 { sub: 'any-user', network_id: 'net-1', kind: 'platform_admin', role: 'admin' },
 SUPABASE_SECRET,
 { expiresIn: '1h' },
 );
 const { status } = await me(tenantToken);
 expect(status).toBe(401);
 });

 // --- Wrong secret ---
 it('REJECTS a token signed with a different secret', async () => {
 const wrongSecretToken = jwt.sign(
 { pa_sub: 'admin-1', kind: 'platform_admin', iss: 'tracker-platform-admin' },
 'completely-wrong-secret',
 { expiresIn: '1h' },
 );
 const { status } = await me(wrongSecretToken);
 expect(status).toBe(401);
 });

 // --- Expired token ---
 it('REJECTS an expired token', async () => {
 const expiredToken = jwt.sign(
 { pa_sub: 'admin-1', kind: 'platform_admin', iss: 'tracker-platform-admin' },
 PA_SECRET,
 { expiresIn: -1 },
 );
 const { status } = await me(expiredToken);
 expect(status).toBe(401);
 });

 // --- Missing token ---
 it('REJECTS requests with no authorization header', async () => {
 const { status } = await me(null);
 expect(status).toBe(401);
 });

 // --- Inactive admin (DB membership gate) ---
 it('REJECTS an inactive admin (403 after valid token)', async () => {
 const adminId = 'test-pa-http-inactive';
 await query(
 `INSERT INTO platform_admins (id, email, status, auth_provider, password_hash)
 VALUES ($1, $2, 'suspended', 'local', $3)
 ON CONFLICT (id) DO UPDATE SET status = 'suspended'`,
 [adminId, `pa-inactive@test.local`, await hashPassword('test-pass-2')],
 );
 const token = await signPlatformAdminToken(adminId);
 const { status } = await me(token);
 expect(status).toBe(403);
 });
});
