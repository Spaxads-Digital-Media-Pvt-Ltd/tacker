/**
 * Manual conversion status changes. Approving a pending conversion does exactly what an
 * auto-approved postback does (tiered commission → earning + billing ledger entries → partner
 * postback, honoring the offer's "Fire Partner Postback" toggle). Rejecting reverses whatever the
 * ledger holds for it. Status change + ledger write share one transaction, so they can't diverge.
 */
import { pool, query } from '../../../lib/db/pool.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { writeConversionLedger, reverseConversionLedger } from '../../../lib/ledger/ledger.js';
import { applyTieredCommission } from '../../../lib/tiered-commissions/evaluate.js';
import { getOfferConfig } from '../../tracking/offer-cache.js';
import { enqueueOutboundPostback } from '../../tracking/conversions/enqueue-postback.js';

interface ConvRow {
  conversion_id: string; status: string; click_id: string; offer_id: string;
  publisher_id: string | null; advertiser_id: string | null;
  payout: string | null; revenue: string | null; currency: string | null;
  event_name: string | null; transaction_id: string | null;
}

const LOCK_SQL = `SELECT conversion_id, status, click_id, offer_id, publisher_id, advertiser_id, payout, revenue,
                         currency, event_name, transaction_id
                    FROM conversions WHERE network_id = $1 AND conversion_id = $2 FOR UPDATE`;

export async function approveConversion(networkId: string, conversionId: string): Promise<ConvRow> {
  const client = await pool.connect();
  let row: ConvRow;
  try {
    await client.query('BEGIN');
    const found = (await client.query<ConvRow>(LOCK_SQL, [networkId, conversionId])).rows[0];
    if (!found) throw notFound('Conversion not found');
    if (found.status !== 'pending') throw badRequest(`Only pending conversions can be approved — this one is ${found.status}.`);
    row = found;

    let { payout, revenue } = row;
    if (payout != null || revenue != null) {
      const adj = await applyTieredCommission(networkId, {
        offerId: row.offer_id, advertiserId: row.advertiser_id, publisherId: row.publisher_id,
        payout: payout ?? '0', revenue: revenue ?? '0',
      });
      if (adj.appliedId) {
        if (payout != null) payout = adj.payout;
        if (revenue != null) revenue = adj.revenue;
      }
    }
    await client.query(
      `UPDATE conversions SET status = 'approved', reason = 'manually_approved', payout = $3, revenue = $4
        WHERE network_id = $1 AND conversion_id = $2`,
      [networkId, conversionId, payout, revenue],
    );
    await writeConversionLedger(client, {
      networkId, conversionId, publisherId: row.publisher_id, advertiserId: row.advertiser_id,
      payout, revenue, currency: row.currency ?? 'USD',
    });
    await client.query('COMMIT');
    row = { ...row, status: 'approved', payout, revenue };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const offer = await getOfferConfig(networkId, row.offer_id);
  if (offer?.firePartnerPostback ?? true) {
    const subs = (await query<{ sub1: string | null; sub2: string | null; sub3: string | null; sub4: string | null; sub5: string | null }>(
      `SELECT sub1, sub2, sub3, sub4, sub5 FROM clicks WHERE network_id = $1 AND click_id = $2 LIMIT 1`,
      [networkId, row.click_id],
    )).rows[0];
    await enqueueOutboundPostback({
      networkId, conversionId, offerId: row.offer_id, publisherId: row.publisher_id, clickId: row.click_id,
      event: row.event_name, payout: row.payout, currency: row.currency, txnId: row.transaction_id,
      subs: [subs?.sub1 ?? null, subs?.sub2 ?? null, subs?.sub3 ?? null, subs?.sub4 ?? null, subs?.sub5 ?? null],
    });
  }
  return row;
}

export async function rejectConversion(networkId: string, conversionId: string, reason = 'manual_rejection'): Promise<ConvRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query<ConvRow>(LOCK_SQL, [networkId, conversionId])).rows[0];
    if (!row) throw notFound('Conversion not found');
    if (row.status === 'rejected') throw badRequest('Conversion already rejected');
    await client.query(
      `UPDATE conversions SET status = 'rejected', reason = $3 WHERE network_id = $1 AND conversion_id = $2`,
      [networkId, conversionId, reason],
    );
    await reverseConversionLedger(networkId, conversionId, reason, client);
    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
