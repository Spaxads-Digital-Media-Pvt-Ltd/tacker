/**
 * Customer Value rule evaluation on a real Postgres (INTEGRATION_DB=1; skipped otherwise) — the
 * code recordConversion() runs before writing an approved conversion's payout/revenue:
 *  - Rule Duration in UTC days, End Date inclusive (C1: the End Date never applied before);
 *  - recurring daily / weekly / monthly windows in UTC (M1: they followed the server's local time);
 *  - conditions (text exact match, number any value / sum of values, missing / non-numeric);
 *  - once per customer vs every cycle;
 *  - overrides returned as the exact stored decimal text;
 *  - another network's rules, data points and history never apply.
 * Plus the /rules API's date contract (YYYY-MM-DD out; strict YYYY-MM-DD in, End ≥ Start).
 * Only `Date` is faked (vi.useFakeTimers toFake: ['Date']) — pg's own timers keep running.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, bearer } from '../helpers/tokens.js';
import { evaluateCustomerValueRules, recordCustomerValueFiring, type CvContext } from '../../src/lib/customer-value/evaluate.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

interface Net { networkId: string; advertiserId: string; offerId: string; publisherId: string }
let seq = 0;
async function mkNetwork(): Promise<Net> {
  const s = `cv${Date.now().toString(36)}${seq++}`;
  const one = async (sql: string, p: unknown[]) => (await query<{ id: string }>(sql, p)).rows[0]!.id;
  const networkId = await one(`INSERT INTO networks (name, slug) VALUES ($1, $2) RETURNING id`, [`CV ${s}`, `cv-${s}`]);
  const advertiserId = await one(`INSERT INTO advertisers (network_id, name) VALUES ($1, 'CV Adv') RETURNING id`, [networkId]);
  const offerId = await one(`INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'CV Offer', 'active', 'https://example.com/{click_id}') RETURNING id`, [networkId, advertiserId]);
  const publisherId = await one(`INSERT INTO publishers (network_id, name, status) VALUES ($1, 'CV Pub', 'active') RETURNING id`, [networkId]);
  return { networkId, advertiserId, offerId, publisherId };
}
async function mkDataPoint(net: Net, key: string, dataType: 'text' | 'number'): Promise<string> {
  return (await query<{ id: string }>(`INSERT INTO customer_data_points (network_id, name, data_type, parameter_key) VALUES ($1, $2, $3, $2) RETURNING id`,
    [net.networkId, key, dataType])).rows[0]!.id;
}
interface RuleOpts {
  startDate?: string | null; endDate?: string | null;
  goalCycle?: 'continuous' | 'recurring'; recurringDuration?: string | null; continuousMode?: string | null;
  conditions?: { dataPointId: string; conditionLogic: 'any_value' | 'sum_of_values'; operator: string; value: string }[];
  outcomeFrequency?: 'once_per_customer' | 'every_cycle'; payout?: string | null; revenue?: string | null;
}
async function mkRule(net: Net, o: RuleOpts = {}): Promise<string> {
  const goalCycle = o.goalCycle ?? 'continuous';
  return (await query<{ id: string }>(
    `INSERT INTO customer_value_rules (network_id, name, status, start_date, end_date, goal_cycle, recurring_duration, continuous_mode,
       set_goal_conditions, conditions, outcome_frequency, payout_value, revenue_value)
     VALUES ($1, 'CV rule', 'active', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [net.networkId, o.startDate ?? null, o.endDate ?? null, goalCycle,
      goalCycle === 'recurring' ? (o.recurringDuration ?? 'daily') : null,
      goalCycle === 'continuous' ? (o.continuousMode ?? 'for_rule_duration') : null,
      (o.conditions?.length ?? 0) > 0, JSON.stringify(o.conditions ?? []),
      o.outcomeFrequency ?? 'once_per_customer', o.payout === undefined ? '12.3456' : o.payout, o.revenue ?? null],
  )).rows[0]!.id;
}
/** A prior approved conversion carrying `raw` (incl. user_id) at `at`. */
async function priorConversion(net: Net, at: string, raw: Record<string, unknown>, status = 'approved') {
  const id = randomUUID().replace(/-/g, '');
  await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, payout, revenue, currency, status, source, raw_params, created_at)
    VALUES ($1, $2, $1, $3, '1.0000', '2.0000', 'USD', $4, 'postback', $5, $6)`, [id, net.networkId, net.offerId, status, JSON.stringify(raw), at]);
}
async function firingAt(net: Net, ruleId: string, userId: string, at: string) {
  await query(`INSERT INTO customer_value_rule_firings (network_id, rule_id, user_id, conversion_id, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [net.networkId, ruleId, userId, randomUUID().replace(/-/g, ''), at]);
}
const ctx = (net: Net, userId: string, raw: Record<string, unknown> = {}): CvContext => ({
  networkId: net.networkId, offerId: net.offerId, advertiserId: net.advertiserId, publisherId: net.publisherId,
  userId, payout: '5.0000', revenue: '8.0000', rawParams: { user_id: userId, ...raw },
});
function clock(isoNow: string) { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(isoNow)); }
const fires = async (c: CvContext) => (await evaluateCustomerValueRules(c)).appliedId != null;

