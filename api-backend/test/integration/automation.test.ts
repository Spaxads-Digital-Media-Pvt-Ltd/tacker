/**
 * Automation runs — on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) — audit F-17a.
 * The mailer is mocked; webhooks go through the real SSRF guard unless a case stubs the response.
 *
 *  - Scheduled actions apply at their time (not before), once, as audited system actions, and /click
 *    follows at once; partner-scoped ones block / approve just those partners; cap_change sets a cap;
 *    an action that can't run is refused on save (422), or — stored earlier — fails with the reason
 *    without holding up the actions after it.
 *  - Alert rules fire when their conditions start to hold (in-app alert + email to admins/managers,
 *    delivery recorded), not again while they keep holding; unreadable conditions are refused.
 *  - Webhooks get the events they listen to through safeRequest (logged per delivery), with retries;
 *    a private destination is blocked for good; GET sends no body.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/lib/mailer.js', () => ({
  sendNetworkEmail: vi.fn(async (_networkId: string, recipients: string[]) => ({
    sent: recipients.length, results: recipients.map((recipient) => ({ recipient, ok: true })),
  })),
}));
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return { ...actual, safeRequest: vi.fn(actual.safeRequest) };
});

import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { UnrecoverableError } from 'bullmq';
import { sendNetworkEmail } from '../../src/lib/mailer.js';
import { safeRequest } from '../../src/lib/net/safe-http.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { runDueScheduledActions } from '../../src/lib/automation/scheduled-actions.js';
import { evaluateAlertRules } from '../../src/lib/automation/alert-rules.js';
import { emitAutomationEvent, deliverWebhook, type WebhookJob } from '../../src/lib/automation/webhooks.js';
import { approveConversion } from '../../src/surfaces/dashboard/finance/conversion-lifecycle.js';
import { getQueue, QUEUE } from '../../src/lib/queues.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

d('automation execution (live DB + Redis)', () => {
  const mail = vi.mocked(sendNetworkEmail);
  const hook = vi.mocked(safeRequest);
  let dash: Express;
  let track: FastifyInstance;
  const run = randomUUID().slice(0, 8);
  const past = () => new Date(Date.now() - 1000).toISOString();
  /** "Now" for a rule evaluation right after inserting rows: a second ahead, so a row stamped in the
   *  same millisecond (Postgres keeps microseconds) is surely inside the window. */
  const soon = () => new Date(Date.now() + 1000);

  const fixture = async () => {
    const fx = await seedFixture(`auto-${randomUUID().slice(0, 8)}`);
    const host = `auto-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    return { ...fx, host, auth: bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA })) };
  };
  type Fx = Fixture & { host: string; auth: { Authorization: string } };
  const click = (fx: Fx, pub: string) => track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${pub}`, headers: { host: fx.host } });
  const offerRow = async (fx: Fx) => (await query<{ status: string; daily_click_cap: number | null }>(
    'SELECT status, daily_click_cap FROM offers WHERE id = $1', [fx.offerA])).rows[0]!;
  const actionRow = async (id: string) => (await query<{ status: string; executed_at: string | null; result: Record<string, unknown> | null }>(
    'SELECT status, executed_at, result FROM offer_scheduled_actions WHERE id = $1', [id])).rows[0]!;
  const schedule = async (fx: Fx, body: Record<string, unknown>) => {
    const res = await request(dash).post('/api/automation/scheduled-actions').set(fx.auth).send({ offerId: fx.offerA, scheduledTime: past(), ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string };
  };
  const webhookJobs = async (webhookId: string) =>
    (await getQueue(QUEUE.automationWebhook).getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']))
      .map((j) => j?.data as WebhookJob | undefined)
      .filter((j): j is WebhookJob => j?.webhookId === webhookId);
  const createWebhook = async (fx: Fx, body: Record<string, unknown>) => {
    const res = await request(dash).post('/api/automation/webhooks').set(fx.auth).send({ name: 'Hook', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; events: string; url: string };
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    await getQueue(QUEUE.automationWebhook).obliterate({ force: true }); // test Redis only
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
  });
  beforeEach(() => { mail.mockClear(); hook.mockClear(); });

  describe('scheduled actions', () => {
    it('pause runs at its time — not before, and once — as an audited system action; /click stops at once', async () => {
      const fx = await fixture();
      expect((await click(fx, fx.pubA1)).statusCode).toBe(302); // also caches the offer config
      const at = new Date(Date.now() + 3600_000);
      const a = await schedule(fx, { actionType: 'pause', scheduledTime: at.toISOString() });
      expect(a).toMatchObject({ status: 'pending', executedAt: null, result: null, capType: null });

      await runDueScheduledActions(new Date(at.getTime() - 60_000));
      expect((await offerRow(fx)).status).toBe('active');
      await runDueScheduledActions(new Date(at.getTime() + 1000));
      expect((await offerRow(fx)).status).toBe('paused');
      const row = await actionRow(a.id);
      expect(row).toMatchObject({ status: 'executed', result: { scope: 'offer', changed: true, from: 'active', to: 'paused' } });
      expect(row.executed_at).not.toBeNull();
      expect((await click(fx, fx.pubA1)).statusCode).toBe(204);

      await runDueScheduledActions(new Date(at.getTime() + 2000));
      // (one transaction → same created_at, so order by action)
      const audits = (await query<{ action: string; entity_id: string }>(
        `SELECT action, entity_id FROM audit_log WHERE network_id = $1 AND actor_type = 'system' ORDER BY action`, [fx.networkA])).rows;
      expect(audits).toEqual([{ action: 'offer.scheduled_action.execute', entity_id: a.id }, { action: 'offer.update', entity_id: fx.offerA }]);
      // The list shows how it went.
      const listed = (await request(dash).get('/api/automation/scheduled-actions?status=executed').set(fx.auth)).body.data;
      expect(listed.find((x: { id: string }) => x.id === a.id)).toMatchObject({ status: 'executed', result: { to: 'paused' } });
    });

    it('for partners: pause blocks just them on the offer; activate approves them again', async () => {
      const fx = await fixture();
      const p = await schedule(fx, { actionType: 'pause', partnerIds: [fx.pubA1] });
      await runDueScheduledActions();
      expect(await actionRow(p.id)).toMatchObject({ status: 'executed', result: { scope: 'partners', access: 'deny', partners: [fx.pubA1] } });
      expect((await offerRow(fx)).status).toBe('active');
      expect((await click(fx, fx.pubA1)).statusCode).toBe(204);
      expect((await click(fx, fx.pubA2)).statusCode).toBe(302);

      await schedule(fx, { actionType: 'activate', partnerIds: [fx.pubA1, fx.pubA2] });
      await runDueScheduledActions();
      expect((await click(fx, fx.pubA1)).statusCode).toBe(302);
      const access = await query(`SELECT publisher_id, access, approval_status FROM offer_publisher_access WHERE offer_id = $1 ORDER BY publisher_id = $2 DESC`, [fx.offerA, fx.pubA1]);
      expect(access.rows).toEqual([
        { publisher_id: fx.pubA1, access: 'allow', approval_status: 'approved' },
        { publisher_id: fx.pubA2, access: 'allow', approval_status: 'approved' },
      ]);
    });

    it('cap_change sets (and removes) a cap, also from the offer tab; actions that could never run are refused', async () => {
      const fx = await fixture();
      for (const [body, msg] of [
        [{ actionType: 'cap_change' }, /needs capType/],
        [{ actionType: 'cap_change', capType: 'daily_click' }, /needs capValue/],
        [{ actionType: 'archive', partnerIds: [fx.pubA1] }, /applies to the whole offer/],
        [{ actionType: 'pause', partnerIds: [fx.pubB1] }, /Unknown partner id\(s\): /], // another network's partner
      ] as const) {
        const res = await request(dash).post('/api/automation/scheduled-actions').set(fx.auth).send({ offerId: fx.offerA, scheduledTime: past(), ...body });
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.error.message).toMatch(msg);
      }
      // A cancelled one isn't checked (it will never run).
      expect((await request(dash).post('/api/automation/scheduled-actions').set(fx.auth).send({ offerId: fx.offerA, actionType: 'cap_change', status: 'cancelled' })).status).toBe(201);

      const tab = await request(dash).post(`/api/offers/${fx.offerA}/scheduled-actions`).set(fx.auth)
        .send({ actionType: 'cap_change', capType: 'daily_click', capValue: 7, scheduledTime: past() });
      expect(tab.status).toBe(201);
      expect(tab.body.data).toMatchObject({ capType: 'daily_click', capValue: 7, status: 'pending' });
      expect((await request(dash).post(`/api/offers/${fx.offerA}/scheduled-actions`).set(fx.auth).send({ actionType: 'cap_change', capType: 'daily_click' })).status).toBe(422);
      await runDueScheduledActions();
      expect((await offerRow(fx)).daily_click_cap).toBe(7);

      await schedule(fx, { actionType: 'cap_change', capType: 'daily_click', capValue: null });
      await runDueScheduledActions();
      expect((await offerRow(fx)).daily_click_cap).toBeNull();
    });

    it("an action stored before that can't run is marked failed with the reason, and doesn't hold up later ones", async () => {
      const fx = await fixture();
      const ins = async (type: string, agoMs: number) => (await query<{ id: string }>(
        `INSERT INTO offer_scheduled_actions (network_id, offer_id, action_type, scheduled_time) VALUES ($1, $2, $3, now() - $4::interval) RETURNING id`,
        [fx.networkA, fx.offerA, type, `${agoMs} milliseconds`])).rows[0]!.id;
      const bad = await ins('cap_change', 120_000);
      const good = await ins('pause', 60_000);
      await runDueScheduledActions();
      expect(await actionRow(bad)).toMatchObject({ status: 'failed', result: { error: expect.stringMatching(/needs capType/) } });
      expect(await actionRow(good)).toMatchObject({ status: 'executed' });
      expect((await offerRow(fx)).status).toBe('paused');
    });
  });

  describe('alert rules', () => {
    const addUsers = (fx: Fx) => query(
      `INSERT INTO users (network_id, email, role, status) VALUES ($1, $2, 'admin', 'active'), ($1, $3, 'manager', 'active'),
         ($1, $4, 'read_only', 'active'), ($1, $5, 'admin', 'disabled')`,
      [fx.networkA, `a-${run}@example.com`, `m-${run}@example.com`, `r-${run}@example.com`, `d-${run}@example.com`]);
    const clicks = (fx: Fx, n: number) => query(
      `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id) SELECT $4 || g, $1, $2, $3 FROM generate_series(1, $5) g`,
      [fx.networkA, fx.offerA, fx.pubA1, `f17-${randomUUID().slice(0, 8)}-`, n]);
    const rule = async (fx: Fx, body: Record<string, unknown>) => {
      const res = await request(dash).post('/api/automation/alert-rules').set(fx.auth).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data as { id: string };
    };

    it('fires once when its conditions start to hold: an in-app alert, emailed to active admins + managers, delivery recorded', async () => {
      const fx = await fixture();
      await addUsers(fx);
      const r = await rule(fx, { name: 'Click surge', conditions: 'clicks >= 3 in 1h', inApp: true, email: true });
      expect((await evaluateAlertRules(soon(), fx.networkA)).fired).toBe(0);
      await clicks(fx, 3);

      expect(await evaluateAlertRules(soon(), fx.networkA)).toEqual({ rules: 1, fired: 1, errors: 0 });
      const alerts = (await query<{ type: string; entity_type: string; entity_id: string; title: string; description: string; metadata: Record<string, unknown> }>(
        'SELECT type, entity_type, entity_id, title, description, metadata FROM alerts WHERE network_id = $1', [fx.networkA])).rows;
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ type: 'automation_rule', entity_type: 'automation_alert_rule', entity_id: r.id, title: 'Click surge', description: 'clicks 3 (>= 3) in the last 1h.' });
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0]![1]).toEqual([`a-${run}@example.com`, `m-${run}@example.com`]);
      expect(mail.mock.calls[0]![2]).toBe('[Tracker] MEDIUM alert: Click surge');
      expect(alerts[0]!.metadata['delivery']).toMatchObject({ email: { sent: 2, failed: 0 } });

      // Still holding → nothing new.
      expect((await evaluateAlertRules(soon(), fx.networkA)).fired).toBe(0);
      expect(mail).toHaveBeenCalledTimes(1);
      const listed = (await request(dash).get('/api/automation/alert-rules?status=all').set(fx.auth)).body.data.find((x: { id: string }) => x.id === r.id);
      expect(listed).toMatchObject({ lastError: null, lastFiredAt: expect.any(String), lastEvaluatedAt: expect.any(String) });

      // Stops holding (2h later the clicks are out of the 1h window), then holds again → fires again; the
      // alert that is still open isn't duplicated.
      expect((await evaluateAlertRules(new Date(Date.now() + 2 * 3600_000), fx.networkA)).fired).toBe(0);
      expect((await evaluateAlertRules(soon(), fx.networkA)).fired).toBe(1);
      expect(mail).toHaveBeenCalledTimes(2);
      expect((await query('SELECT 1 FROM alerts WHERE network_id = $1', [fx.networkA])).rowCount).toBe(1);
    });

    it("per offer: the alert names the offer; an email-only rule doesn't create an inbox alert", async () => {
      const fx = await fixture();
      await addUsers(fx);
      await rule(fx, { name: 'Converting offers', conditions: 'conversions >= 1 per offer in 1h', inApp: false, email: true });
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, source, status, revenue, payout, currency)
         VALUES ($1, $2, $3, $4, $5, 'postback', 'approved', 8, 5, 'USD')`,
        [`f17-conv-${randomUUID().slice(0, 8)}`, fx.networkA, `f17-click-${randomUUID().slice(0, 8)}`, fx.offerA, fx.pubA1]);
      expect((await evaluateAlertRules(soon(), fx.networkA)).fired).toBe(1);
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0]![3]).toContain(`Offer Offer A auto-`);
      expect((await query('SELECT 1 FROM alerts WHERE network_id = $1', [fx.networkA])).rowCount).toBe(0);
    });

    it("conditions the worker can't read are refused (422); a stored one reports lastError", async () => {
      const fx = await fixture();
      const bad = await request(dash).post('/api/automation/alert-rules').set(fx.auth).send({ name: 'x', conditions: 'whenever it looks bad' });
      expect(bad.status).toBe(422);
      expect(bad.body.error.message).toMatch(/Can't read "whenever it looks bad"/);
      const r = await rule(fx, { name: 'ok', conditions: 'clicks > 1' });
      expect((await request(dash).patch(`/api/automation/alert-rules/${r.id}`).set(fx.auth).send({ conditions: 'nope' })).status).toBe(422);

      await query(`INSERT INTO automation_alert_rules (network_id, name, conditions) VALUES ($1, 'legacy', 'CR is high')`, [fx.networkA]);
      expect(await evaluateAlertRules(soon(), fx.networkA)).toMatchObject({ rules: 2, errors: 0 });
      const legacy = (await request(dash).get('/api/automation/alert-rules?status=all').set(fx.auth)).body.data.find((x: { name: string }) => x.name === 'legacy');
      expect(legacy.lastError).toMatch(/^Conditions can't be evaluated: Can't read "CR is high"/);
    });
  });

  describe('webhooks', () => {
    it('events and URL are checked on save; events are stored normalised', async () => {
      const fx = await fixture();
      for (const [body, msg] of [
        [{ url: 'https://hooks.example.com/x', events: 'offer.deleted' }, /Unknown webhook event\(s\): offer.deleted/],
        [{ url: 'https://hooks.example.com/x', events: '' }, /List the events this webhook receives/],
        [{ url: 'http://10.0.0.7/hook', events: '*' }, /not allowed \(private_address\)/],
      ] as const) {
        const res = await request(dash).post('/api/automation/webhooks').set(fx.auth).send({ name: 'x', ...body });
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.error.message).toMatch(msg);
      }
      const h = await createWebhook(fx, { url: 'https://hooks.example.com/x', events: ' Alert.Raised, conversion.approved alert.raised' });
      expect(h.events).toBe('alert.raised,conversion.approved');
    });

    it('a listening webhook gets the event via safeRequest (POST JSON) and the delivery is logged', async () => {
      const fx = await fixture();
      const h = await createWebhook(fx, { url: `https://hooks.example.com/f17a/${run}`, events: 'conversion.approved' });
      const conv = `f17-pending-${randomUUID().slice(0, 8)}`;
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, source, status, revenue, payout, currency)
         VALUES ($1, $2, $3, $4, $5, 'postback', 'pending', 8, 5, 'USD')`,
        [conv, fx.networkA, `f17-k-${randomUUID().slice(0, 8)}`, fx.offerA, fx.pubA1]);
      await approveConversion(fx.networkA, conv); // manual approval emits conversion.approved
      const jobs = await webhookJobs(h.id);
      expect(jobs.map((j) => j.event)).toEqual(['conversion.approved']);

      hook.mockResolvedValueOnce({ status: 204, body: '' });
      await deliverWebhook(jobs[0]!, 1, false);
      const [url, opts] = hook.mock.calls[0]!;
      expect(url).toBe(`https://hooks.example.com/f17a/${run}`);
      expect(opts).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-event': 'conversion.approved', 'x-tracker-delivery': jobs[0]!.deliveryId } });
      expect(JSON.parse(opts.body!)).toMatchObject({
        event: 'conversion.approved',
        data: { conversionId: conv, status: 'approved', reason: 'manually_approved', offerId: fx.offerA, publisherId: fx.pubA1, payout: '5.0000', currency: 'USD' },
      });
      const log = (await request(dash).get(`/api/automation/webhooks/${h.id}/deliveries`).set(fx.auth)).body.data;
      expect(log).toEqual([expect.objectContaining({ event: 'conversion.approved', status: 'success', attempts: 1, statusCode: 204, error: null })]);
      // Not listening to conversion.created → nothing queued.
      expect(await emitAutomationEvent(fx.networkA, 'conversion.created', {})).toBe(0);
    });

    it('a real postback emits conversion.created + approved; an action run and a rule alert reach their listeners too', async () => {
      const fx = await fixture();
      const h = await createWebhook(fx, { url: 'https://hooks.example.com/all', events: '*' });
      const c = await click(fx, fx.pubA1);
      const clickId = new URL(c.headers.location as string).pathname.split('/').pop()!;
      const pb = await track.inject({ method: 'GET', url: `/postback?click_id=${clickId}&status=approved&secure_code=${fx.secureCodeA}`, headers: { host: fx.host } });
      expect(pb.statusCode).toBe(200);
      const a = await schedule(fx, { actionType: 'pause' });
      await runDueScheduledActions();
      // (the click itself is only queued here — no click worker runs — but the postback's conversion is stored)
      await request(dash).post('/api/automation/alert-rules').set(fx.auth).send({ name: 'Any conversion', conditions: 'conversions >= 1 in 1h' });
      await evaluateAlertRules(soon(), fx.networkA);

      const jobs = await webhookJobs(h.id);
      expect(jobs.map((j) => j.event).sort()).toEqual(['alert.raised', 'conversion.approved', 'conversion.created', 'scheduled_action.executed']);
      expect(jobs.find((j) => j.event === 'scheduled_action.executed')!.payload.data).toMatchObject({ id: a.id, actionType: 'pause', status: 'executed' });
      expect(jobs.find((j) => j.event === 'alert.raised')!.payload.data).toMatchObject({ type: 'automation_rule', title: 'Any conversion' });
    });

    it('non-2xx is retried (the last attempt marks it failed); a private destination is blocked for good; GET has no body', async () => {
      const fx = await fixture();
      const h = await createWebhook(fx, { url: 'https://hooks.example.com/flaky', events: 'alert.raised' });
      expect(await emitAutomationEvent(fx.networkA, 'alert.raised', { id: 'x' })).toBe(1);
      const [job] = await webhookJobs(h.id);
      const status = async () => (await query<{ status: string; attempts: number; status_code: number | null; error: string | null }>(
        'SELECT status, attempts, status_code, error FROM automation_webhook_deliveries WHERE id = $1', [job!.deliveryId])).rows[0];
      hook.mockResolvedValueOnce({ status: 500, body: 'boom' });
      await expect(deliverWebhook(job!, 1, false)).rejects.toThrow('webhook http 500');
      expect(await status()).toEqual({ status: 'pending', attempts: 1, status_code: 500, error: 'http_500' });
      hook.mockResolvedValueOnce({ status: 503, body: '' });
      await expect(deliverWebhook(job!, 6, true)).rejects.toThrow('webhook http 503');
      expect(await status()).toMatchObject({ status: 'failed', attempts: 6, status_code: 503 });

      // Hostname resolving to a private address: allowed on save (not a literal IP), refused when sent.
      const priv = await createWebhook(fx, { url: 'http://localhost:9/hook', events: 'alert.raised' });
      await emitAutomationEvent(fx.networkA, 'alert.raised', { id: 'y' });
      const [pj] = await webhookJobs(priv.id);
      await expect(deliverWebhook(pj!, 1, false)).rejects.toBeInstanceOf(UnrecoverableError);
      expect((await query('SELECT status, error FROM automation_webhook_deliveries WHERE id = $1', [pj!.deliveryId])).rows[0])
        .toEqual({ status: 'blocked', error: 'blocked_destination: private_address' });

      const get = await createWebhook(fx, { url: 'https://hooks.example.com/get?k=1', events: 'scheduled_action.executed', httpMethod: 'GET' });
      await emitAutomationEvent(fx.networkA, 'scheduled_action.executed', { id: 'z' });
      const [gj] = await webhookJobs(get.id);
      hook.mockResolvedValueOnce({ status: 200, body: 'ok' });
      await deliverWebhook(gj!, 1, false);
      const [gurl, gopts] = hook.mock.calls.at(-1)!;
      expect(gurl).toBe(`https://hooks.example.com/get?k=1&event=scheduled_action.executed&delivery_id=${gj!.deliveryId}`);
      expect(gopts).toMatchObject({ method: 'GET' });
      expect(gopts.body).toBeUndefined();
    });

    it('a deactivated webhook gets nothing (its subscription cache is busted on update)', async () => {
      const fx = await fixture();
      const h = await createWebhook(fx, { url: 'https://hooks.example.com/off', events: 'alert.raised' });
      expect(await emitAutomationEvent(fx.networkA, 'alert.raised', {})).toBe(1);
      expect((await request(dash).patch(`/api/automation/webhooks/${h.id}`).set(fx.auth).send({ status: 'inactive' })).status).toBe(200);
      expect(await emitAutomationEvent(fx.networkA, 'alert.raised', {})).toBe(0);
    });
  });
});
