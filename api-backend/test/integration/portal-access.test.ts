/**
 * Partner / advertiser access ends at once (O6) — on a real Postgres (INTEGRATION_DB=1) with Supabase
 * Auth replaced by an in-memory fake of the admin API.
 *
 * The account row decides (lib/auth/portal-state.ts): set an account inactive and its portal session
 * and API keys are refused on their next request; delete it and they are gone for good. The login
 * follows — blocked while inactive, deleted with the account. Pending accounts keep access (they sign
 * in to follow their application). An admin can still impersonate an inactive account, not a deleted one.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

const sb = vi.hoisted(() => ({ calls: [] as { op: string; id: string; attrs?: Record<string, unknown> }[], configured: true }));
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => {
    if (!sb.configured) throw new Error('Supabase admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return {
      auth: {
        admin: {
          updateUserById: async (id: string, attrs: Record<string, unknown>) => { sb.calls.push({ op: 'update', id, attrs }); return { data: { user: { id } }, error: null }; },
          deleteUser: async (id: string) => { sb.calls.push({ op: 'delete', id }); return { data: {}, error: null }; },
        },
      },
    };
  },
}));

import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { query } from '../../src/lib/db/pool.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('partner / advertiser access ends at once (live DB, fake Supabase)', () => {
  let dash: Express;
  let api: Express;
  let fx: Fixture;
  let admin: Record<string, string>;

  /** A partner / advertiser with a linked login, and that login's portal token. */
  const account = async (kind: 'publisher' | 'advertiser', status = 'active') => {
    const authId = randomUUID();
    const table = kind === 'publisher' ? 'publishers' : 'advertisers';
    const id = (await query<{ id: string }>(
      `INSERT INTO ${table} (network_id, name, status, contact_email, auth_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [fx.networkA, `${kind} ${authId.slice(0, 6)}`, status, `${authId.slice(0, 8)}@example.com`, authId])).rows[0]!.id;
    return { id, authId, auth: bearer(portalToken({ userId: authId, networkId: fx.networkA, kind, ownerId: id })) };
  };
  const summary = (kind: 'publisher' | 'advertiser', auth: Record<string, string>) => request(dash).get(`/api/portal/${kind}/summary`).set(auth);
  const setStatus = (kind: 'publisher' | 'advertiser', id: string, status: string) =>
    request(dash).patch(`/api/${kind}s/${id}`).set(admin).send({ status });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`portal-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    api = buildPublicApiApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });
  beforeEach(() => { sb.calls.length = 0; sb.configured = true; });

  it('an inactive partner is refused on its next request (same token) and its login is blocked; re-activating restores both', async () => {
    const p = await account('publisher');
    expect((await summary('publisher', p.auth)).status).toBe(200);

    const off = await setStatus('publisher', p.id, 'inactive');
    expect(off.status).toBe(200);
    expect(off.body.data.loginSync).toBe('synced');
    expect(sb.calls).toEqual([{ op: 'update', id: p.authId, attrs: { ban_duration: '876000h' } }]);
    const refused = await summary('publisher', p.auth);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/partner account is inactive/);

    const on = await setStatus('publisher', p.id, 'active');
    expect(on.body.data.loginSync).toBe('synced');
    expect(sb.calls.at(-1)).toEqual({ op: 'update', id: p.authId, attrs: { ban_duration: 'none' } });
    expect((await summary('publisher', p.auth)).status).toBe(200);

    // active ↔ pending doesn't touch the login: both have access.
    sb.calls.length = 0;
    const pending = await setStatus('publisher', p.id, 'pending');
    expect(pending.body.data.loginSync).toBe('no_change');
    expect(sb.calls).toEqual([]);
    expect((await summary('publisher', p.auth)).status).toBe(200);
  });

  it('a deleted partner’s session ends and its login is deleted with it', async () => {
    const p = await account('publisher', 'pending');
    expect((await summary('publisher', p.auth)).status).toBe(200);
    const del = await request(dash).delete(`/api/publishers/${p.id}`).set(admin);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true, login: 'removed' });
    expect(sb.calls).toEqual([{ op: 'delete', id: p.authId }]);
    const gone = await summary('publisher', p.auth);
    expect(gone.status).toBe(401);
    expect(gone.body.error.message).toMatch(/no longer exists/);
  });

  it('advertisers follow the same rules', async () => {
    const a = await account('advertiser');
    expect((await summary('advertiser', a.auth)).status).toBe(200);
    expect((await setStatus('advertiser', a.id, 'inactive')).body.data.loginSync).toBe('synced');
    expect((await summary('advertiser', a.auth)).status).toBe(403);
    await setStatus('advertiser', a.id, 'active');
    expect((await summary('advertiser', a.auth)).status).toBe(200);
    const del = await request(dash).delete(`/api/advertisers/${a.id}`).set(admin);
    expect(del.body.data).toEqual({ deleted: true, login: 'removed' });
    expect((await summary('advertiser', a.auth)).status).toBe(401);
  });

  it('a partner’s API keys stop with its portal: inactive → 403, deleted → 401', async () => {
    const p = await account('publisher');
    const key = generateApiKey('publisher');
    await query(
      `INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, scopes, status, rate_limit_tier)
       VALUES ($1, 'publisher', $2, $3, $4, $5, 'active', 'default')`,
      [fx.networkA, p.id, key.prefix, key.keyHash, AUDIENCE_SCOPES.publisher]);
    const call = () => request(api).get('/api/v1/publisher/offers').set('x-api-key', key.fullKey);
    expect((await call()).status).toBe(200);
    await setStatus('publisher', p.id, 'inactive');
    const refused = await call();
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/inactive/);
    await setStatus('publisher', p.id, 'active');
    expect((await call()).status).toBe(200);
    await request(dash).delete(`/api/publishers/${p.id}`).set(admin);
    expect((await call()).status).toBe(401);
  });

  it('an admin can still impersonate an inactive partner (support), not a deleted one; invites need an active account', async () => {
    const p = await account('publisher', 'inactive');
    const start = await request(dash).post(`/api/publishers/${p.id}/impersonate`).set(admin);
    expect(start.status).toBe(200);
    const imp = bearer(start.body.data.token as string);
    expect((await summary('publisher', imp)).status).toBe(200);
    expect((await summary('publisher', p.auth)).status).toBe(403);

    const invite = await request(dash).post(`/api/publishers/${p.id}/invite`).set(admin);
    expect(invite.status).toBe(409);
    expect(invite.body.error.message).toMatch(/inactive/);

    await request(dash).delete(`/api/publishers/${p.id}`).set(admin);
    expect((await summary('publisher', imp)).status).toBe(401);
  });

  it('without Supabase configured the cut-off still applies (the account row is what is enforced)', async () => {
    const p = await account('publisher');
    sb.configured = false;
    const off = await setStatus('publisher', p.id, 'inactive');
    expect(off.body.data.loginSync).toBe('not_configured');
    expect((await summary('publisher', p.auth)).status).toBe(403);
    const del = await request(dash).delete(`/api/publishers/${p.id}`).set(admin);
    expect(del.body.data.login).toBe('not_configured');
    expect((await summary('publisher', p.auth)).status).toBe(401);
  });
});
