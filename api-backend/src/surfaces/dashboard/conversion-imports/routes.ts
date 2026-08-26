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
import { validateBody } from '../../../lib/http/validate.js';
import { pool, query } from '../../../lib/db/pool.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
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
        ORDER BY l.created_at DESC LIMIT 200`,
      [req.scope!.networkId],
    );
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
          const status = (row['status'] ?? 'approved') as 'pending' | 'approved' | 'rejected';
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(
              `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
                 event_name, status, payout, revenue, currency, transaction_id, source, raw_params)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual','{}'::jsonb)
               ON CONFLICT (offer_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING`,
              [conversionId, networkId, conversionId, offer.id, publisherId, offer.advertiser_id,
                row['event'] ?? null, status, row['payout'] ?? null, row['revenue'] ?? null,
                row['currency'] ?? 'USD', row['transactionId'] ?? row['transaction_id'] ?? null],
            );
            if (status === 'approved') {
              await writeConversionLedger(client, {
                networkId, conversionId, publisherId, advertiserId: offer.advertiser_id,
                payout: row['payout'] ?? null, revenue: row['revenue'] ?? null, currency: row['currency'] ?? 'USD',
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
          const sets: string[] = [];
          const params: unknown[] = [networkId, matchVal];
          if (row['payout'] !== undefined && row['payout'] !== '') { params.push(row['payout']); sets.push(`payout = $${params.length}`); }
          if (row['revenue'] !== undefined && row['revenue'] !== '') { params.push(row['revenue']); sets.push(`revenue = $${params.length}`); }
          if (!sets.length) throw new Error('payout or revenue is required');
          const { rowCount } = await query(
            `UPDATE conversions SET ${sets.join(', ')} WHERE network_id = $1 AND ${matchCol} = $2`,
            params,
          );
          if (!rowCount) throw new Error(`no conversion found for ${matchCol} "${matchVal}"`);
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
    res.status(201);
    sendOk(res, job);
  }));

  return r;
}
