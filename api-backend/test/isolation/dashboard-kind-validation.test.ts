/**
 * JWT kind validation tests (A-4 finding) — no DB needed.
 *
 * Proves that dashboardAuth rejects:
 * - Tokens with no kind claim → next(err) with 401
 * - Tokens with an unknown kind → next(err) with 401
 * - Valid kind=admin/publisher/advertiser → sets req.identity (success path)
 *
 * vi.mock at the TOP LEVEL so it's registered once before any test runs and survives
 * module resets. A global slot holds the per-test mock payload.
 */
declare global {
 // eslint-disable-next-line no-var
 var __mockPayload: unknown;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, NextFunction } from 'express';

vi.mock('../../src/config/env.js', () => ({
 SUPABASE_JWT_SECRET: 'test-secret',
 SUPABASE_URL: 'http://localhost',
}));
vi.mock('../../src/lib/auth/verify-jwt.js', () => ({
 verifySupabaseJwt: async () => globalThis.__mockPayload,
}));

describe('Dashboard kind validation (A-4)', () => {
 beforeEach(() => {
 vi.resetModules();
 (globalThis as typeof globalThis & { __mockPayload?: unknown }).__mockPayload = undefined;
 });

 async function runAuth(
 payload: { sub: string; app_metadata: Record<string, string> },
 ): Promise<{ errorStatus?: number; identityKind?: string }> {
 (globalThis as typeof globalThis & { __mockPayload?: unknown }).__mockPayload = payload;

 const { dashboardAuth: da } = await import('../../src/surfaces/dashboard/auth.js');

 const req = { header: (_k: string) => 'Bearer fake-token' } as unknown as Request;
 let errorStatus: number | undefined;
 const next = ((err?: unknown) => {
 if (err instanceof Error) {
 const s = (err as unknown as { status?: number }).status;
 if (typeof s === 'number') errorStatus = s;
 }
 }) as unknown as NextFunction;
 await (da as (r: Request, _res: unknown, n: NextFunction) => Promise<void>)(req, {}, next);
 const identityKind = (req as { identity?: { kind?: string } }).identity?.kind;
 return { errorStatus, identityKind };
 }

 it('rejects a token with no kind claim', async () => {
 const { errorStatus } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: '' } });
 expect(errorStatus).toBe(401);
 });

 it('rejects a token with an unknown kind (superuser)', async () => {
 const { errorStatus } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: 'superuser' } });
 expect(errorStatus).toBe(401);
 });

 it('accepts a token with kind=admin', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: 'admin', role: 'admin' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('admin');
 });

 it('accepts kind=publisher (portal)', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: 'publisher', owner_id: 'pub-1' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('publisher');
 });

 it('accepts kind=advertiser (portal)', async () => {
 const { errorStatus, identityKind } = await runAuth({ sub: 'u1', app_metadata: { network_id: 'n1', kind: 'advertiser', owner_id: 'adv-1' } });
 expect(errorStatus).toBeUndefined();
 expect(identityKind).toBe('advertiser');
 });
});
