/**
 * JWT kind validation tests (A-4 finding) — no DB needed.
 *
 * Proves that dashboardAuth rejects:
 * - Tokens with no kind claim → next(err) with 401
 * - Tokens with an unknown kind → next(err) with 401
 * - Valid kind=admin/publisher/advertiser → sets req.identity (success path)
 * - Tokens whose network_id no longer exists (deleted network) → 401, not a later FK 23503
 *
 * vi.mock at the TOP LEVEL so it's registered once before any test runs and survives
 * module resets. A global slot holds the per-test mock payload.
 */
declare global {
 // eslint-disable-next-line no-var
 var __mockPayload: unknown;
 // eslint-disable-next-line no-var
 var __existingNetworks: Set<string>;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, NextFunction } from 'express';

const NET = '11111111-1111-4111-8111-111111111111';
const DELETED_NET = '00000000-0000-4000-8000-000000000001';

vi.mock('../../src/config/env.js', () => ({
 SUPABASE_JWT_SECRET: 'test-secret',
 SUPABASE_URL: 'http://localhost',
}));
vi.mock('../../src/lib/auth/verify-jwt.js', () => ({
 verifySupabaseJwt: async () => globalThis.__mockPayload,
}));
vi.mock('../../src/lib/db/pool.js', () => ({
 query: async (sql: string, params: unknown[]) => {
 if (/FROM networks WHERE id = \$1/.test(sql)) {
 const rows = globalThis.__existingNetworks.has(String(params[0])) ? [{ '?column?': 1 }] : [];
 return { rows, rowCount: rows.length };
 }
 return { rows: [], rowCount: 0 };
 },
}));

describe('Dashboard kind validation (A-4)', () => {
 beforeEach(() => {
 vi.resetModules();
 (globalThis as typeof globalThis & { __mockPayload?: unknown }).__mockPayload = undefined;
 globalThis.__existingNetworks = new Set([NET]);
 });

 async function runAuth(
 payload: { sub: string; app_metadata: Record<string, string> },
 ): Promise<{ errorStatus?: number; errorMessage?: string; identityKind?: string }> {
 (globalThis as typeof globalThis & { __mockPayload?: unknown }).__mockPayload = payload;

 const { dashboardAuth: da } = await import('../../src/surfaces/dashboard/auth.js');

 const req = { header: (_k: string) => 'Bearer fake-token' } as unknown as Request;
 let errorStatus: number | undefined;
 let errorMessage: string | undefined;
 const next = ((err?: unknown) => {
 if (err instanceof Error) {
 errorMessage = err.message;
 const s = (err as unknown as { status?: number }).status;
 if (typeof s === 'number') errorStatus = s;
 }
 }) as unknown as NextFunction;
 await (da as (r: Request, _res: unknown, n: NextFunction) => Promise<void>)(req, {}, next);
 const identityKind = (req as { identity?: { kind?: string } }).identity?.kind;
 return { errorStatus, errorMessage, identityKind };
 }

 it('rejects a token with no kind claim', async () => {
 const { errorStatus } = await runAuth({ sub: 'u1', app_metadata: { network_id: NET, kind: '' } });
 expect(errorStatus).toBe(401);
 });

 it('rejects a token with an unknown kind (superuser)', async () => {
 const { errorStatus } = await runAuth({ sub: 'u1', app_metadata: { network_id: NET, kind: 'superuser' } });
 expect(errorStatus).toBe(401);
 });

 it('accepts a token with kind=admin', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: NET, kind: 'admin', role: 'admin' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('admin');
 });

 it('accepts kind=publisher (portal)', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: NET, kind: 'publisher', owner_id: 'pub-1' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('publisher');
 });

 it('accepts kind=advertiser (portal)', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: NET, kind: 'advertiser', owner_id: 'adv-1' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('advertiser');
 });

 // Regression: an admin login whose network was deleted could still call POST /api/advertisers;
 // the INSERT failed on advertisers_network_id_fkey and the user saw "still in use by other records".
 it('rejects an admin token whose network no longer exists (deleted network)', async () => {
 const { errorStatus, errorMessage, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: DELETED_NET, kind: 'admin', role: 'admin' } });
 expect(errorStatus).toBe(401);
 expect(errorMessage).toMatch(/network that no longer exists/);
 expect(identityKind).toBeUndefined();
 });

 it('rejects a portal token whose network no longer exists', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: DELETED_NET, kind: 'advertiser', owner_id: 'adv-1' } });
 expect(errorStatus).toBe(401);
 expect(identityKind).toBeUndefined();
 });

 it('rejects a non-uuid network_id claim', async () => {
 const { errorStatus } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: 'admin', role: 'admin' } });
 expect(errorStatus).toBe(401);
 });
});
