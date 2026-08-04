/**
 * Offline conversions (feature-depth "Offline Report") — record conversions that happened off-network
 * (phone sales, manual reconciliation). Inserts a conversion with source='manual', writes the dual
 * ledger entry when approved (same money rules as the tracked path, spec §8), and logs an import row.
 * Admin-only, admin/manager.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody } from '../../../lib/http/validate.js';
import { badRequest } from '../../../lib/http/errors.js';
import { pool, query } from '../../../lib/db/pool.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { writeAudit } from '../../../lib/audit.js';
import { requireRole } from '../auth.js';

const createSchema = z.object({
  offerId: z.string().uuid(),
  publisherId: z.string().uuid().nullable().optional(),
  clickId: z.string().max(100).nullable().optional(),
  event: z.string().max(100).nullable().optional(),
  payout: z.string().max(20).nullable().optional(),
  revenue: z.string().max(20).nullable().optional(),
  currency: z.string().length(3).default('USD'),
  status: z.enum(['pending', 'approved', 'rejected']).default('approved'),
  txnId: z.string().max(200).nullable().optional(),
});

export function offlineRoutes(): Router {
  const r = Router();

  r.get('/conversions', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT conversion_id, created_at, offer_id, publisher_id, event_name, status, payout, revenue, currency, transaction_id
         FROM conversions WHERE network_id = $1 AND source = 'manual'
        ORDER BY created_at DESC LIMIT 500`,
      [req.scope!.networkId],
    );
    sendOk(res, rows);
  }));

  r.post('/conversions', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    // Tenant integrity: offer (and publisher, if given) must belong to this network.
    const offer = (await query<{ advertiser_id: string }>('SELECT advertiser_id FROM offers WHERE id = $1 AND network_id = $2', [b.offerId, networkId])).rows[0];
    if (!offer) throw badRequest('offerId does not belong to this network');
    if (b.publisherId) {
      const pub = (await query('SELECT 1 FROM publishers WHERE id = $1 AND network_id = $2', [b.publisherId, networkId])).rows[0];
      if (!pub) throw badRequest('publisherId does not belong to this network');
    }

    const conversionId = randomUUID().replace(/-/g, '');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
           event_name, status, payout, revenue, currency, transaction_id, source, raw_params)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual','{}'::jsonb)`,
        [conversionId, networkId, b.clickId ?? conversionId, b.offerId, b.publisherId ?? null, offer.advertiser_id,
          b.event ?? null, b.status, b.payout ?? null, b.revenue ?? null, b.currency, b.txnId ?? null],
      );
      if (b.status === 'approved') {
        await writeConversionLedger(client, {
          networkId, conversionId, publisherId: b.publisherId ?? null, advertiserId: offer.advertiser_id,
          payout: b.payout ?? null, revenue: b.revenue ?? null, currency: b.currency,
        });
      }
      await client.query(
        `INSERT INTO import_export_logs (network_id, kind, entity, status, row_count, detail)
         VALUES ($1, 'import', 'conversions', 'completed', 1, 'offline conversion')`,
        [networkId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await writeAudit(req, { action: 'conversion.offline.create', entityType: 'conversion', entityId: conversionId });
    res.status(201);
    sendOk(res, { conversionId });
  }));

  return r;
}
