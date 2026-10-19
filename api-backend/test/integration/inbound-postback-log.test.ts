/**
 * Inbound postback log — live DB + Redis. Every conversion request the tracker processes (postback,
 * pixel, iframe, advertiser API) leaves one row with what happened to it — recorded, with its
 * conversion, or not — and why. The Advertiser Postback report reads them
 * (GET /api/reports/inbound-postbacks), network-scoped, with secrets masked.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { buildPublicApiApp } from '../../src/surfaces/public-api/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { generateApiKey, AUDIENCE_SCOPES } from '../../src/lib/apikeys/keys.js';
import { runRetention } from '../../src/lib/retention/retention.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

interface LogRow {
  source: string; method: string | null; click_id: string | null; transaction_id: string | null; event_name: string | null;
  offer_id: string | null; publisher_id: string | null; advertiser_id: string | null; outcome: string; reason: string | null;
  conversion_id: string | null; payout: string | null; revenue: string | null; sale_amount: string | null;
  http_status: number; ip: string | null; params: Record<string, unknown>;
}

d('inbound postback log: every request, recorded or not, and why (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let auth: { Authorization: string };

  const click = async (): Promise<string> => {
    const r = await track.inject({ method: 'GET', url: `/click?offer_id=${fx.offerA}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(r.statusCode).toBe(302);
    return new URL((r.headers.location as string).replace('{click_id}', '')).pathname.split('/').pop()!;
  };
  const postback = (qs: string, h: Record<string, string> = {}) => track.inject({ method: 'GET', url: `/postback?${qs}`, headers: { host, ...h }, remoteAddress: '203.0.113.7' });
  /** The log is written off the response path — wait for the row(s). */
  const logs = async (where: string, params: unknown[], n = 1): Promise<LogRow[]> => {
    for (let i = 0; i < 100; i++) {
      const { rows } = await query<LogRow>(
        `SELECT source, method, click_id, transaction_id, event_name, offer_id, publisher_id, advertiser_id, outcome, reason,
                conversion_id, payout, revenue, sale_amount, http_status, host(ip) AS ip, params
           FROM inbound_postback_logs WHERE network_id = $1 AND ${where} ORDER BY created_at`, [fx.networkA, ...params]);
      if (rows.length >= n) return rows;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error(`expected ${n} inbound log row(s) for ${where}`);
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`inlog-${randomUUID().slice(0, 8)}`);
    host = `inlog-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    await query(`UPDATE offers SET destination_url = 'https://adv.example.com/lp/{click_id}' WHERE id = $1`, [fx.offerA]);
    setHostResolver(new DbHostResolver());
    dash = buildDashboardApp();
    track = buildTrackingApp();
    await track.ready();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('a recorded postback: its conversion, money, request — and the security code masked', async () => {
    const c = await click();
    const res = await postback(`secure_code=${fx.secureCodeA}&click_id=${c}&txn_id=L1&status=approved&sale_amount=40`, { 'user-agent': 'AdvServer/1.0' });
    expect(res.statusCode).toBe(200);
    const [row] = await logs('click_id = $2', [c]);
    expect(row).toMatchObject({
      source: 'postback', method: 'GET', transaction_id: 'L1', outcome: 'approved', reason: null,
      conversion_id: res.json().conversion_id, offer_id: fx.offerA, publisher_id: fx.pubA1, advertiser_id: fx.advA,
      payout: '5.0000', revenue: '8.0000', sale_amount: '40.0000', http_status: 200, ip: '203.0.113.7',
    });
    expect(row!.params).toMatchObject({ secure_code: '[redacted]', click_id: c, txn_id: 'L1' });
    expect(JSON.stringify(row!.params)).not.toContain(fx.secureCodeA);
  });

  it('requests that record nothing are logged too, each with its reason', async () => {
    const c = await click();
    const ok = `secure_code=${fx.secureCodeA}&click_id=${c}&txn_id=L2&status=approved`;
    expect((await postback(ok)).statusCode).toBe(200);
    expect((await postback(ok)).json().status).toBe('duplicate');
    expect((await postback(`secure_code=wrong-code-123&click_id=${c}&txn_id=L3`)).statusCode).toBe(403);
    expect((await postback(`click_id=${c}&txn_id=L4`)).statusCode).toBe(403);
    const rows = await logs('click_id = $2', [c], 4);
    expect(rows.map((r) => [r.outcome, r.reason, r.http_status, r.conversion_id == null])).toEqual([
      ['approved', null, 200, false],
      ['duplicate', 'duplicate_transaction_id', 200, true],
      ['security_failed', 'wrong_security_code', 403, true],
      ['security_failed', 'missing_security_code', 403, true],
    ]);
    // Still attributed to the click's offer / partner / advertiser, so it shows under their filters.
    expect(new Set(rows.map((r) => r.offer_id))).toEqual(new Set([fx.offerA]));

    const unknown = randomUUID().replace(/-/g, '');
    expect((await postback(`secure_code=${fx.secureCodeA}&click_id=${unknown}`)).statusCode).toBe(404);
    expect(await logs('click_id = $2', [unknown])).toMatchObject([{ outcome: 'click_not_found', reason: 'unknown_click', http_status: 404, offer_id: null }]);
    const tag = `nc-${randomUUID().slice(0, 8)}`;
    expect((await postback(`secure_code=${fx.secureCodeA}&txn_id=${tag}`)).statusCode).toBe(404);
    expect(await logs('transaction_id = $2', [tag])).toMatchObject([{ outcome: 'click_not_found', reason: 'missing_click_id', click_id: null }]);
  });

  it('a pixel fired from a page that is not the offer’s site is logged with why it was refused', async () => {
    const c = await click();
    const r = await track.inject({ method: 'GET', url: `/pixel?click_id=${c}`, headers: { host, referer: 'https://partner-page.example/thanks' } });
    expect(r.statusCode).toBe(200);
    expect(await logs('click_id = $2', [c])).toMatchObject([{ source: 'pixel', outcome: 'security_failed', reason: 'browser_origin_not_allowed', http_status: 200 }]);
  });

  it('a held or rejected conversion is logged with its own reason', async () => {
    const c = await click();
    await postback(`secure_code=${fx.secureCodeA}&click_id=${c}&txn_id=R1&status=rejected`);
    expect(await logs('click_id = $2', [c])).toMatchObject([{ outcome: 'rejected', conversion_id: expect.any(String) }]);
  });

  it('a request for an unknown tracking host is not logged under any network', async () => {
    const c = randomUUID().replace(/-/g, '');
    const r = await track.inject({ method: 'GET', url: `/postback?secure_code=x&click_id=${c}`, headers: { host: `nobody-${randomUUID().slice(0, 8)}.test` } });
    expect(r.statusCode).toBe(404);
    await new Promise((res) => setTimeout(res, 100));
    expect((await query('SELECT 1 FROM inbound_postback_logs WHERE click_id = $1', [c])).rows).toHaveLength(0);
  });

  it('the advertiser API: recorded and refused requests, logged as source "api" under that advertiser', async () => {
    const key = generateApiKey('advertiser');
    await query(`INSERT INTO api_keys (network_id, audience, owner_id, key_prefix, key_hash, scopes, status, rate_limit_tier)
                 VALUES ($1, 'advertiser', $2, $3, $4, $5, 'active', 'default')`, [fx.networkA, fx.advA, key.prefix, key.keyHash, AUDIENCE_SCOPES.advertiser]);
    const api = buildPublicApiApp();
    const c = await click();
    const ok = await request(api).post('/api/v1/advertiser/conversions').set('x-api-key', key.fullKey).send({ click_id: c, txn_id: 'API-1' });
    expect(ok.status).toBe(201);
    const unknown = randomUUID().replace(/-/g, '');
    expect((await request(api).post('/api/v1/advertiser/conversions').set('x-api-key', key.fullKey).send({ click_id: unknown })).status).toBe(403);
    expect(await logs('click_id = $2', [c])).toMatchObject([{ source: 'api', method: 'POST', outcome: 'approved', advertiser_id: fx.advA, http_status: 201, transaction_id: 'API-1' }]);
    expect(await logs('click_id = $2', [unknown])).toMatchObject([{ source: 'api', outcome: 'click_not_found', reason: 'unknown_click', advertiser_id: fx.advA, http_status: 403 }]);
  });

  it('GET /api/reports/inbound-postbacks: this network only, filters, secrets masked, unknown filter → 422', async () => {
    const c = await click();
    await postback(`secure_code=${fx.secureCodeA}&click_id=${c}&txn_id=G1&status=approved`);
    await postback(`secure_code=${fx.secureCodeA}&click_id=${c}&txn_id=G1&status=approved`);
    await logs('click_id = $2', [c], 2);
    const all = await request(dash).get(`/api/reports/inbound-postbacks?clickId=${c}`).set(auth).expect(200);
    expect(all.body.data.map((r: LogRow) => r.outcome)).toEqual(['duplicate', 'approved']); // newest first
    expect(all.body.data[1].params.secure_code).toBe('[redacted]');
    const ignored = await request(dash).get(`/api/reports/inbound-postbacks?clickId=${c}&recorded=false`).set(auth).expect(200);
    expect(ignored.body.data.map((r: LogRow) => [r.outcome, r.reason])).toEqual([['duplicate', 'duplicate_transaction_id']]);
    const dup = await request(dash).get(`/api/reports/inbound-postbacks?outcome=duplicate&source=postback&offerId=${fx.offerA}`).set(auth).expect(200);
    expect(dup.body.data.length).toBeGreaterThan(0);
    expect(dup.body.data.every((r: LogRow) => r.outcome === 'duplicate')).toBe(true);
    const otherNetwork = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB }));
    expect((await request(dash).get(`/api/reports/inbound-postbacks?clickId=${c}`).set(otherNetwork).expect(200)).body.data).toEqual([]);
    expect((await request(dash).get('/api/reports/inbound-postbacks?status=approved').set(auth)).status).toBe(422);
  });

  it("retention prunes the log on the network's click window", async () => {
    await query(`UPDATE networks SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{retention}', '{"clickDays": 30, "conversionDays": 0}') WHERE id = $1`, [fx.networkA]);
    const old = `old-${randomUUID().slice(0, 8)}`;
    const fresh = `new-${randomUUID().slice(0, 8)}`;
    await query(`INSERT INTO inbound_postback_logs (network_id, created_at, source, outcome, transaction_id) VALUES
                   ($1, now() - interval '31 days', 'postback', 'duplicate', $2), ($1, now() - interval '29 days', 'postback', 'duplicate', $3)`,
      [fx.networkA, old, fresh]);
    const res = await runRetention();
    expect(res.inboundPostbackLogsDeleted).toBeGreaterThanOrEqual(1);
    const { rows } = await query<{ transaction_id: string }>(
      `SELECT transaction_id FROM inbound_postback_logs WHERE network_id = $1 AND transaction_id = ANY($2)`, [fx.networkA, [old, fresh]]);
    expect(rows.map((r) => r.transaction_id)).toEqual([fresh]);
  });
});
