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
import { dbForRequest } from '../../../lib/db/from-request.js';
import { writeAudit } from '../../../lib/audit.js';
import {
  accountBalances, collapseBalances, createPayoutRun, networkDefaultCurrency,
} from '../../../lib/ledger/ledger.js';
import { CURRENCY_RE } from '../../../lib/money.js';
import { approveConversion, rejectConversion } from './conversion-lifecycle.js';
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
  // A batch carries ONE currency. Omitted = the single currency of the payable balances (422 when
  // they span several; the network default when there are none).
  currency: z.string().regex(CURRENCY_RE, 'currency must be a 3-letter upper-case code (e.g. USD)').optional(),
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

  // A publisher's balances: earned (approved) — payable model matches approved for now. Never a
  // cross-currency sum: earned/payable/pending are the single-currency value ('0.0000' when none), or
  // null when that status's entries span several currencies; `currency` is the one currency of all of
  // them (null when mixed, the network default when there are no entries); `balances` = per currency.
  r.get(
    '/publishers/:id/balance',
    asyncHandler(async (req, res) => {
      const networkId = req.scope!.networkId;
      const pubId = req.params.id!;
      const [approved, pending, dflt] = await Promise.all([
        accountBalances(networkId, 'publisher', pubId, 'approved'),
        accountBalances(networkId, 'publisher', pubId, 'pending'),
        networkDefaultCurrency(networkId),
      ]);
      const earned = collapseBalances(approved, dflt).balance;
      const all = [...new Set([...approved, ...pending].map((b) => b.currency))];
      const currency = all.length === 0 ? dflt : all.length === 1 ? all[0]! : null;
      sendOk(res, {
        publisherId: pubId, earned, payable: earned, pending: collapseBalances(pending, dflt).balance,
        currency, balances: { approved, pending },
      });
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
        ...(b.currency ? { currency: b.currency } : {}),
        ...(userId ? { createdBy: userId } : {}),
      });
      await writeAudit(req, { action: 'payout.batch.create', entityType: 'payout_batch', entityId: result.batchId, after: result });
      sendOk(res, result, undefined, 201);
    }),
  );

  // Approve a pending conversion (e.g. held by "Manually Approve Conversions" or a postback sent
  // without status=approved) — writes earning + billing and fires the partner postback.
  r.post(
    '/conversions/:conversionId/approve',
    requireRole('admin', 'finance'),
    asyncHandler(async (req, res) => {
      const before = await approveConversion(req.scope!.networkId, req.params.conversionId!);
      await writeAudit(req, { action: 'conversion.approve', entityType: 'conversion', entityId: req.params.conversionId, after: before });
      sendOk(res, { conversionId: req.params.conversionId, status: 'approved' });
    }),
  );

  // Reject/reverse a conversion — status change + offsetting ledger entries in one transaction.
  r.post(
    '/conversions/:conversionId/reject',
    requireRole('admin', 'finance'),
    asyncHandler(async (req, res) => {
      const before = await rejectConversion(req.scope!.networkId, req.params.conversionId!);
      await writeAudit(req, { action: 'conversion.reject', entityType: 'conversion', entityId: req.params.conversionId, before });
      sendOk(res, { conversionId: req.params.conversionId, status: 'rejected' });
    }),
  );

  return r;
}
