/**
 * Smart-Link KPI rotation, /sl eligibility and Partner Tiers — on a real Postgres + Redis
 * (INTEGRATION_DB=1, as in CI) — audit F-17b.
 *
 *  - The KPI worker scores a link's items from its own clicks/conversions; /sl then sends most traffic
 *    to the winner (and re-scores only when due).
 *  - /sl: a visitor no item targets goes to the catch-all offer (with partner + subs), never to an
 *    item targeted elsewhere; offers that would dead-end at /click are skipped; the link config is
 *    served from Redis and the smart-link API busts it.
 *  - Partner Tiers: a member is paid the tier margin off the revenue (click and conversion), unless
 *    the payout is their own; "auto-approve partners" approves a member's access request at once;
 *    tier edits reach /click immediately.
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
import { getRedis } from '../../src/lib/redis.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;

type Fx = Fixture & { host: string; auth: { Authorization: string } };

d('smart-link KPI rotation, /sl eligibility and partner tiers (live DB + Redis)', () => {
  let dash: Express;
  let track: FastifyInstance;

  const fixture = async (): Promise<Fx> => {
    const fx = await seedFixture(`sl-${randomUUID().slice(0, 8)}`);
    const host = `sl-${randomUUID().slice(0, 8)}.test`;
    await query(`INSERT INTO tracking_domains (network_id, host, mode, status, verification_state) VALUES ($1, $2, 'custom', 'active', 'verified')`, [fx.networkA, host]);
    return { ...fx, host, auth: bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA })) };
  };
  const offer = async (fx: Fx, cols: Record<string, unknown> = {}) => {
    const c = { status: 'active', visibility: 'public', daily_click_cap: null, metadata: '{}', ...cols };
    return (await query<{ id: string }>(
      `INSERT INTO offers (network_id, advertiser_id, name, status, destination_url, default_payout, default_revenue, visibility, daily_click_cap, metadata)
       VALUES ($1, $2, $3, $4, 'https://example.com/{click_id}', 5.0000, 8.0000, $5, $6, $7) RETURNING id`,
      [fx.networkA, fx.advA, `Offer ${randomUUID().slice(0, 6)}`, c.status, c.visibility, c.daily_click_cap, c.metadata])).rows[0]!.id;
  };
  const link = async (fx: Fx, mechanism: string, items: { offerId: string; weight?: number; position?: number; country?: string }[], extra: Record<string, unknown> = {}) => {
    const id = (await query<{ id: string }>(
      `INSERT INTO smart_links (network_id, name, redirect_mechanism, catch_all_offer_id, kpi_metric, kpi_min_clicks, kpi_lookback_hours)
       VALUES ($1, 'F-17b link', $2, $3, $4, $5, $6) RETURNING id`,
      [fx.networkA, mechanism, extra['catchAll'] ?? null, extra['metric'] ?? null, extra['minClicks'] ?? null, extra['lookback'] ?? null])).rows[0]!.id;
    for (const i of items) {
      await query(`INSERT INTO smart_link_items (network_id, smart_link_id, offer_id, weight, position, country) VALUES ($1, $2, $3, $4, $5, $6)`,
        [fx.networkA, id, i.offerId, i.weight ?? (mechanism === 'weight' ? 1 : 0), i.position ?? null, i.country ?? null]);
    }
    return id;
  };
  const sl = async (fx: Fx, id: string, qs = '') => {
    const r = await track.inject({ method: 'GET', url: `/sl?id=${id}${qs}`, headers: { host: fx.host } });
    return { status: r.statusCode, location: r.headers.location as string | undefined };
  };
  const offerOf = (loc: string | undefined) => new URLSearchParams((loc ?? '').split('?')[1]).get('offer_id');
  const picks = async (fx: Fx, id: string, n: number, qs = '') => {
    const out: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const o = offerOf((await sl(fx, id, qs)).location) ?? 'none';
      out[o] = (out[o] ?? 0) + 1;
    }
    return out;
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    setHostResolver(new DbHostResolver());
    track = buildTrackingApp();
    await track.ready();
    dash = buildDashboardApp();
  });

  describe('smart links', () => {
    it("KPI: the worker scores the link's own traffic and /sl sends most clicks to the winner; re-scored only when due", async () => {
      const fx = await fixture();
      const good = await offer(fx);
      const weak = await offer(fx);
      const id = await link(fx, 'kpi', [{ offerId: good }, { offerId: weak }], { metric: 'CVR', minClicks: 10, lookback: 24 });
      // Before any score: an even rotation over both.
      expect(Object.keys(await picks(fx, id, 40)).sort()).toEqual([good, weak].sort());

      const tag = randomUUID().slice(0, 8);
      for (const [o, clicks, convs] of [[good, 20, 6], [weak, 20, 1]] as const) {
        await query(`INSERT INTO clicks (click_id, network_id, offer_id, smart_link_id) SELECT $4 || g, $1, $2, $3 FROM generate_series(1, $5) g`,
          [fx.networkA, o, id, `${tag}-${o.slice(0, 4)}-`, clicks]);
        await query(
          `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, source, status, payout, revenue, currency)
           SELECT 'cv-' || $3 || g, $1, $3 || g, $2, 'postback', 'approved', 5, 8, 'USD' FROM generate_series(1, $4) g`,
          [fx.networkA, o, `${tag}-${o.slice(0, 4)}-`, convs]);
      }
      expect(await rescoreKpiSmartLinks(new Date(Date.now() + 1000), fx.networkA)).toEqual({ links: 1, errors: 0 });
      const items = (await query<{ offer_id: string; kpi_weight: number; kpi_clicks: number; kpi_score: string }>(
        'SELECT offer_id, kpi_weight, kpi_clicks, kpi_score::text FROM smart_link_items WHERE smart_link_id = $1 ORDER BY kpi_weight DESC', [id])).rows;
      expect(items).toEqual([
        { offer_id: good, kpi_weight: 80, kpi_clicks: 20, kpi_score: '0.30000000' },
        { offer_id: weak, kpi_weight: 20, kpi_clicks: 20, kpi_score: '0.05000000' },
      ]);
      // The API shows the scoring.
      const shown = (await request(dash).get(`/api/smart-links/${id}`).set(fx.auth)).body.data;
      expect(shown.kpiComputedAt).not.toBeNull();
      expect(shown.items.map((i: { offerId: string; kpiWeight: number; kpiClicks: number }) => [i.offerId, i.kpiWeight, i.kpiClicks]).sort())
        .toEqual([[good, 80, 20], [weak, 20, 20]].sort());
      const split = await picks(fx, id, 300);
      expect(split[good]! / 300).toBeGreaterThan(0.65); // expected 0.8
      expect(split[weak]).toBeGreaterThan(0); // the other still gets measured

      // Scored a moment ago, re-scored hourly by default → not due yet.
      expect(await rescoreKpiSmartLinks(new Date(Date.now() + 2000), fx.networkA)).toEqual({ links: 0, errors: 0 });
    });

    it('a visitor no item targets goes to the catch-all offer — with the partner and subs — not to any item', async () => {
      const fx = await fixture();
      const us = await offer(fx);
      const fallback = await offer(fx);
      const id = await link(fx, 'weight', [{ offerId: us, country: 'US' }], { catchAll: fallback });
      const r = await sl(fx, id, `&pub_id=${fx.pubA1}&sub1=s1&source=push`);
      expect(r.status).toBe(302);
      const p = new URLSearchParams(r.location!.split('?')[1]);
      expect(Object.fromEntries(p)).toEqual({ offer_id: fallback, sl: id, pub_id: fx.pubA1, sub1: 's1', source_id: 'push' });
      // No catch-all: nothing to send them to.
      const bare = await link(fx, 'weight', [{ offerId: us, country: 'US' }]);
      expect((await sl(fx, bare)).status).toBe(204);
    });

    // (Geo rules are checked too, the way /click does — fail-open while the country is unknown, as it
    // always is here without a geo database, so that case isn't exercised in this suite.)
    it('offers that would dead-end at /click are skipped: paused, capped today, partner blocked / not approved', async () => {
      const fx = await fixture();
      const ok = await offer(fx);
      const paused = await offer(fx, { status: 'paused' });
      const capped = await offer(fx, { daily_click_cap: 1 });
      const priv = await offer(fx, { visibility: 'private' });
      const denied = await offer(fx);
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      await getRedis().set(`cap:click:${capped}:${day}`, '1', 'EX', 3600);
      await query(`INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status) VALUES ($1, $2, $3, 'deny', 'approved')`, [fx.networkA, denied, fx.pubA1]);
      const id = await link(fx, 'weight', [ok, paused, capped, priv, denied].map((offerId) => ({ offerId })));
      expect(await picks(fx, id, 60, `&pub_id=${fx.pubA1}`)).toEqual({ [ok]: 60 });

      // Priority: the first eligible position wins.
      const prio = await link(fx, 'priority', [{ offerId: paused, position: 1 }, { offerId: denied, position: 2 }, { offerId: ok, position: 3 }]);
      expect(offerOf((await sl(fx, prio, `&pub_id=${fx.pubA1}`)).location)).toBe(ok);
      // Nothing eligible and no catch-all → 204.
      const none = await link(fx, 'weight', [{ offerId: paused }]);
      expect((await sl(fx, none)).status).toBe(204);
    });

    it('/sl reads the link from Redis; the smart-link API busts it on change', async () => {
      const fx = await fixture();
      const a = await offer(fx);
      const b = await offer(fx);
      const res = await request(dash).post('/api/smart-links').set(fx.auth).send({ name: 'cached', redirectMechanism: 'weight', items: [{ offerId: a, weight: 1 }] });
      expect(res.status).toBe(201);
      const id = res.body.data.id as string;
      expect(offerOf((await sl(fx, id)).location)).toBe(a);
      expect(await getRedis().get(`slcfg:${fx.networkA}:${id}`)).not.toBeNull();
      // A change straight in the DB isn't seen while cached…
      await query('UPDATE smart_link_items SET offer_id = $2 WHERE smart_link_id = $1', [id, b]);
      expect(offerOf((await sl(fx, id)).location)).toBe(a);
      // …an API change is, at once.
      expect((await request(dash).patch(`/api/smart-links/${id}`).set(fx.auth).send({ items: [{ offerId: b, weight: 1 }] })).status).toBe(200);
      expect(offerOf((await sl(fx, id)).location)).toBe(b);
      expect((await request(dash).patch(`/api/smart-links/${id}`).set(fx.auth).send({ status: 'paused' })).status).toBe(200);
      expect((await sl(fx, id)).status).toBe(204);
    });
  });

  describe('partner tiers', () => {
    const tier = async (fx: Fx, marginPct: number, partnerIds: string[], offerId: string, link: { applyMargin?: boolean; autoApprovePartners?: boolean } = {}) => {
      const t = await request(dash).post('/api/partner-tiers').set(fx.auth).send({ name: `Tier ${randomUUID().slice(0, 6)}`, marginPct, partnerIds });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const l = await request(dash).put(`/api/partner-tiers/${t.body.data.id}/offers`).set(fx.auth).send({ offerId, applyMargin: true, autoApprovePartners: true, ...link });
      expect(l.status).toBe(200);
      return t.body.data.id as string;
    };
    /** Click as `pub`, then an authenticated postback; returns the conversion's payout + revenue. */
    const convert = async (fx: Fx, offerId: string, pub: string, qs = '') => {
      const c = await track.inject({ method: 'GET', url: `/click?offer_id=${offerId}&pub_id=${pub}`, headers: { host: fx.host } });
      expect(c.statusCode).toBe(302);
      const clickId = new URL(c.headers.location as string).pathname.split('/').pop()!;
      const pb = await track.inject({ method: 'GET', url: `/postback?click_id=${clickId}&status=approved&secure_code=${fx.secureCodeA}${qs}`, headers: { host: fx.host } });
      expect(pb.statusCode).toBe(200);
      return (await query<{ payout: string; revenue: string }>('SELECT payout::text, revenue::text FROM conversions WHERE click_id = $1', [clickId])).rows[0]!;
    };

    it("a member is paid the tier margin off the revenue; non-members get the default; the partner's own rates win", async () => {
      const fx = await fixture();
      const o = await offer(fx); // payout 5, revenue 8
      await tier(fx, 20, [fx.pubA1], o);
      expect(await convert(fx, o, fx.pubA1)).toEqual({ payout: '6.4000', revenue: '8.0000' });
      expect(await convert(fx, o, fx.pubA2)).toEqual({ payout: '5.0000', revenue: '8.0000' });
      // An explicit S2S payout still wins.
      expect((await convert(fx, o, fx.pubA1, '&payout=3')).payout).toBe('3.0000');
      // So does the partner's own per-offer payout override.
      await query(`INSERT INTO offer_publisher_access (network_id, offer_id, publisher_id, access, approval_status, payout_override) VALUES ($1, $2, $3, 'allow', 'approved', 7)`, [fx.networkA, o, fx.pubA1]);
      await getRedis().del(`offercfg:${fx.networkA}:${o}`);
      expect((await convert(fx, o, fx.pubA1)).payout).toBe('7.0000');
    });

    it("on a percentage-revenue offer the margin comes off the conversion's actual revenue", async () => {
      const fx = await fixture();
      const o = await offer(fx, { metadata: JSON.stringify({ revenue_settings: { revenueType: 'percentage', revenuePct: 10 } }) });
      await tier(fx, 20, [fx.pubA1], o);
      expect(await convert(fx, o, fx.pubA1, '&amount=200')).toEqual({ payout: '16.0000', revenue: '20.0000' });
    });

    it('tier edits reach /click at once; a tier link without "apply margin", or a paused tier, prices nothing', async () => {
      const fx = await fixture();
      const o = await offer(fx);
      const t = await tier(fx, 20, [fx.pubA1], o);
      expect((await convert(fx, o, fx.pubA1)).payout).toBe('6.4000');
      expect((await request(dash).patch(`/api/partner-tiers/${t}`).set(fx.auth).send({ marginPct: 50 })).status).toBe(200);
      expect((await convert(fx, o, fx.pubA1)).payout).toBe('4.0000');
      expect((await request(dash).patch(`/api/partner-tiers/${t}`).set(fx.auth).send({ status: 'paused' })).status).toBe(200);
      expect((await convert(fx, o, fx.pubA1)).payout).toBe('5.0000');
      const o2 = await offer(fx);
      await tier(fx, 20, [fx.pubA1], o2, { applyMargin: false });
      expect((await convert(fx, o2, fx.pubA1)).payout).toBe('5.0000');
    });

    it('"auto-approve partners": a member\'s access request on a linked offer is approved at once; others wait', async () => {
      const fx = await fixture();
      const o = await offer(fx, { visibility: 'ask' });
      await tier(fx, 10, [fx.pubA1], o);
      const ask = (pub: string) => request(dash).post(`/api/portal/offers/${o}/request`)
        .set(bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: pub }))).send({});
      const member = await ask(fx.pubA1);
      expect(member.status).toBe(201);
      expect(member.body.data).toEqual({ access: 'allow', approvalStatus: 'approved' });
      const other = await ask(fx.pubA2);
      expect(other.body.data).toEqual({ access: 'deny', approvalStatus: 'pending' });
      // The approved member's clicks run on the ask-offer right away.
      const c = await track.inject({ method: 'GET', url: `/click?offer_id=${o}&pub_id=${fx.pubA1}`, headers: { host: fx.host } });
      expect(c.statusCode).toBe(302);
    });
  });
});
