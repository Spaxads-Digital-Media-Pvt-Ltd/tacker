/**
 * Cap time zone — live DB + Redis. Daily caps reset at midnight in the cap time zone: the offer's own
 * (Edit Offer › Cap Time Zone), else the network's (Settings › General — "Daily caps reset at midnight
 * in [zone]"), else UTC. Enforcement and the Caps report count the same day.
 *
 * A conversion is seeded halfway between UTC midnight and Kolkata midnight — "today" in exactly one of
 * the two zones, whatever the time the test runs — so each expectation follows from which one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { FastifyInstance } from 'fastify';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { buildTrackingApp } from '../../src/surfaces/tracking/app.js';
import { setHostResolver } from '../../src/middleware/host-resolver.js';
import { DbHostResolver } from '../../src/surfaces/tracking/host-resolver-db.js';
import { localDate, zonedDayStart } from '../../src/lib/reporting/time-zone.js';
import { getRedis } from '../../src/lib/redis.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const ZONE = 'Asia/Kolkata';

d('cap time zone: daily caps reset at midnight in the cap zone (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;
  let fx: Fixture;
  let host: string;
  let auth: { Authorization: string };
  // The two midnights before now, and an instant between them.
  const now = new Date();
  const zoneMidnight = zonedDayStart(localDate(now, ZONE), ZONE);
  const utcMidnight = zonedDayStart(localDate(now, 'UTC'), 'UTC');
  const between = new Date((zoneMidnight.getTime() + utcMidnight.getTime()) / 2);
  const todayInZone = between >= zoneMidnight;
  const todayInUtc = between >= utcMidnight;

  const newOffer = async (capTimezone: string | null) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, daily_conversion_cap, daily_click_cap, cap_timezone)
     VALUES ($1, $2, $3, 'active', 'https://adv.example.com/lp/{click_id}', 5, 8, 1, 5, $4) RETURNING id`,
    [fx.networkA, fx.advA, `Zone ${randomUUID().slice(0, 6)}`, capTimezone])).rows[0]!.id;
  const seedConversionBetween = (offerId: string) => query(
    `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, status, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'postback', $7)`,
    [randomUUID().replace(/-/g, ''), fx.networkA, randomUUID().replace(/-/g, ''), offerId, fx.pubA1, fx.advA, between.toISOString()]);
  const convert = async (offerId: string) => {
    const c = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${fx.pubA1}`, headers: { host } });
    expect(c.statusCode).toBe(302);
    const clickId = new URL(c.headers.location as string).pathname.split('/').pop()!;
    const r = await track.inject({ method: 'GET', url: `/postback?secure_code=${fx.secureCodeA}&click_id=${clickId}&status=approved&txn_id=${randomUUID()}`, headers: { host } });
    return (r.json() as { status: string }).status;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    expect(todayInZone).not.toBe(todayInUtc); // the seeded instant is today in exactly one zone
    fx = await seedFixture(`captz-${randomUUID().slice(0, 8)}`);
    host = `captz-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    setHostResolver(new DbHostResolver());
    dash = buildDashboardApp();
    track = buildTrackingApp();
    await track.ready();
    auth = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA }));
  });

  it('Settings › General: the network cap time zone (an IANA zone; null back to UTC)', async () => {
    expect((await request(dash).put('/api/settings/general').set(auth).send({ capTimezone: 'Mars/Olympus' })).status).toBe(422);
    await request(dash).put('/api/settings/general').set(auth).send({ capTimezone: ZONE }).expect(200);
    expect((await request(dash).get('/api/settings').set(auth).expect(200)).body.data.general.capTimezone).toBe(ZONE);
  });

  it("the network's zone: a conversion between the two midnights counts toward today's cap only when it is today there", async () => {
    const offer = await newOffer(null);
    await seedConversionBetween(offer);
    expect(await convert(offer)).toBe(todayInZone ? 'pending' : 'approved'); // pending = held over caps
  });

  it("an offer's own cap time zone beats the network's", async () => {
    const offer = await newOffer('UTC');
    await seedConversionBetween(offer);
    expect(await convert(offer)).toBe(todayInUtc ? 'pending' : 'approved');
    // Set over the API (validated) — and it shows on the offer.
    await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ capTimezone: 'Nowhere/Land' }).expect(422);
    const res = await request(dash).patch(`/api/offers/${offer}`).set(auth).send({ capTimezone: ZONE }).expect(200);
    expect(res.body.data.capTimezone).toBe(ZONE);
  });

  it("the click cap's counter is the cap zone's local day", async () => {
    const offer = await newOffer(null);
    expect((await track.inject({ method: 'GET', url: `/click?offer_id=${offer}&pub_id=${fx.pubA1}`, headers: { host } })).statusCode).toBe(302);
    const stamp = localDate(new Date(), ZONE).replace(/-/g, '');
    expect(await getRedis().get(`cap:click:${offer}:${stamp}`)).toBe('1');
  });

  it('the Caps report counts the same day, per offer zone, and says which zone', async () => {
    const zoned = await newOffer(null);
    const utc = await newOffer('UTC');
    await seedConversionBetween(zoned);
    await seedConversionBetween(utc);
    const rows = (await request(dash).get('/api/reports/caps').set(auth).expect(200)).body.data as { id: string; conversions_today: number; cap_timezone: string }[];
    expect(rows.find((r) => r.id === zoned)).toMatchObject({ conversions_today: todayInZone ? 1 : 0, cap_timezone: ZONE });
    expect(rows.find((r) => r.id === utc)).toMatchObject({ conversions_today: todayInUtc ? 1 : 0, cap_timezone: 'UTC' });
    const pacing = (await request(dash).get('/api/reports/pacing?category=conversion').set(auth).expect(200)).body.data;
    expect(pacing.capTimeZone).toBe(ZONE);
    // Detail rows carry each offer's local day.
    const zonedRow = (pacing.rows as { entityId: string; date: string }[]).find((r) => r.entityId === zoned);
    expect(zonedRow?.date).toBe(localDate(between, ZONE));
  });
});
