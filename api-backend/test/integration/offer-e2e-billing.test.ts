/**
 * Offers end to end — the features that were saved but not run (INTEGRATION_DB=1): offers configured through the
 * dashboard API, real /click, /impression, /postback, /pixel and /sdk.js, the real click / impression workers, the
 * CPM booking run, the partner-postback and 24metrics workers (their HTTP calls captured), the ledger and reports.
 *
 * Covered: CPC (paid clicks, the ledger, CPC-level partner postbacks, no base payout on its conversions, manual
 * approval, a partner's own CPC setting) · impressions (accepted / rejected / unique / JSON / the advertiser's
 * impression URL) · CPM (bookings, exact cumulative amounts, the ledger) · reports (impressions / CTR, billing rows
 * are money not conversions) · view-through (by impression id, the visitor's address, the cookie; a click wins;
 * the window; an offer without it) · email ownership (first / last partner, the hash, the window) · price per
 * product (SKU, category, base rate, one product as parameters, a partner's CPA_PPP, pixels never price) · direct
 * linking (the tag's JSON click from the offer's site only, /sdk.js, the links API) · 24metrics (a rejected click
 * flagged + its conversion held + its address blocked; an approved one's conversions reported; fail open).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { Worker } from 'bullmq';

const t24 = vi.hoisted(() => ({ reject: new Set<string>(), down: new Set<string>() }));
const sent = vi.hoisted(() => [] as { url: string; method: string; body?: string }[]);
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return {
    ...mod,
    safeRequest: vi.fn(async (url: string, opts: { method?: string; body?: string } = {}) => {
      sent.push({ url, method: opts.method ?? 'GET', body: opts.body });
      const u = new URL(url);
      // A stand-in for the 24metrics gateway's click API (lib/integrations/tracker24.ts).
      if (u.hostname.endsWith('.gateway.go2link.co') && u.pathname === '/c') {
        const ip = u.searchParams.get('ip') ?? '';
        if (t24.down.has(ip)) return { status: 503, body: '' };
        const data = t24.reject.has(ip)
          ? { status: 'rejected', reason: 'VPN' }
          : { status: 'approved', transaction_id: `tx-${u.searchParams.get('external_transaction_id')}` };
        return { status: 200, body: JSON.stringify({ status: 200, data }) };
      }
      return { status: 200, body: '' };
    }),
  };
});

import { query } from '../../src/lib/db/pool.js';
import { startOutboundPostbackWorker } from '../../src/surfaces/workers/processors/outbound-postback.js';
import { startTracker24Worker } from '../../src/surfaces/workers/processors/tracker24.js';
import { bookImpressions } from '../../src/surfaces/tracking/conversions/volume-billing.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { canConnect } from '../helpers/db.js';
import { startLab, IP, UA, type Lab } from '../helpers/offer-e2e.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REVENUE = (extra: Record<string, unknown> = {}) => ({
  baseEventName: null, manualApproval: false, allowDuplicates: true, revenueAction: 'conversion', revenueType: 'fixed', revenuePct: null, pricePerProduct: false, ...extra,
});
const ATTRIBUTION = (extra: Record<string, unknown> = {}) => ({
  tracker24: { enabled: false, trackerId: null }, ipqs: { enabled: false }, throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 0, maxSeconds: null }, emailOwnership: false, viewThrough: false, serverSideClick: false, ...extra,
});

// A fresh address per visitor: the per-IP velocity check flags an address after 30 events a minute.
let ipN = 0;
const fresh = () => { ipN++; return ipN < 250 ? `198.51.100.${ipN}` : `203.0.113.${ipN - 249}`; };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

d('offers end to end — CPC, impressions / CPM, view-through, email ownership, products, direct linking, 24metrics', () => {
  let lab: Lab;
  let outbound: Worker;
  let tracker24: Worker;

  const ledger = async (conversionId: string) => (await query<{ account_type: string; entry_type: string; direction: string; amount: string }>(
    `SELECT account_type, entry_type, direction, amount::text AS amount FROM ledger_entries WHERE conversion_id = $1 ORDER BY entry_type`, [conversionId])).rows;
  /** The offer's billing rows (paid clicks / CPM bookings), waiting until there are `want`. */
  const billingRows = async (offerId: string, want = 1) => {
    let rows: Record<string, any>[] = [];
    for (let i = 0; i < 80; i++) {
      rows = (await query(
        `SELECT conversion_id, click_id, source, event_name, status, reason, payout::text AS payout, revenue::text AS revenue,
                attribution, publisher_id, transaction_id, raw_params, country, device
           FROM conversions WHERE offer_id = $1 AND source IN ('click', 'impression') ORDER BY created_at, conversion_id`, [offerId])).rows;
      if (rows.length >= want) return rows;
      await sleep(100);
    }
    return rows;
  };
  const conversionOf = async (body: { conversion_id?: string | null }) => lab.conversion(body.conversion_id!);
  const byTxn = async (offerId: string, txn: string) => (await query(
    `SELECT conversion_id FROM conversions WHERE offer_id = $1 AND transaction_id = $2`, [offerId, txn])).rows[0] as { conversion_id: string } | undefined;
  /** Why a request recorded nothing (the inbound postback log). */
  const notRecorded = async (txn: string) => (await query<{ reason: string }>(
    `SELECT reason FROM inbound_postback_logs WHERE network_id = $1 AND transaction_id = $2 ORDER BY created_at DESC LIMIT 1`, [lab.fx.networkA, txn])).rows[0]?.reason;
  const delivered = async (needle: string, want = 1) => {
    for (let i = 0; i < 100; i++) {
      const hits = sent.filter((s) => s.url.includes(needle));
      if (hits.length >= want) return hits;
      await sleep(100);
    }
    return sent.filter((s) => s.url.includes(needle));
  };
  /** Wait until the impression worker has counted `n` billable impressions of the offer (it counts right after
   * writing the row the impression helper waits for). */
  const counted = async (offerId: string, n: number) => {
    for (let i = 0; i < 80; i++) {
      const got = Number((await query<{ n: string }>(`SELECT COALESCE(SUM(impressions), 0)::text AS n FROM impression_billing WHERE offer_id = $1`, [offerId])).rows[0]?.n ?? 0);
      if (got >= n) return;
      await sleep(50);
    }
  };
  const report = (qs: string) => lab.api<{ rows: { dimensions: Record<string, string | null>; metrics: Record<string, any> }[] }>('get', `/reports?${qs}`);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    lab = await startLab('e2eb');
    await getQueue(QUEUE.outboundPostback).drain(true);
    await getQueue(QUEUE.tracker24).drain(true);
    outbound = startOutboundPostbackWorker();
    tracker24 = startTracker24Worker();
  });
  afterAll(async () => { await outbound?.close(); await tracker24?.close(); await lab?.close(); });

  describe('CPC — paid clicks', () => {
    it('each unique, valid click is a paid click: the partner earns, the advertiser is billed, the ledger books it, the CPC postback fires', async () => {
      const o = await lab.offer({ payoutModel: 'CPC', defaultPayout: '0.30', defaultRevenue: '0.50', revenueSettings: REVENUE({ revenueAction: 'click' }) });
      await lab.api('post', `/offers/${o.id}/postbacks`, { publisherId: lab.fx.pubA1, url: 'https://partner.example.com/cpc?c={click_id}&p={payout}&e={event}', level: 'cpc' });
      await lab.api('post', `/offers/${o.id}/postbacks`, { publisherId: lab.fx.pubA1, url: 'https://partner.example.com/conv?c={click_id}&p={payout}', level: 'conversion' });
      const ip = fresh();
      const c1 = await lab.click(o.id, { ip });
      expect(c1.status).toBe(302);
      const [paid] = await billingRows(o.id, 1);
      expect(paid).toMatchObject({ click_id: c1.clickId, source: 'click', event_name: 'click', status: 'approved', payout: '0.3000', revenue: '0.5000', attribution: 'click', publisher_id: lab.fx.pubA1, transaction_id: `cpc:${c1.clickId}` });
      expect(await ledger(paid!.conversion_id)).toEqual([
        { account_type: 'advertiser', entry_type: 'billing', direction: 'debit', amount: '0.5000' },
        { account_type: 'publisher', entry_type: 'earning', direction: 'credit', amount: '0.3000' },
      ]);
      // The partner's CPC-level postback — never their conversion postback — for the paid click.
      expect((await delivered(`cpc?c=${c1.clickId}`))[0]!.url).toBe(`https://partner.example.com/cpc?c=${c1.clickId}&p=0.3000&e=click`);
      expect(sent.some((s) => s.url.includes(`conv?c=${c1.clickId}`))).toBe(false);

      // The same visitor again isn't unique; a flagged (bot) click isn't valid — neither is paid. A new visitor is.
      expect((await lab.click(o.id, { ip })).row!['is_unique']).toBe(false);
      expect((await lab.click(o.id, { ip: fresh(), ua: UA.bot })).row!['fraud_flags']).toContain('bot_user_agent');
      const c4 = await lab.click(o.id, { ip: fresh() });
      const rows = await billingRows(o.id, 2);
      await sleep(300);
      expect((await billingRows(o.id, 2)).map((r) => r['click_id'])).toEqual([c1.clickId, c4.clickId]);

      // A conversion on a CPC offer has no base payout / revenue — they were paid on the click.
      const pb = await lab.postback({ click_id: c1.clickId!, status: 'approved', txn_id: 'cpc-conv-1' });
      expect(await conversionOf(pb.body)).toMatchObject({ status: 'approved', payout: '0.0000', revenue: '0.0000', source: 'postback' });
      expect(rows.length).toBe(2);

      // Reports: the paid clicks are money, not conversions.
      const { rows: rep } = await report(`groupBy=offer&offerId=${o.id}&metrics=clicks,conversions,total_conversions,payout,revenue`);
      expect(rep[0]!.metrics).toMatchObject({ conversions: 1, total_conversions: 1, payout: '0.6000', revenue: '1.0000' });
    });

    it('an event goal still pays on a CPC offer; manual approval holds the paid click until approved', async () => {
      const o = await lab.offer({ payoutModel: 'CPC', defaultPayout: '0.20', revenueSettings: REVENUE({ manualApproval: true }) },
        { goals: [{ name: 'Sale', eventName: 'sale', payout: '3.00', revenue: '9.00' }] });
      const c = await lab.click(o.id, { ip: fresh() });
      const [held] = await billingRows(o.id, 1);
      expect(held).toMatchObject({ status: 'pending', reason: 'manual_approval_required', payout: '0.2000', revenue: '0.0000' });
      expect(await ledger(held!.conversion_id)).toEqual([]);
      await lab.api('post', `/finance/conversions/${held!.conversion_id}/approve`);
      expect(await ledger(held!.conversion_id)).toEqual([{ account_type: 'publisher', entry_type: 'earning', direction: 'credit', amount: '0.2000' }]);
      // Revenue is per conversion here: the base conversion bills it; the event goal pays its own payout.
      const base = await lab.postback({ click_id: c.clickId!, status: 'approved', txn_id: 'cpc-base' });
      expect(await conversionOf(base.body)).toMatchObject({ status: 'pending', payout: '0.0000', revenue: '8.0000' }); // manual approval
      const sale = await lab.postback({ click_id: c.clickId!, event: 'sale', status: 'approved', txn_id: 'cpc-sale' });
      expect(await conversionOf(sale.body)).toMatchObject({ payout: '3.0000', revenue: '9.0000' });
    });

    it('a partner’s own CPC custom setting pays THAT partner per click on a CPA offer', async () => {
      const o = await lab.offer();
      await lab.api('post', '/offer-custom-settings', { category: 'revenue_payout', offerId: o.id, partnerId: lab.fx.pubA2, applyCustomPayout: true, payoutModel: 'CPC', payoutValue: '0.25', status: 'active' });
      const a2 = await lab.click(o.id, { pub: lab.fx.pubA2, ip: fresh() });
      const [paid] = await billingRows(o.id, 1);
      expect(paid).toMatchObject({ publisher_id: lab.fx.pubA2, payout: '0.2500', revenue: '0.0000' });
      const pb2 = await lab.postback({ click_id: a2.clickId!, status: 'approved', txn_id: 'cs-cpc-a2' });
      expect(await conversionOf(pb2.body)).toMatchObject({ payout: '0.0000', revenue: '8.0000' });
      const a1 = await lab.click(o.id, { ip: fresh() });
      const pb1 = await lab.postback({ click_id: a1.clickId!, status: 'approved', txn_id: 'cs-cpc-a1' });
      expect(await conversionOf(pb1.body)).toMatchObject({ payout: '5.0000', revenue: '8.0000' });
      expect((await billingRows(o.id, 1)).length).toBe(1);
    });
  });

  describe('impressions and CPM', () => {
    it('an impression is recorded like a click: accepted (unique once), or rejected with the reason; JSON on request', async () => {
      const o = await lab.offer({}, { geo: [{ country: 'US' }] });
      const ok = await lab.impression(o.id, { ip: IP.US_WA, qs: 'creative_id=cr-1&sub1=pl-9' });
      expect(ok.status).toBe(200);
      expect(ok.row).toMatchObject({ country: 'US', device: 'desktop', creative_id: 'cr-1', sub1: 'pl-9', is_unique: true, fraud_flags: [], payout: '5.0000', revenue: '8.0000' });
      expect((await lab.impression(o.id, { ip: IP.US_WA })).row!['is_unique']).toBe(false);
      expect((await lab.impression(o.id, { ip: IP.GB_LONDON })).reason).toBe('geo_not_allowed');
      const pending = await lab.partner('pending');
      expect((await lab.impression(o.id, { pub: pending, ip: IP.US_WA })).reason).toBe('partner_pending');
      const json = await lab.impression(o.id, { ip: IP.US_WA, qs: 'format=json' });
      expect(json.json).toMatchObject({ ok: true, data: { impression_id: json.impressionId, redirect_url: null } });
      const paused = await lab.offer({ status: 'paused' });
      expect((await lab.impression(paused.id, { ip: IP.US_WA })).reason).toBe('offer_not_active');
    });

    it('with an impression URL the browser goes on to the advertiser / MMP with the impression id', async () => {
      const o = await lab.offer({ impressionUrl: 'https://mmp.example.com/imp?id={imp_id}&s1={sub1}&p={publisher_id}' });
      const r = await lab.impression(o.id, { ip: fresh(), qs: 'sub1=abc' });
      expect(r.status).toBe(302);
      expect(r.location).toBe(`https://mmp.example.com/imp?id=${r.impressionId}&s1=abc&p=${lab.fx.pubA1}`);
    });

    it('CPM: valid impressions are booked as money — exact over many bookings — and reports count impressions, not conversions', async () => {
      const o = await lab.offer({ payoutModel: 'CPM', defaultPayout: '2.00', defaultRevenue: '5.00', revenueSettings: REVENUE({ revenueAction: 'impression' }) });
      for (let i = 0; i < 3; i++) await lab.impression(o.id, { ip: fresh() });
      await lab.impression(o.id, { ip: fresh(), ua: UA.bot }); // flagged — not billed
      await lab.impression(o.id, { pub: await lab.partner('inactive'), ip: fresh() }); // rejected — not billed
      await counted(o.id, 3);
      await bookImpressions({ minIntervalS: 0 });
      const [first] = await billingRows(o.id, 1);
      expect(first).toMatchObject({ source: 'impression', event_name: 'impressions', attribution: 'impression', status: 'approved', payout: '0.0060', revenue: '0.0150', publisher_id: lab.fx.pubA1 });
      expect(first!['raw_params']).toMatchObject({ impressions: '3', from: '1', to: '3' });
      expect(await ledger(first!.conversion_id)).toEqual([
        { account_type: 'advertiser', entry_type: 'billing', direction: 'debit', amount: '0.0150' },
        { account_type: 'publisher', entry_type: 'earning', direction: 'credit', amount: '0.0060' },
      ]);
      for (let i = 0; i < 2; i++) await lab.impression(o.id, { ip: fresh() });
      await counted(o.id, 5);
      await bookImpressions({ minIntervalS: 0 });
      const both = await billingRows(o.id, 2);
      expect(both[1]).toMatchObject({ payout: '0.0040', revenue: '0.0100' });
      expect((await bookImpressions({ minIntervalS: 0 })).booked).toBe(0); // nothing new
      const { rows } = await report(`groupBy=offer&offerId=${o.id}&metrics=impressions,unique_impressions,invalid_impressions,ctr,clicks,conversions,payout,revenue`);
      expect(rows[0]!.metrics).toMatchObject({ impressions: 7, invalid_impressions: 2, conversions: 0, payout: '0.0100', revenue: '0.0250', ctr: 0 });
    });

    it('a tiny CPM rate rounds exactly over the running total, never per booking', async () => {
      const o = await lab.offer({ payoutModel: 'CPM', defaultPayout: '0.0700', defaultRevenue: '0' });
      // 0.07 per 1000 = 0.00007 each: booking one at a time would round every one to 0.0001 (7 × 0.0001 = 0.0007 ≠ 0.0005).
      for (let i = 0; i < 7; i++) {
        await lab.impression(o.id, { ip: fresh() });
        await counted(o.id, i + 1);
        await bookImpressions({ minIntervalS: 0 });
      }
      const rows = await billingRows(o.id, 1);
      const total = rows.reduce((s, r) => s + Math.round(Number(r['payout']) * 10_000), 0);
      expect(total).toBe(5); // round(7 × 0.07 / 1000, 4) = 0.0005
    });
  });

  describe('view-through', () => {
    it('a conversion with no click is credited to the impression — by its id, the visitor’s address, or the cookie; a click wins', async () => {
      const o = await lab.offer({ attributionSettings: ATTRIBUTION({ viewThrough: true, viewThroughWindowHours: 24 }) });
      const ip = IP.GB_LONDON;
      const imp = await lab.impression(o.id, { pub: lab.fx.pubA2, ip, qs: 'sub1=vt-sub' });
      expect(imp.setCookie).toContain(`_trkvt_${o.id.replace(/-/g, '')}=${imp.impressionId}`);

      const byId = await lab.postback({ impression_id: imp.impressionId!, status: 'approved', txn_id: 'vt-id' });
      expect(byId.status).toBe(200);
      expect(await conversionOf(byId.body)).toMatchObject({
        click_id: imp.impressionId, attribution: 'view_through', publisher_id: lab.fx.pubA2, payout: '5.0000', revenue: '8.0000', country: 'GB', device: 'desktop',
      });
      const byIp = await lab.postback({ offer_id: o.id, ip, status: 'approved', txn_id: 'vt-ip' });
      expect(await conversionOf(byIp.body)).toMatchObject({ click_id: imp.impressionId, attribution: 'view_through' });
      // The pixel on the advertiser's thank-you page: the impression cookie (from another address).
      const px = await lab.track.inject({ method: 'GET', url: `/pixel?offer_id=${o.id}&txn_id=vt-cookie&status=approved`, headers: {
        host: lab.host, referer: 'https://adv.example.com/thanks', cookie: `_trkvt_${o.id.replace(/-/g, '')}=${imp.impressionId}`, 'x-forwarded-for': fresh(), 'user-agent': UA.windows,
      } });
      expect(px.statusCode).toBe(200);
      const viaCookie = await byTxn(o.id, 'vt-cookie');
      expect(await lab.conversion(viaCookie!.conversion_id)).toMatchObject({ attribution: 'view_through', publisher_id: lab.fx.pubA2, source: 'pixel' });
      // A click id always wins.
      const c = await lab.click(o.id, { ip: fresh() });
      const click = await lab.postback({ click_id: c.clickId!, impression_id: imp.impressionId!, status: 'approved', txn_id: 'vt-click' });
      expect(await conversionOf(click.body)).toMatchObject({ attribution: 'click', publisher_id: lab.fx.pubA1 });
      // Reports place the view-through conversions by the impression's country.
      const { rows } = await report(`groupBy=country&offerId=${o.id}&metrics=conversions`);
      expect(rows.find((r) => r.dimensions['country'] === 'GB')?.metrics['conversions']).toBe(3);
    });

    it('nothing is credited off an offer without view-through, outside its window, or from a rejected impression', async () => {
      const off = await lab.offer();
      const imp = await lab.impression(off.id, { ip: fresh() });
      expect((await lab.postback({ impression_id: imp.impressionId!, status: 'approved', txn_id: 'vt-off' })).status).toBe(404);
      expect(await notRecorded('vt-off')).toBe('unknown_impression');

      const on = await lab.offer({ attributionSettings: ATTRIBUTION({ viewThrough: true, viewThroughWindowHours: 24 }) }, { geo: [{ country: 'US' }] });
      const old = randomUUID().replace(/-/g, '');
      await query(`INSERT INTO impressions (impression_id, network_id, offer_id, publisher_id, created_at, resolved_payout, resolved_revenue, currency)
                   VALUES ($1, $2, $3, $4, now() - interval '2 days', 5, 8, 'USD')`, [old, lab.fx.networkA, on.id, lab.fx.pubA1]);
      expect((await lab.postback({ impression_id: old, status: 'approved', txn_id: 'vt-old' })).status).toBe(404);
      const rejected = await lab.impression(on.id, { ip: IP.GB_LONDON });
      expect(rejected.reason).toBe('geo_not_allowed');
      expect((await lab.postback({ impression_id: rejected.impressionId!, status: 'approved', txn_id: 'vt-rej' })).status).toBe(404);
    });
  });

  describe('email ownership', () => {
    it('the converting partner owns the customer; a postback with the email and no click is theirs — first or last partner, within the window', async () => {
      const o = await lab.offer({ attributionSettings: ATTRIBUTION({ emailOwnership: true }) });
      const owner = async () => (await query<{ publisher_id: string; email_hash: string }>(
        `SELECT publisher_id, email_hash FROM email_owners WHERE network_id = $1 AND offer_id = $2`, [lab.fx.networkA, o.id])).rows;
      const c1 = await lab.click(o.id, { ip: fresh() });
      await lab.postback({ click_id: c1.clickId!, email: ' Jane.Doe@Example.com ', status: 'approved', txn_id: 'em-1' });
      expect(await owner()).toEqual([{ publisher_id: lab.fx.pubA1, email_hash: sha256('jane.doe@example.com') }]); // only the hash

      const rebill = await lab.postback({ offer_id: o.id, email: 'jane.doe@example.com', status: 'approved', txn_id: 'em-rebill-1' });
      expect(rebill.status).toBe(200);
      expect(await conversionOf(rebill.body)).toMatchObject({ attribution: 'email', publisher_id: lab.fx.pubA1, payout: '5.0000', status: 'approved' });
      // Without the secure code nobody learns whether the advertiser has that customer: 403 either way, nothing recorded.
      for (const [email, txn] of [['jane.doe@example.com', 'em-noauth-1'], ['nobody@example.com', 'em-noauth-2']] as const) {
        expect((await lab.postback({ offer_id: o.id, email, status: 'approved', txn_id: txn }, { secureCode: 'wrong-code' })).status).toBe(403);
        expect(await byTxn(o.id, txn)).toBeUndefined();
      }
      // First partner: another partner's conversion with the same customer doesn't take it.
      const c2 = await lab.click(o.id, { pub: lab.fx.pubA2, ip: fresh() });
      await lab.postback({ click_id: c2.clickId!, email: 'jane.doe@example.com', status: 'approved', txn_id: 'em-2' });
      expect((await owner())[0]!.publisher_id).toBe(lab.fx.pubA1);
      // The advertiser may send the address hashed.
      const hashed = await lab.postback({ offer_id: o.id, email_sha256: sha256('jane.doe@example.com'), status: 'approved', txn_id: 'em-rebill-2' });
      expect(await conversionOf(hashed.body)).toMatchObject({ attribution: 'email', publisher_id: lab.fx.pubA1 });

      // Last partner: the latest converting partner takes the customer over.
      await lab.api('patch', `/offers/${o.id}`, { attributionSettings: ATTRIBUTION({ emailOwnership: true, emailOwnershipMethod: 'last' }) });
      const c3 = await lab.click(o.id, { pub: lab.fx.pubA2, ip: fresh() });
      await lab.postback({ click_id: c3.clickId!, email: 'jane.doe@example.com', status: 'approved', txn_id: 'em-3' });
      expect((await owner())[0]!.publisher_id).toBe(lab.fx.pubA2);
      expect(await conversionOf((await lab.postback({ offer_id: o.id, email: 'jane.doe@example.com', status: 'approved', txn_id: 'em-rebill-3' })).body))
        .toMatchObject({ publisher_id: lab.fx.pubA2 });

      // A window: ownership past it is over — nobody is credited.
      await query(`UPDATE email_owners SET owned_since = now() - interval '3 days', last_conversion_at = now() - interval '3 days' WHERE offer_id = $1`, [o.id]);
      await lab.api('patch', `/offers/${o.id}`, { attributionSettings: ATTRIBUTION({ emailOwnership: true, emailOwnershipWindowDays: 1 }) });
      expect((await lab.postback({ offer_id: o.id, email: 'jane.doe@example.com', status: 'approved', txn_id: 'em-expired' })).status).toBe(404);
      expect(await notRecorded('em-expired')).toBe('unknown_email');
      // The PATCH kept the method saved before (attribution settings merge over the stored ones).
      expect((await lab.api<{ attributionSettings: Record<string, unknown> }>('get', `/offers/${o.id}`)).attributionSettings)
        .toMatchObject({ emailOwnershipMethod: 'last', emailOwnershipWindowDays: 1 });
    });
  });

  describe('price per product', () => {
    it('each line is priced by its SKU rule, else its category rule, else the base rate per unit', async () => {
      const o = await lab.offer({ defaultPayout: '2.00', defaultRevenue: '0', revenueSettings: REVENUE({ revenueType: 'percentage', revenuePct: 10, pricePerProduct: true }) });
      const a1 = await lab.api<{ id: string }>('post', `/offers/${o.id}/products`, { sku: 'A1', name: 'Shoe A1', payoutType: 'fixed', payoutValue: '5.00', revenueType: 'percent', revenueValue: '20' });
      const shoes = await lab.api<{ id: string }>('post', `/offers/${o.id}/products`, { category: 'shoes', payoutType: 'percent', payoutValue: '10' });
      expect((await lab.apiRaw('post', `/offers/${o.id}/products`, { sku: 'a1' })).status).toBe(409);
      expect((await lab.apiRaw('post', `/offers/${o.id}/products`, { name: 'neither' })).status).toBe(422);
      expect((await lab.api<unknown[]>('get', `/offers/${o.id}/products`)).length).toBe(2);

      const c = await lab.click(o.id, { ip: fresh() });
      const products = JSON.stringify([
        { sku: 'A1', price: '50.00', quantity: 2 },               // SKU rule: payout 5 × 2, revenue 20 % of 100
        { sku: 'S9', category: 'Shoes', price: '30.00', quantity: 1 }, // category rule: payout 10 % of 30; revenue 10 % of 30
        { sku: 'Z', price: '10.00', quantity: 3 },                // base: payout 2 × 3; revenue 10 % of 30
      ]);
      const pb = await lab.postback({ click_id: c.clickId!, products, status: 'approved', txn_id: 'ppp-1' });
      const conv = await conversionOf(pb.body);
      expect(conv).toMatchObject({ payout: '19.0000', revenue: '26.0000' });
      expect(conv!['products']).toEqual([
        expect.objectContaining({ sku: 'A1', quantity: 2, amount: '100.0000', productId: a1.id, payout: '10.0000', revenue: '20.0000' }),
        expect.objectContaining({ sku: 'S9', category: 'Shoes', productId: shoes.id, payout: '3.0000', revenue: '3.0000' }),
        expect.objectContaining({ sku: 'Z', productId: null, payout: '6.0000', revenue: '3.0000' }),
      ]);
      // One product as plain parameters.
      const c2 = await lab.click(o.id, { ip: fresh() });
      const single = await lab.postback({ click_id: c2.clickId!, sku: 'A1', quantity: '3', price: '10.00', status: 'approved', txn_id: 'ppp-2' });
      expect(await conversionOf(single.body)).toMatchObject({ payout: '15.0000', revenue: '6.0000' });
      // A partner's CPA_PPP custom payout: per unit sold.
      await lab.api('post', '/offer-custom-settings', { category: 'revenue_payout', offerId: o.id, partnerId: lab.fx.pubA2, applyCustomPayout: true, payoutModel: 'CPA_PPP', payoutValue: '1.50', status: 'active' });
      const c3 = await lab.click(o.id, { pub: lab.fx.pubA2, ip: fresh() });
      expect(await conversionOf((await lab.postback({ click_id: c3.clickId!, products, status: 'approved', txn_id: 'ppp-3' })).body))
        .toMatchObject({ payout: '9.0000', revenue: '26.0000' }); // 1.50 × 6 units
      // A pixel never prices products (the visitor could write any price): the base amounts.
      const c4 = await lab.click(o.id, { ip: fresh() });
      await lab.track.inject({ method: 'GET', url: `/pixel?click_id=${c4.clickId}&txn_id=ppp-px&products=${encodeURIComponent(products)}`, headers: { host: lab.host, referer: 'https://adv.example.com/thanks' } });
      const px = await byTxn(o.id, 'ppp-px');
      expect(await lab.conversion(px!.conversion_id)).toMatchObject({ payout: '2.0000', products: null });
    });
  });

  describe('direct linking', () => {
    it('the tag on the advertiser’s page registers the click — only from the offer’s own site; /sdk.js and the links API', async () => {
      const o = await lab.offer({ linkingType: 'redirect_direct' });
      const ip = fresh();
      const direct = await lab.track.inject({ method: 'GET', url: `/click?offer_id=${o.id}&pub_id=${lab.fx.pubA1}&format=json&sub1=dl-1&referrer=${encodeURIComponent('https://partner.example/page')}`,
        headers: { host: lab.host, origin: 'https://adv.example.com', 'x-forwarded-for': ip, 'user-agent': UA.windows } });
      expect(direct.statusCode).toBe(200);
      expect(direct.headers['access-control-allow-origin']).toBe('https://adv.example.com');
      const id = (direct.json() as { data: { click_id: string } }).data.click_id;
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      let row: Record<string, unknown> | undefined;
      for (let i = 0; i < 50 && !row; i++) {
        row = (await query(`SELECT referrer, sub1, publisher_id FROM clicks WHERE click_id = $1`, [id])).rows[0];
        if (!row) await sleep(100);
      }
      expect(row).toMatchObject({ referrer: 'https://partner.example/page', sub1: 'dl-1', publisher_id: lab.fx.pubA1 });
      // The conversion pixel from the advertiser's site with that click id.
      await lab.track.inject({ method: 'GET', url: `/pixel?click_id=${id}&txn_id=dl-conv`, headers: { host: lab.host, referer: 'https://adv.example.com/thanks' } });
      expect(await byTxn(o.id, 'dl-conv')).toBeTruthy();

      // From another site it is no direct click (a normal redirect, no JSON).
      const evil = await lab.track.inject({ method: 'GET', url: `/click?offer_id=${o.id}&format=json`, headers: { host: lab.host, origin: 'https://evil.example', 'user-agent': UA.windows } });
      expect(evil.statusCode).toBe(302);
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
      // A redirect-only offer ignores it too.
      const plain = await lab.offer();
      expect((await lab.track.inject({ method: 'GET', url: `/click?offer_id=${plain.id}&format=json`, headers: { host: lab.host, origin: 'https://adv.example.com' } })).statusCode).toBe(302);

      const sdk = await lab.track.inject({ method: 'GET', url: '/sdk.js', headers: { host: lab.host } });
      expect(sdk.statusCode).toBe(200);
      expect(sdk.headers['content-type']).toContain('javascript');
      expect(sdk.body).toContain('window.trk = trk');
      expect((await lab.track.inject({ method: 'GET', url: '/sdk.js', headers: { host: 'nobody.example' } })).statusCode).toBe(404);

      const links = await lab.api<{ trackingUrl: string; impressionUrl: string; directUrl: string; sdk: { landing: string } }>('get', `/offers/${o.id}/links?publisherId=${lab.fx.pubA1}`);
      expect(links.directUrl).toBe(`https://adv.example.com/lp?offer_id=${o.id}&pub_id=${lab.fx.pubA1}`); // the macro parameters dropped
      expect(links.impressionUrl).toContain(`/impression?offer_id=${o.id}&pub_id=${lab.fx.pubA1}`);
      expect(links.sdk.landing).toContain('/sdk.js');
      expect((await lab.api<{ directUrl: string | null; sdk: unknown }>('get', `/offers/${plain.id}/links`))).toMatchObject({ directUrl: null, sdk: null });
    });
  });

  describe('24metrics', () => {
    it('a rejected click is flagged, its conversion held and its address blocked; an approved one’s conversions are reported; a failure changes nothing', async () => {
      const o = await lab.offer({ attributionSettings: ATTRIBUTION({ tracker24: { enabled: true, trackerId: 't24test' } }) });
      const bad = fresh();
      t24.reject.add(bad);
      const flagged = await lab.click(o.id, { ip: bad });
      expect(flagged.status).toBe(302); // the redirect never waits on 24metrics
      expect(flagged.row!['fraud_flags']).toEqual(expect.arrayContaining(['24metrics', '24metrics:VPN']));
      const call = sent.find((s) => s.url.includes(`external_transaction_id=${flagged.clickId}`))!;
      expect(call.url).toMatch(/^https:\/\/t24test\.gateway\.go2link\.co\/c\?no_redirect=true&/);
      expect(new URL(call.url).searchParams.get('ip')).toBe(bad);
      const held = await lab.postback({ click_id: flagged.clickId!, status: 'approved', txn_id: 't24-bad' });
      expect(await conversionOf(held.body)).toMatchObject({ status: 'pending', reason: '24metrics_flagged' });
      expect((await lab.click(o.id, { ip: bad })).reason).toBe('24metrics_blocked');

      const good = await lab.click(o.id, { ip: fresh() });
      expect(good.row!['fraud_flags']).toEqual([]);
      const ok = await lab.postback({ click_id: good.clickId!, status: 'approved', txn_id: 't24-good' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await conversionOf(ok.body), JSON.stringify(ok.body)).toMatchObject({ status: 'approved' });
      const report24 = (await delivered(`/api/event-tx?transaction_id=tx-${good.clickId}`))[0]!;
      expect(report24.url).toContain('payout=5.0000');

      const down = fresh();
      t24.down.add(down);
      const kept = await lab.click(o.id, { ip: down });
      expect(kept.row!['fraud_flags']).toEqual([]);
      expect(await conversionOf((await lab.postback({ click_id: kept.clickId!, status: 'approved', txn_id: 't24-down' })).body)).toMatchObject({ status: 'approved' });
    });
  });
});
