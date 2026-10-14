/**
 * Reporting rollups and report time zones — on a real Postgres (INTEGRATION_DB=1, as in CI) — audit F-20.
 *
 *  - Once the worker has rolled the history up, a report read through the rollups (whole frozen
 *    15-minute buckets) + the raw tail equals the raw-only report exactly — every metric (money,
 *    currencies, per-currency money, fraud averages), groupings, filters, odd range edges, time zones.
 *  - It stays exact when a row lands late in an old bucket or a conversion's status changes later
 *    (the triggers mark the bucket dirty → read raw until the next run re-rolls it), and the rollups
 *    really are read (a raw row deleted afterwards still counts). Re-running the worker changes nothing.
 *  - An IST network's dashboard "today" starts at IST midnight; `?tz=` reports bucket local days and
 *    read plain dates as local days; an unknown zone is a 422. Report rows carry entity labels.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { PostgresReportingProvider } from '../../src/lib/reporting/postgres.js';
import { setReportingProvider } from '../../src/lib/reporting/index.js';
import { runRollup, rollupWindow } from '../../src/lib/reporting/rollups.js';
import { localDate, zonedDayStart, addDays } from '../../src/lib/reporting/time-zone.js';
import type { ReportRequest, Metric } from '../../src/lib/reporting/types.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

const ALL: Metric[] = ['clicks', 'unique_clicks', 'conversions', 'cr', 'payout', 'revenue', 'margin', 'epc',
  'invalid_clicks', 'total_conversions', 'avg_fraud_score', 'currencies', 'money_by_currency'];

d('reporting rollups + report time zones (live DB)', () => {
  const hybrid = new PostgresReportingProvider({ rollups: true });
  const raw = new PostgresReportingProvider({ rollups: false });
  let fx: Fixture;
  let offerB: string;
  let smartLink: string;
  let dash: Express;
  let auth: { Authorization: string };
  const run = randomUUID().slice(0, 8);
  // History from ~3 days ago up to ~4 hours ago (all of it older than the 3-hour freeze line).
  const base = Math.floor((Date.now() - 72 * 3600_000) / 3600_000) * 3600_000;
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

  const req = (over: Partial<ReportRequest>): ReportRequest => ({
    networkId: fx.networkA, groupBy: [], metrics: ALL, filters: {}, limit: 500, offset: 0,
    moneyFields: ['payout', 'revenue', 'margin'], ...over,
  });
  const same = async (r: ReportRequest) => {
    const [h, w] = await Promise.all([hybrid.runReport(r), raw.runReport(r)]);
    expect(h, JSON.stringify(r)).toEqual(w);
    return h;
  };
  const rollUntilClean = async () => {
    for (let i = 0; i < 30; i++) {
      const r = await runRollup(new Date(), { backfillChunkMs: 3650 * 24 * 3600_000 });
      if (!r.dirty && !r.backfilled) return;
    }
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`rollup-${run}`);
    offerB = (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue)
       VALUES ($1, $2, 'Rollup offer B', 'active', 'https://example.com/{click_id}', 5, 8) RETURNING id`, [fx.networkA, fx.advA])).rows[0]!.id;
    smartLink = (await query<{ id: string }>(`INSERT INTO smart_links (network_id, name) VALUES ($1, 'rollup sl') RETURNING id`, [fx.networkA])).rows[0]!.id;

    // ~60 clicks spread over three days at uneven minutes, mixed dims / flags / scores …
    const countries = ['US', 'IN', null, 'GB'];
    const devices = ['mobile', 'desktop', null];
    for (let i = 0; i < 60; i++) {
      const minute = i * 67 + (i % 7) * 3; // uneven, crosses bucket / hour / day edges
      await query(
        `INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, smart_link_id, country, device, is_unique, fraud_score, fraud_flags, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [`${run}-k${i}`, fx.networkA, i % 3 === 0 ? offerB : fx.offerA, i % 4 === 0 ? null : (i % 2 ? fx.pubA1 : fx.pubA2),
          i % 5 === 0 ? smartLink : null, countries[i % 4], devices[i % 3], i % 6 !== 0, (i * 13) % 100,
          i % 9 === 0 ? ['datacenter_ip'] : [], at(minute)]);
    }
    // … and conversions on some of them: approved / pending / rejected, three currencies (one NULL),
    // money with 4 decimals, one conversion without a click row.
    const statuses = ['approved', 'approved', 'pending', 'rejected', 'approved'];
    const currencies = ['USD', 'EUR', null, 'USD'];
    for (let i = 0; i < 40; i++) {
      const k = (i * 3) % 60;
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, source, status, payout, revenue, currency, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'postback', $7, $8, $9, $10, $11)`,
        [`${run}-cv${i}`, fx.networkA, i === 39 ? `${run}-orphan` : `${run}-k${k}`, i % 3 === 0 ? offerB : fx.offerA,
          i % 2 ? fx.pubA1 : fx.pubA2, fx.advA, statuses[i % 5], `${i}.${String(i * 37 % 10000).padStart(4, '0')}`,
          `${i * 2}.5005`, currencies[i % 4], at(k * 67 + 13 + (i % 4) * 11)]);
    }
    // Rebuild the rollups from scratch for this test DB, then let the worker catch up completely.
    await query('TRUNCATE stats_clicks_15m, stats_conversions_15m, stats_dirty_buckets');
    await query('DELETE FROM stats_rollup_state');
    await rollUntilClean();

    dash = buildDashboardApp();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });
  afterAll(() => setReportingProvider(new PostgresReportingProvider()));

  it('the worker rolled the history up: the rollup window covers it', async () => {
    const w = (await rollupWindow(fx.networkA))!;
    expect(w.low.getTime()).toBeLessThanOrEqual(base);
    expect(w.high.getTime()).toBeGreaterThan(base + 60 * 67 * 60_000 / 60); // past the newest seeded click
    const n = (await query<{ n: number }>('SELECT COALESCE(SUM(clicks), 0)::int AS n FROM stats_clicks_15m WHERE network_id = $1', [fx.networkA])).rows[0]!.n;
    expect(n).toBe(60);
  });

  it.each([
    ['grand total', {}],
    ['by offer, odd range edges', { groupBy: ['offer'], filters: { from: at(50), to: at(2 * 1440 + 187) } }],
    ['by partner × day in IST', { groupBy: ['publisher', 'day'], timeZone: 'Asia/Kolkata' }],
    ['by country × device, offer list + country exclusion', { groupBy: ['country', 'device'], filters: { offerId: ['', ''], excludeCountry: 'GB' } }],
    ['by advertiser, advertiser filter', { groupBy: ['advertiser'], filters: { advertiserId: '' } }],
    ['by smart link, smart-link exclusion', { groupBy: ['smartLink'], filters: { excludeSmartLinkId: '' } }],
    ['by hour in New York over a day', { groupBy: ['hour'], timeZone: 'America/New_York', filters: { from: at(1440), to: at(2 * 1440) } }],
    ['by day UTC, sorted by payout (per currency)', { groupBy: ['day'], orderBy: 'payout', orderDir: 'desc' }],
    ['by offer, sorted by margin, Kathmandu', { groupBy: ['offer'], orderBy: 'margin', timeZone: 'Asia/Kathmandu' }],
  ] as [string, Partial<ReportRequest>][])('%s: rollups + raw tail = raw', async (_, over) => {
    // Fill in ids the table above can't know at definition time.
    const filters = { ...(over.filters ?? {}) };
    if (Array.isArray(filters.offerId)) filters.offerId = [fx.offerA, offerB];
    if (filters.advertiserId === '') filters.advertiserId = fx.advA;
    if (filters.excludeSmartLinkId === '') filters.excludeSmartLinkId = smartLink;
    const r = await same(req({ ...over, filters }));
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('stays exact after a late row in an old bucket and a status change days later; the next run re-rolls them', async () => {
    await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, country, created_at) VALUES ($1, $2, $3, $4, 'US', $5)`,
      [`${run}-late`, fx.networkA, fx.offerA, fx.pubA1, at(500)]);
    await query(`UPDATE conversions SET status = 'approved' WHERE conversion_id = $1`, [`${run}-cv2`]); // was pending
    await query(`UPDATE conversions SET status = 'rejected' WHERE conversion_id = $1`, [`${run}-cv0`]); // was approved
    const dirty = (await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM stats_dirty_buckets WHERE network_id = $1', [fx.networkA])).rows[0]!.n;
    expect(dirty).toBeGreaterThanOrEqual(2);
    for (const over of [{}, { groupBy: ['offer', 'day'] }, { groupBy: ['country'] }] as Partial<ReportRequest>[]) await same(req(over));

    await rollUntilClean();
    expect((await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM stats_dirty_buckets WHERE network_id = $1', [fx.networkA])).rows[0]!.n).toBe(0);
    const total = await same(req({}));
    expect(total.rows[0]!.metrics['clicks']).toBe(61);
  });

  it('re-running the worker is idempotent', async () => {
    const snap = () => query(
      `SELECT bucket, COALESCE(offer_id::text, '') AS o, SUM(clicks)::int AS c FROM stats_clicks_15m WHERE network_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [fx.networkA]);
    const before = (await snap()).rows;
    await runRollup(new Date());
    await runRollup(new Date());
    expect((await snap()).rows).toEqual(before);
  });

  it('the rollups really are read: a raw row deleted afterwards (retention) still counts in the hybrid report', async () => {
    await query('DELETE FROM clicks WHERE click_id = $1', [`${run}-k5`]);
    const [h, w] = await Promise.all([hybrid.runReport(req({})), raw.runReport(req({}))]);
    expect(Number(h.rows[0]!.metrics['clicks'])).toBe(Number(w.rows[0]!.metrics['clicks']) + 1);
  });

  describe('time zones', () => {
    it("an IST network's dashboard: today starts at IST midnight; ?tz= overrides; the hourly series is local", async () => {
      const ist = await seedFixture(`rollup-ist-${run}`);
      await query(`UPDATE networks SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{general}', '{"timezone": "Asia/Kolkata"}'::jsonb) WHERE id = $1`, [ist.networkA]);
      const today = localDate(new Date(), 'Asia/Kolkata');
      const midnight = zonedDayStart(today, 'Asia/Kolkata');
      const clicks = [new Date(midnight.getTime() - 1), midnight, new Date(midnight.getTime() + 60_000)];
      for (const [i, t] of clicks.entries()) {
        if (t.getTime() > Date.now()) continue; // (the first minute after midnight)
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at) VALUES ($1, $2, $3, $4)`, [`${run}-ist${i}`, ist.networkA, ist.offerA, t.toISOString()]);
      }
      const inToday = clicks.filter((t) => t >= midnight && t.getTime() <= Date.now()).length;
      const istAuth = bearer(operatorToken({ userId: randomUUID(), networkId: ist.networkA }));
      for (const provider of [raw, hybrid]) {
        setReportingProvider(provider);
        const res = await request(dash).get('/api/reports/dashboard').set(istAuth);
        expect(res.status).toBe(200);
        expect(res.body.data.timeZone).toBe('Asia/Kolkata');
        expect(res.body.data.clicks.today).toBe(inToday);
        expect(res.body.data.clicks.yesterday).toBe(1);
        expect(res.body.data.series.clicks[0]).toBe(inToday); // both today-clicks are in IST hour 00
      }
      // Under UTC the same clicks fall on the UTC calendar.
      const utc = await request(dash).get('/api/reports/dashboard?tz=UTC').set(istAuth);
      const utcToday = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      expect(utc.body.data.timeZone).toBe('UTC');
      expect(utc.body.data.clicks.today).toBe(clicks.filter((t) => t.getTime() >= utcToday && t.getTime() <= Date.now()).length);
      expect((await request(dash).get('/api/reports/dashboard?tz=Mars/Olympus').set(istAuth)).status).toBe(422);
    });

    it('?tz= reports: local-day buckets with their offset, plain dates read as local days', async () => {
      setReportingProvider(raw);
      const day = '2026-03-10';
      const istStart = zonedDayStart(day, 'Asia/Kolkata'); // 2026-03-09T18:30Z
      const tz = await seedFixture(`rollup-tz-${run}`);
      for (const [i, t] of [new Date(istStart.getTime() - 60_000), istStart, new Date(istStart.getTime() + 5 * 3600_000)].entries()) {
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, created_at) VALUES ($1, $2, $3, $4)`, [`${run}-tz${i}`, tz.networkA, tz.offerA, t.toISOString()]);
      }
      const tzAuth = bearer(operatorToken({ userId: randomUUID(), networkId: tz.networkA }));
      const byDay = await request(dash).get(`/api/reports?groupBy=day&metrics=clicks&tz=Asia/Kolkata&from=${addDays(day, -1)}&to=${day}`).set(tzAuth);
      expect(byDay.status).toBe(200);
      expect(byDay.body.data.rows.map((r: { dimensions: { day: string }; metrics: { clicks: number } }) => [r.dimensions.day, r.metrics.clicks]))
        .toEqual([['2026-03-09T00:00:00+05:30', 1], ['2026-03-10T00:00:00+05:30', 2]]);
      const oneDay = await request(dash).get(`/api/reports?groupBy=none&metrics=clicks&tz=Asia/Kolkata&from=${day}&to=${day}`).set(tzAuth);
      expect(oneDay.body.data.rows[0].metrics.clicks).toBe(2);
      // UTC (default) keeps the old shape — and all three clicks (18:29Z–23:30Z) are one UTC day.
      const utc = await request(dash).get(`/api/reports?groupBy=day&metrics=clicks&from=2026-03-09&to=2026-03-10`).set(tzAuth);
      expect(utc.body.data.rows.map((r: { dimensions: { day: string }; metrics: { clicks: number } }) => [r.dimensions.day, r.metrics.clicks]))
        .toEqual([['2026-03-09T00:00:00.000Z', 3]]);
      expect((await request(dash).get('/api/reports?tz=Nowhere/Land').set(tzAuth)).status).toBe(422);
    });
  });

  it('report rows carry entity labels (ref + name) for offer / partner dimensions', async () => {
    setReportingProvider(raw);
    const res = await request(dash).get('/api/reports?groupBy=offer,publisher&metrics=clicks').set(auth);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: { dimensions: { offer: string; publisher: string | null } }) => r.dimensions.offer === offerB && r.dimensions.publisher === fx.pubA2);
    expect(row.labels.offer).toEqual({ ref: expect.any(Number), name: 'Rollup offer B' });
    expect(row.labels.publisher).toEqual({ ref: expect.any(Number), name: 'Pub A2' });
    const none = res.body.data.rows.find((r: { dimensions: { publisher: string | null } }) => r.dimensions.publisher == null);
    expect(none.labels.publisher).toBeNull();
    const byDay = await request(dash).get('/api/reports?groupBy=day&metrics=clicks').set(auth);
    expect(byDay.body.data.rows[0].labels).toBeUndefined();
  });
});
