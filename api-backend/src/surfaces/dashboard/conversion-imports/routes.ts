/**
 * Conversion Imports (Reporting › Conversion Imports) — real bulk CSV import jobs against the
 * conversions table. Rows are parsed client-side into objects (no server-side CSV parser needed) and
 * posted as JSON; each row is processed individually so a bad row doesn't fail the whole job — same
 * spirit as the reference's "Total Rows / Total Processed / Conversion Errors" columns. Logged to the
 * existing import_export_logs table (kind='import', entity='conversions'), the same table single
 * offline-conversion creates already write to (offline/routes.ts).
 *
 * Create rows go through the same policy as manual Add Conversion (lib/offer-access/
 * manual-conversion-policy.ts): the offer and its advertiser must be this network's (an advertiser
 * column, when present, must be the offer's advertiser); a row naming a partner needs an ACTIVE
 * partner allowed on the offer by the /click rules (explicit deny; private / request-access offers
 * need an approved grant). A row without a status cell is 'approved'; on an offer with "Manually
 * Approve Conversions" on, a missing or explicit 'approved' status becomes 'pending' with reason
 * 'manual_approval_required' (explicit 'pending' / 'rejected' are kept). Any refusal is a per-row
 * error and nothing is written. Rows without a partner are an administrative record (POST is
 * admin/manager only). The offer's status is not checked (historical conversions). Imports never
 * fire partner postbacks and never enforce conversion caps (they still count toward them, like any
 * non-rejected conversion).
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody } from '../../../lib/http/validate.js';
import { pool, query } from '../../../lib/db/pool.js';
import { rebalanceConversionLedger, writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { moneySign, normalizeMoney } from '../../../lib/money.js';
import { writeAudit } from '../../../lib/audit.js';
import {
  MANUAL_CONVERSION_STATUSES, evaluateManualConversion, loadManualConversionOffer,
  type ManualConversionOffer, type ManualConversionStatus,
} from '../../../lib/offer-access/manual-conversion-policy.js';
import { requireRole } from '../auth.js';

const IMPORT_TYPES = ['create', 'update_by_transaction_id', 'update_by_conversion_id'] as const;
const TYPE_LABELS: Record<(typeof IMPORT_TYPES)[number], string> = {
  create: 'Create Offline Conversions',
  update_by_transaction_id: 'Update Revenue/Payout By Transaction ID',
  update_by_conversion_id: 'Update Revenue/Payout By Conversion ID',
};

// A blank row is a per-row error (see the loop), not a reason to reject the whole batch.
const rowSchema = z.record(z.string(), z.string());
const importSchema = z.object({
  type: z.enum(IMPORT_TYPES),
  rows: z.array(rowSchema).min(1).max(1000),
});

/**
 * Decimal-validated money for one CSV cell (null when blank); throws a per-row error otherwise. A
 * negative amount is rejected: the ledger never books one, so the conversion and ledger would disagree.
 */
function moneyOrNull(v: string | undefined, field: string): string | null {
  if (v == null || v.trim() === '') return null;
  let m: string;
  try { m = normalizeMoney(v); } catch { throw new Error(`${field} "${v}" is not a valid amount`); }
  if (moneySign(m) < 0) throw new Error(`${field} "${v}" must not be negative`);
  return m;
}

/** First non-blank cell among `keys` (CSV header aliases). */
function cell(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) { const v = row[k]; if (v != null && v.trim() !== '') return v; }
  return undefined;
}

/** This network's offer by numeric ref or uuid; throws a per-row error when it doesn't exist. */
async function resolveOffer(networkId: string, offerRef: string): Promise<ManualConversionOffer> {
  const offer = await loadManualConversionOffer(networkId, offerRef);
  if (!offer) throw new Error(`offer "${offerRef}" not found`);
  return offer;
}

