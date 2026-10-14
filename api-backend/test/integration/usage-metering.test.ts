/**
 * Plan metering — on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) — audit F-26.
 *
 * The usage meter counts a network's clicks, conversions and events (conversions with an event name)
 * per UTC day into usage_records (idempotent; yesterday re-counted so late rows land). Against the
 * plan's limits for the billing period it raises a warning near the limit (≥ 80 %) and another when
 * it's reached — once each per period. The policy at the limit is to flag, not block: tracking goes on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildPlatformAdminApp } from '../../src/surfaces/platform-admin/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { signPlatformAdminToken } from '../../src/lib/auth/platform-admin-token.js';
import { hashPassword } from '../../src/lib/auth/platform-admin-password.js';
import { meterNetwork, runUsageMeter } from '../../src/lib/usage/meter.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const DAY = 86_400_000;
const utcDate = (t: Date) => t.toISOString().slice(0, 10);

d('plan metering (live DB)', () => {
  let dash: Express;
  let platform: Express;
  let track: FastifyInstance;
  let pa: { Authorization: string };
  const tag = randomUUID().slice(0, 8);
  let seq = 0;

  const clicks = (fx: Fixture, n: number, at: Date) => Promise.all(Array.from({ length: n }, () =>
    query('INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($1, $2, $3, $4, $5)',
      [`meter-${tag}-${++seq}`, fx.networkA, fx.offerA, fx.pubA1, at.toISOString()])));
  const conversion = (fx: Fixture, at: Date, eventName: string | null) => query(
    `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, status, source, event_name, created_at)
     VALUES ($1, $2, $3, $4, $5, 'approved', 'postback', $6, $7)`,
    [`meter-${tag}-v${++seq}`, fx.networkA, `meter-${tag}-x${seq}`, fx.offerA, fx.pubA1, eventName, at.toISOString()]);
  const usage = async (networkId: string, day: string) => Object.fromEntries((await query<{ metric: string; value: string }>(
    'SELECT metric, value::text AS value FROM usage_records WHERE network_id = $1 AND period_date = $2', [networkId, day])).rows.map((r) => [r.metric, Number(r.value)]));
  const alertsOf = async (networkId: string) => (await query<{ type: string; severity: string; entity_id: string; metadata: Record<string, unknown> }>(
    `SELECT type, severity, entity_id, metadata FROM alerts WHERE network_id = $1 AND type LIKE 'plan_limit_%' ORDER BY created_at`, [networkId])).rows;
  const plan = async (fx: Fixture, limits: Record<string, number>, period?: { start: Date; end: Date }) => {
    const code = `meter-${tag}-${++seq}`;
    const p = (await query<{ id: string }>(`INSERT INTO subscription_plans (code, name, price_cents, limits) VALUES ($1, 'Growth', 9900, $2) RETURNING id`, [code, JSON.stringify(limits)])).rows[0]!.id;
    await query(`INSERT INTO subscriptions (network_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, 'active', $3, $4)
                 ON CONFLICT (network_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end`,
      [fx.networkA, p, period?.start.toISOString() ?? null, period?.end.toISOString() ?? null]);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    dash = buildDashboardApp();
    platform = buildPlatformAdminApp();
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    const adminId = randomUUID();
    await query(`INSERT INTO platform_admins (id, email, status, auth_provider, password_hash) VALUES ($1, $2, 'active', 'local', $3)`,
      [adminId, `pa-${adminId.slice(0, 8)}@test.local`, await hashPassword(`pw-${adminId}`)]);
    pa = bearer(await signPlatformAdminToken(adminId));
  });
  afterAll(async () => { await track?.close(); });

  it('usage accrues per UTC day — clicks, conversions, events; re-runs never double; late rows land', async () => {
    const fx = await seedFixture(`meter-a-${tag}`);
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY);
    await clicks(fx, 4, now);
    await clicks(fx, 1, yesterday);
    await conversion(fx, now, 'sale');
    await conversion(fx, now, null);

    await meterNetwork(fx.networkA, now);
    expect(await usage(fx.networkA, utcDate(now))).toEqual({ clicks: 4, conversions: 2, events: 1 });
    expect(await usage(fx.networkA, utcDate(yesterday))).toEqual({ clicks: 1, conversions: 0, events: 0 });

    await meterNetwork(fx.networkA, now);
    expect((await usage(fx.networkA, utcDate(now))).clicks).toBe(4);
    await clicks(fx, 2, now);
    await clicks(fx, 1, yesterday); // a late row for yesterday
    await meterNetwork(fx.networkA, now);
    expect((await usage(fx.networkA, utcDate(now))).clicks).toBe(6);
    expect((await usage(fx.networkA, utcDate(yesterday))).clicks).toBe(2);
    expect(await usage(fx.networkB, utcDate(now))).toEqual({}); // never another network's traffic

    // The worker's run covers every active network.
    const run = await runUsageMeter(now);
    expect(run.networks).toBeGreaterThan(0);
    expect((await usage(fx.networkB, utcDate(now))).clicks).toBe(0);
  });

  it('near the limit → a warning once per period; reached → a second alert; flagged, never blocked', async () => {
    const fx = await seedFixture(`meter-b-${tag}`);
    const host = `meter-${tag}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await plan(fx, { clicks: 10, offers: 100 });
    const now = new Date();
    const monthStart = `${utcDate(now).slice(0, 8)}01`;

    await clicks(fx, 8, now);
    expect(await meterNetwork(fx.networkA, now)).toBe(1);
    expect(await alertsOf(fx.networkA)).toEqual([{
      type: 'plan_limit_near', severity: 'medium', entity_id: `clicks:${monthStart}`,
      metadata: expect.objectContaining({ metric: 'clicks', used: 8, limit: 10, pct: 80 }),
    }]);
    // Once per period — even after the alert is resolved.
    expect(await meterNetwork(fx.networkA, now)).toBe(0);
    await query(`UPDATE alerts SET status = 'resolved' WHERE network_id = $1`, [fx.networkA]);
    expect(await meterNetwork(fx.networkA, now)).toBe(0);

    await clicks(fx, 2, now);
    expect(await meterNetwork(fx.networkA, now)).toBe(1);
    expect((await alertsOf(fx.networkA)).map((a) => [a.type, a.severity])).toEqual([['plan_limit_near', 'medium'], ['plan_limit_reached', 'high']]);

    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const mine = await request(dash).get('/api/subscription').set(admin);
    expect(mine.status).toBe(200);
    expect(mine.body.data.period.start).toBe(monthStart);
    expect(mine.body.data.limits).toEqual([
      { key: 'clicks', used: 10, limit: 10, pct: 100, state: 'over' },
      { key: 'offers', used: 1, limit: 100, pct: 1, state: 'ok' },
    ]);
    const platformView = await request(platform).get(`/platform/networks/${fx.networkA}/usage`).set(pa);
    expect(platformView.body.data).toMatchObject({ plan: { name: 'Growth' }, limits: expect.arrayContaining([expect.objectContaining({ key: 'clicks', state: 'over' })]) });

    // Over the limit, clicks still track (policy: flag, never block).
    const click = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, remoteAddress: '127.0.0.1', headers: { host, 'user-agent': 'Mozilla/5.0 Chrome/120' } });
    expect(click.statusCode).toBe(302);
  });

  it("the subscription's own billing period is used when it has one; seats are current active users", async () => {
    const fx = await seedFixture(`meter-c-${tag}`);
    const now = new Date();
    await plan(fx, { clicks: 100, seats: 1 }, { start: new Date(now.getTime() - 5 * DAY), end: new Date(now.getTime() + 25 * DAY) });
    await clicks(fx, 50, new Date(now.getTime() - 10 * DAY)); // before this period
    await clicks(fx, 3, now);
    for (const day of [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) await meterNetwork(fx.networkA, new Date(now.getTime() - day * DAY));
    for (const email of ['a', 'b']) await query(`INSERT INTO users (network_id, email, role, status) VALUES ($1, $2, 'admin', 'active')`, [fx.networkA, `${email}-${tag}@example.com`]);
    await meterNetwork(fx.networkA, now);

    const admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const { body } = await request(dash).get('/api/subscription').set(admin);
    expect(body.data.period).toEqual({ start: utcDate(new Date(now.getTime() - 5 * DAY)), end: utcDate(new Date(now.getTime() + 25 * DAY)) });
    expect(body.data.limits).toEqual([
      { key: 'clicks', used: 3, limit: 100, pct: 3, state: 'ok' },
      { key: 'seats', used: 2, limit: 1, pct: 200, state: 'over' },
    ]);
    expect((await alertsOf(fx.networkA)).map((a) => [a.type, a.entity_id.split(':')[0]])).toEqual([['plan_limit_reached', 'seats']]);
  });
});
