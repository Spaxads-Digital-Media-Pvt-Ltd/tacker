/**
 * Admin finance routes (spec §8) — ledger, balances, payouts, and conversion reversal.
 * RBAC: reads allowed for any admin; money-moving actions (payout run, reject/reverse) require
 * admin/finance. Money is never mutated in place — reversals are new offsetting entries.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { validateBody, validateQuery } from '../../../lib/http/validate.js';
import { paginationSchema, type PaginationQuery } from '../../../lib/http/pagination.js';
import { notFound, badRequest } from '../../../lib/http/errors.js';
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import { accountBalance, createPayoutRun, reverseConversionLedger } from '../../../lib/ledger/ledger.js';
import { requireRole } from '../auth.js';

interface LedgerRow {
  id: string; account_type: string; account_id: string; conversion_id: string | null;
  entry_type: string; direction: string; amount: string; currency: string; status: string;
  created_at: string; metadata: Record<string, unknown>;
}
const toLedgerDTO = (r: LedgerRow) => ({
  id: r.id, accountType: r.account_type, accountId: r.account_id, conversionId: r.conversion_id,
  entryType: r.entry_type, direction: r.direction, amount: r.amount, currency: r.currency,
  status: r.status, createdAt: r.created_at, metadata: r.metadata,
});

const ledgerQuery = paginationSchema.extend({
  accountType: z.enum(['publisher', 'advertiser']).optional(),
  accountId: z.string().uuid().optional(),
});

const createBatchSchema = z.object({
  publisherIds: z.array(z.string().uuid()).min(1).optional(),
  note: z.string().max(500).optional(),
});

export function financeRoutes(): Router {
  const r = Router();

  // Ledger entries (append-only history).
  r.get(
    '/ledger',
    validateQuery(ledgerQuery),
    asyncHandler(async (req, res) => {
      const q = res.locals.query as PaginationQuery & { accountType?: string; accountId?: string };
      const where: Record<string, unknown> = {};
      if (q.accountType) where['account_type'] = q.accountType;
      if (q.accountId) where['account_id'] = q.accountId;
      const rows = await dbForRequest(req).selectMany<LedgerRow>('ledger_entries', {
        where, limit: q.limit, offset: q.offset, orderBy: 'created_at',
      });
      sendOk(res, rows.map(toLedgerDTO), { limit: q.limit, offset: q.offset });
    }),
  );

  // A publisher's balances: earned (approved) — payable model matches approved for now.
  r.get(
    '/publishers/:id/balance',
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const pubId = req.params.id!;
      const [approved, pending] = await Promise.all([
        accountBalance(networkId, 'publisher', pubId, 'approved'),
        accountBalance(networkId, 'publisher', pubId, 'pending'),
      ]);
      sendOk(res, { publisherId: pubId, earned: approved, payable: approved, pending });
    }),
  );

  // Payout batches (history).
  r.get(
    '/payouts/batches',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { limit, offset } = res.locals.query as PaginationQuery;
      const rows = await dbForRequest(req).selectMany('payout_batches', { limit, offset, orderBy: 'created_at' });
      sendOk(res, rows, { limit, offset });
    }),
  );

  // Create a payout run (money movement — admin/finance only, spec §8/§11).
  r.post(
    '/payouts/batches',
    requireRole('admin', 'finance'),
    validateBody(createBatchSchema),
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const b = req.body as z.infer<typeof createBatchSchema>;
      const userId = req.identity && req.identity.surface === 'dashboard' ? req.identity.userId : undefined;
      const result = await createPayoutRun(networkId, {
        ...(b.publisherIds ? { publisherIds: b.publisherIds } : {}),
        ...(b.note ? { note: b.note } : {}),
        ...(userId ? { createdBy: userId } : {}),
      });
      await writeAudit(req, { action: 'payout.batch.create', entityType: 'payout_batch', entityId: result.batchId, after: result });
      res.status(201);
      sendOk(res, result);
    }),
  );

  // Reject/reverse an approved conversion — writes offsetting ledger entries (never edits).
  r.post(
    '/conversions/:conversionId/reject',
    requireRole('admin', 'finance'),
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const db = dbForRequest(req);
      const conv = await db.selectOne<{ conversion_id: string; status: string }>('conversions', {
        conversion_id: req.params.conversionId,
      });
      if (!conv) throw notFound('Conversion not found');
      if (conv.status === 'rejected') throw badRequest('Conversion already rejected');

      // conversions is NOT append-only; flip its status, then write ledger reversals.
      await db.update('conversions', { status: 'rejected', reason: 'manual_rejection' }, { conversion_id: req.params.conversionId });
      await reverseConversionLedger(networkId, req.params.conversionId!, 'manual_rejection');
      await writeAudit(req, { action: 'conversion.reject', entityType: 'conversion', entityId: req.params.conversionId, before: conv });
      sendOk(res, { conversionId: req.params.conversionId, status: 'rejected' });
    }),
  );

  return r;
}
