/**
 * Offers end to end — the CONVERSION side (INTEGRATION_DB=1): offers configured through the dashboard API, real
 * clicks, real S2S postbacks / pixels, the real outbound-postback worker (its HTTP call captured — the delivery
 * guard refuses test addresses), and the ledger.
 *
 * Covered: secure code (network, the offer's own) · unknown clicks · status approved / pending / rejected and the
 * ledger · manual approval and approving later · duplicates (unique transaction, one per click, every postback)
 * · events / goals and pricing precedence (explicit, partner custom payout, event goal, country override, default
 * goal) · percentage / mixed revenue, a partner's % of the sale (CPS) · currency · offer, goal and partner
 * conversion caps · attribution window · click-to-conversion time · partner postbacks (macros, event-only,
 * offer-specific, POST, pending → after approval, turned off, rejected) · pixel origin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Worker } from 'bullmq';

const sent = vi.hoisted(() => [] as { url: string; method: string; body?: string }[]);
vi.mock('../../src/lib/net/safe-http.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/net/safe-http.js')>();
  return {
    ...mod,
    safeRequest: vi.fn(async (url: string, opts: { method?: string; body?: string } = {}) => {
      sent.push({ url, method: opts.method ?? 'GET', body: opts.body });
      return { status: 200, body: '' };
    }),
  };
});

import { query } from '../../src/lib/db/pool.js';
import { startOutboundPostbackWorker } from '../../src/surfaces/workers/processors/outbound-postback.js';
import { getQueue, QUEUE } from '../../src/surfaces/workers/queues.js';
import { canConnect } from '../helpers/db.js';
import { startLab, IP, type Lab } from '../helpers/offer-e2e.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const REVENUE = (extra: Record<string, unknown> = {}) => ({
  baseEventName: null, manualApproval: false, allowDuplicates: true, revenueAction: 'conversion', revenueType: 'fixed', revenuePct: null, pricePerProduct: false, ...extra,
});
const ATTRIBUTION = (extra: Record<string, unknown> = {}) => ({
  tracker24: { enabled: false, trackerId: null }, ipqs: { enabled: false }, throttle: { enabled: false, ratePct: 0 },
  clickToConversion: { enabled: false, minSeconds: 0, maxSeconds: null }, emailOwnership: false, viewThrough: false, serverSideClick: false, ...extra,
});

d('offers end to end — conversions and postbacks (live DB + GeoIP test data)', () => {
  let lab: Lab;
  let outbound: Worker;
  const ledger = async (conversionId: string) => (await query<{ account_type: string; entry_type: string; direction: string; amount: string; currency: string }>(
    `SELECT account_type, entry_type, direction, amount::text AS amount, currency FROM ledger_entries WHERE conversion_id = $1 ORDER BY created_at, entry_type`, [conversionId])).rows;
  /** A click on the offer (by default from the US) and its click id. */
  const clickOn = async (offerId: string, opts: Parameters<Lab['click']>[1] = {}) => {
    const c = await lab.click(offerId, { ip: IP.US_WA, ...opts });
    expect(c.status, JSON.stringify(c.row?.['fraud_flags'])).toBe(302);
    return c.clickId!;
  };
  /** The partner postbacks delivered whose URL / body mentions `needle` (waits for the worker). */
  const delivered = async (needle: string, want = 1) => {
    for (let i = 0; i < 150; i++) {
      const hits = sent.filter((s) => s.url.includes(needle) || (s.body ?? '').includes(needle));
      if (hits.length >= want) return hits;
      await sleep(100);
    }
    return sent.filter((s) => s.url.includes(needle) || (s.body ?? '').includes(needle));
  };

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    lab = await startLab('e2ev');
    // Other files leave postback jobs no worker took (test Redis only) — drop them, or ours would wait behind them.
    await getQueue(QUEUE.outboundPostback).drain(true);
    outbound = startOutboundPostbackWorker();
  });
  afterAll(async () => { await outbound?.close(); await lab?.close(); });

  describe('security and attribution', () => {
    it('the network’s secure code is required; an offer with its own code takes only that one', async () => {
      const o = await lab.offer();
      const cid = await clickOn(o.id);
      expect((await lab.postback({ click_id: cid, txn_id: 'x' }, { secureCode: null })).status).toBe(403);
      expect((await lab.postback({ click_id: cid, txn_id: 'x' }, { secureCode: 'WrongCode1234' })).status).toBe(403);
      const ok = await lab.postback({ click_id: cid, txn_id: 'x', status: 'approved' });
      expect(ok).toMatchObject({ status: 200, body: { status: 'approved', conversion_id: expect.any(String) } });
      const own = await lab.offer();
      const code = (await lab.api<{ securityCode: string }>('post', `/offers/${own.id}/security-code/regenerate`)).securityCode;
      const cid2 = await clickOn(own.id);
      expect((await lab.postback({ click_id: cid2, txn_id: 'y' })).status).toBe(403); // the network's code no longer works for it
      expect((await lab.postback({ click_id: cid2, txn_id: 'y', status: 'approved' }, { secureCode: code })).body.status).toBe('approved');
      const log = (await query<{ outcome: string; reason: string }>(
        `SELECT outcome, reason FROM inbound_postback_logs WHERE network_id = $1 AND click_id = $2 ORDER BY created_at`, [lab.fx.networkA, cid])).rows;
      expect(log.map((l) => l.outcome)).toEqual(['security_failed', 'security_failed', 'approved']);
    });

    it('an unknown click is 404 and nothing is recorded', async () => {
      const r = await lab.postback({ click_id: randomUUID().replace(/-/g, ''), txn_id: 'nope' });
      expect(r.status).toBe(404);
    });

    it('status: approved pays (ledger) · pending holds (no ledger) · rejected records only', async () => {
      const o = await lab.offer();
      const approved = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'a', status: 'approved' });
      const entries = await ledger(approved.body.conversion_id);
      expect(entries).toHaveLength(2);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ account_type: 'publisher', entry_type: 'earning', direction: 'credit', amount: '5.0000' }),
        expect.objectContaining({ account_type: 'advertiser', entry_type: 'billing', direction: 'debit', amount: '8.0000' }),
      ]));
      const pending = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'p' }); // no status → pending
      expect(pending.body.status).toBe('pending');
      expect(await ledger(pending.body.conversion_id)).toEqual([]);
      const rejected = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'r', status: 'reversed' });
      expect(rejected.body.status).toBe('rejected');
      expect(await ledger(rejected.body.conversion_id)).toEqual([]);
    });

    it('manual approval holds every conversion until approved in the dashboard — then it pays and posts back', async () => {
      const o = await lab.offer({ revenueSettings: REVENUE({ manualApproval: true }) });
      const sub = `pb-${randomUUID().slice(0, 8)}`;
      await lab.api('post', `/publishers/${lab.fx.pubA1}/postbacks`, { url: `https://partner.example.com/pb?m=manual&click={sub1}&payout={payout}`, offerId: o.id });
      const p = await lab.postback({ click_id: await clickOn(o.id, { qs: `sub1=${sub}` }), txn_id: 'm1', status: 'approved' });
      expect(p.body.status).toBe('pending');
      expect(await lab.conversion(p.body.conversion_id)).toMatchObject({ reason: 'manual_approval_required' });
      await sleep(300);
      expect(sent.some((s) => s.url.includes(sub))).toBe(false);
      await lab.api('post', `/finance/conversions/${p.body.conversion_id}/approve`);
      expect((await lab.conversion(p.body.conversion_id))!['status']).toBe('approved');
      expect((await ledger(p.body.conversion_id)).length).toBe(2);
      expect((await delivered(sub))[0]!.url).toBe(`https://partner.example.com/pb?m=manual&click=${sub}&payout=5.0000`);
    });
  });

  describe('duplicates', () => {
    it('unique transaction (default): a repeated txn is a duplicate, a new txn is another conversion; without a txn, one per click', async () => {
      const o = await lab.offer();
      const cid = await clickOn(o.id);
      expect((await lab.postback({ click_id: cid, txn_id: 'T1', status: 'approved' })).body.status).toBe('approved');
      expect((await lab.postback({ click_id: cid, txn_id: 'T1', status: 'approved' })).body.status).toBe('duplicate');
      expect((await lab.postback({ click_id: cid, txn_id: 'T2', status: 'approved' })).body.status).toBe('approved');
      const cid2 = await clickOn(o.id);
      expect((await lab.postback({ click_id: cid2, status: 'approved' })).body.status).toBe('approved');
      expect((await lab.postback({ click_id: cid2, status: 'approved' })).body.status).toBe('duplicate');
    });

    it('one per click: a second conversion is a duplicate whatever its txn', async () => {
      const o = await lab.offer({ revenueSettings: REVENUE({ duplicateMode: 'one_per_click' }) });
      const cid = await clickOn(o.id);
      expect((await lab.postback({ click_id: cid, txn_id: 'A', status: 'approved' })).body.status).toBe('approved');
      expect((await lab.postback({ click_id: cid, txn_id: 'B', status: 'approved' })).body.status).toBe('duplicate');
    });

    it('every postback counts (renewals) — an identical repeat within 60 s is the advertiser’s retry', async () => {
      const o = await lab.offer({ revenueSettings: REVENUE({ duplicateMode: 'every_postback' }) });
      const cid = await clickOn(o.id);
      expect((await lab.postback({ click_id: cid, status: 'approved', revenue: '8.00' })).body.status).toBe('approved');
      expect((await lab.postback({ click_id: cid, status: 'approved', revenue: '8.00' })).body.status).toBe('duplicate');
      expect((await lab.postback({ click_id: cid, status: 'approved', revenue: '9.00' })).body.status).toBe('approved');
    });
  });

  describe('events, pricing, revenue share, currency', () => {
    it('events price by their goal; no event takes the default goal; a country override sits under an event goal', async () => {
      const o = await lab.offer({}, {
        geo: [{ country: 'GB', payoutOverride: '2.00', revenueOverride: '3.00' }, { country: 'US' }],
        goals: [
          { name: 'Lead', eventName: 'lead', payoutModel: 'CPL', payout: '1.50', revenue: '2.50', isDefault: true },
          { name: 'Purchase', eventName: 'purchase', payout: '10.00', revenue: '18.00' },
        ],
      });
      const us = await clickOn(o.id);
      const lead = await lab.postback({ click_id: us, event: 'lead', status: 'approved' });
      const buy = await lab.postback({ click_id: us, event: 'purchase', txn_id: 'O-1', status: 'approved' });
      expect(await lab.conversion(lead.body.conversion_id)).toMatchObject({ event_name: 'lead', payout: '1.5000', revenue: '2.5000' });
      expect(await lab.conversion(buy.body.conversion_id)).toMatchObject({ event_name: 'purchase', payout: '10.0000', revenue: '18.0000' });
      const gb = await clickOn(o.id, { ip: IP.GB_LONDON });
      const gbBuy = await lab.postback({ click_id: gb, event: 'purchase', txn_id: 'O-2', status: 'approved' });
      expect(await lab.conversion(gbBuy.body.conversion_id)).toMatchObject({ payout: '10.0000', revenue: '18.0000' }); // event goal beats the country rate
      const gbBase = await lab.postback({ click_id: gb, status: 'approved' });
      expect(await lab.conversion(gbBase.body.conversion_id)).toMatchObject({ payout: '2.0000', revenue: '3.0000' }); // country rate beats the default goal
    });

    it('pricing precedence: an explicit payout / revenue wins, then the partner’s custom payout, then the defaults', async () => {
      const o = await lab.offer();
      await lab.api('post', '/offer-custom-settings', { category: 'revenue_payout', offerId: o.id, partnerId: lab.fx.pubA2, applyCustomPayout: true, payoutModel: 'CPA', payoutValue: '7.00', status: 'active' });
      const explicit = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'e', payout: '9.99', revenue: '12.34', status: 'approved' });
      expect(await lab.conversion(explicit.body.conversion_id)).toMatchObject({ payout: '9.9900', revenue: '12.3400' });
      const custom = await lab.postback({ click_id: await clickOn(o.id, { pub: lab.fx.pubA2 }), txn_id: 'c', status: 'approved' });
      expect(await lab.conversion(custom.body.conversion_id)).toMatchObject({ payout: '7.0000', revenue: '8.0000' });
      const plain = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'd', status: 'approved' });
      expect(await lab.conversion(plain.body.conversion_id)).toMatchObject({ payout: '5.0000', revenue: '8.0000' });
    });

    it('revenue share: percentage and mixed revenue from the sale amount; a partner’s CPS % of the sale', async () => {
      const pct = await lab.offer({ payoutModel: 'RevShare', defaultPayout: '0', defaultRevenue: '0', revenueSettings: REVENUE({ revenueType: 'percentage', revenuePct: 30 }) });
      const a = await lab.postback({ click_id: await clickOn(pct.id), txn_id: 's1', sale_amount: '40', status: 'approved' });
      expect(await lab.conversion(a.body.conversion_id)).toMatchObject({ revenue: '12.0000' });
      const mixed = await lab.offer({ defaultRevenue: '8.00', revenueSettings: REVENUE({ revenueType: 'mixed', revenuePct: 10 }) });
      const b = await lab.postback({ click_id: await clickOn(mixed.id), txn_id: 's2', amount: '50', status: 'approved' });
      expect(await lab.conversion(b.body.conversion_id)).toMatchObject({ revenue: '13.0000' });
      const won = await lab.postback({ click_id: await clickOn(pct.id), txn_id: 's3', sale_amount: '40', revenue: '5.00', status: 'approved' });
      expect(await lab.conversion(won.body.conversion_id)).toMatchObject({ revenue: '5.0000' }); // an explicit revenue wins
      await lab.api('post', '/offer-custom-settings', { category: 'revenue_payout', offerId: pct.id, partnerId: lab.fx.pubA2, applyCustomPayout: true, payoutModel: 'CPS', payoutValue: '25', status: 'active' });
      const cps = await lab.postback({ click_id: await clickOn(pct.id, { pub: lab.fx.pubA2 }), txn_id: 's4', sale_amount: '40', status: 'approved' });
      expect(await lab.conversion(cps.body.conversion_id)).toMatchObject({ payout: '10.0000', revenue: '12.0000' });
    });

    it('a EUR offer converts and books in EUR', async () => {
      const o = await lab.offer({ currency: 'EUR', defaultPayout: '3.00', defaultRevenue: '4.50' });
      const c = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'eur', status: 'approved' });
      expect(await lab.conversion(c.body.conversion_id)).toMatchObject({ currency: 'EUR', payout: '3.0000' });
      expect((await ledger(c.body.conversion_id)).map((l) => l.currency)).toEqual(['EUR', 'EUR']);
    });
  });

  describe('caps and time windows', () => {
    it('offer, goal and partner conversion caps hold the next conversion as pending with the cap as its reason', async () => {
      const o = await lab.offer({ dailyConversionCap: 1 });
      expect((await lab.postback({ click_id: await clickOn(o.id), txn_id: '1', status: 'approved' })).body.status).toBe('approved');
      const over = await lab.postback({ click_id: await clickOn(o.id), txn_id: '2', status: 'approved' });
      expect(await lab.conversion(over.body.conversion_id)).toMatchObject({ status: 'pending', reason: 'daily_conversion_cap_reached' });
      const g = await lab.offer({}, { goals: [{ name: 'Sale', eventName: 'sale', payout: '4.00', revenue: '6.00', dailyConversionCap: 1 }] });
      await lab.postback({ click_id: await clickOn(g.id), event: 'sale', txn_id: 'g1', status: 'approved' });
      const gOver = await lab.postback({ click_id: await clickOn(g.id), event: 'sale', txn_id: 'g2', status: 'approved' });
      expect(await lab.conversion(gOver.body.conversion_id)).toMatchObject({ status: 'pending', reason: 'goal_daily_conversion_cap_reached' });
      const p = await lab.offer();
      await lab.api('post', '/offer-custom-settings', { category: 'caps', offerId: p.id, partnerId: lab.fx.pubA1, capType: 'conversions', capInterval: 'daily', capValue: 1, status: 'active' });
      await lab.postback({ click_id: await clickOn(p.id), txn_id: 'p1', status: 'approved' });
      const pOver = await lab.postback({ click_id: await clickOn(p.id), txn_id: 'p2', status: 'approved' });
      expect(await lab.conversion(pOver.body.conversion_id)).toMatchObject({ status: 'pending', reason: 'custom_conversion_cap_reached' });
    });

    /** A click recorded `ageS` seconds ago on the offer (straight into the clicks table — Redis has no copy). */
    const oldClick = async (offerId: string, ageS: number) => {
      const clickId = randomUUID().replace(/-/g, '');
      await query(`INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, country, resolved_payout, resolved_revenue, currency, is_unique, fraud_score, fraud_flags)
                   VALUES ($1, $2, $3, $4, now() - make_interval(secs => $5), '216.160.83.56', 'US', 5, 8, 'USD', true, 0, '{}')`,
        [clickId, lab.fx.networkA, offerId, lab.fx.pubA1, ageS]);
      return clickId;
    };

    it('outside the attribution window → rejected', async () => {
      const o = await lab.offer({ attributionWindowS: 3600 });
      const late = await lab.postback({ click_id: await oldClick(o.id, 7200), txn_id: 'late', status: 'approved' });
      expect(await lab.conversion(late.body.conversion_id)).toMatchObject({ status: 'rejected', reason: 'outside_attribution_window' });
      const inTime = await lab.postback({ click_id: await oldClick(o.id, 600), txn_id: 'ok', status: 'approved' });
      expect((await lab.conversion(inTime.body.conversion_id))!['status']).toBe('approved');
    });

    it('click-to-conversion time: too fast or too slow → rejected', async () => {
      const o = await lab.offer({ attributionSettings: ATTRIBUTION({ clickToConversion: { enabled: true, minSeconds: 60, maxSeconds: 3600 } }) });
      const fast = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'fast', status: 'approved' });
      expect(await lab.conversion(fast.body.conversion_id)).toMatchObject({ status: 'rejected', reason: 'click_to_conversion_too_fast' });
      const slow = await lab.postback({ click_id: await oldClick(o.id, 7200), txn_id: 'slow', status: 'approved' });
      expect(await lab.conversion(slow.body.conversion_id)).toMatchObject({ status: 'rejected', reason: 'click_to_conversion_too_slow' });
      const fine = await lab.postback({ click_id: await oldClick(o.id, 600), txn_id: 'fine', status: 'approved' });
      expect((await lab.conversion(fine.body.conversion_id))!['status']).toBe('approved');
    });
  });

  describe('partner postbacks', () => {
    it('a partner’s postback fires for an approved conversion with every macro filled', async () => {
      const o = await lab.offer();
      const p = await lab.partner('active');
      await lab.api('post', `/publishers/${p}/postbacks`, {
        url: 'https://partner.example.com/pb?click={sub1}&our={click_id}&conv={conversion_id}&payout={payout}&cur={currency}&event={event}&txn={txn_id}&offer={offer_id}&pub={publisher_id}',
      });
      const theirs = `their-${randomUUID().slice(0, 8)}`;
      const cid = await clickOn(o.id, { pub: p, qs: `sub1=${theirs}` });
      const conv = await lab.postback({ click_id: cid, txn_id: 'ORD-9', status: 'approved' });
      const [hit] = await delivered(theirs);
      expect(hit, 'postback delivered').toBeDefined();
      const u = new URL(hit!.url);
      expect(Object.fromEntries(u.searchParams)).toEqual({
        click: theirs, our: cid, conv: conv.body.conversion_id, payout: '5.0000', cur: 'USD', event: '', txn: 'ORD-9', offer: o.id, pub: p,
      });
      const log = (await query<{ success: boolean; url: string }>('SELECT success, url FROM postback_logs WHERE conversion_id = $1', [conv.body.conversion_id])).rows;
      expect(log).toEqual([expect.objectContaining({ success: true, url: hit!.url })]);
    });

    it('an event postback fires only for its event; an offer’s own postback beats the global one; POST sends JSON', async () => {
      const o = await lab.offer({}, { goals: [{ name: 'Lead', eventName: 'lead', payout: '1.00', revenue: '2.00' }, { name: 'Purchase', eventName: 'purchase', payout: '9.00', revenue: '15.00' }] });
      const p = await lab.partner('active');
      await lab.api('post', `/publishers/${p}/postbacks`, { url: 'https://partner.example.com/purchase?c={sub1}&v={payout}', level: 'event', event: 'purchase' });
      const theirs = `ev-${randomUUID().slice(0, 8)}`;
      const cid = await clickOn(o.id, { pub: p, qs: `sub1=${theirs}` });
      await lab.postback({ click_id: cid, event: 'lead', status: 'approved' });
      await lab.postback({ click_id: cid, event: 'purchase', txn_id: 'P1', status: 'approved' });
      const hits = await delivered(theirs);
      expect(hits.map((h) => h.url)).toEqual([`https://partner.example.com/purchase?c=${theirs}&v=9.0000`]);

      const q = await lab.partner('active');
      await lab.api('post', `/publishers/${q}/postbacks`, { url: 'https://partner.example.com/global?c={sub1}' });
      const own = await lab.offer();
      await lab.api('post', `/publishers/${q}/postbacks`, { url: 'https://partner.example.com/offer-only', method: 'POST', offerId: own.id });
      const t2 = `own-${randomUUID().slice(0, 8)}`;
      await lab.postback({ click_id: await clickOn(own.id, { pub: q, qs: `sub1=${t2}` }), txn_id: 'Q1', status: 'approved' });
      const [post] = await delivered(t2);
      expect(post).toMatchObject({ url: 'https://partner.example.com/offer-only', method: 'POST' });
      expect(JSON.parse(post!.body!)).toMatchObject({ sub1: t2, payout: '5.0000', txn_id: 'Q1' });
      expect(sent.some((s) => s.url.startsWith(`https://partner.example.com/global?c=${t2}`))).toBe(false);
    });

    it('no partner postback for a pending or rejected conversion, or when the offer turns them off', async () => {
      const p = await lab.partner('active');
      await lab.api('post', `/publishers/${p}/postbacks`, { url: 'https://partner.example.com/any?c={sub1}' });
      const o = await lab.offer();
      const tPending = `pend-${randomUUID().slice(0, 8)}`;
      const tRejected = `rej-${randomUUID().slice(0, 8)}`;
      await lab.postback({ click_id: await clickOn(o.id, { pub: p, qs: `sub1=${tPending}` }), txn_id: 'pe' });
      await lab.postback({ click_id: await clickOn(o.id, { pub: p, qs: `sub1=${tRejected}` }), txn_id: 're', status: 'rejected' });
      const off = await lab.offer({ firePartnerPostback: false });
      const tOff = `off-${randomUUID().slice(0, 8)}`;
      const c = await lab.postback({ click_id: await clickOn(off.id, { pub: p, qs: `sub1=${tOff}` }), txn_id: 'of', status: 'approved' });
      expect(c.body.status).toBe('approved'); // still a conversion
      await sleep(800);
      expect(sent.filter((s) => [tPending, tRejected, tOff].some((t) => s.url.includes(t)))).toEqual([]);
    });
  });

  describe('coupons, deep links, postback controls, throttle', () => {
    it('a coupon postback (no click) is credited to the coupon’s partner — authenticated, priced, deduped, paid', async () => {
      const o = await lab.offer();
      const p = await lab.partner('active');
      await lab.api('post', `/offers/${o.id}/publishers`, { publisherId: p, access: 'allow', approvalStatus: 'approved', payoutOverride: '4.25' });
      await lab.api('post', `/publishers/${p}/postbacks`, { url: 'https://partner.example.com/coupon?c={click_id}&v={payout}' });
      const code = `SAVE${randomUUID().slice(0, 6).toUpperCase()}`;
      await lab.api('post', `/offers/${o.id}/coupons`, { code, publisherId: p });
      expect((await lab.postback({ coupon_code: code, txn_id: 'C-1', status: 'approved' }, { secureCode: 'WrongCode1234' })).status).toBe(403);
      const ok = await lab.postback({ coupon_code: code.toLowerCase(), txn_id: 'C-1', status: 'approved' });
      expect(ok.status).toBe(200);
      expect(await lab.conversion(ok.body.conversion_id)).toMatchObject({ status: 'approved', publisher_id: p, payout: '4.2500', revenue: '8.0000' });
      expect((await query<{ click_id: string }>('SELECT click_id FROM conversions WHERE conversion_id = $1', [ok.body.conversion_id])).rows[0]!.click_id).toMatch(/^coupon-[0-9a-f]{32}$/);
      expect((await lab.postback({ coupon: code, txn_id: 'C-1', status: 'approved' })).body.status).toBe('duplicate');
      expect((await ledger(ok.body.conversion_id)).length).toBe(2);
      expect((await delivered('partner.example.com/coupon?c=coupon-'))[0]!.url).toMatch(/v=4\.2500$/);
      // Disabled / expired / unknown coupons are not credited.
      const off = `OFF${randomUUID().slice(0, 6).toUpperCase()}`;
      await lab.api('post', `/offers/${o.id}/coupons`, { code: off, publisherId: p, status: 'disabled' });
      expect((await lab.postback({ coupon_code: off, txn_id: 'C-2', status: 'approved' })).status).toBe(404);
      const old = `OLD${randomUUID().slice(0, 6).toUpperCase()}`;
      await lab.api('post', `/offers/${o.id}/coupons`, { code: old, publisherId: p, endsAt: new Date(Date.now() - 86_400_000).toISOString() });
      expect((await lab.postback({ coupon_code: old, txn_id: 'C-3', status: 'approved' })).status).toBe(404);
      expect((await lab.postback({ coupon_code: 'NO-SUCH-CODE', txn_id: 'C-4' })).status).toBe(404);
    });

    it('deep links: only when the offer allows them, only to its own site, keeping the click id', async () => {
      const o = await lab.offer({ deepLinkEnabled: true });
      const deep = await lab.click(o.id, { ip: IP.US_WA, qs: `url=${encodeURIComponent('https://shop.adv.example.com/product/42?color=red')}` });
      expect(deep.location).toMatch(/^https:\/\/shop\.adv\.example\.com\/product\/42\?color=red&cid=[0-9a-f]{32}&s1=&o=/);
      const foreign = await lab.click(o.id, { ip: IP.US_WA, qs: `url=${encodeURIComponent('https://evil.example.org/phish')}` });
      expect(foreign.location).toMatch(/^https:\/\/adv\.example\.com\/lp\?cid=/);
      const off = await lab.offer();
      const ignored = await lab.click(off.id, { ip: IP.US_WA, qs: `url=${encodeURIComponent('https://shop.adv.example.com/x')}` });
      expect(ignored.location).toMatch(/^https:\/\/adv\.example\.com\/lp\?cid=/);
    });

    it('advertiser postback controls: reject or hold matching conversions', async () => {
      const o = await lab.offer();
      await lab.api('post', '/postback-controls', { name: 'E2E reject bad sub1', controlType: 'reject', targetType: 'offer', targetIds: [o.id], rules: [{ variable: 'sub1', operator: 'equals', value: 'bad' }] });
      await lab.api('post', '/postback-controls', { name: 'E2E hold big payout', controlType: 'hold', targetType: 'offer', targetIds: [o.id], rules: [{ variable: 'payout', operator: 'greater_than', value: '100' }] });
      const bad = await lab.postback({ click_id: await clickOn(o.id, { qs: 'sub1=bad' }), txn_id: 'b', status: 'approved' });
      expect(await lab.conversion(bad.body.conversion_id)).toMatchObject({ status: 'rejected', reason: 'postback_control:E2E reject bad sub1' });
      const big = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'h', payout: '150', status: 'approved' });
      expect(await lab.conversion(big.body.conversion_id)).toMatchObject({ status: 'pending', reason: 'postback_control:E2E hold big payout' });
      const fine = await lab.postback({ click_id: await clickOn(o.id), txn_id: 'f', status: 'approved' });
      expect((await lab.conversion(fine.body.conversion_id))!['status']).toBe('approved');
    });

    it('throttle 100 %: approved and billed, the partner paid nothing and not posted back', async () => {
      const o = await lab.offer({ attributionSettings: ATTRIBUTION({ throttle: { enabled: true, ratePct: 100 } }) });
      const p = await lab.partner('active');
      await lab.api('post', `/publishers/${p}/postbacks`, { url: 'https://partner.example.com/throttle?c={sub1}' });
      const t = `thr-${randomUUID().slice(0, 8)}`;
      const c = await lab.postback({ click_id: await clickOn(o.id, { pub: p, qs: `sub1=${t}` }), txn_id: 't', status: 'approved' });
      expect(await lab.conversion(c.body.conversion_id)).toMatchObject({ status: 'approved', reason: 'throttled', payout: '0.0000', revenue: '8.0000' });
      await sleep(600);
      expect(sent.some((s) => s.url.includes(t))).toBe(false);
    });
  });

  describe('pixel', () => {
    it('a pixel counts only from the offer’s own site', async () => {
      const o = await lab.offer();
      const cid = await clickOn(o.id);
      const foreign = await lab.track.inject({ method: 'GET', url: `/pixel?click_id=${cid}`, headers: { host: lab.host, referer: 'https://evil.example.org/thanks' } });
      expect(foreign.statusCode).toBe(200); // a GIF either way
      const none = (await query('SELECT 1 FROM conversions WHERE network_id = $1 AND click_id = $2', [lab.fx.networkA, cid])).rows;
      expect(none).toEqual([]);
      const own = await lab.track.inject({ method: 'GET', url: `/pixel?click_id=${cid}`, headers: { host: lab.host, referer: 'https://checkout.adv.example.com/thanks' } });
      expect(own.statusCode).toBe(200);
      const rows = (await query<{ status: string }>('SELECT status FROM conversions WHERE network_id = $1 AND click_id = $2', [lab.fx.networkA, cid])).rows;
      expect(rows).toHaveLength(1);
    });
  });
});
