/**
 * Smart links: an item's own landing page (Offer URL override) and the KPI Run Record — live DB + Redis
 * (INTEGRATION_DB=1).
 *
 *  - /sl names the picked item (`sli`) when it has its own landing page; /click looks the URL up in the
 *    link's config and sends the visitor there (macros filled). An `sli` of another link / offer is ignored.
 *  - Every KPI scoring run is recorded (smart_link_kpi_runs) and listed by GET /api/smart-links/:id/kpi-runs
 *    with each offer's name; runs older than 90 days are pruned by the retention job.
 *  - An item's Offer URL must be an http(s) redirect (javascript: / data: are refused).
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
import { rescoreKpiSmartLinks } from '../../src/lib/smart-links/kpi.js';
import { runRetention } from '../../src/lib/retention/retention.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

type Fx = Fixture & { host: string; auth: { Authorization: string } };

d('smart links: item landing pages and the KPI Run Record (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;

  const fixture = async (): Promise<Fx> => {
    const fx = await seedFixture(`slr-${randomUUID().slice(0, 8)}`);
    const host = `slr-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    return { ...fx, host, auth: bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA })) };
  };
  const offer = async (fx: Fx, name = `Offer ${randomUUID().slice(0, 6)}`) => (await query<{ id: string }>(
    `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, visibility)
     VALUES ($1, $2, $3, 'active', 'https://offer.example.com/{click_id}', 5.0000, 8.0000, 'public') RETURNING id`,
    [fx.networkA, fx.advA, name])).rows[0]!.id;
  const createLink = async (fx: Fx, body: Record<string, unknown>) =>
    request(dash).post('/api/smart-links').set(fx.auth).send({ name: `Link ${randomUUID().slice(0, 6)}`, ...body });
  const get = (fx: Fx, url: string) => track.inject({ method: 'GET', url, headers: { host: fx.host } });

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
  });

  it("the picked item's own landing page is where /click sends the visitor (macros filled)", async () => {
    const fx = await fixture();
    const o = await offer(fx);
    const res = await createLink(fx, { redirectMechanism: 'weight', items: [{ offerId: o, weight: 1, offerUrl: 'https://lp.example.com/item?c={click_id}&s={sub1}' }] });
    expect(res.status).toBe(201);
    const link = (await request(dash).get(`/api/smart-links/${res.body.data.id}`).set(fx.auth)).body.data;
    const itemId = link.items[0].id as string;

    const viaSl = await get(fx, `/sl?id=${link.id}&pub_id=${fx.pubA1}&sub1=abc`);
    expect(viaSl.statusCode).toBe(302);
    const forwarded = new URLSearchParams((viaSl.headers.location as string).split('?')[1]);
    expect([forwarded.get('offer_id'), forwarded.get('sl'), forwarded.get('sli')]).toEqual([o, link.id, itemId]);

    const click = await get(fx, viaSl.headers.location as string);
    expect(click.statusCode).toBe(302);
    const dest = new URL(click.headers.location as string);
    expect(dest.origin + dest.pathname).toBe('https://lp.example.com/item');
    expect(dest.searchParams.get('s')).toBe('abc');
    expect(dest.searchParams.get('c')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('an sli that is not an item of this link for this offer is ignored (the offer URL is used)', async () => {
    const fx = await fixture();
    const [a, b] = [await offer(fx), await offer(fx)];
    const res = await createLink(fx, { redirectMechanism: 'weight', items: [
      { offerId: a, weight: 1, offerUrl: 'https://lp.example.com/a' }, { offerId: b, weight: 1 },
    ] });
    const link = (await request(dash).get(`/api/smart-links/${res.body.data.id}`).set(fx.auth)).body.data;
    const itemA = (link.items as { id: string; offerId: string }[]).find((i) => i.offerId === a)!.id;
    // item A's id on offer B's click, and a random id: both fall back to the offer's own URL.
    for (const sli of [itemA, randomUUID()]) {
      const click = await get(fx, `/click?offer_id=${b}&sl=${link.id}&sli=${sli}`);
      expect(click.statusCode).toBe(302);
      expect(click.headers.location).toMatch(/^https:\/\/offer\.example\.com\//);
    }
    // An item without its own landing page isn't named at all.
    const res2 = await createLink(fx, { redirectMechanism: 'weight', items: [{ offerId: b, weight: 1 }] });
    const plain = await get(fx, `/sl?id=${res2.body.data.id}`);
    expect(new URLSearchParams((plain.headers.location as string).split('?')[1]).get('sli')).toBeNull();
  });

  it('an item Offer URL must be an http(s) redirect', async () => {
    const fx = await fixture();
    const o = await offer(fx);
    for (const offerUrl of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.example.com/']) {
      expect((await createLink(fx, { items: [{ offerId: o, offerUrl }] })).status, offerUrl).toBe(422);
    }
  });

  it('every KPI run is recorded and listed (newest first, offer names, even rotation flagged); old runs are pruned', async () => {
    const fx = await fixture();
    const good = await offer(fx, 'Good offer');
    const weak = await offer(fx, 'Weak offer');
    const res = await createLink(fx, { redirectMechanism: 'kpi', kpiMetric: 'CVR', kpiMinClicks: 10, kpiLookbackHours: 24, kpiRunFrequencyHours: 1,
      items: [{ offerId: good }, { offerId: weak }] });
    const id = res.body.data.id as string;

    // Run 1: no traffic yet → recorded, not weighted (even rotation).
    expect(await rescoreKpiSmartLinks(new Date(Date.now() + 1000), fx.networkA)).toEqual({ links: 1, errors: 0 });

    const tag = randomUUID().slice(0, 8);
    for (const [o, clicks, convs] of [[good, 20, 6], [weak, 20, 1]] as const) {
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, smart_link_id) SELECT $4 || g, $1, $2, $3 FROM generate_series(1, $5) g`,
        [fx.networkA, o, id, `${tag}-${o.slice(0, 4)}-`, clicks]);
      await query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, payout, revenue, currency)
         SELECT 'cv-' || $3 || g, $1, $3 || g, $2, 'postback', 'approved', 5, 8, 'USD' FROM generate_series(1, $4) g`,
        [fx.networkA, o, `${tag}-${o.slice(0, 4)}-`, convs]);
    }
    // Run 2, due an hour later: the good offer wins.
    expect(await rescoreKpiSmartLinks(new Date(Date.now() + 3_700_000), fx.networkA)).toEqual({ links: 1, errors: 0 });

    const list = await request(dash).get(`/api/smart-links/${id}/kpi-runs`).set(fx.auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination).toMatchObject({ total: 2, limit: 25, offset: 0 });
    const [latest, first] = list.body.data;
    expect(first).toMatchObject({ metric: 'CVR', lookbackHours: 24, minClicks: 10, weighted: false });
    expect(latest.weighted).toBe(true);
    const byName = Object.fromEntries((latest.items as { offerName: string }[]).map((i) => [i.offerName, i]));
    expect(byName['Good offer']).toMatchObject({ clicks: 20, conversions: 6, payout: '30.0000', revenue: '48.0000', score: '0.30000000', weight: 80 });
    expect(byName['Weak offer']).toMatchObject({ clicks: 20, conversions: 1, weight: 20 });

    // Another network can't read them.
    const other = await fixture();
    expect((await request(dash).get(`/api/smart-links/${id}/kpi-runs`).set(other.auth)).status).toBe(404);

    // Retention: a run older than 90 days goes, recent ones stay.
    await query(`UPDATE smart_link_kpi_runs SET ran_at = now() - interval '100 days' WHERE id = $1`, [first.id]);
    const pruned = await runRetention();
    expect(pruned.kpiRunsDeleted).toBeGreaterThanOrEqual(1);
    expect((await request(dash).get(`/api/smart-links/${id}/kpi-runs`).set(fx.auth)).body.data.map((r: { id: string }) => r.id)).toEqual([latest.id]);
  });
});