d('Customer Value rule evaluation (live DB)', () => {
  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable. Run migrations against DATABASE_URL first.');
    await resetDb();
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('Rule Duration — UTC days, End Date inclusive (C1)', () => {
    let net: Net;
    beforeAll(async () => { net = await mkNetwork(); await mkRule(net, { startDate: '2026-03-10', endDate: '2026-03-20' }); });
    it('before the Start Date (23:59:59 UTC the day before) → does not fire', async () => {
      clock('2026-03-09T23:59:59.000Z');
      expect(await fires(ctx(net, 'u-dates'))).toBe(false);
    });
    it('the Start Date at 00:00 UTC → fires', async () => {
      clock('2026-03-10T00:00:00.000Z');
      expect(await fires(ctx(net, 'u-dates'))).toBe(true);
    });
    it('the End Date at 23:59 UTC → fires', async () => {
      clock('2026-03-20T23:59:00.000Z');
      expect(await fires(ctx(net, 'u-dates'))).toBe(true);
    });
    it('the day after the End Date → does NOT fire (regression: the End Date used to be ignored)', async () => {
      clock('2026-03-21T00:00:01.000Z');
      expect(await fires(ctx(net, 'u-dates'))).toBe(false);
      clock('2027-01-15T12:00:00.000Z');
      expect(await fires(ctx(net, 'u-dates'))).toBe(false);
    });
  });

  describe('recurring windows in UTC (M1) — sum of deposits ≥ 100 within the window', () => {
    // A prior deposit of 60 just before a UTC boundary + 50 now: 110 inside the same window, 50 after it.
    const scenario = (period: string, priorAt: string, sameWindowNow: string, nextWindowNow: string) => async () => {
      const net = await mkNetwork();
      const dp = await mkDataPoint(net, 'deposit', 'number');
      await mkRule(net, { goalCycle: 'recurring', recurringDuration: period, outcomeFrequency: 'every_cycle',
        conditions: [{ dataPointId: dp, conditionLogic: 'sum_of_values', operator: 'greater_than_or_equal_to', value: '100' }] });
      await priorConversion(net, priorAt, { user_id: 'u-win', deposit: '60' });
      clock(sameWindowNow);
      expect(await fires(ctx(net, 'u-win', { deposit: '50' })), `${period}: same UTC window`).toBe(true);
      clock(nextWindowNow);
      expect(await fires(ctx(net, 'u-win', { deposit: '50' })), `${period}: next UTC window`).toBe(false);
    };
    it('daily: midnight UTC', scenario('daily', '2026-03-09T23:50:00.000Z', '2026-03-09T23:55:00.000Z', '2026-03-10T00:05:00.000Z'));
    it('weekly: Monday 00:00 UTC (Sunday is the old week)', scenario('weekly', '2026-03-08T23:50:00.000Z', '2026-03-08T23:55:00.000Z', '2026-03-09T00:05:00.000Z'));
    it('monthly: day 1 00:00 UTC', scenario('monthly', '2026-03-31T23:50:00.000Z', '2026-03-31T23:55:00.000Z', '2026-04-01T00:05:00.000Z'));
    it('quarterly: 1 Apr 00:00 UTC', scenario('quarterly', '2026-03-31T23:50:00.000Z', '2026-03-31T23:55:00.000Z', '2026-04-01T00:05:00.000Z'));
  });

  describe('conditions', () => {
    it('text exact match (case-insensitive, as today); a different value does not match', async () => {
      const net = await mkNetwork();
      const dp = await mkDataPoint(net, 'geo', 'text');
      await mkRule(net, { conditions: [{ dataPointId: dp, conditionLogic: 'any_value', operator: 'exact_match', value: 'US' }] });
      expect(await fires(ctx(net, 'u-t1', { geo: 'us' }))).toBe(true);
      expect(await fires(ctx(net, 'u-t2', { geo: 'CA' }))).toBe(false);
    });
    it('number "any value": one value must pass on its own; "sum of values" adds the history', async () => {
      const anyNet = await mkNetwork();
      const anyDp = await mkDataPoint(anyNet, 'deposit', 'number');
      await mkRule(anyNet, { conditions: [{ dataPointId: anyDp, conditionLogic: 'any_value', operator: 'greater_than', value: '100' }] });
      await priorConversion(anyNet, '2026-01-01T00:00:00.000Z', { user_id: 'u-any', deposit: '80' });
      expect(await fires(ctx(anyNet, 'u-any', { deposit: '50' }))).toBe(false); // 80 and 50, neither > 100
      expect(await fires(ctx(anyNet, 'u-any', { deposit: '150' }))).toBe(true);

      const sumNet = await mkNetwork();
      const sumDp = await mkDataPoint(sumNet, 'deposit', 'number');
      await mkRule(sumNet, { conditions: [{ dataPointId: sumDp, conditionLogic: 'sum_of_values', operator: 'greater_than', value: '100' }] });
      await priorConversion(sumNet, '2026-01-01T00:00:00.000Z', { user_id: 'u-sum', deposit: '80' });
      expect(await fires(ctx(sumNet, 'u-sum', { deposit: '50' }))).toBe(true); // 80 + 50 = 130
    });
    it('only APPROVED history counts toward a sum', async () => {
      const net = await mkNetwork();
      const dp = await mkDataPoint(net, 'deposit', 'number');
      await mkRule(net, { conditions: [{ dataPointId: dp, conditionLogic: 'sum_of_values', operator: 'greater_than', value: '100' }] });
      await priorConversion(net, '2026-01-01T00:00:00.000Z', { user_id: 'u-st', deposit: '80' }, 'pending');
      await priorConversion(net, '2026-01-02T00:00:00.000Z', { user_id: 'u-st', deposit: '80' }, 'rejected');
      expect(await fires(ctx(net, 'u-st', { deposit: '50' }))).toBe(false);
    });
    it('a missing or non-numeric value does not match a number condition', async () => {
      const net = await mkNetwork();
      const dp = await mkDataPoint(net, 'deposit', 'number');
      await mkRule(net, { conditions: [{ dataPointId: dp, conditionLogic: 'any_value', operator: 'greater_than_or_equal_to', value: '0' }] });
      expect(await fires(ctx(net, 'u-miss'))).toBe(false);
      expect(await fires(ctx(net, 'u-nan', { deposit: 'abc' }))).toBe(false);
      expect(await fires(ctx(net, 'u-ok', { deposit: '0' }))).toBe(true);
    });
    it('no user_id → never evaluated', async () => {
      const net = await mkNetwork();
      await mkRule(net);
      expect(await fires({ ...ctx(net, 'x'), userId: null })).toBe(false);
    });
  });

  describe('outcome frequency', () => {
    it('once per customer: fires, and after its firing is recorded never again for that customer', async () => {
      const net = await mkNetwork();
      await mkRule(net);
      const first = await evaluateCustomerValueRules(ctx(net, 'u-once'));
      expect(first.appliedId).not.toBeNull();
      await recordCustomerValueFiring({ query: (sql, p) => query(sql, p) }, { networkId: net.networkId, ruleId: first.appliedId!, userId: 'u-once', conversionId: randomUUID().replace(/-/g, '') });
      expect(await fires(ctx(net, 'u-once'))).toBe(false);
      expect(await fires(ctx(net, 'u-other'))).toBe(true);
    });
    it('every cycle (recurring daily): a firing in the previous UTC day does not block today; one today does', async () => {
      const net = await mkNetwork();
      const ruleId = await mkRule(net, { goalCycle: 'recurring', recurringDuration: 'daily', outcomeFrequency: 'every_cycle' });
      await firingAt(net, ruleId, 'u-cycle', '2026-03-09T23:59:00.000Z');
      clock('2026-03-10T00:01:00.000Z');
      expect(await fires(ctx(net, 'u-cycle'))).toBe(true);
      await firingAt(net, ruleId, 'u-cycle', '2026-03-10T00:00:30.000Z');
      expect(await fires(ctx(net, 'u-cycle'))).toBe(false);
    });
  });

  describe('exact money', () => {
    it('payout override returned as the exact stored text; revenue left unchanged when the rule sets none', async () => {
      const net = await mkNetwork();
      await mkRule(net, { payout: '12.3456', revenue: null });
      const r = await evaluateCustomerValueRules(ctx(net, 'u-m1'));
      expect(r).toMatchObject({ payout: '12.3456', revenue: '8.0000', payoutOverridden: true, revenueOverridden: false });
    });
    it('both overrides, 4-decimal amounts, exact', async () => {
      const net = await mkNetwork();
      await mkRule(net, { payout: '0.0005', revenue: '0.0015' });
      const r = await evaluateCustomerValueRules(ctx(net, 'u-m2'));
      expect(r).toMatchObject({ payout: '0.0005', revenue: '0.0015', payoutOverridden: true, revenueOverridden: true });
      expect(typeof r.payout).toBe('string');
    });
  });

  describe('cross-network isolation', () => {
    it("another network's rule never applies, even for the same user_id", async () => {
      const a = await mkNetwork(); const b = await mkNetwork();
      await mkRule(b);
      expect(await fires(ctx(a, 'u-shared'))).toBe(false);
      expect(await fires(ctx(b, 'u-shared'))).toBe(true);
    });
    it("a rule pointing at another network's data point never matches", async () => {
      const a = await mkNetwork(); const b = await mkNetwork();
      const dpB = await mkDataPoint(b, 'deposit', 'number');
      await mkRule(a, { conditions: [{ dataPointId: dpB, conditionLogic: 'any_value', operator: 'greater_than', value: '1' }] });
      expect(await fires(ctx(a, 'u-x', { deposit: '500' }))).toBe(false);
    });
    it("another network's conversion history never counts toward a sum", async () => {
      const a = await mkNetwork(); const b = await mkNetwork();
      const dpA = await mkDataPoint(a, 'deposit', 'number');
      await mkRule(a, { conditions: [{ dataPointId: dpA, conditionLogic: 'sum_of_values', operator: 'greater_than', value: '100' }] });
      await priorConversion(b, '2026-01-01T00:00:00.000Z', { user_id: 'u-hist', deposit: '500' });
      expect(await fires(ctx(a, 'u-hist', { deposit: '50' }))).toBe(false);
    });
    it("another network's firing never blocks a once-per-customer rule", async () => {
      const a = await mkNetwork(); const b = await mkNetwork();
      await mkRule(a);
      const ruleB = await mkRule(b);
      await firingAt(b, ruleB, 'u-fire', '2026-01-01T00:00:00.000Z');
      expect(await fires(ctx(a, 'u-fire'))).toBe(true);
    });
  });

  describe('/api/customer-value/rules — related ids and conditions are validated', () => {
    let app: Express; let auth: { Authorization: string }; let a: Net; let b: Net;
    let dpTextA: string; let dpNumA: string; let dpNumB: string;
    const body = (extra: Record<string, unknown>) => ({ name: 'Validated rule', payoutValue: '5', continuousMode: 'for_rule_duration', ...extra });
    const post = (extra: Record<string, unknown>) => request(app).post('/api/customer-value/rules').set(auth).send(body(extra));
    beforeAll(async () => {
      a = await mkNetwork(); b = await mkNetwork();
      app = buildDashboardApp();
      auth = bearer(operatorToken({ userId: randomUUID(), networkId: a.networkId, role: 'admin' }));
      dpTextA = await mkDataPoint(a, 'geo', 'text');
      dpNumA = await mkDataPoint(a, 'deposit', 'number');
      dpNumB = await mkDataPoint(b, 'deposit', 'number');
    });
    it("a rule using this network's offer, advertiser, partner and data points is accepted", async () => {
      const res = await post({
        applyOffersMode: 'specific', applyOfferIds: [a.offerId], applyAdvertisersMode: 'specific', applyAdvertiserIds: [a.advertiserId],
        applyPartnersMode: 'specific', applyPartnerIds: [a.publisherId], setGoalConditions: true,
        conditions: [
          { dataPointId: dpTextA, conditionLogic: 'any_value', operator: 'exact_match', value: 'US' },
          { dataPointId: dpNumA, conditionLogic: 'sum_of_values', operator: 'greater_than_or_equal_to', value: '99.5' },
        ],
      });
      expect(res.status).toBe(201);
    });
    it("another network's (or a non-existent) offer / advertiser / partner / data point is a 400", async () => {
      const ghost = randomUUID();
      const cases: Record<string, unknown>[] = [
        { applyOffersMode: 'specific', applyOfferIds: [b.offerId] },
        { applyOffersMode: 'specific', applyOfferIds: [a.offerId, ghost] },
        { applyAdvertisersMode: 'specific', applyAdvertiserIds: [b.advertiserId] },
        { applyPartnersMode: 'specific', applyPartnerIds: [b.publisherId] },
        { applyOffersMode: 'all', applyOfferIds: [b.offerId] }, // stored even in "all" mode → still checked
        { setGoalConditions: true, conditions: [{ dataPointId: dpNumB, conditionLogic: 'any_value', operator: 'greater_than', value: '1' }] },
        { setGoalConditions: true, conditions: [{ dataPointId: ghost, conditionLogic: 'any_value', operator: 'exact_match', value: 'x' }] },
      ];
      for (const c of cases) {
        const res = await post(c);
        expect(res.status, JSON.stringify(c)).toBe(400);
        expect(res.body.error.message).toMatch(/does not belong to this network|do not belong to this network/);
      }
      const created = await post({});
      const patch = await request(app).patch(`/api/customer-value/rules/${created.body.data.id}`).set(auth).send(body({ applyPartnersMode: 'specific', applyPartnerIds: [b.publisherId] }));
      expect(patch.status).toBe(400);
      const n = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_value_rules WHERE network_id = $1 AND $2::uuid = ANY(apply_offer_ids)`, [a.networkId, b.offerId])).rows[0]!.n;
      expect(n).toBe(0); // nothing foreign was stored
    });
    it("a condition that doesn't fit its data point's type is a 422", async () => {
      const bad = [
        { dataPointId: dpTextA, conditionLogic: 'any_value', operator: 'greater_than', value: 'US' },
        { dataPointId: dpTextA, conditionLogic: 'sum_of_values', operator: 'exact_match', value: 'US' },
        { dataPointId: dpNumA, conditionLogic: 'any_value', operator: 'exact_match', value: '100' },
        { dataPointId: dpNumA, conditionLogic: 'any_value', operator: 'greater_than', value: 'abc' },
        { dataPointId: dpNumA, conditionLogic: 'any_value', operator: 'greater_than', value: '1,000' },
      ];
      for (const cond of bad) {
        const res = await post({ setGoalConditions: true, conditions: [cond] });
        expect(res.status, JSON.stringify(cond)).toBe(422);
        expect(res.body.error.message).toMatch(/Condition 1/);
      }
    });
  });

  describe('/api/customer-value/data-points — a data point that rules use is protected (409)', () => {
    let app: Express; let auth: { Authorization: string }; let net: Net; let other: Net;
    const dpBody = (extra: Record<string, unknown> = {}) => ({ name: 'Deposit', dataType: 'number', parameterKey: 'deposit', ...extra });
    beforeAll(async () => {
      net = await mkNetwork(); other = await mkNetwork();
      app = buildDashboardApp();
      auth = bearer(operatorToken({ userId: randomUUID(), networkId: net.networkId, role: 'admin' }));
    });
    const mkUsed = async (key: string) => {
      const dp = (await request(app).post('/api/customer-value/data-points').set(auth).send(dpBody({ parameterKey: key }))).body.data.id as string;
      const rule = await request(app).post('/api/customer-value/rules').set(auth).send({ name: `Uses ${key}`, payoutValue: '5', continuousMode: 'for_rule_duration', setGoalConditions: true,
        conditions: [{ dataPointId: dp, conditionLogic: 'any_value', operator: 'greater_than', value: '1' }] });
      expect(rule.status).toBe(201);
      return { dp, rule: rule.body.data as { id: string; name: string } };
    };
    it('delete is a 409 naming the rule (with its id in details), and the data point stays', async () => {
      const { dp, rule } = await mkUsed('dep_del');
      const res = await request(app).delete(`/api/customer-value/data-points/${dp}`).set(auth);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('conflict');
      expect(res.body.error.message).toBe(`This data point is used by rule "${rule.name}". Remove it from that rule before you delete it.`);
      expect(res.body.error.details?.rules?.map((r: { id: string }) => r.id)).toEqual([rule.id]);
      expect((await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_data_points WHERE id = $1`, [dp])).rows[0]!.n).toBe(1);
    });
    it('changing the type or the parameter key is a 409; renaming only is fine', async () => {
      const { dp } = await mkUsed('dep_chg');
      const retype = await request(app).patch(`/api/customer-value/data-points/${dp}`).set(auth).send(dpBody({ parameterKey: 'dep_chg', dataType: 'text' }));
      expect(retype.status).toBe(409);
      expect(retype.body.error.message).toMatch(/before you change its type or parameter name\.$/);
      expect((await request(app).patch(`/api/customer-value/data-points/${dp}`).set(auth).send(dpBody({ parameterKey: 'dep_other' }))).status).toBe(409);
      const rename = await request(app).patch(`/api/customer-value/data-points/${dp}`).set(auth).send(dpBody({ name: 'First deposit', parameterKey: 'dep_chg' }));
      expect(rename.status).toBe(200);
      expect(rename.body.data).toMatchObject({ name: 'First deposit', dataType: 'number', parameterKey: 'dep_chg' });
    });
    it('a data point no rule uses can be retyped, re-keyed and deleted', async () => {
      const dp = (await request(app).post('/api/customer-value/data-points').set(auth).send(dpBody({ parameterKey: 'unused_dp' }))).body.data.id as string;
      expect((await request(app).patch(`/api/customer-value/data-points/${dp}`).set(auth).send(dpBody({ parameterKey: 'unused_dp2', dataType: 'text' }))).status).toBe(200);
      expect((await request(app).delete(`/api/customer-value/data-points/${dp}`).set(auth)).status).toBe(200);
    });
    it("another network's rule never blocks this network's data point", async () => {
      const dp = (await request(app).post('/api/customer-value/data-points').set(auth).send(dpBody({ parameterKey: 'iso_dp' }))).body.data.id as string;
      // A foreign rule that (contrived) references this id directly in the DB.
      await query(`INSERT INTO customer_value_rules (network_id, name, status, goal_cycle, continuous_mode, set_goal_conditions, conditions, outcome_frequency, payout_value)
        VALUES ($1, 'Foreign rule', 'active', 'continuous', 'for_rule_duration', true, $2, 'once_per_customer', '1')`,
        [other.networkId, JSON.stringify([{ dataPointId: dp, conditionLogic: 'any_value', operator: 'greater_than', value: '1' }])]);
      expect((await request(app).delete(`/api/customer-value/data-points/${dp}`).set(auth)).status).toBe(200);
    });
    it('a missing data point is still a 404', async () => {
      expect((await request(app).delete(`/api/customer-value/data-points/${randomUUID()}`).set(auth)).status).toBe(404);
      expect((await request(app).patch(`/api/customer-value/data-points/${randomUUID()}`).set(auth).send(dpBody())).status).toBe(404);
    });
  });

  describe('/api/customer-value/rules date contract', () => {
    let app: Express; let auth: { Authorization: string }; let net: Net;
    const body = (extra: Record<string, unknown>) => ({ name: 'Dated rule', payoutValue: 5, continuousMode: 'for_rule_duration', ...extra });
    beforeAll(async () => {
      net = await mkNetwork();
      app = buildDashboardApp();
      auth = bearer(operatorToken({ userId: randomUUID(), networkId: net.networkId, role: 'admin' }));
    });
    it('dates come back as YYYY-MM-DD (create, read, list) — never a timestamp', async () => {
      const created = await request(app).post('/api/customer-value/rules').set(auth).send(body({ startDate: '2026-03-01', endDate: '2026-03-31' }));
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' });
      const read = await request(app).get(`/api/customer-value/rules/${created.body.data.id}`).set(auth);
      expect(read.body.data).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' });
      const list = await request(app).get('/api/customer-value/rules?status=all').set(auth);
      expect(list.body.data.find((r: { id: string }) => r.id === created.body.data.id)).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-31' });
    });
    it('a save round-trip keeps the same days', async () => {
      const created = await request(app).post('/api/customer-value/rules').set(auth).send(body({ startDate: '2026-12-31', endDate: '2027-01-01' }));
      const { id, startDate, endDate } = created.body.data;
      const again = await request(app).patch(`/api/customer-value/rules/${id}`).set(auth).send(body({ startDate, endDate }));
      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ startDate: '2026-12-31', endDate: '2027-01-01' });
    });
    it('no dates: null and "" both mean none', async () => {
      const a = await request(app).post('/api/customer-value/rules').set(auth).send(body({ startDate: null, endDate: '' }));
      expect(a.status).toBe(201);
      expect(a.body.data).toMatchObject({ startDate: null, endDate: null });
    });
    it('amounts: decimal text and plain numbers are stored exactly; "" means not set', async () => {
      const a = await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: '0.0005', revenueValue: '12.3456' }));
      expect(a.status).toBe(201);
      expect(a.body.data).toMatchObject({ payoutValue: '0.0005', revenueValue: '12.3456' });
      const read = await request(app).get(`/api/customer-value/rules/${a.body.data.id}`).set(auth);
      expect(read.body.data).toMatchObject({ payoutValue: '0.0005', revenueValue: '12.3456' });
      const num = await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: 12.5, revenueValue: 0 }));
      expect(num.status).toBe(201); // existing numeric callers keep working
      expect(num.body.data).toMatchObject({ payoutValue: '12.5000', revenueValue: '0.0000' });
      const blank = await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: '', revenueValue: '3' }));
      expect(blank.status).toBe(201);
      expect(blank.body.data).toMatchObject({ payoutValue: null, revenueValue: '3.0000' });
    });
    it('amounts: negative, more than 4 decimals, separators, symbols or text are a 422 — never stored as null or rounded', async () => {
      for (const bad of ['-1', -1, '1.23456', 1.23456, '1,000', '$5', 'abc', '1e3', true]) {
        const res = await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: bad }));
        expect(res.status, JSON.stringify(bad)).toBe(422);
      }
      const created = await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: '7.25' }));
      const patch = await request(app).patch(`/api/customer-value/rules/${created.body.data.id}`).set(auth).send(body({ payoutValue: '7.123456' }));
      expect(patch.status).toBe(422);
      expect((await request(app).get(`/api/customer-value/rules/${created.body.data.id}`).set(auth)).body.data.payoutValue).toBe('7.2500');
      // Neither amount set → still a 422.
      expect((await request(app).post('/api/customer-value/rules').set(auth).send(body({ payoutValue: null, revenueValue: '' }))).status).toBe(422);
    });
    it('a bad date, a timestamp, or End before Start is a 422', async () => {
      for (const extra of [{ startDate: '2026-02-30' }, { endDate: '31/03/2026' }, { startDate: '2026-03-01T00:00:00.000Z' }, { startDate: '2026-03-31', endDate: '2026-03-01' }]) {
        const res = await request(app).post('/api/customer-value/rules').set(auth).send(body(extra));
        expect(res.status, JSON.stringify(extra)).toBe(422);
      }
      const created = await request(app).post('/api/customer-value/rules').set(auth).send(body({}));
      const patch = await request(app).patch(`/api/customer-value/rules/${created.body.data.id}`).set(auth).send(body({ startDate: '2026-05-02', endDate: '2026-05-01' }));
      expect(patch.status).toBe(422);
    });
  });
});
