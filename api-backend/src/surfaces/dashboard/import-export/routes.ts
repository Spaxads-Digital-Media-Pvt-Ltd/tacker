/**
 * Import & Export logs (feature-depth "Import & Export Logs" report). Lists every import/export job
 * for the network. Exports are recorded here and return the rows so the client can download a CSV.
 * Imports are logged by their producers (e.g. offline conversions). Admin-only.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { query } from '../../../lib/db/pool.js';
import { requireRole } from '../auth.js';

const exportSchema = z.object({
  entity: z.enum(['conversions', 'clicks']),
  from: z.string().optional(),
  to: z.string().optional(),
  offerId: z.string().uuid().optional(),
  publisherId: z.string().uuid().optional(),
  advertiserId: z.string().uuid().optional(),
  country: z.string().max(3).optional(),
  device: z.string().max(40).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  source: z.enum(['postback', 'pixel', 'iframe', 'manual']).optional(),
});

export function importExportRoutes(): Router {
  const r = Router();

  // Log list.
  r.get('/', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, kind, entity, status, row_count, detail, created_at
         FROM import_export_logs WHERE network_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));

  // Export: pull rows (bounded), record the export, return rows for a client-side CSV download.
  r.post('/export', requireRole('admin', 'manager'), validateBody(exportSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof exportSchema>;
    const where = ['network_id = $1'];
    const params: unknown[] = [networkId];
    const add = (val: unknown, col: string, op = '=') => { if (val == null || val === '') return; params.push(val); where.push(`${col} ${op} $${params.length}`); };
    add(b.from, 'created_at', '>='); add(b.to, 'created_at', '<=');
    add(b.offerId, 'offer_id'); add(b.publisherId, 'publisher_id');
    add(b.country, 'country'); add(b.device, 'device');
    if (b.entity === 'conversions') { add(b.advertiserId, 'advertiser_id'); add(b.status, 'status'); add(b.source, 'source'); }

    const sql = b.entity === 'conversions'
      ? `SELECT conversion_id, created_at, offer_id, publisher_id, event_name, status, payout, revenue, currency, source
           FROM conversions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 10000`
      : `SELECT click_id, created_at, offer_id, publisher_id, ip::text AS ip, country, device, is_unique
           FROM clicks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 10000`;
    const { rows } = await query<Record<string, unknown>>(sql, params);

    await query(
      `INSERT INTO import_export_logs (network_id, kind, entity, status, row_count, detail)
       VALUES ($1, 'export', $2, 'completed', $3, 'CSV export')`,
      [networkId, b.entity, rows.length],
    );
    sendOk(res, { entity: b.entity, rowCount: rows.length, rows });
  }));

  return r;
}
