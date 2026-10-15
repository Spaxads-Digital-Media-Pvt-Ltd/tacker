/**
 * SmartSwitch runs (D8) — live DB + Redis, mail mocked at the mailer.
 *
 * A rule's conditions are evaluated per partner × offer over its window; where they hold, the action
 * runs once per holding period: notify (an alert), block the partner on the offer, redirect their
 * traffic (a Landing Page custom setting), or set their payout (payout_override). An action needs a
 * minimum-volume clause; an Action Delay holds it back until the conditions have held that long.
 * Preview shows what a rule would act on without acting; the log has edits (by name) and actions.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/lib/mailer.js', () => ({
  smtpConfigError: async () => null,
  sendNetworkEmail: vi.fn(async (_networkId: string, recipients: string[]) => ({
    sent: recipients.length, results: recipients.map((recipient) => ({ recipient, ok: true })),
  })),
}));

import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { evaluateSmartSwitchRules } from '../../src/lib/automation/smartswitch.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('SmartSwitch rules run (live DB)', () => {
  let dash: Express;
  const soon = (minutes = 0) => new Date(Date.now() + 1000 + minutes * 60_000);

  /** A fresh network: pubA1 sends 20 clicks and no conversions on offerA (a bad CR), pubA2 20 clicks and 4 conversions. */
  const setup = async () => {
    const fx = await seedFixture(`ss-${randomUUID().slice(0, 8)}`);
    const managerId = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status) VALUES ($1, $2, $3, 'Mira Manager', 'manager', 'active')`,
      [fx.networkA, managerId, `mira-${managerId.slice(0, 6)}@example.com`]);
    const auth = bearer(operatorToken({ userId: managerId, networkId: fx.networkA, role: 'manager' }));
    const tag = randomUUID().slice(0, 8);
    for (const [pub, n] of [[fx.pubA1, 20], [fx.pubA2, 20]] as const) {
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id) SELECT $4 || g, $1, $2, $3 FROM generate_series(1, $5) g`,
        [fx.networkA, fx.offerA, pub, `ss-${tag}-${pub.slice(0, 4)}-`, n]);
    }
    await query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, status, payout, revenue, currency, source)
       SELECT 'ssc-' || $5 || g, $1, $6 || g, $2, $3, $4, 'approved', 1, 2, 'USD', 'postback' FROM generate_series(1, 4) g`,
      [fx.networkA, fx.offerA, fx.pubA2, fx.advA, tag, `ss-${tag}-${fx.pubA2.slice(0, 4)}-`]);
    return { fx, auth };
  };
  const create = (auth: Record<string, string>, body: Record<string, unknown>) => request(dash).post('/api/smartswitch/rules').set(auth).send(body);
  const access = async (fx: Fixture, pub: string) => (await query<{ access: string; payout_override: string | null }>(
    'SELECT access, payout_override::text FROM offer_publisher_access WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3', [fx.networkA, fx.offerA, pub])).rows[0] ?? null;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    dash = buildDashboardApp();
  });

  it('a rule must be able to run: conditions, a minimum volume for actions, the action’s URL / payout, this network’s scope', async () => {
    const { fx, auth } = await setup();
    const bad = async (body: Record<string, unknown>, msg: RegExp) => {
      const res = await create(auth, { name: 'x', ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.message).toMatch(msg);
    };
    await bad({ action: 'block' }, /Add conditions/);
    await bad({ action: 'block', conditions: 'cr < 1 in 24h' }, /minimum volume/);
    await bad({ action: 'notify', conditions: 'cr < 1 per offer in 24h' }, /leave out "per/);
    await bad({ action: 'redirect', conditions: 'cr < 1 AND clicks >= 5' }, /http\(s\) URL/);
    await bad({ action: 'payout', conditions: 'cr < 1 AND clicks >= 5' }, /new payout/);
    await bad({ action: 'notify', conditions: 'cr < 1', actionDelay: 'soon' }, /Action Delay/);
    expect((await create(auth, { name: 'x', action: 'notify', conditions: 'cr < 1', offerIds: [randomUUID()] })).status).toBe(400); // not this network's (the ownership check's 400)
    // A paused rule may be a draft.
    expect((await create(auth, { name: 'Draft', action: 'block', status: 'paused' })).status).toBe(201);
    void fx;
  });

  it('block: previewed first, then the partner with the bad CR is blocked on the offer — once — logged, alerted, cache cleared', async () => {
    const { fx, auth } = await setup();
    const body = { name: 'Block low CR', action: 'block', conditions: 'cr < 5 AND clicks >= 10 in 1h', offerIds: [fx.offerA] };

    const preview = await request(dash).post('/api/smartswitch/preview').set(auth).send(body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.data).toMatchObject({ windowMinutes: 60, total: 1, pairs: [{ offerId: fx.offerA, publisherId: fx.pubA1, partnerName: 'Pub A1' }] });
    expect(await access(fx, fx.pubA1)).toMatchObject({ access: 'allow' }); // preview changed nothing

    const rule = (await create(auth, body)).body.data as { id: string };
    expect(await evaluateSmartSwitchRules(soon(), fx.networkA)).toEqual({ rules: 1, acted: 1, errors: 0 });
    expect(await access(fx, fx.pubA1)).toMatchObject({ access: 'deny' });
    expect(await access(fx, fx.pubA2)).toBeNull(); // the good partner untouched (no access row made)

    const log = (await request(dash).get(`/api/smartswitch/history?ruleId=${rule.id}`).set(auth)).body.data as Record<string, unknown>[];
    expect(log.find((h) => h['kind'] === 'action')).toMatchObject({ offerId: fx.offerA, publisherId: fx.pubA1, employeeName: null, change: expect.stringMatching(/^Partner Pub A1 on offer .+: blocked \(cr 0\.00% \(< 5%\), clicks 20 \(>= 10\) in the last 1h\)$/) });
    expect(log.find((h) => h['kind'] === 'change')).toMatchObject({ change: 'Rule created', employeeName: 'Mira Manager' });
    const alerts = await query(`SELECT 1 FROM alerts WHERE network_id = $1 AND type = 'smartswitch' AND entity_id = $2`, [fx.networkA, `${rule.id}:${fx.offerA}:${fx.pubA1}`]);
    expect(alerts.rowCount).toBe(1);
    const listed = ((await request(dash).get('/api/smartswitch/rules').set(auth)).body.data as Record<string, unknown>[]).find((x) => x['id'] === rule.id);
    expect(listed).toMatchObject({ lastError: null, lastFiredAt: expect.any(String), lastEvaluatedAt: expect.any(String) });

    // Still holding → not again.
    expect((await evaluateSmartSwitchRules(soon(1), fx.networkA)).acted).toBe(0);
  });

  it('an Action Delay holds the action until the conditions have held that long', async () => {
    const { fx, auth } = await setup();
    await create(auth, { name: 'Notify after 30m', action: 'notify', conditions: 'cr < 5 AND clicks >= 10 in 2h', actionDelay: '30 minutes' });
    expect((await evaluateSmartSwitchRules(soon(), fx.networkA)).acted).toBe(0);
    expect((await evaluateSmartSwitchRules(soon(20), fx.networkA)).acted).toBe(0);
    expect((await evaluateSmartSwitchRules(soon(31), fx.networkA)).acted).toBe(1);
    expect(await access(fx, fx.pubA1)).toMatchObject({ access: 'allow', payout_override: null }); // notify changes nothing
  });

  it('redirect adds a Landing Page custom setting for that partner; payout sets their payout override', async () => {
    const { fx, auth } = await setup();
    await create(auth, { name: 'Send elsewhere', action: 'redirect', redirectUrl: 'https://lp.example.com/backup', conditions: 'cr < 5 AND clicks >= 10 in 1h' });
    await create(auth, { name: 'Cut payout', action: 'payout', payout: '0.5', conditions: 'cr < 5 AND clicks >= 10 in 1h' });
    expect(await evaluateSmartSwitchRules(soon(), fx.networkA)).toEqual({ rules: 2, acted: 2, errors: 0 });
    const lp = await query<{ landing_page_url: string; partner_id: string; status: string }>(
      `SELECT landing_page_url, partner_id::text, status FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $2 AND category = 'landing_pages'`, [fx.networkA, fx.offerA]);
    expect(lp.rows).toEqual([{ landing_page_url: 'https://lp.example.com/backup', partner_id: fx.pubA1, status: 'active' }]);
    expect(await access(fx, fx.pubA1)).toMatchObject({ access: 'allow', payout_override: '0.5000' });
  });

  it('editing a rule starts it fresh; pausing stops it', async () => {
    const { fx, auth } = await setup();
    const rule = (await create(auth, { name: 'Watch', action: 'notify', conditions: 'cr < 5 AND clicks >= 10 in 1h' })).body.data as { id: string };
    expect((await evaluateSmartSwitchRules(soon(), fx.networkA)).acted).toBe(1);
    const paused = await request(dash).patch(`/api/smartswitch/rules/${rule.id}`).set(auth).send({ status: 'paused' });
    expect(paused.status).toBe(200);
    expect((await evaluateSmartSwitchRules(soon(1), fx.networkA)).rules).toBe(0);
    await request(dash).patch(`/api/smartswitch/rules/${rule.id}`).set(auth).send({ status: 'active' });
    // Resumed = edited: what it watched is cleared, so the still-holding pair is acted on again.
    expect((await evaluateSmartSwitchRules(soon(2), fx.networkA)).acted).toBe(1);
    const changes = ((await request(dash).get(`/api/smartswitch/history?ruleId=${rule.id}&kind=change`).set(auth)).body.data as { change: string }[]).map((c) => c.change);
    expect(changes).toEqual(['Rule resumed', 'Rule paused', 'Rule created']);
  });
});
