/**
 * Reports in the network's time zone (D7 / O10) — live DB. Every report endpoint the pages use takes
 * `?tz=`: a plain-date from / to is a whole local day of that zone, and day buckets are local days.
 * GET /api/me tells the SPA the network's zone (staff and portals alike); Pacing stays on UTC days,
 * because that's when caps reset.
 *
 * Three clicks around one Kolkata day D (UTC+05:30): D−1 20:00Z (= D 01:30 IST), D 10:00Z
 * (= D 15:30 IST), D 20:00Z (= D+1 01:30 IST) — UTC puts two on D; Kolkata puts the first two on D.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { addDays } from '../../src/lib/reporting/time-zone.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const TZ = 'Asia/Kolkata';

d('reports in a time zone (live DB)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  let D: string;
  const ids = { early: '', mid: '', late: '' };
  const get = (path: string) => request(dash).get(path).set(admin);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`zone-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
    D = addDays(new Date().toISOString().slice(0, 10), -3);
    const at = { early: `${addDays(D, -1)}T20:00:00Z`, mid: `${D}T10:00:00Z`, late: `${D}T20:00:00Z` };
    for (const k of ['early', 'mid', 'late'] as const) {
      ids[k] = randomUUID().replace(/-/g, '');
      await query('INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at) VALUES ($1, $2, $3, $4, $5)',
        [ids[k], fx.networkA, fx.offerA, fx.pubA1, at[k]]);
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, status, payout, revenue, currency, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', 1, 2, 'USD', 'postback')`,
        [`zone-${ids[k]}`, fx.networkA, ids[k], fx.offerA, fx.pubA1, fx.advA, at[k]]);
    }
  });

  it('row-level logs: the range is the zone’s day (clicks, conversions)', async () => {
    const clicks = async (tz?: string) => ((await get(`/api/reports/clicks?from=${D}&to=${D}&offerId=${fx.offerA}${tz ? `&tz=${tz}` : ''}`)).body.data as { click_id: string }[])
      .map((r) => r.click_id).filter((id) => Object.values(ids).includes(id)).sort();
    expect(await clicks(TZ)).toEqual([ids.early, ids.mid].sort());
    expect(await clicks()).toEqual([ids.mid, ids.late].sort()); // no tz = UTC days, as before
    expect(await clicks('UTC')).toEqual([ids.mid, ids.late].sort());

    const convs = (await get(`/api/reports/conversions?from=${D}&to=${D}&offerId=${fx.offerA}&tz=${TZ}`)).body.data as { click_id: string }[];
    expect(convs.map((r) => r.click_id).filter((id) => Object.values(ids).includes(id)).sort()).toEqual([ids.early, ids.mid].sort());
    expect((await get(`/api/reports/clicks?from=${D}&tz=Mars/Olympus`)).status).toBe(422);
  });

  it('day buckets are local days (grouped, the main report, cohort)', async () => {
    const range = `from=${addDays(D, -1)}&to=${addDays(D, 1)}&offerId=${fx.offerA}`;
    const grouped = async (tz?: string) => Object.fromEntries(((await get(`/api/reports/grouped?groupBy=day&${range}${tz ? `&tz=${tz}` : ''}`)).body.data.rows as { key: string; clicks: number }[])
      .map((r) => [r.key, r.clicks]));
    expect(await grouped(TZ)).toEqual({ [D]: 2, [addDays(D, 1)]: 1 });
    expect(await grouped()).toEqual({ [addDays(D, -1)]: 1, [D]: 2 });

    const main = (await get(`/api/reports?groupBy=day&metrics=clicks&${range}&tz=${TZ}`)).body.data.rows as { dimensions: { day: string }; metrics: { clicks: number } }[];
    expect(main.map((r) => [r.dimensions.day.slice(0, 10), r.metrics.clicks])).toEqual([[D, 2], [addDays(D, 1), 1]]);

    const cohort = (await get(`/api/reports/cohort?from=${D}&to=${addDays(D, 1)}&offerId=${fx.offerA}&tz=${TZ}`)).body.data.rows as { date: string; topLevel: number }[];
    expect(cohort.map((r) => [r.date, r.topLevel])).toEqual([[`${D}T00:00:00+05:30`, 2], [`${addDays(D, 1)}T00:00:00+05:30`, 1]]);
  });

  it('the other report endpoints take tz too; Pacing stays on UTC days', async () => {
    for (const path of [
      `/api/reports/postback-logs?from=${D}&to=${D}&tz=${TZ}`,
      `/api/reports/goals?from=${D}&to=${D}&tz=${TZ}`,
      `/api/reports/click-to-conversion-time?from=${D}&to=${D}&tz=${TZ}`,
      `/api/traffic-health/usage?from=${D}&to=${D}&tz=${TZ}`,
      `/api/customer-value/conversion-events?from=${D}&to=${D}&tz=${TZ}`,
    ]) expect([path, (await get(path)).status]).toEqual([path, 200]);
    expect((await get(`/api/reports/pacing?from=${D}&to=${D}&tz=${TZ}`)).status).toBe(422);
  });

  it("GET /api/me carries the network's zone — for staff and portal users", async () => {
    expect((await get('/api/me')).body.data.reportTimeZone).toBe('UTC');
    await query(`UPDATE networks SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [fx.networkA, JSON.stringify({ general: { timezone: TZ } })]);
    expect((await get('/api/me')).body.data.reportTimeZone).toBe(TZ);
    const portal = await request(dash).get('/api/me').set(bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })));
    expect(portal.body.data.reportTimeZone).toBe(TZ);
  });
});
