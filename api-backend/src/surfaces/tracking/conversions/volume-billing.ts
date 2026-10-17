/**
 * Billing rows — the conversions the tracker books ITSELF for offers priced per click or per 1000 impressions
 * (lib/offer-settings/billing.ts), so that money reaches the ledger, partner balances, invoices and reports
 * exactly like conversion money:
 *
 *  - CPC: one conversion per BILLABLE click — unique, valid (no fraud flag), with a partner — event 'click',
 *    source 'click', its click id the click's, created at the click's time. Written by the click-persist worker
 *    right after the click; idempotent on the click (transaction id `cpc:<click id>`).
 *  - CPM: the impression-persist worker counts each billable impression (valid, a partner) in impression_billing
 *    — per offer, partner, day, country, device, currency and rates — and bookImpressions() (impression-billing
 *    worker, every minute) books what's new since a row's last booking as ONE conversion: event 'impressions',
 *    source 'impression', payout / revenue = the rate × impressions / 1000. A row books at most every
 *    `minIntervalS` (5 min) while its day is open; its first booking, and a closed day, at once. The amount is
 *    the running total's rounding minus what was booked before, so many small bookings sum to the exact total.
 *
 * Status: approved — pending (manual_approval_required) when the offer manually approves conversions; approving
 * one later books the ledger like any conversion. A paid click fires the partner's CPC-level postbacks (Partners ›
 * Postbacks, level "CPC"); their conversion postbacks never fire for billing rows. Reports, caps and conversion
 * counts leave billing rows out (they are money, not conversions).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, query } from '../../../lib/db/pool.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { getAnalyticsWriter } from '../../../lib/analytics/writer.js';
import { moneySign, scaleMoney, subMoney } from '../../../lib/money.js';
import { logger } from '../../../lib/logger.js';
import { getOfferConfig } from '../offer-cache.js';
import type { ImpressionJob } from '../impression-job.js';
import { enqueueOutboundPostback } from './enqueue-postback.js';

const ZERO = '0.0000';
const amount = (v: string | null | undefined) => (v != null && moneySign(v) > 0 ? v : ZERO);

export interface ClickBilling {
  networkId: string; clickId: string; offerId: string; publisherId: string; advertiserId: string;
  payout: string | null; revenue: string | null; currency: string | null;
  country: string | null; device: string | null; ts: string; manualApproval: boolean;
  subs: (string | null)[];
}

/** Book a paid click (CPC). Returns the conversion id, or null when nothing was booked (no money, or already). */
export async function recordClickBilling(b: ClickBilling): Promise<string | null> {
  const payout = amount(b.payout);
  const revenue = amount(b.revenue);
  if (payout === ZERO && revenue === ZERO) return null;
  const status = b.manualApproval ? 'pending' : 'approved';
  const reason = b.manualApproval ? 'manual_approval_required' : null;
  const conversionId = randomUUID().replace(/-/g, '');
  const currency = b.currency ?? 'USD';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, event_name, status, reason,
                                payout, revenue, currency, transaction_id, source, raw_params, attribution, country, device, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'click', $7, $8, $9, $10, $11, $12, 'click', '{}'::jsonb, 'click', $13, $14, $15)
       ON CONFLICT (offer_id, event_name, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
       RETURNING conversion_id`,
      [conversionId, b.networkId, b.clickId, b.offerId, b.publisherId, b.advertiserId, status, reason,
        payout, revenue, currency, `cpc:${b.clickId}`, b.country, b.device, b.ts],
    );
    if (!ins.rows.length) { await client.query('COMMIT'); return null; }
    if (status === 'approved') {
      await writeConversionLedger(client, {
        networkId: b.networkId, conversionId, publisherId: b.publisherId, advertiserId: b.advertiserId, payout, revenue, currency,
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // The partner's CPC-level postback (Partners › Postbacks, level "CPC"), when the offer fires partner postbacks.
  if (status === 'approved' && (await getOfferConfig(b.networkId, b.offerId))?.firePartnerPostback !== false) {
    await enqueueOutboundPostback({
      networkId: b.networkId, conversionId, offerId: b.offerId, publisherId: b.publisherId, clickId: b.clickId,
      event: 'click', payout, currency, txnId: null, subs: b.subs, level: 'cpc',
    });
  }
  await getAnalyticsWriter().writeConversions([{
    conversionId, clickId: b.clickId, networkId: b.networkId, offerId: b.offerId, publisherId: b.publisherId, timestamp: b.ts,
    advertiserId: b.advertiserId, goalId: null, status, reason, source: 'click', eventName: 'click',
    country: b.country, region: null, city: null, isp: null, device: b.device, os: null, browser: null,
    sub1: b.subs[0] ?? null, sub2: b.subs[1] ?? null, sub3: b.subs[2] ?? null, sub4: b.subs[3] ?? null, sub5: b.subs[4] ?? null,
    smartLinkId: null, fraudScore: 0, fraudFlags: [], payout, revenue, currency,
  }]);
  return conversionId;
}

/** Count a billable impression (CPM) for its booking row — in the caller's transaction when given one. */
export async function countImpression(job: ImpressionJob, db: Pick<PoolClient, 'query'> = { query: query as unknown as PoolClient['query'] }): Promise<void> {
  if (!job.cpm || !job.publisherId) return;
  await db.query(
    `INSERT INTO impression_billing (network_id, offer_id, publisher_id, advertiser_id, day, country, device, currency, payout_cpm, revenue_cpm, impressions)
     VALUES ($1, $2, $3, $4, ($5::timestamptz AT TIME ZONE 'UTC')::date, $6, $7, $8, $9, $10, 1)
     ON CONFLICT (network_id, offer_id, publisher_id, day, country, device, currency, payout_cpm, revenue_cpm)
     DO UPDATE SET impressions = impression_billing.impressions + 1, advertiser_id = EXCLUDED.advertiser_id`,
    [job.networkId, job.offerId, job.publisherId, job.cpm.advertiserId, job.ts, job.country ?? '', job.device ?? '',
      job.currency ?? 'USD', job.cpm.payout ?? ZERO, job.cpm.revenue ?? ZERO],
  );
}

interface BillingRow {
  id: string; network_id: string; offer_id: string; publisher_id: string; advertiser_id: string | null; day: string;
  country: string; device: string; currency: string; payout_cpm: string; revenue_cpm: string; impressions: string; booked: string;
}

export interface BookingRun { rows: number; booked: number }

/** Book the impressions counted since each row's last booking (see the header). */
export async function bookImpressions(opts: { minIntervalS?: number; limit?: number } = {}): Promise<BookingRun> {
  const { rows: due } = await query<{ id: string }>(
    `SELECT id FROM impression_billing
      WHERE impressions > booked
        AND (last_booked_at IS NULL OR last_booked_at <= now() - make_interval(secs => $1) OR day < (now() AT TIME ZONE 'UTC')::date)
      ORDER BY last_booked_at NULLS FIRST LIMIT $2`,
    [opts.minIntervalS ?? 300, opts.limit ?? 500],
  );
  let booked = 0;
  for (const { id } of due) {
    try {
      if (await bookRow(id)) booked++;
    } catch (err) {
      logger.error({ err, id }, 'impression booking failed');
    }
  }
  return { rows: due.length, booked };
}

async function bookRow(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query<BillingRow>(
      `SELECT id, network_id, offer_id, publisher_id, advertiser_id, day::text AS day, country, device, currency,
              payout_cpm::text AS payout_cpm, revenue_cpm::text AS revenue_cpm, impressions::text AS impressions, booked::text AS booked
         FROM impression_billing WHERE id = $1 FOR UPDATE SKIP LOCKED`, [id])).rows[0];
    const total = BigInt(r?.impressions ?? 0);
    const before = BigInt(r?.booked ?? 0);
    if (!r || total <= before) { await client.query('COMMIT'); return false; }
    const share = (rate: string) => subMoney(scaleMoney(rate, total, 1000), scaleMoney(rate, before, 1000));
    const payout = share(r.payout_cpm);
    const revenue = share(r.revenue_cpm);
    const offer = await getOfferConfig(r.network_id, r.offer_id);
    const manual = Boolean(offer?.revenue?.manualApproval);
    const status = manual ? 'pending' : 'approved';
    const conversionId = randomUUID().replace(/-/g, '');
    if (moneySign(payout) > 0 || moneySign(revenue) > 0) {
      const ins = await client.query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, event_name, status, reason,
                                  payout, revenue, currency, transaction_id, source, raw_params, attribution, country, device)
         VALUES ($1, $2, $3, $4, $5, $6, 'impressions', $7, $8, $9, $10, $11, $12, 'impression', $13, 'impression', $14, $15)
         ON CONFLICT (offer_id, event_name, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
         RETURNING conversion_id`,
        [conversionId, r.network_id, `cpm-${conversionId}`, r.offer_id, r.publisher_id, r.advertiser_id, status,
          manual ? 'manual_approval_required' : null, payout, revenue, r.currency, `cpm:${r.id}:${before + 1n}-${total}`,
          JSON.stringify({ impressions: String(total - before), from: String(before + 1n), to: String(total), day: r.day, payout_cpm: r.payout_cpm, revenue_cpm: r.revenue_cpm }),
          r.country || null, r.device || null],
      );
      if (ins.rows.length && status === 'approved') {
        await writeConversionLedger(client, {
          networkId: r.network_id, conversionId, publisherId: r.publisher_id, advertiserId: r.advertiser_id,
          payout, revenue, currency: r.currency,
        });
      }
    }
    await client.query(`UPDATE impression_billing SET booked = $2, last_booked_at = now() WHERE id = $1`, [r.id, String(total)]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
