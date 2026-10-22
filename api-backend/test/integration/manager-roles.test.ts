/**
 * Affiliate / Advertiser Manager roles and My partners / My advertisers — live DB (INTEGRATION_DB=1).
 *
 * - The scoped roles reach only /api/me…, /api/my…, help and announcements: every other route → 403
 *   scoped_role (deny by default), so no list can show them accounts they don't manage.
 * - My partners / advertisers: only the accounts assigned to me, with numbers from the reporting provider
 *   and the latest conversions; another account → 404; other networks never.
 * - Offer applications: my partners' only; approve works, someone else's partner → 404; an Advertiser
 *   Manager can't decide (403). Every staff role has the panels; admins can give the new roles.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer, operatorToken } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('manager roles + My partners / My advertisers (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  const staff = async (networkId: string, role: string) => {
    const auth = randomUUID();
    const id = (await query<{ id: string }>(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [networkId, auth, `${role}-${auth.slice(0, 6)}@test.local`, `${role} ${auth.slice(0, 4)}`, role])).rows[0]!.id;
    return { id, auth: bearer(operatorToken({ userId: auth, networkId, role })) };
  };
  const conversion = (pub: string, payout: string, revenue: string) => query(
    `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, source, status, payout, revenue, currency, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'postback', 'approved', $7, $8, 'USD', now() - interval '1 minute')`,
    [`mr-${randomUUID()}`, fx.networkA, `c-${randomUUID()}`, fx.offerA, pub, fx.advA, payout, revenue]);
  let am: Awaited<ReturnType<typeof staff>>;
  let adm: Awaited<ReturnType<typeof staff>>;
  let admin: Awaited<ReturnType<typeof staff>>;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`mr-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    am = await staff(fx.networkA, 'affiliate_manager');
    adm = await staff(fx.networkA, 'advertiser_manager');
    admin = await staff(fx.networkA, 'admin');
    await query('UPDATE publishers SET partner_manager_id = $2 WHERE id = $1', [fx.pubA1, am.id]);
    await query('UPDATE advertisers SET account_manager_id = $2 WHERE id = $1', [fx.advA, adm.id]);
    await conversion(fx.pubA1, '2.50', '4.00');
    await conversion(fx.pubA1, '1.50', '3.00');
    await conversion(fx.pubA2, '9.00', '12.00');
  });

  it('deny by default: a scoped role reaches only its own account and panels', async () => {
    for (const path of ['/api/publishers', '/api/offers', '/api/advertisers', '/api/reports/dashboard', '/api/audit-log', '/api/users', '/api/settings/security', '/api/finance/summary']) {
      const r = await request(dash).get(path).set(am.auth);
      expect([path, r.status, r.body.error?.details?.reason]).toEqual([path, 403, 'scoped_role']);
    }
    expect((await request(dash).post('/api/offers').set(adm.auth).send({ name: 'x' })).status).toBe(403);
    const me = await request(dash).get('/api/me').set(am.auth);
    expect([me.status, me.body.data.identity.role]).toEqual([200, 'affiliate_manager']);
    expect((await request(dash).get('/api/me/account').set(am.auth)).status).toBe(200);
    expect((await request(dash).get('/api/my/summary').set(am.auth)).body.data).toMatchObject({ userId: am.id, partners: 1, advertisers: 0 });
    // A regular admin still has the whole dashboard — and the panels.
    expect((await request(dash).get('/api/publishers').set(admin.auth)).status).toBe(200);
    expect((await request(dash).get('/api/my/partners').set(admin.auth)).body.data.partners).toEqual([]);
  });

  it('My partners: only mine, with their numbers and latest conversions; another partner is a 404', async () => {
    const listRes = await request(dash).get('/api/my/partners').set(am.auth);
    expect(listRes.status, JSON.stringify(listRes.body)).toBe(200);
    const list = listRes.body.data;
    expect(list.partners.map((p: { id: string }) => p.id)).toEqual([fx.pubA1]);
    expect(list.partners[0].stats).toMatchObject({ conversions: 2 });
    expect(Number(list.partners[0].stats.payout)).toBe(4);
    expect(list.range.from).toMatch(/^\d{4}-\d{2}-01$/);
    const one = (await request(dash).get(`/api/my/partners/${fx.pubA1}`).set(am.auth)).body.data;
    expect(one.partner.id).toBe(fx.pubA1);
    expect(one.latestConversions).toHaveLength(2);
    expect(one.latestConversions.every((c: { publisher_id: string }) => c.publisher_id === fx.pubA1)).toBe(true);
    expect(one.offers[0].dimensions.offer).toBe(fx.offerA);
    expect((await request(dash).get(`/api/my/partners/${fx.pubA2}`).set(am.auth)).status).toBe(404);
    expect((await request(dash).get(`/api/my/partners/${fx.pubB1}`).set(am.auth)).status).toBe(404);
  });

  it('offer applications: my partners’ only; approve; someone else’s → 404; an advertiser manager can’t decide', async () => {
    const pending = async (pub: string) => (await query<{ id: string }>(
      `INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'allow', 'pending')
       ON CONFLICT (offer_id, publisher_id) DO UPDATE SET approval_status = 'pending' RETURNING id`, [fx.networkA, fx.offerA, pub])).rows[0]!.id;
    const mine = await pending(fx.pubA1);
    const theirs = await pending(fx.pubA2);
    expect((await request(dash).get('/api/my/offer-applications').set(am.auth)).body.data.map((a: { id: string }) => a.id)).toEqual([mine]);
    expect((await request(dash).post(`/api/my/offer-applications/${theirs}`).set(am.auth).send({ status: 'approved' })).status).toBe(404);
    expect((await request(dash).post(`/api/my/offer-applications/${mine}`).set(adm.auth).send({ status: 'approved' })).status).toBe(403);
    const ok = await request(dash).post(`/api/my/offer-applications/${mine}`).set(am.auth).send({ status: 'approved' });
    expect(ok.body.data).toMatchObject({ id: mine, status: 'approved', access: 'allow' });
    expect((await query('SELECT access FROM offer_publisher_access WHERE id = $1', [mine])).rows[0]).toEqual({ access: 'allow' });
    expect((await query('SELECT approval_status FROM offer_publisher_access WHERE id = $1', [theirs])).rows[0]).toEqual({ approval_status: 'pending' });
  });

  it('My advertisers: the ones I manage (account or sales manager), their offers and numbers', async () => {
    const list = (await request(dash).get('/api/my/advertisers').set(adm.auth)).body.data;
    expect(list.advertisers.map((a: { id: string }) => a.id)).toEqual([fx.advA]);
    expect(list.advertisers[0]).toMatchObject({ offers: 1, stats: expect.objectContaining({ conversions: 3 }) });
    expect(Number(list.advertisers[0].stats.revenue)).toBe(19);
    const one = (await request(dash).get(`/api/my/advertisers/${fx.advA}`).set(adm.auth)).body.data;
    expect(one.offers.map((o: { id: string }) => o.id)).toEqual([fx.offerA]);
    expect(one.latestConversions).toHaveLength(3);
    expect((await request(dash).get(`/api/my/advertisers/${fx.advB}`).set(adm.auth)).status).toBe(404);
    expect((await request(dash).get('/api/my/partners').set(adm.auth)).body.data.partners).toEqual([]);
  });

  it('admins give the new roles; the role applies on the next request', async () => {
    const u = await staff(fx.networkA, 'manager');
    expect((await request(dash).get('/api/publishers').set(u.auth)).status).toBe(200);
    const put = await request(dash).patch(`/api/control-center/users/${u.id}`).set(admin.auth).send({ role: 'affiliate_manager' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const after = await request(dash).get('/api/publishers').set(u.auth);
    expect([after.status, after.body.error?.details?.reason]).toEqual([403, 'scoped_role']);
  });
});
