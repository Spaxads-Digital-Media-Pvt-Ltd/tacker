/**
 * Reporting integrity on a real Postgres (INTEGRATION_DB=1; skipped otherwise — the pure parts are
 * in test/filters/reporting-integrity.test.ts):
 *  - the Conversions report never returns an inbound secure_code / security_code value;
 *  - Pacing / Cap usage counts conversions exactly like cap enforcement (non-rejected), ignores
 *    another network's rows that point at this network's offer, and returns money as text;
 *  - malformed / zero / negative caps are "no cap" (200, excluded) — never a 500;
 *  - the Event report and Pacing money rows carry their currency;
 *  - Customer Value rejects secret data-point keys (422) and never returns a secret value;
 *  - /grouped rejects unknown params;
 *  - Click report `conversionStatus` (each value, on /clicks and /grouped), Event report grouping by
 *    goal id with goal-less conversions as `unmatched` rows, Click→Conversion Time `status`, the
 *    `currencies` metric (single / mixed / none) + mixed-currency Pacing summary, and partner
 *    credentials masked in /postback-logs (stored row unchanged);
 *  - custom metrics: empty PATCH and ungrammatical formulas are 422s;
 *  - conversion imports: ambiguous transactionId, negative amounts and blank rows are per-row
 *    errors, an all-failed job is logged as 'failed', and create rows default/validate currency.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { canConnect, resetDb, seedFixture, type Fixture } from '../helpers/db.js';
import { query } from '../../src/lib/db/pool.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const run = process.env.INTEGRATION_DB === '1';
const d = run ? describe : describe.skip;

d('reporting integrity (live DB)', () => {
  let app: Express;
  let fx: Fixture;
  let auth: { Authorization: string };
  let capOffer: string;
  let offerA2: string;
  let offerA2Ref: string;
  let offerARef: string;

  const uid = () => randomUUID().replace(/-/g, '');
  async function conv(o: {
    networkId: string; offerId: string; status: 'pending' | 'approved' | 'rejected';
    payout?: string; revenue?: string; txn?: string | null; rawParams?: Record<string, unknown>; ago?: string;
  }): Promise<string> {
    const id = uid();
    await query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, payout, revenue,
                                currency, status, source, transaction_id, raw_params, created_at)
       VALUES ($1, $2, $1, $3, NULL, NULL, $4, $5, 'USD', $6, 'postback', $7, $8, now() - $9::interval)`,
      [id, o.networkId, o.offerId, o.payout ?? '1', o.revenue ?? '2', o.status, o.txn ?? null,
        JSON.stringify(o.rawParams ?? {}), o.ago ?? '0 seconds'],
    );
    return id;
  }
  const click = (networkId: string, offerId: string) => query(
    `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($1, $2, $3, NULL, now())`,
    [uid(), networkId, offerId]);
  const imp = (type: string, rows: Record<string, string>[]) =>
    request(app).post('/api/conversion-imports').set(auth).send({ type, rows });
  const payoutOf = async (networkId: string, offerId: string, txn: string) => (await query<{ payout: string }>(
    `SELECT payout::text AS payout FROM conversions WHERE network_id = $1 AND offer_id = $2 AND transaction_id = $3`,
    [networkId, offerId, txn])).rows[0]?.payout;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable. Run migrations against DATABASE_URL first.');
    await resetDb();
    fx = await seedFixture();
    app = buildDashboardApp();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    const mk = async (name: string, extra = '', vals: unknown[] = []) => (await query<{ id: string; ref: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url${extra ? `, ${extra}` : ''})
       VALUES ($1, $2, $3, 'active', 'https://example.com/{click_id}'${vals.map((_, i) => `, $${i + 4}`).join('')})
       RETURNING id, ref::text AS ref`, [fx.networkA, fx.advA, name, ...vals])).rows[0]!;
    const cap = await mk('Capped', 'daily_conversion_cap, total_conversion_cap, daily_click_cap', [10, 20, 4]);
    capOffer = cap.id;
    const a2 = await mk('Offer A2');
    offerA2 = a2.id; offerA2Ref = a2.ref;
    offerARef = (await query<{ ref: string }>(`SELECT ref::text AS ref FROM offers WHERE id = $1`, [fx.offerA])).rows[0]!.ref;
  });

  // ── 1. Secure-code redaction ──
  it('GET /api/reports/conversions redacts secure_code / Security_Code and keeps the other params', async () => {
    const id = await conv({
      networkId: fx.networkA, offerId: fx.offerA, status: 'approved',
      rawParams: { secure_code: 'TOPSECRET', Security_Code: 'ALSOSECRET', click_id: 'k-1', sub1: 'aff' },
    });
    const res = await request(app).get(`/api/reports/conversions?offerId=${fx.offerA}&limit=500`).set(auth);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: { conversion_id: string }) => r.conversion_id === id);
    expect(row.raw_params).toEqual({ secure_code: '[redacted]', Security_Code: '[redacted]', click_id: 'k-1', sub1: 'aff' });
    expect(JSON.stringify(res.body)).not.toMatch(/TOPSECRET|ALSOSECRET/);
  });

  describe('Offer Report (/api/reports?groupBy=offer)', () => {
    const mkOffer = async (name: string) => (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, $3, 'active', 'https://example.com/{click_id}') RETURNING id`,
      [fx.networkA, fx.advA, name])).rows[0]!.id;
    const clicks = async (offerId: string, n: number, flagged: boolean) => {
      for (let i = 0; i < n; i++) {
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at, is_unique, fraud_flags) VALUES ($1, $2, $3, '2026-05-05T10:00:00Z', true, $4)`,
          [uid(), fx.networkA, offerId, flagged ? ['datacenter'] : []]);
      }
    };
    const convAt = (offerId: string, status: string, payout: string, revenue: string) => query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, payout, revenue, currency, status, source, created_at)
       VALUES ($1, $2, $1, $3, $4, $5, 'USD', $6, 'postback', '2026-05-05T11:00:00Z')`, [uid(), fx.networkA, offerId, payout, revenue, status]);
    let gross: string; let net: string;
    beforeAll(async () => {
      // `gross` has more clicks in total but most are fraud-flagged; `net` has more VALID clicks.
      gross = await mkOffer('Offer report gross'); net = await mkOffer('Offer report net');
      await clicks(gross, 2, false); await clicks(gross, 6, true);
      await clicks(net, 5, false);
      await convAt(net, 'approved', '1.2345', '3.0000');
      await convAt(net, 'pending', '9.0000', '9.0000');
      await convAt(net, 'rejected', '7.0000', '7.0000');
    });
    const report = (qs: string) => request(app).get(`/api/reports?groupBy=offer&from=2026-05-05&to=2026-05-05&offerId=${gross},${net}&metrics=clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,currencies&${qs}`).set(auth);
    const order = (res: { body: { data: { rows: { dimensions: { offer: string } }[] } } }) => res.body.data.rows.map((r) => r.dimensions.offer);

    it('Clicks column sort (valid_clicks) orders by net clicks; gross `clicks` keeps its own order', async () => {
      expect(order(await report('orderBy=valid_clicks&orderDir=desc'))).toEqual([net, gross]); // 5 valid vs 2
      expect(order(await report('orderBy=clicks&orderDir=desc'))).toEqual([gross, net]);       // 8 gross vs 5
    });
    it('counts and money reconcile with the records: CV = approved only, Total CV = every status, money = approved, exact text', async () => {
      const rows = (await report('orderBy=valid_clicks')).body.data.rows as { dimensions: { offer: string }; metrics: Record<string, unknown> }[];
      const n = rows.find((r) => r.dimensions.offer === net)!.metrics;
      expect(n).toMatchObject({ clicks: 5, invalid_clicks: 0, conversions: 1, total_conversions: 3, payout: '1.2345', revenue: '3.0000', margin: '1.7655', currencies: ['USD'] });
      const g = rows.find((r) => r.dimensions.offer === gross)!.metrics;
      expect(g).toMatchObject({ clicks: 8, invalid_clicks: 6, conversions: 0, total_conversions: 0, payout: '0.0000', currencies: [] });
    });
    it('another network gets none of these offers\' rows', async () => {
      const authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
      const res = await request(app).get(`/api/reports?groupBy=offer&from=2026-05-05&to=2026-05-05&offerId=${gross},${net}`).set(authB);
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
    });
  });

  describe('Advertiser Report (/api/reports?groupBy=advertiser)', () => {
    let advGross: string; let advNet: string;
    const mkAdv = async (name: string) => (await query<{ id: string }>(`INSERT INTO advertisers (network_id, name) VALUES ($1, $2) RETURNING id`, [fx.networkA, name])).rows[0]!.id;
    const mkOffer = async (advertiserId: string) => (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'adv report offer', 'active', 'https://example.com/{click_id}') RETURNING id`,
      [fx.networkA, advertiserId])).rows[0]!.id;
    const clicks = async (offerId: string, n: number, flagged: boolean) => {
      for (let i = 0; i < n; i++) {
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at, is_unique, fraud_flags) VALUES ($1, $2, $3, '2026-06-06T10:00:00Z', true, $4)`,
          [uid(), fx.networkA, offerId, flagged ? ['datacenter'] : []]);
      }
    };
    const convAt = (offerId: string, advertiserId: string, status: string, payout: string, revenue: string) => query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, advertiser_id, payout, revenue, currency, status, source, created_at)
       VALUES ($1, $2, $1, $3, $4, $5, $6, 'USD', $7, 'postback', '2026-06-06T11:00:00Z')`, [uid(), fx.networkA, offerId, advertiserId, payout, revenue, status]);
    beforeAll(async () => {
      // advGross: 10 gross / 2 valid clicks, payout 5 → EPC 0.5. advNet: 4 gross / 4 valid, payout 1 → EPC 0.25.
      advGross = await mkAdv('Adv report gross'); advNet = await mkAdv('Adv report net');
      const og = await mkOffer(advGross); const on = await mkOffer(advNet);
      await clicks(og, 2, false); await clicks(og, 8, true);
      await clicks(on, 4, false);
      await convAt(og, advGross, 'approved', '5.0000', '8.0000');
      await convAt(on, advNet, 'approved', '1.0000', '2.5000');
      await convAt(on, advNet, 'pending', '3.0000', '3.0000');
    });
    const report = (qs: string, a = auth) => request(app).get(`/api/reports?groupBy=advertiser&from=2026-06-06&to=2026-06-06&advertiserId=${advGross},${advNet}&metrics=clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,epc,currencies&${qs}`).set(a);
    const order = (res: { body: { data: { rows: { dimensions: { advertiser: string } }[] } } }) => res.body.data.rows.map((r) => r.dimensions.advertiser);

    it('Clicks column sort (valid_clicks) orders by net clicks; gross `clicks` keeps its own order', async () => {
      expect(order(await report('orderBy=valid_clicks&orderDir=desc'))).toEqual([advNet, advGross]); // 4 valid vs 2
      expect(order(await report('orderBy=clicks&orderDir=desc'))).toEqual([advGross, advNet]);       // 10 gross vs 4
    });
    it('EPC sort orders by the API epc it displays (payout ÷ gross clicks)', async () => {
      const res = await report('orderBy=epc&orderDir=desc');
      expect(order(res)).toEqual([advGross, advNet]); // 0.5 vs 0.25
      expect(res.body.data.rows.map((r: { metrics: { epc: number } }) => r.metrics.epc)).toEqual([0.5, 0.25]);
    });
    it('counts and money reconcile: CV = approved, Total CV = every status, money exact text, per-advertiser', async () => {
      const rows = (await report('orderBy=valid_clicks')).body.data.rows as { dimensions: { advertiser: string }; metrics: Record<string, unknown> }[];
      expect(rows.find((r) => r.dimensions.advertiser === advNet)!.metrics).toMatchObject({ clicks: 4, invalid_clicks: 0, conversions: 1, total_conversions: 2, payout: '1.0000', revenue: '2.5000', margin: '1.5000', currencies: ['USD'] });
      expect(rows.find((r) => r.dimensions.advertiser === advGross)!.metrics).toMatchObject({ clicks: 10, invalid_clicks: 8, conversions: 1, total_conversions: 1, payout: '5.0000', revenue: '8.0000', margin: '3.0000' });
    });
    it('another network gets none of these advertisers\' rows', async () => {
      const authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
      const res = await report('orderBy=valid_clicks', authB);
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
    });
  });

  describe('Flex Report (/api/reports?groupBy=offer,publisher)', () => {
    let flexOffer: string;
    const clicks = async (publisherId: string | null, n: number, flagged: boolean) => {
      for (let i = 0; i < n; i++) {
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, is_unique, fraud_flags) VALUES ($1, $2, $3, $4, '2026-07-07T10:00:00Z', true, $5)`,
          [uid(), fx.networkA, flexOffer, publisherId, flagged ? ['datacenter'] : []]);
      }
    };
    const convAt = (publisherId: string, status: string, payout: string, revenue: string) => query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, payout, revenue, currency, status, source, created_at)
       VALUES ($1, $2, $1, $3, $4, $5, $6, 'USD', $7, 'postback', '2026-07-07T11:00:00Z')`, [uid(), fx.networkA, flexOffer, publisherId, payout, revenue, status]);
    beforeAll(async () => {
      flexOffer = (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Flex report offer', 'active', 'https://example.com/{click_id}') RETURNING id`,
        [fx.networkA, fx.advA])).rows[0]!.id;
      // Offer × Partner groups: pubA1 has the most clicks but most are fraud-flagged (9 gross, 2 valid);
      // pubA2 has 4 valid; traffic with no partner has 3 valid.
      await clicks(fx.pubA1, 2, false); await clicks(fx.pubA1, 7, true);
      await clicks(fx.pubA2, 4, false);
      await clicks(null, 3, false);
      await convAt(fx.pubA2, 'approved', '1.5000', '4.0000');
      await convAt(fx.pubA2, 'pending', '9.0000', '9.0000');
      await convAt(fx.pubA1, 'approved', '0.1000', '0.2500');
    });
    const report = (qs: string, a = auth, groupBy = 'offer,publisher') => request(app).get(`/api/reports?groupBy=${groupBy}&from=2026-07-07&to=2026-07-07&offerId=${flexOffer}&metrics=clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,currencies&${qs}`).set(a);
    type Row = { dimensions: { offer: string; publisher: string | null }; metrics: Record<string, unknown> };
    const pubs = (res: { body: { data: { rows: Row[] } } }) => res.body.data.rows.map((r) => r.dimensions.publisher);

    it('Clicks column sort (valid_clicks) orders the Offer × Partner groups by net clicks, both directions', async () => {
      expect(pubs(await report('orderBy=valid_clicks&orderDir=desc'))).toEqual([fx.pubA2, null, fx.pubA1]); // 4, 3, 2 valid
      expect(pubs(await report('orderBy=valid_clicks&orderDir=asc'))).toEqual([fx.pubA1, null, fx.pubA2]);
      expect(pubs(await report('orderBy=clicks&orderDir=desc'))).toEqual([fx.pubA1, fx.pubA2, null]);        // 9, 4, 3 gross
    });
    it('paging keeps the full-result order and the same total on every page', async () => {
      const full = pubs(await report('orderBy=valid_clicks&orderDir=desc'));
      const paged: (string | null)[] = [];
      for (let offset = 0; offset < 3; offset++) {
        const res = await report(`orderBy=valid_clicks&orderDir=desc&limit=1&offset=${offset}`);
        expect(res.body.data.total).toBe(3);
        paged.push(...pubs(res));
      }
      expect(paged).toEqual(full);
    });
    it('groups add up to the grand total — no double counting — and money is exact text per group', async () => {
      const rows = (await report('orderBy=valid_clicks')).body.data.rows as Row[];
      const sum = (k: string) => rows.reduce((s, r) => s + Number(r.metrics[k]), 0);
      const total = ((await report('', auth, 'none')).body.data.rows as Row[])[0]!.metrics;
      expect({ clicks: sum('clicks'), invalid_clicks: sum('invalid_clicks'), conversions: sum('conversions'), total_conversions: sum('total_conversions') })
        .toEqual({ clicks: total['clicks'], invalid_clicks: total['invalid_clicks'], conversions: total['conversions'], total_conversions: total['total_conversions'] });
      expect(total).toMatchObject({ clicks: 16, invalid_clicks: 7, conversions: 2, total_conversions: 3, payout: '1.6000', revenue: '4.2500', margin: '2.6500' });
      expect(rows.find((r) => r.dimensions.publisher === fx.pubA2)!.metrics).toMatchObject({ clicks: 4, conversions: 1, total_conversions: 2, payout: '1.5000', revenue: '4.0000', margin: '2.5000', currencies: ['USD'] });
      expect(rows.find((r) => r.dimensions.publisher === null)!.metrics).toMatchObject({ clicks: 3, conversions: 0, total_conversions: 0, payout: '0.0000', currencies: [] });
    });
    it('another network gets none of these rows', async () => {
      const authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
      const res = await report('orderBy=valid_clicks', authB);
      expect(res.status).toBe(200);
      expect(res.body.data.rows).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('Performance Graph day series (/api/reports?groupBy=day) — paged past the 200-row cap', () => {
    // 250 consecutive active days (one click each, a conversion every 50th day) on one offer.
    const DAYS = 250;
    const day0 = Date.UTC(2025, 0, 1);
    const dayStr = (i: number) => new Date(day0 + i * 86400e3).toISOString().slice(0, 10);
    let graphOffer: string;
    beforeAll(async () => {
      graphOffer = (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Graph series offer', 'active', 'https://example.com/{click_id}') RETURNING id`,
        [fx.networkA, fx.advA])).rows[0]!.id;
      await query(
        `INSERT INTO clicks (click_id, network_id, offer_id, created_at)
         SELECT replace(gen_random_uuid()::text, '-', ''), $1, $2, $3::timestamptz + (i || ' days')::interval + interval '12 hours'
           FROM generate_series(0, $4 - 1) AS i`, [fx.networkA, graphOffer, `${dayStr(0)}T00:00:00Z`, DAYS]);
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, payout, revenue, currency, status, source, created_at)
         SELECT c, $1, c, $2, '1.0000', '2.5000', 'USD', 'approved', 'postback', $3::timestamptz + (i || ' days')::interval + interval '13 hours'
           FROM (SELECT i, replace(gen_random_uuid()::text, '-', '') AS c FROM generate_series(0, $4 - 1, 50) AS i) s`,
        [fx.networkA, graphOffer, `${dayStr(0)}T00:00:00Z`, DAYS]);
    });
    // Exactly what every Performance Graph sends (groupBy=day, no orderBy), plus limit/offset.
    const series = (from: string, to: string, page: string, a = auth) => request(app).get(
      `/api/reports?groupBy=day&metrics=clicks,revenue,currencies&offerId=${graphOffer}&from=${from}T00:00:00.000Z&to=${to}T23:59:59.999Z&${page}`).set(a);
    type Row = { dimensions: { day: string }; metrics: { clicks: number; revenue: string } };
    const daysOf = (res: { body: { data: { rows: Row[] } } }) => res.body.data.rows.map((r) => r.dimensions.day.slice(0, 10));
    const allPages = async (from: string, to: string) => {
      const out: string[] = []; let total = -1; let requests = 0;
      for (let offset = 0; ; offset += 200) {
        const res = await series(from, to, `limit=200&offset=${offset}`);
        expect(res.status).toBe(200);
        requests++; total = res.body.data.total; out.push(...daysOf(res));
        if (res.body.data.rows.length < 200 || out.length >= total) break;
      }
      return { days: out, total, requests };
    };

    it('the API refuses a page over 200 rows — a graph cannot just ask for more', async () => {
      expect((await series(dayStr(0), dayStr(DAYS - 1), 'limit=201')).status).toBe(422);
    });
    it('one 200-row request of a 250-day range keeps the OLDEST 200 days and reports total=250', async () => {
      const res = await series(dayStr(0), dayStr(DAYS - 1), 'limit=200');
      expect(res.body.data.total).toBe(DAYS);
      expect(daysOf(res)).toEqual(Array.from({ length: 200 }, (_, i) => dayStr(i)));
    });
    it('paging (limit=200, offset) returns every one of the 250 days once, chronologically, newest last', async () => {
      const r = await allPages(dayStr(0), dayStr(DAYS - 1));
      expect(r).toMatchObject({ total: DAYS, requests: 2 });
      expect(r.days).toEqual(Array.from({ length: DAYS }, (_, i) => dayStr(i)));
    });
    it('exactly 200 and 199 active days fit in one request', async () => {
      expect(await allPages(dayStr(0), dayStr(199))).toMatchObject({ total: 200, requests: 1 });
      const r199 = await allPages(dayStr(0), dayStr(198));
      expect(r199).toMatchObject({ total: 199, requests: 1 });
      expect(r199.days.at(-1)).toBe(dayStr(198));
    });
    it('each day point carries that day\'s own totals (UTC day buckets), money as exact text', async () => {
      const res = await series(dayStr(200), dayStr(201), 'limit=200');
      expect(res.body.data.rows.map((r: Row) => ({ day: r.dimensions.day.slice(0, 10), clicks: r.metrics.clicks, revenue: r.metrics.revenue })))
        .toEqual([{ day: dayStr(200), clicks: 1, revenue: '2.5000' }, { day: dayStr(201), clicks: 1, revenue: '0.0000' }]);
    });
    it('a single-day range by hour is at most 24 points (Flex / Nested / Dimensional one-day graphs)', async () => {
      const res = await request(app).get(`/api/reports?groupBy=hour&metrics=clicks&offerId=${graphOffer}&from=${dayStr(5)}T00:00:00.000Z&to=${dayStr(5)}T23:59:59.999Z&limit=200`).set(auth);
      expect(res.body.data.total).toBeLessThanOrEqual(24);
      expect(res.body.data.rows).toHaveLength(1);
    });
    it('another network pages through nothing', async () => {
      const authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
      const res = await series(dayStr(0), dayStr(DAYS - 1), 'limit=200&offset=200', authB);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ rows: [], total: 0 });
    });
  });

  describe('Conversion Report rows', () => {
    let offerCR: string;
    beforeAll(async () => {
      offerCR = (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url) VALUES ($1, $2, 'Conv report', 'active', 'https://example.com/{click_id}') RETURNING id`,
        [fx.networkA, fx.advA])).rows[0]!.id;
    });
    const get = (qs: string, a = auth) => request(app).get(`/api/reports/conversions?offerId=${offerCR}&${qs}`).set(a);

    it('rows carry the stored ids, money (exact decimal text), currency and status of the conversion and its click', async () => {
      const clickId = uid();
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, country, device) VALUES ($1, $2, $3, $4, now() - interval '90 seconds', 'DE', 'mobile')`,
        [clickId, fx.networkA, offerCR, fx.pubA1]);
      const convId = uid();
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, payout, revenue, currency, status, source, transaction_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1.2345, 9.5, 'EUR', 'pending', 'postback', 'TXN-CR-1', now())`,
        [convId, fx.networkA, clickId, offerCR, fx.pubA1, fx.advA]);
      const row = (await get('limit=500')).body.data.find((r: { conversion_id: string }) => r.conversion_id === convId);
      expect(row).toMatchObject({
        conversion_id: convId, click_id: clickId, transaction_id: 'TXN-CR-1', offer_id: offerCR, publisher_id: fx.pubA1, advertiser_id: fx.advA,
        payout: '1.2345', revenue: '9.5000', currency: 'EUR', status: 'pending', source: 'postback', country: 'DE', device: 'mobile',
      });
      expect(row.delta_seconds).toBeGreaterThanOrEqual(89);
    });
    it('paging conversions that share one created_at returns each exactly once (stable order)', async () => {
      const at = '2026-03-04T05:06:07.000Z';
      const made: string[] = [];
      for (let i = 0; i < 7; i++) {
        const id = uid();
        await query(`INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, payout, revenue, currency, status, source, created_at)
                     VALUES ($1, $2, $1, $3, 1, 2, 'USD', 'approved', 'postback', $4)`, [id, fx.networkA, offerCR, at]);
        made.push(id);
      }
      const seen: string[] = [];
      for (let offset = 0; offset < 7; offset += 2) {
        seen.push(...(await get(`from=2026-03-04&to=2026-03-04&limit=2&offset=${offset}`)).body.data.map((r: { conversion_id: string }) => r.conversion_id));
      }
      expect(seen).toEqual([...made].sort().reverse());
    });
    it('status filter returns exactly that status; another network\'s conversions never appear', async () => {
      const mine = await conv({ networkId: fx.networkA, offerId: offerCR, status: 'rejected' });
      const theirs = await conv({ networkId: fx.networkB, offerId: offerCR, status: 'rejected' });
      const rejected = (await get('status=rejected&limit=500')).body.data as { conversion_id: string; status: string }[];
      expect(rejected.every((r) => r.status === 'rejected')).toBe(true);
      expect(rejected.map((r) => r.conversion_id)).toContain(mine);
      expect(rejected.map((r) => r.conversion_id)).not.toContain(theirs);
      const authB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
      expect((await get('limit=500', authB)).body.data.map((r: { conversion_id: string }) => r.conversion_id)).not.toContain(mine);
    });
    it('read-only admins can read the report but cannot approve or reject (admin / finance only)', async () => {
      const id = await conv({ networkId: fx.networkA, offerId: offerCR, status: 'pending' });
      for (const role of ['read_only', 'manager']) {
        const a = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role }));
        expect((await get('limit=1', a)).status, role).toBe(200);
        expect((await request(app).post(`/api/finance/conversions/${id}/approve`).set(a).send({})).status, role).toBe(403);
        expect((await request(app).post(`/api/finance/conversions/${id}/reject`).set(a).send({})).status, role).toBe(403);
      }
      expect((await query<{ status: string }>(`SELECT status FROM conversions WHERE conversion_id = $1`, [id])).rows[0]!.status).toBe('pending');
    });
  });

  // ── 2-4. Pacing + Caps ──
  describe('pacing / caps', () => {
    beforeAll(async () => {
      // Today: 1 approved (counts, and is the only payout/revenue), 2 pending (count — enforcement
      // counts them), 3 rejected (never count). Two days ago: 1 pending (all-time only).
      await conv({ networkId: fx.networkA, offerId: capOffer, status: 'approved', payout: '25.5', revenue: '10' });
      await conv({ networkId: fx.networkA, offerId: capOffer, status: 'pending', payout: '1000', revenue: '1000' });
      await conv({ networkId: fx.networkA, offerId: capOffer, status: 'pending', payout: '1000', revenue: '1000' });
      for (let i = 0; i < 3; i++) await conv({ networkId: fx.networkA, offerId: capOffer, status: 'rejected', payout: '1000' });
      await conv({ networkId: fx.networkA, offerId: capOffer, status: 'pending', ago: '2 days' });
      // Another network's rows carrying this network's offer id must never be counted.
      for (let i = 0; i < 5; i++) await conv({ networkId: fx.networkB, offerId: capOffer, status: 'approved', payout: '999', revenue: '999' });
      await click(fx.networkA, capOffer);
      for (let i = 0; i < 3; i++) await click(fx.networkB, capOffer);
      await query(
        `INSERT INTO offer_groups (network_id, name, offer_ids, caps_enabled, caps)
         VALUES ($1, 'Group 1', $2::jsonb, true, '{"payout":{"daily":100},"revenue":{"daily":50}}'::jsonb)`,
        [fx.networkA, JSON.stringify([capOffer])]);
    });

    it('summary counts non-rejected conversions (like enforcement) and only this network', async () => {
      const res = await request(app).get('/api/reports/pacing?category=conversion').set(auth);
      expect(res.status).toBe(200);
      const by = Object.fromEntries(res.body.data.summary.map((s: { category: string }) => [s.category, s]));
      expect(by.conversion.dailyUsedPct).toBe(30); // 3 of 10 (1 approved + 2 pending)
      expect(by.conversion.globalUsedPct).toBe(20); // 4 of 20
      expect(by.click.dailyUsedPct).toBe(25); // 1 of 4 — network B's 3 clicks ignored
      expect(by.payout.dailyUsedPct).toBe(25.5); // approved only: 25.5 of 100
      expect(by.revenue.dailyUsedPct).toBe(20); // approved only: 10 of 50
      expect(by.payout.mixedCurrency).toBeUndefined(); // one currency (USD cap, USD conversions)
    });

    it('conversion detail rows count non-rejected conversions per UTC day', async () => {
      const res = await request(app).get(`/api/reports/pacing?category=conversion&offerId=${capOffer}`).set(auth);
      expect(res.status).toBe(200);
      const actuals = res.body.data.rows.map((r: { actual: number }) => r.actual).sort();
      expect(actuals).toEqual([1, 3]);
      expect(res.body.data.rows.every((r: { cap: number }) => r.cap === 10)).toBe(true);
    });

    it('payout/revenue detail rows are approved-only and carry money as decimal text', async () => {
      const p = await request(app).get('/api/reports/pacing?category=payout').set(auth);
      expect(p.status).toBe(200);
      expect(p.body.data.rows).toHaveLength(1);
      expect(p.body.data.rows[0]).toMatchObject({ entity: 'Group 1', cap: '100.0000', actual: '25.5000', usedPct: 25.5 });
      const r = await request(app).get('/api/reports/pacing?category=revenue').set(auth);
      expect(r.body.data.rows[0]).toMatchObject({ cap: '50.0000', actual: '10.0000', usedPct: 20 });
    });

    it('/caps counts like enforcement and ignores other networks', async () => {
      const res = await request(app).get('/api/reports/caps').set(auth);
      expect(res.status).toBe(200);
      const row = res.body.data.find((x: { id: string }) => x.id === capOffer);
      expect(row).toMatchObject({ conversions_today: 3, conversions_total: 4, clicks_today: 1 });
    });

    it('malformed / zero / negative caps are "no cap": 200, left out, valid caps and totals unchanged', async () => {
      // Offer-group caps are free-form JSON — none of these may reach a numeric cast.
      const bad = ['"abc"', '""', '-5', '0', '"0.0000"', '"1e999"', '1e999', '"12abc"', '" 7"', '{"x":1}', '[1]', 'null', 'true'];
      for (const [i, v] of bad.entries()) {
        await query(
          `INSERT INTO offer_groups (network_id, name, offer_ids, caps_enabled, caps)
           VALUES ($1, $2, $3::jsonb, true, $4::jsonb)`,
          [fx.networkA, `Bad ${i}`, JSON.stringify([capOffer]), `{"payout":{"daily":${v}},"revenue":{"daily":${v}}}`]);
      }
      await query(`UPDATE offer_groups SET currency = 'EUR' WHERE network_id = $1 AND name = 'Group 1'`, [fx.networkA]);
      // Enforcement treats a 0 / negative offer cap as unlimited — so must Pacing / Caps (its traffic
      // must not inflate the summary numerator against a 0 denominator).
      const zero = (await query<{ id: string }>(
        `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, daily_conversion_cap, total_conversion_cap, daily_click_cap)
         VALUES ($1, $2, 'Zero caps', 'active', 'https://example.com/{click_id}', 0, -1, 0) RETURNING id`,
        [fx.networkA, fx.advA])).rows[0]!.id;
      for (let i = 0; i < 4; i++) await conv({ networkId: fx.networkA, offerId: zero, status: 'approved' });
      await click(fx.networkA, zero);

      const summary = await request(app).get('/api/reports/pacing?category=conversion').set(auth);
      expect(summary.status).toBe(200);
      const by = Object.fromEntries(summary.body.data.summary.map((s: { category: string }) => [s.category, s]));
      expect(by.conversion).toMatchObject({ dailyUsedPct: 30, globalUsedPct: 20 });
      expect(by.click.dailyUsedPct).toBe(25);
      // Group 1 is now capped in EUR while today's conversions are USD — a pooled % would add unlike
      // money, so it is reported as unavailable (the valid USD-only figures are asserted above).
      expect(by.payout).toMatchObject({ dailyUsedPct: null, mixedCurrency: true });
      expect(by.revenue).toMatchObject({ dailyUsedPct: null, mixedCurrency: true });
      expect(summary.body.data.rows.some((r: { entityId: string }) => r.entityId === zero)).toBe(false);
      for (const category of ['payout', 'revenue'] as const) {
        const res = await request(app).get(`/api/reports/pacing?category=${category}`).set(auth);
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toHaveLength(1);
        expect(res.body.data.rows[0]).toMatchObject({ entity: 'Group 1', currency: 'EUR' });
      }
      const clicks = await request(app).get(`/api/reports/pacing?category=click&offerId=${zero}`).set(auth);
      expect(clicks.status).toBe(200);
      expect(clicks.body.data.rows).toEqual([]);
      const caps = await request(app).get('/api/reports/caps').set(auth);
      expect(caps.status).toBe(200);
      expect(caps.body.data.some((x: { id: string }) => x.id === zero)).toBe(false);
    });
  });

  // ── Event report currency ──
  it('/goals rows carry the offer currency', async () => {
    await query(`UPDATE offers SET currency = 'INR' WHERE id = $1 AND network_id = $2`, [offerA2, fx.networkA]);
    await conv({ networkId: fx.networkA, offerId: offerA2, status: 'approved' });
    const res = await request(app).get(`/api/reports/goals?offerId=${offerA2}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBeGreaterThan(0);
    expect(res.body.data.rows.every((r: { currency: string }) => r.currency === 'INR')).toBe(true);
  });

  // ── Customer Value never exposes a secret raw param ──
  describe('customer value data points', () => {
    it.each(['secure_code', 'SECURITY_CODE', 'api_key', 'token'])('POST parameterKey %s → 422 and stores nothing', async (parameterKey) => {
      const res = await request(app).post('/api/customer-value/data-points').set(auth).send({ name: 'X', dataType: 'text', parameterKey });
      expect(res.status).toBe(422);
      const n = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM customer_data_points WHERE network_id = $1 AND lower(parameter_key) = lower($2)`, [fx.networkA, parameterKey])).rows[0]!.n;
      expect(n).toBe(0);
    });

    it('PATCH to a secret key → 422; /conversion-events never returns a secret value, even for a legacy data point', async () => {
      const plan = await request(app).post('/api/customer-value/data-points').set(auth).send({ name: 'Plan', dataType: 'text', parameterKey: 'plan' });
      expect(plan.status).toBe(201);
      const patch = await request(app).patch(`/api/customer-value/data-points/${plan.body.data.id}`).set(auth)
        .send({ name: 'Plan', dataType: 'text', parameterKey: 'secure_code' });
      expect(patch.status).toBe(422);
      // A data point created before the check existed.
      await query(`INSERT INTO customer_data_points (network_id, name, data_type, parameter_key) VALUES ($1, 'Legacy code', 'text', 'security_code')`, [fx.networkA]);
      await conv({ networkId: fx.networkA, offerId: fx.offerA, status: 'approved',
        rawParams: { user_id: 'cust-1', plan: 'gold', security_code: 'TOPSECRET2', secure_code: 'TOPSECRET3' } });
      const res = await request(app).get('/api/customer-value/conversion-events?userId=cust-1').set(auth);
      expect(res.status).toBe(200);
      expect(res.body.data.events).toHaveLength(1);
      expect(res.body.data.events[0].dataPoints).toEqual([{ name: 'Plan', parameterKey: 'plan', value: 'gold' }]);
      expect(JSON.stringify(res.body)).not.toMatch(/TOPSECRET/);
    });
  });

  // ── 5. /grouped strict ──
  it('/grouped rejects an unknown param with 422 and still serves known ones', async () => {
    expect((await request(app).get('/api/reports/grouped?groupBy=offer&status=approved').set(auth)).status).toBe(422);
    expect((await request(app).get(`/api/reports/grouped?groupBy=offer&offerId=${fx.offerA}`).set(auth)).status).toBe(200);
  });

  // ── 5b. Click report Conversion Status, Event report grouping, C2C status, currencies, postback URLs ──
  describe('conversion status / goals grouping / c2c status / currencies / postback redaction', () => {
    const newOffer = async (name: string) => (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url)
       VALUES ($1, $2, $3, 'active', 'https://example.com/{click_id}') RETURNING id`, [fx.networkA, fx.advA, name])).rows[0]!.id;
    const clickAt = async (networkId: string, offerId: string, ago = '0 seconds') => {
      const id = uid();
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($1, $2, $3, NULL, now() - $4::interval)`,
        [id, networkId, offerId, ago]);
      return id;
    };
    async function convFor(o: {
      networkId?: string; offerId: string; clickId?: string; status: 'pending' | 'approved' | 'rejected';
      payout?: string; currency?: string | null; goalId?: string | null; event?: string | null;
      source?: string; afterClick?: string; revenue?: string; publisherId?: string | null;
    }): Promise<string> {
      const id = uid();
      // `afterClick` dates the conversion relative to its click (for the C2C buckets).
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, payout, revenue,
                                  currency, status, source, goal_id, event_name, raw_params, created_at)
         VALUES ($1, $2, $3, $4, $12::uuid, NULL, $5::numeric, COALESCE($13::numeric, $5::numeric), $6, $7, $8, $9, $10, '{}',
                 COALESCE((SELECT k.created_at + $11::interval FROM clicks k WHERE k.click_id = $3 AND k.network_id = $2), now()))`,
        [id, o.networkId ?? fx.networkA, o.clickId ?? id, o.offerId, o.payout ?? '1', o.currency === undefined ? 'USD' : o.currency,
          o.status, o.source ?? 'postback', o.goalId ?? null, o.event ?? null, o.afterClick ?? '0 seconds',
          o.publisherId ?? null, o.revenue ?? null],
      );
      return id;
    }

    describe('Click Report filters: clickIds, ip, isUnique (+ new click fields)', () => {
      let offerCF: string;
      const c: Record<string, string> = {};
      const clickWith = async (networkId: string, offerId: string, ip: string, unique: boolean, extra: { referrer?: string; ua?: string; currency?: string; payout?: string } = {}) => {
        const id = uid();
        await query(
          `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, is_unique, referrer, user_agent, currency, resolved_payout)
           VALUES ($1, $2, $3, NULL, now(), $4::inet, $5, $6, $7, $8, $9::numeric)`,
          [id, networkId, offerId, ip, unique, extra.referrer ?? null, extra.ua ?? null, extra.currency ?? null, extra.payout ?? null]);
        return id;
      };
      const ids = (res: { body: { data: { click_id: string }[] } }) => res.body.data.map((r) => r.click_id).sort();
      beforeAll(async () => {
        offerCF = await newOffer('Click filters');
        c.v4 = await clickWith(fx.networkA, offerCF, '10.0.0.1', true, { referrer: 'https://r.example/p?api_key=K1&a=1', ua: 'QA-UA', currency: 'EUR', payout: '1.5' });
        c.dup = await clickWith(fx.networkA, offerCF, '10.0.0.2', false);
        c.v6 = await clickWith(fx.networkA, offerCF, '2001:db8::1', true);
        // Another tenant's click with the same IP never appears.
        c.other = await clickWith(fx.networkB, offerCF, '10.0.0.1', true);
        await convFor({ offerId: offerCF, clickId: c.v4!, status: 'approved', payout: '2' });
        await convFor({ offerId: offerCF, clickId: c.dup!, status: 'approved', payout: '3' });
      });
      const get = (qs: string) => request(app).get(`/api/reports/clicks?offerId=${offerCF}&limit=500&${qs}`).set(auth);

      it('clickIds (comma list, spaces, duplicates) returns exactly those clicks', async () => {
        const res = await get(`clickIds=${encodeURIComponent(` ${c.v4}, ${c.v6},${c.v4},`)}`);
        expect(res.status).toBe(200);
        expect(ids(res)).toEqual([c.v4!, c.v6!].sort());
      });
      it('ip matches exactly (IPv4 and IPv6) and stays inside the tenant', async () => {
        expect(ids(await get('ip=10.0.0.1'))).toEqual([c.v4]);
        expect(ids(await get(`ip=${encodeURIComponent('2001:db8::1')}`))).toEqual([c.v6]);
        expect(ids(await get('ip=10.9.9.9'))).toEqual([]);
        // The row's ip is the plain address (no /32), so it can be pasted straight into the filter.
        expect((await get(`clickIds=${c.v4}`)).body.data[0].ip).toBe('10.0.0.1');
      });
      it('isUnique (Visibility): unique vs duplicate clicks; combined with clickIds', async () => {
        expect(ids(await get('isUnique=false'))).toEqual([c.dup]);
        expect(ids(await get('isUnique=true'))).toEqual([c.v4!, c.v6!].sort());
        expect(ids(await get(`isUnique=true&clickIds=${c.v4},${c.dup}`))).toEqual([c.v4]);
      });
      it('rows carry the stored referrer (redacted), user agent, currency and click-time rates', async () => {
        const row = (await get(`clickIds=${c.v4}`)).body.data[0];
        expect(row).toMatchObject({ user_agent: 'QA-UA', currency: 'EUR', resolved_payout: '1.5000', referrer: 'https://r.example/p?api_key=[redacted]&a=1' });
        const stored = (await query<{ referrer: string }>(`SELECT referrer FROM clicks WHERE click_id = $1`, [c.v4])).rows[0]!.referrer;
        expect(stored).toContain('api_key=K1'); // the stored row is unchanged
      });
      it('/grouped applies the same filters to clicks and to their conversions', async () => {
        const g = async (qs: string) => (await request(app).get(`/api/reports/grouped?groupBy=offer&offerId=${offerCF}&${qs}`).set(auth)).body.data.rows[0];
        expect(await g(`clickIds=${c.v4}`)).toMatchObject({ clicks: 1, conversions: 1, payout: '2.0000' });
        expect(await g('ip=10.0.0.2')).toMatchObject({ clicks: 1, conversions: 1, payout: '3.0000' });
        expect(await g('isUnique=true')).toMatchObject({ clicks: 2, conversions: 1, payout: '2.0000' });
      });
      it('paging clicks that share one created_at returns each click exactly once (stable order)', async () => {
        const offer = await newOffer('Click paging ties');
        const at = '2026-03-04T05:06:07.000Z';
        const made: string[] = [];
        for (let i = 0; i < 7; i++) {
          const id = uid();
          await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at) VALUES ($1, $2, $3, $4)`, [id, fx.networkA, offer, at]);
          made.push(id);
        }
        const seen: string[] = [];
        for (let offset = 0; offset < 7; offset += 2) {
          const res = await request(app).get(`/api/reports/clicks?offerId=${offer}&from=2026-03-04&to=2026-03-04&limit=2&offset=${offset}`).set(auth);
          seen.push(...res.body.data.map((r: { click_id: string }) => r.click_id));
        }
        expect(seen).toEqual([...made].sort().reverse()); // newest first, then click_id desc
      });
      it('/grouped Day rows are chronological; groups without an offer use the network default currency', async () => {
        const offer = await newOffer('Click grouped order');
        for (const [ago, n] of [['2 days', 1], ['1 day', 5], ['0 days', 3]] as const) {
          for (let i = 0; i < n; i++) {
            await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at) VALUES ($1, $2, $3, date_trunc('day', now()) - $4::interval + interval '1 hour')`, [uid(), fx.networkA, offer, ago]);
          }
        }
        const prev = (await query<{ default_currency: string }>(`SELECT default_currency FROM networks WHERE id = $1`, [fx.networkA])).rows[0]!.default_currency;
        await query(`UPDATE networks SET default_currency = 'GBP' WHERE id = $1`, [fx.networkA]);
        try {
          const res = await request(app).get(`/api/reports/grouped?groupBy=day&offerId=${offer}&from=${new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10)}`).set(auth);
          const rows = res.body.data.rows as { key: string; clicks: number; currency: string }[];
          expect(rows.map((r) => r.clicks)).toEqual([1, 5, 3]);
          expect(rows.map((r) => r.key)).toEqual([...rows.map((r) => r.key)].sort());
          expect(rows.every((r) => r.currency === 'GBP')).toBe(true);
        } finally {
          await query(`UPDATE networks SET default_currency = $2 WHERE id = $1`, [fx.networkA, prev]);
        }
      });
      it('malformed values are 422s', async () => {
        expect((await get('clickIds=nope')).status).toBe(422);
        expect((await get('ip=10.0.0')).status).toBe(422);
        expect((await request(app).get('/api/reports/grouped?isUnique=maybe').set(auth)).status).toBe(422);
      });
    });

    describe('conversionStatus', () => {
      let offerCS: string;
      const k: Record<string, string> = {};
      beforeAll(async () => {
        offerCS = await newOffer('Conv status');
        for (const n of ['approved', 'pending', 'rejected', 'both', 'none']) k[n] = await clickAt(fx.networkA, offerCS);
        await convFor({ offerId: offerCS, clickId: k.approved!, status: 'approved', payout: '2' });
        await convFor({ offerId: offerCS, clickId: k.pending!, status: 'pending', payout: '50' });
        await convFor({ offerId: offerCS, clickId: k.rejected!, status: 'rejected', payout: '50' });
        await convFor({ offerId: offerCS, clickId: k.both!, status: 'approved', payout: '3' });
        await convFor({ offerId: offerCS, clickId: k.both!, status: 'rejected', payout: '50' });
        // Another network's conversion carrying this network's click id never counts.
        await convFor({ networkId: fx.networkB, offerId: offerCS, clickId: k.none!, status: 'approved' });
        // An offline conversion with no click row: counted with no filter, never under a click predicate.
        await convFor({ offerId: offerCS, status: 'approved', payout: '7', source: 'manual' });
      });

      it.each([
        [undefined, ['approved', 'pending', 'rejected', 'both', 'none']],
        ['any', ['approved', 'pending', 'rejected', 'both']],
        ['approved', ['approved', 'both']],
        ['pending', ['pending']],
        ['rejected', ['rejected', 'both']],
        ['none', ['none']],
      ] as const)('/clicks conversionStatus=%s', async (s, expected) => {
        const res = await request(app).get(`/api/reports/clicks?offerId=${offerCS}&limit=500${s ? `&conversionStatus=${s}` : ''}`).set(auth);
        expect(res.status).toBe(200);
        const ids = res.body.data.map((r: { click_id: string }) => r.click_id).sort();
        expect(ids).toEqual(expected.map((n) => k[n]).sort());
        // `converted` is still "any status".
        const conv = Object.fromEntries(res.body.data.map((r: { click_id: string; converted: boolean }) => [r.click_id, r.converted]));
        if (k.pending! in conv) expect(conv[k.pending!]).toBe(true);
        if (k.none! in conv) expect(conv[k.none!]).toBe(false);
      });

      it.each([
        [undefined, 5, 3, '12.0000'],
        ['any', 4, 2, '5.0000'],
        ['approved', 2, 2, '5.0000'],
        ['pending', 1, 0, '0'],
        ['rejected', 2, 1, '3.0000'],
        ['none', 1, 0, '0'],
      ] as const)('/grouped conversionStatus=%s → clicks %i, conversions %i', async (s, clicks, conversions, payout) => {
        const res = await request(app).get(`/api/reports/grouped?groupBy=offer&offerId=${offerCS}${s ? `&conversionStatus=${s}` : ''}`).set(auth);
        expect(res.status).toBe(200);
        const row = res.body.data.rows.find((r: { key: string }) => r.key === offerCS);
        expect(row).toMatchObject({ clicks, conversions });
        expect(Number(row.payout)).toBe(Number(payout));
      });
    });

    it('/goals: one row per goal id; goal-less conversions are separate unmatched rows', async () => {
      const offerG = await newOffer('Goals grouping');
      const goal = async (event: string) => (await query<{ id: string }>(
        `INSERT INTO offer_goals (network_id, offer_id, name, event_name) VALUES ($1, $2, 'Purchase', $3) RETURNING id`,
        [fx.networkA, offerG, event])).rows[0]!.id;
      const g1 = await goal('purchase_a');
      const g2 = await goal('purchase_b');
      await convFor({ offerId: offerG, status: 'approved', goalId: g1, event: 'purchase_a' });
      await convFor({ offerId: offerG, status: 'approved', goalId: g1, event: 'purchase_a', currency: 'EUR' });
      await convFor({ offerId: offerG, status: 'approved', goalId: g2, event: 'purchase_b' });
      await convFor({ offerId: offerG, status: 'pending', goalId: g2, event: 'purchase_b' }); // not counted
      // An import with the goal's NAME as its event: its own unmatched row, never merged into a goal.
      await convFor({ offerId: offerG, status: 'approved', event: 'Purchase', source: 'manual' });
      await convFor({ offerId: offerG, status: 'approved', event: null, source: 'manual', currency: null });
      const res = await request(app).get(`/api/reports/goals?offerId=${offerG}`).set(auth);
      expect(res.status).toBe(200);
      const rows = res.body.data.rows as { goal: string; goal_id: string | null; unmatched: boolean; conversions: number; currencies: string[] }[];
      const pick = (r: typeof rows[number]) => ({ goal: r.goal, goal_id: r.goal_id, unmatched: r.unmatched, conversions: r.conversions, currencies: r.currencies });
      const byKey = (x: object, y: object) => JSON.stringify(x).localeCompare(JSON.stringify(y));
      expect(rows.map(pick).sort(byKey)).toEqual([
        { goal: 'Purchase', goal_id: g1, unmatched: false, conversions: 2, currencies: ['EUR', 'USD'] },
        { goal: 'Purchase', goal_id: g2, unmatched: false, conversions: 1, currencies: ['USD'] },
        { goal: 'Purchase', goal_id: null, unmatched: true, conversions: 1, currencies: ['USD'] },
        { goal: '(no event)', goal_id: null, unmatched: true, conversions: 1, currencies: [] },
      ].sort(byKey));
      expect(res.body.data.total).toBe(4);
    });

    it('/click-to-conversion-time: status filter, default approved, manual conversions included', async () => {
      const offerT = await newOffer('C2C status');
      const c1 = await clickAt(fx.networkA, offerT, '1 hour');
      const c2 = await clickAt(fx.networkA, offerT, '1 hour');
      const c3 = await clickAt(fx.networkA, offerT, '1 hour');
      const c4 = await clickAt(fx.networkA, offerT, '1 hour');
      await convFor({ offerId: offerT, clickId: c1, status: 'approved', afterClick: '10 seconds' }); // b0
      await convFor({ offerId: offerT, clickId: c2, status: 'approved', afterClick: '20 seconds', source: 'manual' }); // b1
      await convFor({ offerId: offerT, clickId: c3, status: 'pending', afterClick: '100 seconds' }); // b3
      await convFor({ offerId: offerT, clickId: c4, status: 'rejected', afterClick: '400 seconds' }); // b6
      const get = async (qs: string) => {
        const res = await request(app).get(`/api/reports/click-to-conversion-time?offerId=${offerT}${qs}`).set(auth);
        expect(res.status).toBe(200);
        return res.body.data.rows.find((r: { key: string }) => r.key === offerT);
      };
      expect(await get('')).toMatchObject({ b0: 1, b1: 1, b3: 0, b6: 0, total: 2 });
      expect(await get('&status=approved')).toMatchObject({ b0: 1, b1: 1, total: 2 });
      expect(await get('&status=pending')).toMatchObject({ b0: 0, b3: 1, total: 1 });
      expect(await get('&status=rejected')).toMatchObject({ b6: 1, total: 1 });
      expect(await get('&status=all')).toMatchObject({ b0: 1, b1: 1, b3: 1, b6: 1, total: 4 });
    });

    it('`currencies` metric on /api/reports: single, mixed, none (approved + non-null only)', async () => {
      const single = await newOffer('Cur single');
      const mixed = await newOffer('Cur mixed');
      const none = await newOffer('Cur none');
      await convFor({ offerId: single, status: 'approved', currency: 'USD' });
      await convFor({ offerId: single, status: 'pending', currency: 'GBP' }); // not money-bearing
      await convFor({ offerId: mixed, status: 'approved', currency: 'USD', payout: '1' });
      await convFor({ offerId: mixed, status: 'approved', currency: 'EUR', payout: '2' });
      await convFor({ offerId: mixed, status: 'approved', currency: null, payout: '4' });
      await clickAt(fx.networkA, none);
      await convFor({ networkId: fx.networkB, offerId: none, status: 'approved', currency: 'JPY' }); // other tenant
      const res = await request(app).get(`/api/reports?groupBy=offer&metrics=payout,currencies&offerId=${single},${mixed},${none}`).set(auth);
      expect(res.status).toBe(200);
      const by = Object.fromEntries(res.body.data.rows.map((r: { dimensions: { offer: string }; metrics: unknown }) => [r.dimensions.offer, r.metrics]));
      expect(by[single]).toEqual({ payout: '1.0000', currencies: ['USD'] });
      expect(by[mixed]).toEqual({ payout: '7.0000', currencies: ['EUR', 'USD'] });
      expect(by[none]).toEqual({ payout: '0.0000', currencies: [] });
      const total = await request(app).get(`/api/reports?groupBy=none&metrics=currencies&offerId=${single},${mixed}`).set(auth);
      expect(total.body.data.rows[0].metrics).toEqual({ currencies: ['EUR', 'USD'] });
      // Omitting `metrics` keeps the existing default set.
      const dflt = await request(app).get(`/api/reports?groupBy=offer&offerId=${single}`).set(auth);
      expect(dflt.body.data.rows[0].metrics).not.toHaveProperty('currencies');
      // /grouped carries the same per row and in totals.
      const g = await request(app).get(`/api/reports/grouped?groupBy=offer&offerId=${single},${mixed},${none}`).set(auth);
      const gBy = Object.fromEntries(g.body.data.rows.map((r: { key: string; currencies: string[] }) => [r.key, r.currencies]));
      expect(gBy).toMatchObject({ [single]: ['USD'], [mixed]: ['EUR', 'USD'], [none]: [] });
      expect(g.body.data.totals.currencies).toEqual(['EUR', 'USD']);
    });

    it('/dashboard, /summary and /cohort expose the currencies behind their money', async () => {
      const offerX = await newOffer('Cur other endpoints');
      const kx = await clickAt(fx.networkA, offerX);
      await convFor({ offerId: offerX, clickId: kx, status: 'approved', currency: 'CHF', afterClick: '1 second' });
      await convFor({ offerId: offerX, clickId: kx, status: 'pending', currency: 'SEK', afterClick: '1 second' }); // not money-bearing
      const dash = await request(app).get('/api/reports/dashboard').set(auth);
      expect(dash.status).toBe(200);
      expect(dash.body.data.currencies.today).toContain('CHF');
      expect(dash.body.data.currencies.month).toContain('CHF');
      expect(dash.body.data.currencies.today).not.toContain('SEK');
      expect(dash.body.data.currencies.today).toEqual([...dash.body.data.currencies.today].sort());
      const sum = await request(app).get('/api/reports/summary').set(auth);
      expect(sum.body.data.currencies).toContain('CHF');
      expect(sum.body.data.currencies).not.toContain('SEK');
      // Cohort: a click two days ago converting an hour later (NOK) — its Day 1 cell has elapsed.
      const kOld = await clickAt(fx.networkA, offerX, '2 days');
      await convFor({ offerId: offerX, clickId: kOld, status: 'approved', currency: 'NOK', afterClick: '1 hour' });
      const day = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const cohort = await request(app).get(`/api/reports/cohort?from=${from}&to=${day}&metric=payout&offerId=${offerX}`).set(auth);
      expect(cohort.status).toBe(200);
      const cur = cohort.body.data.rows.map((r: { currencies: string[] }) => r.currencies);
      // Today's cohort has no elapsed day column yet, so no cell (and no currency) is shown for it.
      expect(cur).toEqual([['NOK'], []]);
      expect(cohort.body.data.currencies).toEqual(['NOK']);
    });

    it('/postback-logs masks the partner credentials in the url; the stored log is unchanged', async () => {
      const raw = 'https://bob:hunter2@partner.example/pb?click_id=c1&Token=PARTNERSECRET&api_key=KEY2&payout=1.5';
      const id = (await query<{ id: string }>(
        `INSERT INTO postback_logs (network_id, conversion_id, url, attempt, status_code, success)
         VALUES ($1, $2, $3, 1, 200, true) RETURNING id`, [fx.networkA, uid(), raw])).rows[0]!.id;
      const res = await request(app).get('/api/reports/postback-logs?limit=500').set(auth);
      expect(res.status).toBe(200);
      const row = res.body.data.find((r: { id: string }) => r.id === id);
      expect(row.url).toBe('https://[redacted]@partner.example/pb?click_id=c1&Token=[redacted]&api_key=[redacted]&payout=1.5');
      expect(JSON.stringify(res.body)).not.toMatch(/PARTNERSECRET|KEY2|hunter2/);
      const stored = (await query<{ url: string }>(`SELECT url FROM postback_logs WHERE id = $1 AND network_id = $2`, [id, fx.networkA])).rows[0]!.url;
      expect(stored).toBe(raw);
    });

    // ── Money by currency / money sort (never summed or compared across currencies) ──
    describe('money by currency', () => {
      const M = (payout: string, revenue: string, margin: string) => ({ payout, revenue, margin });
      let single: string; let mixed: string; let none: string;
      beforeAll(async () => {
        single = await newOffer('MBC single');
        mixed = await newOffer('MBC mixed');
        none = await newOffer('MBC none');
        await convFor({ offerId: single, status: 'approved', currency: 'USD', payout: '1', revenue: '3' });
        await convFor({ offerId: single, status: 'pending', currency: 'GBP', payout: '50', revenue: '50' }); // not money-bearing
        await convFor({ offerId: mixed, status: 'approved', currency: 'USD', payout: '1', revenue: '2' });
        await convFor({ offerId: mixed, status: 'approved', currency: 'EUR', payout: '2', revenue: '5' });
        await convFor({ offerId: mixed, status: 'approved', currency: null, payout: '4', revenue: '4' }); // NULL currency: in the sum, not split
        await clickAt(fx.networkA, none);
        await convFor({ networkId: fx.networkB, offerId: none, status: 'approved', currency: 'JPY', payout: '9' }); // other tenant
      });

      it('/api/reports money_by_currency: single, mixed, none; groupBy=none; opt-in only', async () => {
        const res = await request(app).get(`/api/reports?groupBy=offer&metrics=payout,money_by_currency&offerId=${single},${mixed},${none}`).set(auth);
        expect(res.status).toBe(200);
        const by = Object.fromEntries(res.body.data.rows.map((r: { dimensions: { offer: string }; metrics: unknown }) => [r.dimensions.offer, r.metrics]));
        expect(by[single]).toEqual({ payout: '1.0000', money_by_currency: { USD: M('1.0000', '3.0000', '2.0000') } });
        expect(by[mixed]).toEqual({ payout: '7.0000', money_by_currency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '2.0000', '1.0000') } });
        expect(by[none]).toEqual({ payout: '0.0000', money_by_currency: {} });
        expect(res.body.data.sortedWithinCurrency).toBeUndefined();
        const total = await request(app).get(`/api/reports?groupBy=none&metrics=money_by_currency&offerId=${single},${mixed},${none}`).set(auth);
        expect(total.body.data.rows[0].metrics).toEqual({ money_by_currency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('2.0000', '5.0000', '3.0000') } });
        const empty = await request(app).get(`/api/reports?groupBy=none&metrics=money_by_currency&offerId=${none}`).set(auth);
        expect(empty.body.data.rows[0].metrics).toEqual({ money_by_currency: {} });
        // Multi-dimension grouping (incl. a NULL dimension value) attaches to the right group.
        const two = await request(app).get(`/api/reports?groupBy=offer,country&metrics=money_by_currency&offerId=${mixed}`).set(auth);
        expect(two.body.data.rows).toEqual([{
          dimensions: { offer: mixed, country: null }, metrics: { money_by_currency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '2.0000', '1.0000') } },
          labels: { offer: { ref: expect.any(Number), name: expect.any(String) } }, // F-20: entity names on id dimensions
        }]);
        const dflt = await request(app).get(`/api/reports?groupBy=offer&offerId=${mixed}`).set(auth);
        expect(dflt.body.data.rows[0].metrics).not.toHaveProperty('money_by_currency');
        expect((await request(app).get(`/api/reports?orderBy=money_by_currency&offerId=${mixed}`).set(auth)).body.data.sortedWithinCurrency).toBeUndefined();
      });

      it('publisher portal: payout only — never revenue/margin, even when asked for', async () => {
        const pubOffer = await newOffer('MBC publisher');
        await convFor({ offerId: pubOffer, status: 'approved', currency: 'EUR', payout: '2', revenue: '9', publisherId: fx.pubA1 });
        await convFor({ offerId: pubOffer, status: 'approved', currency: 'USD', payout: '1', revenue: '9', publisherId: fx.pubA2 }); // other publisher
        const pub = bearer(portalToken({ userId: 'p1', networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 }));
        const res = await request(app).get(`/api/portal/publisher/stats?groupBy=offer&metrics=money_by_currency,revenue,margin&offerId=${pubOffer}`).set(pub);
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toEqual([{
          dimensions: { offer: pubOffer }, metrics: { money_by_currency: { EUR: { payout: '2.0000' } } },
          labels: { offer: { ref: expect.any(Number), name: 'MBC publisher' } },
        }]);
        const sum = await request(app).get('/api/portal/publisher/summary').set(pub);
        expect(sum.status).toBe(200);
        expect(sum.body.data.moneyByCurrency.EUR).toEqual({ payout: expect.any(String) });
        for (const v of Object.values(sum.body.data.moneyByCurrency as Record<string, object>)) expect(Object.keys(v)).toEqual(['payout']);
        expect(JSON.stringify(sum.body.data.moneyByCurrency)).not.toMatch(/revenue|margin/);
      });

      describe('money sort', () => {
        const o: Record<string, string> = {};
        beforeAll(async () => {
          for (const k of ['E5', 'E1', 'U3', 'U10', 'N0', 'NP', 'MX', 'NULL']) o[k] = await newOffer(`Sort ${k}`);
          await convFor({ offerId: o.E5!, status: 'approved', currency: 'EUR', payout: '5' });
          await convFor({ offerId: o.E1!, status: 'approved', currency: 'EUR', payout: '1' });
          await convFor({ offerId: o.U3!, status: 'approved', currency: 'USD', payout: '3' });
          await convFor({ offerId: o.U10!, status: 'approved', currency: 'USD', payout: '10' });
          await clickAt(fx.networkA, o.N0!); // no conversion at all
          await convFor({ offerId: o.NP!, status: 'pending', currency: 'USD', payout: '99' }); // no money-bearing conversion
          await convFor({ offerId: o.MX!, status: 'approved', currency: 'USD', payout: '1' });
          await convFor({ offerId: o.MX!, status: 'approved', currency: 'EUR', payout: '1' }); // mixed
          await convFor({ offerId: o.NULL!, status: 'approved', currency: null, payout: '100' }); // unknown currency → with mixed
        });
        const ids = () => Object.values(o).join(',');
        const byKey = (...ks: string[]) => ks.map((k) => o[k]!).sort();
        const page = async (qs: string) => {
          const res = await request(app).get(`/api/reports?groupBy=offer&metrics=payout&offerId=${ids()}&${qs}`).set(auth);
          expect(res.status).toBe(200);
          return res.body.data as { rows: { dimensions: { offer: string } }[]; total: number; sortedWithinCurrency?: boolean };
        };
        const offers = (d: { rows: { dimensions: { offer: string } }[] }) => d.rows.map((r) => r.dimensions.offer);

        it('payout desc: EUR rows (by value), USD rows (by value), no-money rows, mixed/unknown last', async () => {
          const d = await page('orderBy=payout&orderDir=desc&limit=100');
          expect(d.sortedWithinCurrency).toBe(true);
          expect(d.total).toBe(8);
          expect(offers(d)).toEqual([o.E5, o.E1, o.U10, o.U3, ...byKey('N0', 'NP'), ...byKey('MX', 'NULL')]);
        });

        it('payout asc reverses only the value within each currency', async () => {
          const d = await page('orderBy=payout&orderDir=asc&limit=100');
          expect(offers(d)).toEqual([o.E1, o.E5, o.U3, o.U10, ...byKey('N0', 'NP'), ...byKey('MX', 'NULL')]);
        });

        it('pagination across the currency boundary is consistent (sort happens before LIMIT/OFFSET)', async () => {
          const full = offers(await page('orderBy=revenue&orderDir=desc&limit=100'));
          const parts: string[] = [];
          for (let off = 0; off < 8; off += 3) {
            const d = await page(`orderBy=revenue&orderDir=desc&limit=3&offset=${off}`);
            expect(d.total).toBe(8);
            expect(d.sortedWithinCurrency).toBe(true);
            parts.push(...offers(d));
          }
          expect(parts).toEqual(full);
          expect(full.slice(2, 4)).toEqual([o.U10, o.U3]); // page 1 ends inside EUR→USD, page 2 starts in USD
        });

        it('margin and epc are money sorts too; clicks / conversions are unchanged and unflagged', async () => {
          for (const m of ['margin', 'epc']) expect((await page(`orderBy=${m}&limit=100`)).sortedWithinCurrency).toBe(true);
          const c = await request(app).get(`/api/reports?groupBy=offer&metrics=conversions&offerId=${ids()}&orderBy=conversions&orderDir=desc&limit=100`).set(auth);
          expect(c.status).toBe(200);
          expect(c.body.data.sortedWithinCurrency).toBeUndefined();
          const conv = c.body.data.rows as { dimensions: { offer: string }; metrics: { conversions: number } }[];
          const expected = [...conv].sort((a, b) => b.metrics.conversions - a.metrics.conversions || a.dimensions.offer.localeCompare(b.dimensions.offer));
          expect(conv.map((r) => r.dimensions.offer)).toEqual(expected.map((r) => r.dimensions.offer));
          expect(conv[0]!.metrics.conversions).toBe(2); // MX — a money sort would have put it last
        });
      });

      it('/grouped rows + totals, /goals rows carry moneyByCurrency', async () => {
        const g = await request(app).get(`/api/reports/grouped?groupBy=offer&offerId=${single},${mixed},${none}`).set(auth);
        expect(g.status).toBe(200);
        const gBy = Object.fromEntries(g.body.data.rows.map((r: { key: string; moneyByCurrency: unknown }) => [r.key, r.moneyByCurrency]));
        expect(gBy).toEqual({ [single]: { USD: M('1.0000', '3.0000', '2.0000') }, [mixed]: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '2.0000', '1.0000') }, [none]: {} });
        expect(g.body.data.totals.moneyByCurrency).toEqual({ EUR: M('2.0000', '5.0000', '3.0000'), USD: M('2.0000', '5.0000', '3.0000') });
        const goals = await request(app).get(`/api/reports/goals?offerId=${mixed}`).set(auth);
        expect(goals.status).toBe(200);
        expect(goals.body.data.rows).toHaveLength(1);
        expect(goals.body.data.rows[0]).toMatchObject({ unmatched: true, payout: '7.0000', moneyByCurrency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '2.0000', '1.0000') } });
        expect(goals.body.data.rows[0]).not.toHaveProperty('event_key');
      });

      it('/dashboard and /summary split today\'s money per currency (approved only)', async () => {
        const off = await newOffer('MBC dashboard');
        await convFor({ offerId: off, status: 'approved', currency: 'DKK', payout: '2', revenue: '7' });
        await convFor({ offerId: off, status: 'pending', currency: 'PLN', payout: '2', revenue: '7' });
        const dash = await request(app).get('/api/reports/dashboard').set(auth);
        expect(dash.status).toBe(200);
        expect(dash.body.data.moneyByCurrency.today.DKK).toEqual(M('2.0000', '7.0000', '5.0000'));
        expect(dash.body.data.moneyByCurrency.month.DKK).toEqual(M('2.0000', '7.0000', '5.0000'));
        expect(dash.body.data.moneyByCurrency.today).not.toHaveProperty('PLN');
        expect(Object.keys(dash.body.data.moneyByCurrency.today).sort()).toEqual([...dash.body.data.currencies.today].sort());
        const sum = await request(app).get('/api/reports/summary').set(auth);
        expect(sum.body.data.moneyByCurrency.DKK).toEqual(M('2.0000', '7.0000', '5.0000'));
        expect(Object.keys(sum.body.data.moneyByCurrency).sort()).toEqual(sum.body.data.currencies);
      });

      it('Pacing payout/revenue detail rows and /cohort split money per currency', async () => {
        const off = await newOffer('MBC pacing');
        await convFor({ offerId: off, status: 'approved', currency: 'EUR', payout: '2', revenue: '3' });
        await convFor({ offerId: off, status: 'approved', currency: 'USD', payout: '1.5', revenue: '4' });
        await query(
          `INSERT INTO offer_groups (network_id, name, offer_ids, caps_enabled, caps)
           VALUES ($1, 'MBC group', $2::jsonb, true, '{"payout":{"daily":100},"revenue":{"daily":50}}'::jsonb)`,
          [fx.networkA, JSON.stringify([off])]);
        const p = await request(app).get(`/api/reports/pacing?category=payout&offerId=${off}`).set(auth);
        expect(p.status).toBe(200);
        const row = p.body.data.rows.find((r: { entity: string }) => r.entity === 'MBC group');
        expect(row).toMatchObject({ actual: '3.5000', currencies: ['EUR', 'USD'], moneyByCurrency: { EUR: { payout: '2.0000' }, USD: { payout: '1.5000' } } });
        const r = await request(app).get(`/api/reports/pacing?category=revenue&offerId=${off}`).set(auth);
        expect(r.body.data.rows.find((x: { entity: string }) => x.entity === 'MBC group').moneyByCurrency).toEqual({ EUR: { revenue: '3.0000' }, USD: { revenue: '4.0000' } });

        const kOld = await clickAt(fx.networkA, off, '2 days');
        await convFor({ offerId: off, clickId: kOld, status: 'approved', currency: 'EUR', payout: '1.25', afterClick: '1 hour' });
        await convFor({ offerId: off, clickId: kOld, status: 'approved', currency: 'SEK', payout: '3', afterClick: '1 hour' });
        const day = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
        const c = await request(app).get(`/api/reports/cohort?from=${from}&to=${day}&metric=payout&offerId=${off}`).set(auth);
        expect(c.status).toBe(200);
        expect(c.body.data.moneyByCurrency).toEqual({ EUR: { payout: '1.2500' }, SEK: { payout: '3.0000' } });
        const cc = await request(app).get(`/api/reports/cohort?from=${from}&to=${day}&offerId=${off}`).set(auth);
        expect(cc.body.data.moneyByCurrency).toEqual({});
      });

      it('offer-group stats and list rows carry currencies + moneyByCurrency of the summed conversions', async () => {
        const off = await newOffer('MBC offer group');
        const k1 = await clickAt(fx.networkA, off);
        const k2 = await clickAt(fx.networkA, off);
        await convFor({ offerId: off, clickId: k1, status: 'approved', currency: 'EUR', payout: '2', revenue: '5' });
        await convFor({ offerId: off, clickId: k2, status: 'approved', currency: 'USD', payout: '1', revenue: '3' });
        const created = await request(app).post('/api/offer-groups').set(auth).send({ name: 'MBC stats', offerIds: [off], currency: 'USD' });
        expect(created.status).toBe(201);
        const s = await request(app).get(`/api/offer-groups/${created.body.data.id}/stats`).set(auth);
        expect(s.status).toBe(200);
        expect(s.body.data).toMatchObject({ payout: '3.0000', revenue: '8.0000', margin: '5.0000', clicks: 2, cv: 2, currencies: ['EUR', 'USD'],
          moneyByCurrency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '3.0000', '2.0000') } });
        const list = await request(app).get('/api/offer-groups').set(auth);
        const mine = list.body.data.find((g: { id: string }) => g.id === created.body.data.id);
        expect(mine.today).toEqual({ clicks: 2, payout: '3.0000', revenue: '8.0000', currencies: ['EUR', 'USD'],
          moneyByCurrency: { EUR: M('2.0000', '5.0000', '3.0000'), USD: M('1.0000', '3.0000', '2.0000') } });
        // Another network's group id is not readable.
        const other = await request(app).get(`/api/offer-groups/${created.body.data.id}/stats`).set(bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' })));
        expect(other.status).toBe(404);
      });
    });
  });

  // ── 6. Custom metrics ──
  describe('custom metrics', () => {
    it('PATCH {} → 422 (not 500); a real PATCH still works', async () => {
      const created = await request(app).post('/api/custom-metrics').set(auth)
        .send({ name: 'CR', formula: [{ type: 'op', value: '(' }, { type: 'metric', key: 'conversions' }, { type: 'op', value: '/' }, { type: 'metric', key: 'clicks' }, { type: 'op', value: ')' }, { type: 'op', value: '*' }, { type: 'const', value: 100 }] });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      const empty = await request(app).patch(`/api/custom-metrics/${id}`).set(auth).send({});
      expect(empty.status).toBe(422);
      expect(empty.body.ok).toBe(false);
      const ok = await request(app).patch(`/api/custom-metrics/${id}`).set(auth).send({ name: 'Conversion Rate' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.name).toBe('Conversion Rate');
    });

    it.each([
      ['[+]', [{ type: 'op', value: '+' }]],
      ['( clicks', [{ type: 'op', value: '(' }, { type: 'metric', key: 'clicks' }]],
      ['clicks clicks', [{ type: 'metric', key: 'clicks' }, { type: 'metric', key: 'clicks' }]],
    ])('rejects formula %s on POST and PATCH and stores nothing', async (_n, formula) => {
      const before = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM custom_metrics WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      const post = await request(app).post('/api/custom-metrics').set(auth).send({ name: 'Bad', formula });
      expect(post.status).toBe(422);
      const after = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM custom_metrics WHERE network_id = $1`, [fx.networkA])).rows[0]!.n;
      expect(after).toBe(before);
      const existing = (await query<{ id: string }>(`SELECT id FROM custom_metrics WHERE network_id = $1 LIMIT 1`, [fx.networkA])).rows[0]!.id;
      const patch = await request(app).patch(`/api/custom-metrics/${existing}`).set(auth).send({ formula });
      expect(patch.status).toBe(422);
    });
  });

  // ── 7. Conversion imports ──
  describe('conversion imports', () => {
    const dup = `DUP-${uid().slice(0, 8)}`;
    beforeAll(async () => {
      await conv({ networkId: fx.networkA, offerId: fx.offerA, status: 'pending', payout: '1', txn: dup });
      await conv({ networkId: fx.networkA, offerId: offerA2, status: 'pending', payout: '2', txn: dup });
    });

    it('a transactionId shared by two offers updates nothing and reports a per-row error', async () => {
      const res = await imp('update_by_transaction_id', [{ transactionId: dup, payout: '9' }]);
      expect(res.status).toBe(201);
      expect(res.body.data.error_count).toBe(1);
      expect(res.body.data.errors[0].message).toMatch(/matches 2 conversions on different offers/);
      expect(await payoutOf(fx.networkA, fx.offerA, dup)).toBe('1.0000');
      expect(await payoutOf(fx.networkA, offerA2, dup)).toBe('2.0000');
    });

    it('an offer column disambiguates the transactionId', async () => {
      const res = await imp('update_by_transaction_id', [{ transactionId: dup, offerRef: offerA2Ref, payout: '9' }]);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ total_processed: 1, error_count: 0, status: 'completed' });
      expect(await payoutOf(fx.networkA, offerA2, dup)).toBe('9.0000');
      expect(await payoutOf(fx.networkA, fx.offerA, dup)).toBe('1.0000');
    });

    it('negative payout/revenue are per-row errors (create and update) and write nothing', async () => {
      const neg = `NEG-${uid().slice(0, 8)}`;
      const c = await imp('create', [{ offerRef: offerARef, transactionId: neg, payout: '-5', revenue: '1' }]);
      expect(c.status).toBe(201);
      expect(c.body.data.errors[0].message).toMatch(/payout "-5" must not be negative/);
      expect(await payoutOf(fx.networkA, fx.offerA, neg)).toBeUndefined();
      const u = await imp('update_by_transaction_id', [{ transactionId: dup, offerRef: offerA2Ref, revenue: '-1' }]);
      expect(u.body.data.errors[0].message).toMatch(/revenue "-1" must not be negative/);
      expect(await payoutOf(fx.networkA, offerA2, dup)).toBe('9.0000');
    });

    it('blank rows are per-row errors instead of failing the whole batch', async () => {
      const ok = `OK-${uid().slice(0, 8)}`;
      const res = await imp('create', [{}, { transactionId: '', payout: '  ' }, { offerRef: offerARef, transactionId: ok, payout: '1', status: 'pending' }]);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ row_count: 3, total_processed: 1, error_count: 2, status: 'completed' });
      expect(res.body.data.errors).toEqual([{ row: 1, message: 'blank row — skipped' }, { row: 2, message: 'blank row — skipped' }]);
      expect(res.body.data.detail).toMatch(/2 of 3 rows failed/);
      expect(await payoutOf(fx.networkA, fx.offerA, ok)).toBe('1.0000');
    });

    it("create rows book in the offer's currency by default; a supplied one is validated and upper-cased", async () => {
      await query(`UPDATE offers SET currency = 'GBP' WHERE id = $1 AND network_id = $2`, [offerA2, fx.networkA]);
      const dflt = `DF-${uid().slice(0, 8)}`;
      const lower = `LC-${uid().slice(0, 8)}`;
      const bad = `BAD-${uid().slice(0, 8)}`;
      const res = await imp('create', [
        { offerRef: offerA2Ref, transactionId: dflt, payout: '1', revenue: '2' },
        { offerRef: offerA2Ref, transactionId: lower, payout: '1', revenue: '2', currency: 'eur' },
        { offerRef: offerA2Ref, transactionId: bad, payout: '1', revenue: '2', currency: 'US$' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ total_processed: 2, error_count: 1 });
      expect(res.body.data.errors).toEqual([{ row: 3, message: 'currency "US$" must be a 3-letter code (e.g. USD)' }]);
      const cur = async (txn: string) => (await query<{ currency: string; ledger: string | null }>(
        `SELECT c.currency, (SELECT string_agg(DISTINCT l.currency, ',') FROM ledger_entries l
                              WHERE l.network_id = c.network_id AND l.conversion_id = c.conversion_id) AS ledger
           FROM conversions c WHERE c.network_id = $1 AND c.offer_id = $2 AND c.transaction_id = $3`,
        [fx.networkA, offerA2, txn])).rows[0];
      expect(await cur(dflt)).toEqual({ currency: 'GBP', ledger: 'GBP' });
      expect(await cur(lower)).toEqual({ currency: 'EUR', ledger: 'EUR' });
      expect(await cur(bad)).toBeUndefined();
    });

    it("an import where every row fails is logged as 'failed'", async () => {
      const res = await imp('create', [{}, { offerRef: 'no-such-offer' }]);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'failed', total_processed: 0, error_count: 2 });
      expect(res.body.data.detail).toBe('Create Offline Conversions — 2 of 2 rows failed');
      const logged = (await query<{ status: string }>(`SELECT status FROM import_export_logs WHERE id = $1 AND network_id = $2`, [res.body.data.id, fx.networkA])).rows[0]!;
      expect(logged.status).toBe('failed');
      const list = await request(app).get('/api/conversion-imports').set(auth);
      expect(list.body.data.find((j: { id: string }) => j.id === res.body.data.id).status).toBe('failed');
    });
  });
});
