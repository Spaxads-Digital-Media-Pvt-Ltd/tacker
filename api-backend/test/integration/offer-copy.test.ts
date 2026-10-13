/**
 * Copy Offer / Copy Offer Settings — on a real Postgres + Redis (INTEGRATION_DB=1, as in CI) —
 * audit F-11.
 *
 * Custom settings are copied with the CURRENT (v2) columns (the old lists named the dropped
 * event/value columns → 500, or copied the bigserial `ref` → duplicate display refs); goal_id is
 * re-pointed to the destination's matching goal; deleted settings stay behind. Copy Offer makes a
 * single DRAFT copy, and both operations are one transaction: a failure part-way leaves nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { getOfferConfig, offerCacheKey } from '../../src/surfaces/tracking/offer-cache.js';
import { getRedis } from '../../src/lib/redis.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

interface CustomSettingRow {
  id: string; ref: string; offer_id: string; category: string; status: string; partner_id: string | null;
  apply_custom_payout: boolean; payout_model: string | null; payout_value: string | null; caps: Record<string, unknown>;
  throttle_rate: string | null; landing_page_url: string | null; goal_id: string | null; targeting: Record<string, unknown>;
}

d('Copy Offer / Copy Offer Settings (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: { Authorization: string };
  const FAIL = `__fail_copy_${randomUUID().slice(0, 8)}__`;

  const offer = async (name: string, status = 'active') => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
     VALUES ($1, $2, $3, $4, 'https://example.com/lp/{click_id}', 5, 8) RETURNING id`,
    [fx.networkA, fx.advA, name, status])).rows[0]!.id;
  const goal = async (offerId: string) => (await query<{ id: string }>(
    `INSERT INTO offer_goals (network_id, offer_id, name, event_name, payout) VALUES ($1, $2, 'Sale', 'sale', 4) RETURNING id`,
    [fx.networkA, offerId])).rows[0]!.id;
  const customSetting = async (offerId: string, goalId: string | null, status = 'active') => (await query<{ id: string; ref: string }>(
    `INSERT INTO offer_custom_settings (network_id, offer_id, category, name, status, partner_id, apply_custom_payout,
       payout_model, payout_value, caps, throttle_rate, landing_page_url, goal_id, targeting)
     VALUES ($1, $2, 'revenue_payout', 'VIP payout', $3, $4, true, 'CPA', 7.5, '{"daily": 100}', 12.5,
       'https://example.com/vip', $5, '{"countries": ["US"]}') RETURNING id, ref::text`,
    [fx.networkA, offerId, status, fx.pubA1, goalId])).rows[0]!;
  const settingsOf = async (offerId: string) => (await query<CustomSettingRow>(
    `SELECT id, ref::text, offer_id, category, status, partner_id, apply_custom_payout, payout_model, payout_value::text,
            caps, throttle_rate::text, landing_page_url, goal_id, targeting
       FROM offer_custom_settings WHERE network_id = $1 AND offer_id = $2 ORDER BY created_at`, [fx.networkA, offerId])).rows;
  const copiesOf = async (name: string) => (await query<{ id: string; status: string }>(
    `SELECT id, status FROM offers WHERE network_id = $1 AND name = $2`, [fx.networkA, `${name} (copy)`])).rows;
  /** Make the forwarding-rule copy fail part-way (test-only trigger, matched by a unique rule name). */
  const withFailingForwardingCopy = async <T>(fn: () => Promise<T>): Promise<T> => {
    await query(`CREATE OR REPLACE FUNCTION f11_fail_copy() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name = '${FAIL}' THEN RAISE EXCEPTION 'forced copy failure'; END IF; RETURN NEW; END $$`);
    await query(`CREATE TRIGGER f11_fail_copy BEFORE INSERT ON offer_forwarding_rules FOR EACH ROW EXECUTE FUNCTION f11_fail_copy()`);
    try {
      return await fn();
    } finally {
      await query('DROP TRIGGER IF EXISTS f11_fail_copy ON offer_forwarding_rules');
      await query('DROP FUNCTION IF EXISTS f11_fail_copy()');
    }
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`copy-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('duplicate with custom settings → 201, exactly one DRAFT copy, v2 settings copied (own ref, goal re-pointed)', async () => {
    const name = `F-11 source ${randomUUID().slice(0, 6)}`;
    const src = await offer(name, 'active');
    const srcGoal = await goal(src);
    const srcSetting = await customSetting(src, srcGoal);
    await customSetting(src, null, 'deleted');
    await query(`INSERT INTO offer_geo_rules (network_id, offer_id, country, action, payout_override) VALUES ($1, $2, 'CA', 'allow', 9)`, [fx.networkA, src]);

    const res = await request(dash).post(`/api/offers/${src}/duplicate`).set(admin).send({ includeCustomSettings: true });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: `${name} (copy)`, status: 'draft' });
    const copies = await copiesOf(name);
    expect(copies).toEqual([{ id: res.body.data.id, status: 'draft' }]);
    const copyId = copies[0]!.id;

    const [copyGoal] = (await query<{ id: string }>(`SELECT id FROM offer_goals WHERE offer_id = $1`, [copyId])).rows;
    const settings = await settingsOf(copyId);
    expect(settings).toHaveLength(1); // the deleted setting stayed behind
    expect(settings[0]).toMatchObject({
      category: 'revenue_payout', status: 'active', partner_id: fx.pubA1, apply_custom_payout: true, payout_model: 'CPA',
      payout_value: '7.5000', caps: { daily: 100 }, throttle_rate: '12.50', landing_page_url: 'https://example.com/vip',
      targeting: { countries: ['US'] }, goal_id: copyGoal!.id,
    });
    expect(settings[0]!.ref).not.toBe(srcSetting.ref);
    expect((await query(`SELECT 1 FROM offer_geo_rules WHERE offer_id = $1 AND country = 'CA'`, [copyId])).rows).toHaveLength(1);
  });

  it('a failure part-way through a duplicate leaves no copy (and no orphan child rows) behind', async () => {
    const name = `F-11 atomic ${randomUUID().slice(0, 6)}`;
    const src = await offer(name);
    await goal(src);
    await query(`INSERT INTO offer_forwarding_rules (network_id, offer_id, name, status) VALUES ($1, $2, $3, 'active')`, [fx.networkA, src, FAIL]);

    const res = await withFailingForwardingCopy(() =>
      request(dash).post(`/api/offers/${src}/duplicate`).set(admin).send({ includeForwardingRules: true, includeCustomSettings: true }));
    expect(res.status).toBe(500);
    expect(await copiesOf(name)).toEqual([]);
    expect(Number((await query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM offer_goals g WHERE g.network_id = $1 AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.id = g.offer_id)`,
      [fx.networkA])).rows[0]!.n)).toBe(0);
  });

  it('copy-settings-to copies the same v2 columns, gives each row its own ref, keeps target geo rules, busts the target cache', async () => {
    const src = await offer(`F-11 cs src ${randomUUID().slice(0, 6)}`);
    const srcGoal = await goal(src);
    await customSetting(src, srcGoal);
    await query(`INSERT INTO offer_geo_rules (network_id, offer_id, country, action, payout_override) VALUES ($1, $2, 'US', 'allow', 20), ($1, $2, 'CA', 'allow', 9)`, [fx.networkA, src]);
    const target = await offer(`F-11 cs target ${randomUUID().slice(0, 6)}`);
    const targetGoal = await goal(target);
    await query(`INSERT INTO offer_geo_rules (network_id, offer_id, country, action, payout_override) VALUES ($1, $2, 'US', 'allow', 3)`, [fx.networkA, target]);
    expect(await getOfferConfig(fx.networkA, target)).not.toBeNull(); // cached
    expect(await getRedis().exists(offerCacheKey(fx.networkA, target))).toBe(1);

    const res = await request(dash).post(`/api/offers/${src}/copy-settings-to`).set(admin).send({ targetOfferId: target, includeCustomSettings: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ copied: true, targetOfferId: target, geoRulesInserted: 1 });

    const copied = await settingsOf(target);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ payout_value: '7.5000', caps: { daily: 100 }, goal_id: targetGoal });
    const refs = (await query<{ n: string; distinct_n: string }>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT ref) AS distinct_n FROM offer_custom_settings WHERE network_id = $1`, [fx.networkA])).rows[0]!;
    expect(refs.distinct_n).toBe(refs.n);
    const us = (await query<{ payout_override: string }>(`SELECT payout_override::text FROM offer_geo_rules WHERE offer_id = $1 AND country = 'US'`, [target])).rows;
    expect(us).toEqual([{ payout_override: '3.0000' }]); // the target's own rule survived
    expect(await getRedis().exists(offerCacheKey(fx.networkA, target))).toBe(0);
  });

  it('copy-settings-to is all-or-nothing too', async () => {
    const src = await offer(`F-11 cs atomic ${randomUUID().slice(0, 6)}`);
    await customSetting(src, null);
    await query(`INSERT INTO offer_forwarding_rules (network_id, offer_id, name, status) VALUES ($1, $2, $3, 'active')`, [fx.networkA, src, FAIL]);
    const target = await offer(`F-11 cs atomic target ${randomUUID().slice(0, 6)}`);
    const res = await withFailingForwardingCopy(() =>
      request(dash).post(`/api/offers/${src}/copy-settings-to`).set(admin).send({ targetOfferId: target, includeCustomSettings: true, includeForwardingRules: true }));
    expect(res.status).toBe(500);
    expect(await settingsOf(target)).toEqual([]);
  });
});
