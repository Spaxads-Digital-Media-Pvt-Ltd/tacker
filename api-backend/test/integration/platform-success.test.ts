/**
 * Super Admin › Customer success — on a real Postgres (INTEGRATION_DB=1).
 *
 * - Health: a busy, paying, set-up network scores healthy with every milestone dated; an empty one is at
 *   risk; falling to at risk from better gives its account manager ONE check-in task; history per day.
 * - API: accounts (filters, worst first, 7 days ago), a network's account (milestones, history, notes),
 *   assign an account manager / seller / tags, notes (pin, edit, delete), recalculate.
 * - Roles: an Account Manager sees only its networks (another → 404); Sales reads but can't change.
 * - A network's export leaves the platform's account records out.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { query } from '../../src/lib/db/pool.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { computeHealth } from '../../src/lib/platform/health.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ROLE = { owner: '00000000-0000-4000-a000-000000000001', sales: '00000000-0000-4000-a000-000000000003', am: '00000000-0000-4000-a000-000000000004' };

d('Super Admin › Customer success (live DB)', () => {
  let platform: Express;
  let fx: Fixture;
  const staff = async (roleId: string) => {
    const id = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, name, status, auth_provider, password_hash, role_id) VALUES ($1, $2, $3, 'active', 'local', $4, $5)`,
      [id, `cs-${id.slice(0, 8)}@test.local`, `CS ${id.slice(0, 4)}`, await hashPassword(`pw-${id}`), roleId]);
    return { id, auth: bearer(await signPlatformAdminToken(id)) };
  };
  /** Make network A busy, paying and set up (fixture A already has an advertiser, partners and an offer). */
  const makeHealthy = async (net: string) => {
    for (let i = 1; i <= 13; i++) {
      await query(`INSERT INTO usage_records (network_id, metric, value, period_date) VALUES ($1, 'clicks', 100, CURRENT_DATE - $2::int)
                   ON CONFLICT (network_id, metric, period_date) DO UPDATE SET value = 100`, [net, i]);
    }
    await query(`INSERT INTO usage_records (network_id, metric, value, period_date) VALUES ($1, 'conversions', 4, CURRENT_DATE - 1)
                 ON CONFLICT (network_id, metric, period_date) DO UPDATE SET value = 4`, [net]);
    await query(`INSERT INTO login_events (network_id, user_id, employee_email, created_at) VALUES ($1, $2, 'owner@x.test', now() - interval '1 hour')`, [net, randomUUID()]);
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state, ssl_status) VALUES ($1, $2, 'subdomain', 'active', 'verified', 'issued')`,
      [net, `cs-${randomUUID().slice(0, 8)}.trk.test`]);
    await query(`INSERT INTO users (network_id, email, role, status) VALUES ($1, $2, 'admin', 'active'), ($1, $3, 'manager', 'active')`,
      [net, `o-${randomUUID().slice(0, 6)}@x.test`, `m-${randomUUID().slice(0, 6)}@x.test`]);
    await query(`INSERT INTO publisher_postbacks (network_id, publisher_id, url) VALUES ($1, (SELECT id FROM publishers WHERE network_id = $1 LIMIT 1), 'https://p.test/pb?c={click_id}')`, [net]);
    const plan = (await query<{ id: string }>(
      `INSERT INTO subscription_plans (code, name, price_cents, currency, limits) VALUES ($1, 'CS plan', 0, 'USD', '{}') RETURNING id`, [`cs-${randomUUID().slice(0, 8)}`])).rows[0]!.id;
    await query(`INSERT INTO subscriptions (network_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, 'active', now(), now() + interval '30 days')
                 ON CONFLICT (network_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active'`, [net, plan]);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`cs-${randomUUID().slice(0, 8)}`);
    platform = buildPlatformAdminApp();
  });

  it('health: healthy with dated milestones; empty → at risk; a fall → one check-in for the account manager', async () => {
    await makeHealthy(fx.networkA);
    const am = await staff(ROLE.am);
    await query('UPDATE networks SET account_manager_id = $1 WHERE id = ANY($2::uuid[])', [am.id, [fx.networkA, fx.networkB]]);
    const out = await computeHealth([fx.networkA, fx.networkB]);
    expect(out.computed).toBe(2);
    const a = (await query<{ health_score: number; health_status: string; onboarding_pct: number; health_components: Record<string, number>; onboarding: { key: string; done: boolean; at: string | null }[] }>(
      'SELECT * FROM network_accounts WHERE network_id = $1', [fx.networkA])).rows[0]!;
    expect(a.health_components).toEqual({ usage: 100, trend: 100, engagement: 100, billing: 100, onboarding: 100 });
    expect(a).toMatchObject({ health_score: 100, health_status: 'healthy', onboarding_pct: 100 });
    expect(a.onboarding.every((m) => m.done && m.at)).toBe(true);
    const b = (await query<{ health_status: string; health_score: number }>('SELECT * FROM network_accounts WHERE network_id = $1', [fx.networkB])).rows[0]!;
    expect(b.health_status).toBe('at_risk');
    // B's first computation: no task (only a fall from better makes one).
    expect((await query('SELECT 1 FROM platform_tasks WHERE network_id = $1', [fx.networkB])).rows).toHaveLength(0);
    expect((await query('SELECT score FROM network_health_history WHERE network_id = $1 AND day = CURRENT_DATE', [fx.networkA])).rows).toEqual([{ score: 100 }]);

    // A falls: no traffic, no sign-ins, an overdue invoice.
    await query(`DELETE FROM usage_records WHERE network_id = $1`, [fx.networkA]);
    await query(`DELETE FROM login_events WHERE network_id = $1`, [fx.networkA]);
    await query(`UPDATE subscriptions SET status = 'past_due' WHERE network_id = $1`, [fx.networkA]);
    const fell = await computeHealth([fx.networkA]);
    expect(fell.tasksCreated).toBe(1);
    const task = (await query<{ title: string; assignee_id: string; kind: string; priority: string }>('SELECT * FROM platform_tasks WHERE network_id = $1', [fx.networkA])).rows;
    expect(task).toHaveLength(1);
    expect(task[0]).toMatchObject({ assignee_id: am.id, kind: 'success', priority: 'high', title: expect.stringMatching(/^Check in: Net A .* — health fell to \d+$/) });
    // Still at risk next time: no second task.
    expect((await computeHealth([fx.networkA])).tasksCreated).toBe(0);
  });

  it('API: accounts, a network’s account, assignments, tags, notes, recalculate', async () => {
    const owner = await staff(ROLE.owner);
    const am = await staff(ROLE.am);
    const accounts = await request(platform).get(`/platform/success/accounts?q=${encodeURIComponent('Net B ' + '')}`).set(owner.auth);
    expect(accounts.status).toBe(200);

    const assign = await request(platform).patch(`/platform/networks/${fx.networkB}/account`).set(owner.auth).send({ accountManagerId: am.id, tags: ['VIP', 'enterprise', 'vip'] });
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);
    expect(assign.body.data).toMatchObject({ account_manager_id: am.id, tags: ['vip', 'enterprise'] });
    const mine = (await request(platform).get('/platform/success/accounts?manager=me').set(am.auth)).body.data as { id: string }[];
    expect(mine.map((x) => x.id)).toEqual([fx.networkB]);
    expect(((await request(platform).get('/platform/success/accounts?tag=vip').set(owner.auth)).body.data as { id: string }[]).map((x) => x.id)).toContain(fx.networkB);

    const note = await request(platform).post(`/platform/networks/${fx.networkB}/notes`).set(am.auth).send({ body: 'Wants CAPI next quarter', pinned: true });
    expect(note.status).toBe(201);
    expect((await request(platform).patch(`/platform/notes/${note.body.data.id}`).set(am.auth).send({ body: 'Wants Meta CAPI next quarter' })).body.data).toMatchObject({ body: 'Wants Meta CAPI next quarter', pinned: true });

    await computeHealth([fx.networkB]);
    const acc = (await request(platform).get(`/platform/networks/${fx.networkB}/account`).set(am.auth)).body.data;
    expect(acc).toMatchObject({ account_manager_id: am.id, health_status: expect.any(String), tags: ['vip', 'enterprise'] });
    expect(acc.milestones).toHaveLength(10);
    expect(acc.onboarding).toHaveLength(10);
    expect(acc.history.at(-1)).toMatchObject({ score: acc.health_score });
    expect(acc.notes[0]).toMatchObject({ body: 'Wants Meta CAPI next quarter', pinned: true, author_name: `CS ${am.id.slice(0, 4)}` });

    const recalc = await request(platform).post('/platform/success/recalculate').set(am.auth);
    expect(recalc.status).toBe(200);
    expect(recalc.body.data.computed).toBe(1); // an Account Manager recomputes only its networks
    expect((await request(platform).get('/platform/success/summary').set(am.auth)).body.data.counts).toMatchObject({ accounts: 1, mine: 1 });
    expect((await request(platform).delete(`/platform/notes/${note.body.data.id}`).set(am.auth)).status).toBe(200);
  });

  it('roles: an Account Manager only its networks; Sales reads, can’t change', async () => {
    const am = await staff(ROLE.am);
    const s = await staff(ROLE.sales);
    expect((await request(platform).get(`/platform/networks/${fx.networkA}/account`).set(am.auth)).status).toBe(404);
    expect((await request(platform).post(`/platform/networks/${fx.networkA}/notes`).set(am.auth).send({ body: 'x' })).status).toBe(404);
    expect((await request(platform).get('/platform/success/summary').set(s.auth)).status).toBe(200);
    const denied = await request(platform).patch(`/platform/networks/${fx.networkA}/account`).set(s.auth).send({ tags: ['x'] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/Your role \(Sales\) can’t change Customer success/);
  });

  it('a network’s export leaves the account records out', async () => {
    const owner = await staff(ROLE.owner);
    await request(platform).post(`/platform/networks/${fx.networkB}/notes`).set(owner.auth).send({ body: 'internal' });
    const exp = await request(platform).get(`/platform/networks/${fx.networkB}/export`).set(owner.auth);
    const tables = (JSON.parse(exp.text.split('\n')[0]!).export as { tables: string[] }).tables;
    for (const t of ['network_accounts', 'network_health_history', 'network_notes']) expect(tables).not.toContain(t);
    expect(exp.text).not.toContain('internal');
  });
});
