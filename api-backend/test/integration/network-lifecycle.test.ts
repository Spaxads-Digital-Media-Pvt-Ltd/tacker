/**
 * Network lifecycle — on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) with Supabase Auth
 * replaced by an in-memory fake of the admin API — audit F-26.
 *
 * DELETE /platform/networks/:id is a soft delete: tracking, the dashboard / portals and the API stop at
 * once and every row is kept (PATCH status 'active' restores it; 'suspended' blocks the same way). The
 * export streams every row the network owns from one snapshot with credentials redacted. The purge —
 * the old hard delete — needs a deleted network past its grace period, an export since the delete
 * (or an explicit waiver) and the slug as confirmation; it deletes the network's Supabase logins
 * first (never leaving orphans: if one can't go, nothing is purged), then its data — keeping the
 * platform's audit rows and the append-only money ledger.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';

interface FakeUser { id: string; email: string; app_metadata: Record<string, unknown> }
const sb = vi.hoisted(() => {
  const users = new Map<string, FakeUser>();
  const state = { configured: true, failDelete: new Set<string>() };
  const admin = {
    listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) =>
      ({ data: { users: [...users.values()].slice((page - 1) * perPage, page * perPage) }, error: null }),
    deleteUser: async (id: string) => {
      if (state.failDelete.has(id)) return { data: null, error: { message: 'upstream exploded', status: 500 } };
      if (!users.delete(id)) return { data: null, error: { message: 'User not found', status: 404, code: 'user_not_found' } };
      return { data: {}, error: null };
    },
  };
  return {
    users, state, admin,
    add(networkId: string | null, email = `u-${crypto.randomUUID().slice(0, 8)}@example.com`): FakeUser {
      const u = { id: crypto.randomUUID(), email, app_metadata: networkId ? { network_id: networkId } : {} };
      users.set(u.id, u);
      return u;
    },
  };
});
vi.mock('../../src/lib/supabase.js', () => ({
  getSupabaseAdmin: () => {
    if (!sb.state.configured) throw new Error('Supabase admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return { auth: { admin: sb.admin } };
  },
}));

import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import { encryptSecret } from '../../src/lib/crypto/secret-box.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('network lifecycle: soft delete, export, purge (live DB, fake Supabase)', () => {
  let platform: Express;
  let dash: Express;
  let pub: Express;
  let track: FastifyInstance;
  let pa: { Authorization: string };

  /** A network with traffic, money, an API key, a tracking host and logins. */
  interface World { fx: Fixture; host: string; apiKey: string; slug: string; admin: { Authorization: string } }
  const world = async (tag: string): Promise<World> => {
    const fx = await seedFixture(`${tag}-${randomUUID().slice(0, 8)}`);
    const host = `${tag}-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    const p = `${tag}-${randomUUID().slice(0, 8)}-`;
    for (const n of [fx.networkA, fx.networkB]) {
      const offer = n === fx.networkA ? fx.offerA : (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Offer B', 'active', 'https://b.example.com/') RETURNING id`, [n, fx.advB])).rows[0]!.id;
      const pubId = n === fx.networkA ? fx.pubA1 : fx.pubB1;
      for (const i of [1, 2, 3]) {
        await query('INSERT INTO clicks (click_id, network_id, offer_id, publisher_id) VALUES ($1, $2, $3, $4)', [`${p}${n.slice(0, 4)}c${i}`, n, offer, pubId]);
      }
      await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, status, payout, revenue, currency, source)
                   VALUES ($1, $2, $3, $4, $5, 'approved', 2, 3, 'USD', 'postback')`, [`${p}${n.slice(0, 4)}v`, n, `${p}${n.slice(0, 4)}c1`, offer, pubId]);
      await query(`INSERT INTO ledger_entries (network_id, account_type, account_id, conversion_id, entry_type, direction, amount, currency, status, idempotency_key)
                   VALUES ($1, 'publisher', $2, $3, 'earning', 'credit', 2, 'USD', 'approved', $4)`, [n, pubId, `${p}${n.slice(0, 4)}v`, `test:${randomUUID()}`]);
      await query(`INSERT INTO postback_logs (network_id, conversion_id, url, success) VALUES ($1, $2, 'https://pb.example.com/', true)`, [n, `${p}${n.slice(0, 4)}v`]);
    }
    const key = generateApiKey('network');
    await query(`INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, scopes, status, rate_limit_tier)
                 VALUES ($1, 'network', $1, $2, $3, $4, 'active', 'default')`, [fx.networkA, key.prefix, key.keyHash, AUDIENCE_SCOPES.network]);
    const slug = (await query<{ slug: string }>('SELECT slug FROM networks WHERE id = $1', [fx.networkA])).rows[0]!.slug;
    return { fx, host, apiKey: key.fullKey, slug, admin: bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' })) };
  };

  const clickVia = (w: World) => track.inject({ method: 'GET', url: `/click?offer_id=${w.fx.offerA}&pub_id=${w.fx.pubA1}`, remoteAddress: '127.0.0.1', headers: { host: w.host, 'user-agent': 'Mozilla/5.0 Chrome/120' } });
  const dashboardOf = (w: World) => request(dash).get('/api/offers').set(w.admin);
  const apiOf = (w: World) => request(pub).get('/api/v1/network/offers').set('x-api-key', w.apiKey);
  const count = async (table: string, networkId: string) =>
    Number((await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table} WHERE network_id = $1`, [networkId])).rows[0]!.n);
  const softDelete = (id: string) => request(platform).delete(`/platform/networks/${id}`).set(pa);
  const purge = (id: string, body: Record<string, unknown>) => request(platform).post(`/platform/networks/${id}/purge`).set(pa).send(body);
  const exportOf = async (id: string) => {
    const res = await request(platform).get(`/platform/networks/${id}/export`).set(pa).buffer(true).parse((r, cb) => {
      let t = ''; r.setEncoding('utf8'); r.on('data', (c: string) => { t += c; }); r.on('end', () => cb(null, t));
    });
    return { res, text: res.body as string, lines: String(res.body).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) };
  };
  const backdate = (id: string, days: number) => query(`UPDATE networks SET deleted_at = deleted_at - make_interval(days => $2) WHERE id = $1`, [id, days]);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    const adminId = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash) VALUES ($1, $2, 'active', 'local', $3)`,
      [adminId, `pa-${adminId.slice(0, 8)}@test.local`, await hashPassword(`pw-${adminId}`)]);
    pa = bearer(await signPlatformAdminToken(adminId));
    platform = buildPlatformAdminApp();
    dash = buildDashboardApp();
    pub = buildPublicApiApp();
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
  });
  afterAll(async () => { await track?.close(); });
  beforeEach(() => { sb.state.configured = true; sb.state.failDelete.clear(); });

  it('soft delete stops tracking, the dashboard and the API at once and keeps every row; restore brings it back; suspend blocks too', async () => {
    const w = await world('soft');
    expect((await clickVia(w)).statusCode).toBe(302);
    expect((await dashboardOf(w)).status).toBe(200);
    expect((await apiOf(w)).status).toBe(200);
    const before = { offers: await count('offers', w.fx.networkA), clicks: await count('clicks', w.fx.networkA), conversions: await count('conversions', w.fx.networkA), ledger: await count('ledger_entries', w.fx.networkA) };

    const del = await softDelete(w.fx.networkA);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true, soft: true, status: 'deleted', exportUrl: `/platform/networks/${w.fx.networkA}/export` });
    expect(Date.parse(del.body.data.purgeAfter) - Date.parse(del.body.data.deletedAt)).toBe(30 * 86_400_000);

    const blockedClick = await clickVia(w);
    expect(blockedClick.statusCode).toBe(404);
    expect(blockedClick.json()).toMatchObject({ error: { message: 'unknown_tracking_host' } });
    const blockedDash = await dashboardOf(w);
    expect(blockedDash.status).toBe(403);
    expect(blockedDash.body.error.message).toMatch(/This network is deleted/);
    expect((await apiOf(w)).status).toBe(403);

    expect({ offers: await count('offers', w.fx.networkA), clicks: await count('clicks', w.fx.networkA), conversions: await count('conversions', w.fx.networkA), ledger: await count('ledger_entries', w.fx.networkA) }).toEqual(before);
    const audit = await query<{ after: Record<string, unknown> }>(`SELECT after FROM audit_log WHERE actor_type = 'platform_admin' AND action = 'network.delete' AND entity_id = $1`, [w.fx.networkA]);
    expect(audit.rows[0]?.after).toMatchObject({ status: 'deleted', soft: true });

    const restore = await request(platform).patch(`/platform/networks/${w.fx.networkA}`).set(pa).send({ status: 'active' });
    expect(restore.status).toBe(200);
    expect(restore.body.data).toMatchObject({ status: 'active', deleted_at: null });
    expect((await clickVia(w)).statusCode).toBe(302);
    expect((await dashboardOf(w)).status).toBe(200);
    expect((await apiOf(w)).status).toBe(200);

    expect((await request(platform).patch(`/platform/networks/${w.fx.networkA}`).set(pa).send({ status: 'suspended' })).status).toBe(200);
    expect((await clickVia(w)).statusCode).toBe(404);
    expect((await dashboardOf(w)).body.error.message).toMatch(/This network is suspended/);
    await request(platform).patch(`/platform/networks/${w.fx.networkA}`).set(pa).send({ status: 'active' });
    // Another network was never affected.
    expect((await request(dash).get('/api/offers').set(bearer(operatorToken({ userId: randomUUID(), networkId: w.fx.networkB })))).status).toBe(200);
  });

  it('export: every row the network owns as NDJSON from one snapshot, credentials redacted, other networks never included', async () => {
    const w = await world('export');
    const smtpPlain = `smtp-${randomUUID()}`;
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [w.fx.networkA, JSON.stringify({
      smtp: { host: 'smtp.example.test', password: encryptSecret(smtpPlain) }, integrations: { ipqsApiKey: 'plain-ipqs-key', ipqsEnabled: true },
    })]);
    await query(`UPDATE offers SET security_code = 'offer-secret-code' WHERE id = $1`, [w.fx.offerA]);
    const secure = (await query<{ c: string }>('SELECT postback_security_code AS c FROM networks WHERE id = $1', [w.fx.networkA])).rows[0]!.c;

    const { res, text, lines } = await exportOf(w.fx.networkA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
    expect(res.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="network-${w.slug}-\\d{4}-\\d{2}-\\d{2}\\.ndjson"`));
    const header = lines[0]!['export'] as { networkId: string; tables: string[] };
    expect(header.networkId).toBe(w.fx.networkA);
    expect(header.tables).toEqual(expect.arrayContaining(['networks', 'offers', 'clicks', 'conversions', 'ledger_entries', 'postback_logs', 'api_keys', 'tracking_domains']));

    const rowsOf = (table: string) => lines.filter((l) => l['table'] === table).map((l) => l['row'] as Record<string, unknown>);
    const [net] = rowsOf('networks');
    expect(net).toMatchObject({ id: w.fx.networkA, postback_security_code: '[redacted]', settings: { smtp: { host: 'smtp.example.test', password: '[redacted]' }, integrations: { ipqsApiKey: '[redacted]', ipqsEnabled: true } } });
    expect(rowsOf('offers').find((o) => o['id'] === w.fx.offerA)).toMatchObject({ security_code: '[redacted]' });
    expect(rowsOf('api_keys')[0]).toMatchObject({ key_hash: '[redacted]' });
    expect(rowsOf('clicks')).toHaveLength(3);
    expect(rowsOf('conversions')).toHaveLength(1);
    expect(rowsOf('ledger_entries')).toHaveLength(1);
    expect(rowsOf('postback_logs')).toHaveLength(1);
    for (const secret of [secure, smtpPlain, 'enc:v1:', 'plain-ipqs-key', 'offer-secret-code']) expect(text).not.toContain(secret);
    expect(text).not.toContain(w.fx.networkB); // nothing of another network

    expect((await query('SELECT 1 FROM networks WHERE id = $1 AND exported_at IS NOT NULL', [w.fx.networkA])).rowCount).toBe(1);
    expect((await query(`SELECT 1 FROM audit_log WHERE actor_type = 'platform_admin' AND action = 'network.export' AND entity_id = $1`, [w.fx.networkA])).rowCount).toBe(1);
  });

  it('purge: refuses until deleted, confirmed, past the grace period and exported; then deletes the logins first, then the data', async () => {
    const w = await world('purge');
    const net = w.fx.networkA;
    // Logins: the network admin's (linked from users), a partner's and an advertiser's portal logins,
    // one only the claims point at — and another network's, which must survive.
    const staff = sb.add(net); const partner = sb.add(net); const advertiser = sb.add(net); const unlinked = sb.add(net);
    const other = sb.add(w.fx.networkB);
    await query(`INSERT INTO users (network_id, auth_user_id, email, role) VALUES ($1, $2, $3, 'admin')`, [net, staff.id, staff.email]);
    await query('UPDATE publishers SET auth_user_id = $2 WHERE id = $1', [w.fx.pubA1, partner.id]);
    await query('UPDATE advertisers SET auth_user_id = $2 WHERE id = $1', [w.fx.advA, advertiser.id]);
    await request(dash).get('/api/offers').set(w.admin); // the tenant's own audit trail gets a row or two
    await query(`INSERT INTO audit_log (network_id, actor_type, actor_id, action) VALUES ($1, 'user', 'someone', 'offer.update')`, [net]);
    const ledger = await count('ledger_entries', net);
    const otherBefore = { offers: await count('offers', w.fx.networkB), clicks: await count('clicks', w.fx.networkB) };

    const notDeleted = await purge(net, { confirm: w.slug });
    expect(notDeleted.status).toBe(409);
    expect(notDeleted.body.error.details).toEqual({ reason: 'not_deleted' });

    await softDelete(net);
    expect((await purge(net, { confirm: 'wrong-slug' })).status).toBe(422);
    const grace = await purge(net, { confirm: w.slug });
    expect(grace.status).toBe(409);
    expect(grace.body.error.details.reason).toBe('grace_period');
    await backdate(net, 31);
    const noExport = await purge(net, { confirm: w.slug });
    expect(noExport.status).toBe(409);
    expect(noExport.body.error.details).toEqual({ reason: 'no_export' });
    expect((await exportOf(net)).res.status).toBe(200);
    expect(sb.users.size).toBeGreaterThanOrEqual(5); // nothing touched yet

    const res = await purge(net, { confirm: w.slug });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      purged: true, authUsersDeleted: 4, ledgerEntriesRetained: ledger,
      rowsDeleted: { clicks: 3, conversions: 1, postbackLogs: 1, loginEvents: 0 },
    });
    expect(res.body.data.rowsDeleted.auditLog).toBeGreaterThan(0);
    for (const u of [staff, partner, advertiser, unlinked]) expect(sb.users.has(u.id)).toBe(false);
    expect(sb.users.has(other.id)).toBe(true);

    expect((await query('SELECT 1 FROM networks WHERE id = $1', [net])).rowCount).toBe(0);
    for (const t of ['offers', 'publishers', 'tracking_domains', 'api_keys', 'clicks', 'conversions', 'postback_logs']) expect(await count(t, net)).toBe(0);
    expect(await count('ledger_entries', net)).toBe(ledger); // the append-only ledger stays
    expect(await count('audit_log', net)).toBe(0); // the tenant's own trail is gone…
    const platformRows = await query<{ action: string; network_id: string | null; before: Record<string, unknown> | null }>(
      `SELECT action, network_id, before FROM audit_log WHERE actor_type = 'platform_admin' AND entity_id = $1 ORDER BY created_at`, [net]);
    expect(platformRows.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['network.delete', 'network.export', 'network.purge'])); // …the platform's stays
    expect(platformRows.rows.every((r) => r.network_id === null)).toBe(true);
    expect(platformRows.rows.find((r) => r.action === 'network.purge')?.before).toMatchObject({ id: net, slug: w.slug });

    expect({ offers: await count('offers', w.fx.networkB), clicks: await count('clicks', w.fx.networkB) }).toEqual(otherBefore);
    // Its old logins are refused outright now.
    expect((await dashboardOf(w)).status).toBe(401);
  });

  it('a purge never leaves logins behind: Supabase not configured, or a login that cannot be deleted → 503 and nothing purged', async () => {
    const w = await world('orphan');
    const net = w.fx.networkA;
    const login = sb.add(net);
    await query('UPDATE publishers SET auth_user_id = $2 WHERE id = $1', [w.fx.pubA1, login.id]);
    await softDelete(net);
    await backdate(net, 31);

    sb.state.configured = false;
    const unconfigured = await purge(net, { confirm: w.slug, acknowledgeNoExport: true });
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body.error.message).toMatch(/1 login\(s\) and Supabase Auth is not configured/);
    expect((await query('SELECT 1 FROM networks WHERE id = $1', [net])).rowCount).toBe(1);

    sb.state.configured = true;
    sb.state.failDelete.add(login.id);
    const failing = await purge(net, { confirm: w.slug, acknowledgeNoExport: true });
    expect(failing.status).toBe(503);
    expect(failing.body.error.message).toMatch(/nothing was purged/);
    expect(await count('clicks', net)).toBe(3);
    expect(sb.users.has(login.id)).toBe(true);

    sb.state.failDelete.clear(); // retry works
    const ok = await purge(net, { confirm: w.slug, acknowledgeNoExport: true });
    expect(ok.status).toBe(200);
    expect(sb.users.has(login.id)).toBe(false);
  });
});
