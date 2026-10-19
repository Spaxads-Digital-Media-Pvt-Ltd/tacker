/**
 * Super Admin › operations — on a real Postgres (INTEGRATION_DB=1).
 *
 * - Overview: networks by status, subscriptions, MRR per currency (paying only — trials excluded; a yearly
 *   price as a twelfth), billing per currency, what needs attention; traffic per day (14), new networks per
 *   month (6) and each panel's headline numbers — equal to the panel's own page, null without its section.
 * - Usage across networks: each against its plan's limits, the worst state.
 * - Team: add (no duplicate email), disable (never yourself — so one active Super Admin always remains; a
 *   disabled one is refused at once), reset another's password, change your own (needs the current one);
 *   last sign-in.
 * - Activity: what Super Admins did, and what billing did on its own; filters.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { runBilling } from '../../src/lib/billing/engine.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const PW = 'a-strong-password-123';
const ADMIN_ROLE = '00000000-0000-4000-a000-000000000002'; // built-in Admin (team: read)

d('Super Admin operations (live DB)', () => {
  let platform: Express;
  let fx: Fixture;
  let adminId: string;
  let email: string;
  let pa: Record<string, string>;
  const cur = `Q${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase().padEnd(2, 'X')}`; // a currency only this file uses

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`ops-${randomUUID().slice(0, 8)}`);
    adminId = randomUUID();
    email = `pa-${adminId.slice(0, 8)}@test.local`;
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash) VALUES ($1, $2, 'active', 'local', $3)`,
      [adminId, email, await hashPassword(PW)]);
    pa = bearer(await signPlatformAdminToken(adminId));
    platform = buildPlatformAdminApp();
  });

  it('overview: MRR per currency from paying subscriptions only (a yearly price as a twelfth); networks and subscriptions counted', async () => {
    const plan = async (priceCents: number, billingInterval: string, trialDays = 0) => (await request(platform).post('/platform/plans').set(pa)
      .send({ code: `o-${randomUUID().slice(0, 8)}`, name: 'Ops plan', priceCents, currency: cur, billingInterval, trialDays })).body.data.id as string;
    const monthly = await plan(10000, 'month');
    const yearly = await plan(120000, 'year');
    const trial = await plan(5000, 'month', 30);
    const n2 = (await seedFixture(`ops2-${randomUUID().slice(0, 8)}`)).networkA;
    const n3 = (await seedFixture(`ops3-${randomUUID().slice(0, 8)}`)).networkA;
    // The test DB outlives a run: compare what these three subscriptions ADD to the per-currency totals.
    const mrrOf = (body: { data: { mrr: { currency: string; amount: string; subscriptions: number }[] } }) =>
      body.data.mrr.find((m) => m.currency === cur) ?? { amount: '0', subscriptions: 0 };
    const openOf = (body: { data: { billing: { currency: string; open_total: string }[] } }) =>
      Number(body.data.billing.find((b) => b.currency === cur)?.open_total ?? 0);
    const before = (await request(platform).get('/platform/summary').set(pa)).body;
    await request(platform).put(`/platform/networks/${fx.networkA}/subscription`).set(pa).send({ planId: monthly, trialDays: 0 });
    await request(platform).put(`/platform/networks/${n2}/subscription`).set(pa).send({ planId: yearly, trialDays: 0 });
    await request(platform).put(`/platform/networks/${n3}/subscription`).set(pa).send({ planId: trial });
    const r = await request(platform).get('/platform/summary').set(pa);
    expect(r.status).toBe(200);
    // 100 + 1200 / 12 = 200 a month from 2 paying subscriptions; the trial isn't revenue.
    expect(Number(mrrOf(r.body).amount) - Number(mrrOf(before).amount)).toBe(200);
    expect(mrrOf(r.body).subscriptions - mrrOf(before).subscriptions).toBe(2);
    expect(openOf(r.body) - openOf(before)).toBe(1300); // the two first invoices: 100 + 1200 (no tax set in this DB)
    expect(r.body.data.networks).toMatchObject({ total: expect.any(Number), active: expect.any(Number), suspended_for_billing: expect.any(Number) });
    expect(r.body.data.subscriptions.trialing).toBeGreaterThanOrEqual(1);
    expect(r.body.data.trialsEndingSoon.map((t: { network_id: string }) => t.network_id)).not.toContain(n3); // 30 days away
    expect(r.body.data.recentActivity[0]).toMatchObject({ admin_email: email });
  });

  it('overview: traffic per day, new networks per month, and each panel’s numbers — the same as its own page; a role without the section gets null', async () => {
    const before = (await request(platform).get('/platform/summary').set(pa)).body.data;
    expect(before.trend).toHaveLength(14);
    expect(before.signups).toHaveLength(6);
    const today = before.trend[13].day as string;
    // Today's metered traffic of this file's own network (no usage rows of its own yet).
    await query(`INSERT INTO usage_records (network_id, metric, period_date, value) VALUES ($1, 'clicks', $2::date, 7), ($1, 'conversions', $2::date, 2)`,
      [fx.networkA, today]);
    const s = (await request(platform).get('/platform/summary').set(pa)).body.data;
    expect(s.trend[13].clicks - before.trend[13].clicks).toBe(7);
    expect(s.trend[13].conversions - before.trend[13].conversions).toBe(2);
    expect(s.signups[5]).toMatchObject({ month: today.slice(0, 7), created: expect.any(Number) });
    expect(s.signups[5].created).toBeGreaterThanOrEqual(1); // this file's fixtures
    expect(Array.isArray(s.mrrTrend)).toBe(true);
    // The busiest networks of the 14 days: at most 6, busiest first.
    const top = s.topNetworks as { id: string; clicks: number }[];
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThanOrEqual(6);
    expect(top.map((t) => t.clicks)).toEqual([...top.map((t) => t.clicks)].sort((x, y) => y - x));
    // One definition each: the Overview says what the panel's own page says.
    expect(s.sales.kpis).toEqual((await request(platform).get('/platform/sales/summary').set(pa)).body.data.kpis);
    expect(s.support).toEqual((await request(platform).get('/platform/support/summary').set(pa)).body.data.counts);
    expect(s.health).toEqual((await request(platform).get('/platform/success/summary').set(pa)).body.data.counts);
    expect(s.tasks).toEqual((await request(platform).get('/platform/tasks/summary').set(pa)).body.data);

    // Support: no Sales or Revenue — those parts are null, not empty.
    const agent = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash, role_id) VALUES ($1, $2, 'active', 'local', $3, '00000000-0000-4000-a000-000000000005')`,
      [agent, `agent-${agent.slice(0, 8)}@test.local`, await hashPassword(PW)]);
    const a = (await request(platform).get('/platform/summary').set(bearer(await signPlatformAdminToken(agent)))).body.data;
    expect(a).toMatchObject({ sales: null, mrrTrend: null, mrr: null, support: expect.objectContaining({ open: expect.any(Number) }), health: expect.objectContaining({ accounts: expect.any(Number) }) });
  });

  it('usage across networks: each with its plan, the limits this period and the worst state', async () => {
    const p = (await request(platform).post('/platform/plans').set(pa)
      .send({ code: `u-${randomUUID().slice(0, 8)}`, name: 'Tiny', priceCents: 0, currency: cur, limits: { offers: 1 } })).body.data.id as string;
    const net = (await seedFixture(`ops4-${randomUUID().slice(0, 8)}`)).networkA; // its fixture has 1 offer → 100 % of 1
    await request(platform).put(`/platform/networks/${net}/subscription`).set(pa).send({ planId: p, trialDays: 0 });
    const r = await request(platform).get('/platform/usage').set(pa);
    expect(r.status).toBe(200);
    const row = (r.body.data as { id: string; worst: string; plan: { name: string }; limits: { key: string; state: string }[] }[]).find((x) => x.id === net);
    expect(row).toMatchObject({ worst: 'over', plan: { name: 'Tiny' }, limits: [expect.objectContaining({ key: 'offers', state: 'over' })] });
  });

  it('team: add, no duplicates, reset another password, change your own; never disable yourself; disabling is immediate', async () => {
    const otherEmail = `other-${randomUUID().slice(0, 6)}@test.local`;
    const added = await request(platform).post('/platform/admins').set(pa).send({ email: otherEmail, name: 'Other', password: PW, roleId: ADMIN_ROLE });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.data).not.toHaveProperty('password_hash');
    expect((await request(platform).post('/platform/admins').set(pa).send({ email: otherEmail.toUpperCase(), password: PW, roleId: ADMIN_ROLE })).status).toBe(400);
    expect((await request(platform).post('/platform/admins').set(pa).send({ email: 'x@test.local', password: 'short', roleId: ADMIN_ROLE })).status).toBe(422);
    const otherId = added.body.data.id as string;

    // Sign-in records the last login.
    expect((await request(platform).post('/platform/login').send({ email: otherEmail, password: PW })).status).toBe(200);
    const listed = (await request(platform).get('/platform/admins').set(pa)).body.data as { id: string; last_login_at: string | null; you: boolean }[];
    expect(listed.find((a) => a.id === otherId)?.last_login_at).toBeTruthy();
    expect(listed.find((a) => a.id === adminId)?.you).toBe(true);

    // Reset theirs (not your own this way); they sign in with it.
    expect((await request(platform).post(`/platform/admins/${adminId}/password`).set(pa).send({ password: 'another-password-456' })).status).toBe(400);
    expect((await request(platform).post(`/platform/admins/${otherId}/password`).set(pa).send({ password: 'their-new-password-789' })).status).toBe(200);
    expect((await request(platform).post('/platform/login').send({ email: otherEmail, password: 'their-new-password-789' })).status).toBe(200);

    // Your own needs the current one.
    const wrong = await request(platform).post('/platform/me/password').set(pa).send({ currentPassword: 'nope', newPassword: 'my-newer-password-321' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toMatch(/current password is not right/);
    expect((await request(platform).post('/platform/me/password').set(pa).send({ currentPassword: PW, newPassword: 'my-newer-password-321' })).status).toBe(200);
    expect((await request(platform).post('/platform/login').send({ email, password: 'my-newer-password-321' })).status).toBe(200);

    // Not yourself.
    const self = await request(platform).patch(`/platform/admins/${adminId}`).set(pa).send({ status: 'disabled' });
    expect(self.status).toBe(409);
    // Disabling another works and is immediate.
    const otherToken = bearer(await signPlatformAdminToken(otherId));
    expect((await request(platform).get('/platform/admins').set(otherToken)).status).toBe(200);
    expect((await request(platform).patch(`/platform/admins/${otherId}`).set(pa).send({ status: 'disabled' })).body.data.status).toBe('disabled');
    expect((await request(platform).get('/platform/admins').set(otherToken)).status).toBe(403);

    // …and re-enabled.
    expect((await request(platform).patch(`/platform/admins/${otherId}`).set(pa).send({ status: 'active' })).body.data.status).toBe('active');
    expect((await request(platform).get('/platform/admins').set(otherToken)).status).toBe(200);
  });

  it('activity: Super Admin actions and billing on its own, filterable', async () => {
    const net = (await seedFixture(`ops5-${randomUUID().slice(0, 8)}`)).networkA;
    const p = (await request(platform).post('/platform/plans').set(pa)
      .send({ code: `a-${randomUUID().slice(0, 8)}`, name: 'Act', priceCents: 100, currency: cur, trialDays: 0 })).body.data.id as string;
    await request(platform).put(`/platform/networks/${net}/subscription`).set(pa).send({ planId: p, trialDays: 0 });
    await query(`UPDATE subscriptions SET current_period_end = now() - interval '1 minute' WHERE network_id = $1`, [net]);
    await runBilling();
    const all = await request(platform).get(`/platform/activity?networkId=${net}`).set(pa);
    expect(all.status).toBe(200);
    const actions = (all.body.data as { action: string; actor_type: string; admin_email: string | null }[]);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['subscription.assign', 'subscription.renewed']));
    expect(actions.find((a) => a.action === 'subscription.renewed')).toMatchObject({ actor_type: 'system', admin_email: null });
    const admins = await request(platform).get(`/platform/activity?networkId=${net}&scope=admins`).set(pa);
    expect((admins.body.data as { action: string }[]).map((a) => a.action)).not.toContain('subscription.renewed');
    const billing = await request(platform).get(`/platform/activity?networkId=${net}&scope=billing`).set(pa);
    expect((billing.body.data as { action: string }[]).map((a) => a.action)).toEqual(['subscription.renewed']);
    const search = await request(platform).get(`/platform/activity?q=${encodeURIComponent('subscription.assign')}&networkId=${net}`).set(pa);
    expect(search.body.data).toHaveLength(1);
    expect((await request(platform).get('/platform/activity?scope=nope').set(pa)).status).toBe(422);
  });
});