/** A status cell: blank → undefined (policy default); otherwise pending|approved|rejected, any case. */
function statusCell(v: string | undefined): ManualConversionStatus | undefined {
  if (v === undefined) return undefined;
  const st = v.trim().toLowerCase();
  if (!(MANUAL_CONVERSION_STATUSES as readonly string[]).includes(st)) throw new Error(`status must be pending, approved or rejected (got "${st}")`);
  return st as ManualConversionStatus;
}

/** A supplied currency cell must be a 3-letter code (any case in, stored upper-case) — it lands in
 * ledger_entries.currency. Blank falls back to `dflt`; anything else is a per-row error. */
function currencyOr(v: string | undefined, dflt: string): string {
  if (v == null || v.trim() === '') return dflt;
  const cur = v.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`currency "${v}" must be a 3-letter code (e.g. USD)`);
  return cur;
}

function actingUserId(req: import('express').Request): string | null {
  return req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;
}

export function conversionImportsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT l.id, l.status, l.detail, l.row_count, l.total_processed, l.error_count, l.errors,
              l.created_at, l.processed_at, u.name AS created_by_name, u.email AS created_by_email
         FROM import_export_logs l
         LEFT JOIN users u ON u.id = l.created_by AND u.network_id = l.network_id
        WHERE l.network_id = $1 AND l.kind = 'import' AND l.entity = 'conversions'
        ORDER BY l.created_at DESC LIMIT ${LIST_CAP}`,
      [req.scope!.networkId],
    );
    warnIfCapped(rows, LIST_CAP, 'conversion-imports.list');
    sendOk(res, rows);
  }));

  r.post('/', requireRole('admin', 'manager'), validateBody(importSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof importSchema>;
    const errors: { row: number; message: string }[] = [];
    let processed = 0;

    for (let i = 0; i < b.rows.length; i++) {
      const row = b.rows[i]!;
      const rowNum = i + 1;
      try {
        if (Object.values(row).every((v) => v.trim() === '')) throw new Error('blank row — skipped');
        if (b.type === 'create') {
          const offerRef = row['offerRef'] ?? row['offer_ref'] ?? row['offerId'];
          if (!offerRef) throw new Error('offerRef is required');
          const offer = await resolveOffer(networkId, offerRef);

          const requestedStatus = statusCell(cell(row, 'status'));
          // Shared with Add Conversion: tenant + partner access + manual-approval policy. No partner
          // column → no partner earning is booked (the ledger skips a null publisher).
          const decision = await evaluateManualConversion({
            networkId, offer, offerLabel: offerRef, requestedStatus,
            publisherRef: row['publisherRef'] ?? row['publisher_ref'] ?? row['publisherId'],
            advertiserRef: cell(row, 'advertiserRef', 'advertiser_ref', 'advertiserId', 'advertiser_id'),
          });
          if (!decision.ok) throw new Error(decision.error.message);
          const { publisherId, status, reason } = decision;

          const conversionId = randomUUID().replace(/-/g, '');
          const payout = moneyOrNull(row['payout'], 'payout');
          const revenue = moneyOrNull(row['revenue'], 'revenue');
          const currency = currencyOr(row['currency'], offer.currency);
          const txnId = row['transactionId'] ?? row['transaction_id'] ?? null;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const ins = await client.query(
              `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
                 event_name, status, payout, revenue, currency, transaction_id, source, raw_params, reason)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual','{}'::jsonb,$13)
               ON CONFLICT (offer_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
               RETURNING conversion_id`,
              [conversionId, networkId, conversionId, offer.id, publisherId, offer.advertiserId,
                row['event'] ?? null, status, payout, revenue, currency, txnId, reason],
            );
            // A duplicate transaction_id is skipped — and must not write money for a row that doesn't exist.
            if (ins.rows.length === 0) throw new Error(`transaction_id "${txnId}" already exists for this offer — skipped`);
            if (status === 'approved') {
              await writeConversionLedger(client, {
                networkId, conversionId, publisherId, advertiserId: offer.advertiserId, payout, revenue, currency,
              });
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        } else {
          const matchCol = b.type === 'update_by_transaction_id' ? 'transaction_id' : 'conversion_id';
          const matchVal = b.type === 'update_by_transaction_id'
            ? (row['transactionId'] ?? row['transaction_id'])
            : (row['conversionId'] ?? row['conversion_id']);
          if (!matchVal) throw new Error(`${matchCol} is required`);
          const newPayout = row['payout'] !== undefined && row['payout'] !== '' ? moneyOrNull(row['payout'], 'payout') : undefined;
          const newRevenue = row['revenue'] !== undefined && row['revenue'] !== '' ? moneyOrNull(row['revenue'], 'revenue') : undefined;
          if (newPayout === undefined && newRevenue === undefined) throw new Error('payout or revenue is required');
          // transaction_id is only unique per offer — an optional offer column narrows the match.
          const offerRef = cell(row, 'offerRef', 'offer_ref', 'offerId', 'offer_id');
          const offerId = offerRef ? (await resolveOffer(networkId, offerRef)).id : null;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const { rows: matched } = await client.query<{
              conversion_id: string; status: string; publisher_id: string | null; advertiser_id: string | null;
              payout: string | null; revenue: string | null; currency: string | null;
            }>(
              `SELECT conversion_id, status, publisher_id, advertiser_id, payout, revenue, currency
                 FROM conversions WHERE network_id = $1 AND ${matchCol} = $2 AND ($3::uuid IS NULL OR offer_id = $3) FOR UPDATE`,
              [networkId, matchVal, offerId],
            );
            if (!matched.length) throw new Error(`no conversion found for ${matchCol} "${matchVal}"`);
            // Never update several conversions from one row — a bare transactionId can repeat across offers.
            if (matched.length > 1) {
              throw new Error(`${matchCol} "${matchVal}" matches ${matched.length} conversions on different offers — add an offerRef/offerId column (or use conversionId)`);
            }
            for (const c of matched) {
              const payout = newPayout !== undefined ? newPayout : c.payout;
              const revenue = newRevenue !== undefined ? newRevenue : c.revenue;
              await client.query(
                `UPDATE conversions SET payout = $3, revenue = $4 WHERE network_id = $1 AND conversion_id = $2`,
                [networkId, c.conversion_id, payout, revenue],
              );
              // Approved money already sits in the append-only ledger — append the difference.
              if (c.status === 'approved') {
                await rebalanceConversionLedger(client, {
                  networkId, conversionId: c.conversion_id, publisherId: c.publisher_id, advertiserId: c.advertiser_id,
                  payout, revenue, currency: c.currency ?? 'USD', reason: 'conversion_import_update',
                });
              }
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        }
        processed++;
      } catch (err) {
        errors.push({ row: rowNum, message: err instanceof Error ? err.message : 'unknown error' });
      }
    }

    // 'failed' only when no row went through (the CHECK allows just completed|failed).
    const status = processed === 0 ? 'failed' : 'completed';
    const detail = errors.length ? `${TYPE_LABELS[b.type]} — ${errors.length} of ${b.rows.length} rows failed` : TYPE_LABELS[b.type];
    const { rows: jobRows } = await query<{ id: string }>(
      `INSERT INTO import_export_logs (network_id, kind, entity, status, row_count, total_processed, error_count, errors, detail, created_by, processed_at)
       VALUES ($1, 'import', 'conversions', $8, $2, $3, $4, $5, $6, $7, now())
       RETURNING id, status, detail, row_count, total_processed, error_count, errors, created_at, processed_at`,
      [networkId, b.rows.length, processed, errors.length, JSON.stringify(errors), detail, actingUserId(req), status],
    );
    const job = jobRows[0]!;
    await writeAudit(req, { action: 'conversion_import.create', entityType: 'import_export_log', entityId: job.id });
    sendOk(res, job, undefined, 201);
  }));

  return r;
}
