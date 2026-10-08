/**
 * Conversion Imports (Reporting › Conversion Imports) — real bulk CSV import jobs against the
 * conversions table. Rows are parsed client-side into objects (no server-side CSV parser needed) and
 * posted as JSON; each row is processed individually so a bad row doesn't fail the whole job — same
 * spirit as the reference's "Total Rows / Total Processed / Conversion Errors" columns. Logged to the
 * existing import_export_logs table (kind='import', entity='conversions'), the same table single
 * offline-conversion creates already write to (offline/routes.ts).
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
import { normalizeMoney } from '../../../lib/money.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const IMPORT_TYPES = ['create', 'update_by_transaction_id', 'update_by_conversion_id'] as const;
const TYPE_LABELS: Record<(typeof IMPORT_TYPES)[number], string> = {
  create: 'Create Offline Conversions',
  update_by_transaction_id: 'Update Revenue/Payout By Transaction ID',
  update_by_conversion_id: 'Update Revenue/Payout By Conversion ID',
};

const rowSchema = z.record(z.string(), z.string()).refine((r) => Object.keys(r).length > 0, 'empty row');
const importSchema = z.object({
  type: z.enum(IMPORT_TYPES),
  rows: z.array(rowSchema).min(1).max(1000),
});

/** Decimal-validated money for one CSV cell (null when blank); throws a per-row error otherwise. */
function moneyOrNull(v: string | undefined, field: string): string | null {
  if (v == null || v.trim() === '') return null;
  try { return normalizeMoney(v); } catch { throw new Error(`${field} "${v}" is not a valid amount`); }
}

function actingUserId(req: import('express').Request): string | null {
  return req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : null;
}

export function conversionImportsRoutes(): Router {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT l.id, l.detail, l.row_count, l.total_processed, l.error_count, l.errors,
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
        if (b.type === 'create') {
          const offerRef = row['offerRef'] ?? row['offer_ref'] ?? row['offerId'];
          if (!offerRef) throw new Error('offerRef is required');
          const offer = (await query<{ id: string; advertiser_id: string }>(
            `SELECT id, advertiser_id FROM offers WHERE network_id = $1 AND (ref::text = $2 OR id::text = $2)`,
            [networkId, offerRef],
          )).rows[0];
          if (!offer) throw new Error(`offer "${offerRef}" not found`);

          let publisherId: string | null = null;
          const pubRef = row['publisherRef'] ?? row['publisher_ref'] ?? row['publisherId'];
          if (pubRef) {
            const pub = (await query<{ id: string }>(`SELECT id FROM publishers WHERE network_id = $1 AND (ref::text = $2 OR id::text = $2)`, [networkId, pubRef])).rows[0];
            if (!pub) throw new Error(`partner "${pubRef}" not found`);
            publisherId = pub.id;
          }

          const conversionId = randomUUID().replace(/-/g, '');
          const status = (row['status'] ?? 'approved').toLowerCase();
          if (!['pending', 'approved', 'rejected'].includes(status)) throw new Error(`status must be pending, approved or rejected (got "${status}")`);
          const payout = moneyOrNull(row['payout'], 'payout');
          const revenue = moneyOrNull(row['revenue'], 'revenue');
          const currency = row['currency'] ?? 'USD';
          const txnId = row['transactionId'] ?? row['transaction_id'] ?? null;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const ins = await client.query(
              `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
                 event_name, status, payout, revenue, currency, transaction_id, source, raw_params)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual','{}'::jsonb)
               ON CONFLICT (offer_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
               RETURNING conversion_id`,
              [conversionId, networkId, conversionId, offer.id, publisherId, offer.advertiser_id,
                row['event'] ?? null, status, payout, revenue, currency, txnId],
            );
            // A duplicate transaction_id is skipped — and must not write money for a row that doesn't exist.
            if (ins.rows.length === 0) throw new Error(`transaction_id "${txnId}" already exists for this offer — skipped`);
            if (status === 'approved') {
              await writeConversionLedger(client, {
                networkId, conversionId, publisherId, advertiserId: offer.advertiser_id, payout, revenue, currency,
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
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const { rows: matched } = await client.query<{
              conversion_id: string; status: string; publisher_id: string | null; advertiser_id: string | null;
              payout: string | null; revenue: string | null; currency: string | null;
            }>(
              `SELECT conversion_id, status, publisher_id, advertiser_id, payout, revenue, currency
                 FROM conversions WHERE network_id = $1 AND ${matchCol} = $2 FOR UPDATE`,
              [networkId, matchVal],
            );
            if (!matched.length) throw new Error(`no conversion found for ${matchCol} "${matchVal}"`);
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

    const { rows: jobRows } = await query<{ id: string }>(
      `INSERT INTO import_export_logs (network_id, kind, entity, status, row_count, total_processed, error_count, errors, detail, created_by, processed_at)
       VALUES ($1, 'import', 'conversions', 'completed', $2, $3, $4, $5, $6, $7, now())
       RETURNING id, detail, row_count, total_processed, error_count, errors, created_at, processed_at`,
      [networkId, b.rows.length, processed, errors.length, JSON.stringify(errors), TYPE_LABELS[b.type], actingUserId(req)],
    );
    const job = jobRows[0]!;
    await writeAudit(req, { action: 'conversion_import.create', entityType: 'import_export_log', entityId: job.id });
    sendOk(res, job, undefined, 201);
  }));

  return r;
}
