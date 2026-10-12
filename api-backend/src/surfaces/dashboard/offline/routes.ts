/**
 * Offline conversions (feature-depth "Offline Report") — record conversions that happened off-network
 * (phone sales, manual reconciliation). Inserts a conversion with source='manual', writes the dual
 * ledger entry when approved (same money rules as the tracked path, spec §8), and logs an import row.
 * Admin-only, admin/manager.
 *
 * Same policy as Conversion Imports `create` rows (lib/offer-access/manual-conversion-policy.ts):
 * offer + its advertiser (+ partner, if given) must be this network's (else 400); a partner must be
 * active and allowed on the offer by the /click rules (else 422); on a "Manually Approve Conversions"
 * offer an 'approved' (or omitted) status is stored as 'pending' with reason 'manual_approval_required'
 * and no ledger entry. The offer's status is not checked; no postbacks fire; caps aren't enforced.
 *
 * Money: payout / revenue follow lib/money.ts (decimal, ≤ 4 dp, fits numeric(14,4), not negative →
 * else 422). Currency: an omitted currency is the offer's (network default when the offer has none);
 * a supplied one must be 3 upper-case letters (else 422). No FX — the amounts are stored as given.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../../../lib/http/async-handler.js';
import { sendOk } from '../../../lib/http/envelope.js';
import { LIST_CAP, warnIfCapped } from '../../../lib/http/list-cap.js';
import { validateBody } from '../../../lib/http/validate.js';
import { AppError, badRequest, validationFailed, type ErrorCode } from '../../../lib/http/errors.js';
import { pool, query } from '../../../lib/db/pool.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { CURRENCY_RE, moneySchema, moneySign } from '../../../lib/money.js';
import { writeAudit } from '../../../lib/audit.js';
import {
  MANUAL_CONVERSION_STATUSES, evaluateManualConversion, loadManualConversionOffer, type ManualConversionDenial,
} from '../../../lib/offer-access/manual-conversion-policy.js';
import { requireRole } from '../auth.js';

/** moneySchema (decimal string/number, ≤ 4 dp, ≤ 10 integer digits = numeric(14,4)) + not negative. */
const nonNegativeMoney = (field: string) => moneySchema.refine((v) => {
  // A malformed value already failed moneySchema (reported under the field); don't throw here.
  try { return moneySign(String(v)) >= 0; } catch { return true; }
}, { message: `${field} must not be negative` });

const createSchema = z.object({
  offerId: z.string().uuid(),
  publisherId: z.string().uuid().nullable().optional(),
  clickId: z.string().max(100).nullable().optional(),
  event: z.string().max(100).nullable().optional(),
  // Money convention (lib/money.ts): decimal, ≤ 4 dp, fits numeric(14,4), never negative (the
  // ledger never books one, so the conversion and ledger would disagree). Normalised to 4 dp.
  payout: nonNegativeMoney('payout').nullable().optional(),
  revenue: nonNegativeMoney('revenue').nullable().optional(),
  // Omitted = the offer's currency (the network default when the offer has none).
  currency: z.string().regex(CURRENCY_RE, 'currency must be a 3-letter upper-case code (e.g. USD)').optional(),
  // Omitted = 'approved' unless the offer requires manual approval (decided by the shared policy).
  status: z.enum(MANUAL_CONVERSION_STATUSES).optional(),
  txnId: z.string().max(200).nullable().optional(),
});

/** How a policy refusal surfaces here: tenant problems are 400 (as before), partner access is 422. */
const DENIAL_ERRORS: Record<ManualConversionDenial, [ErrorCode, string]> = {
  advertiser_not_in_network: ['bad_request', "The offer's advertiser does not belong to this network."],
  advertiser_not_found: ['bad_request', 'advertiserId does not belong to this network'],
  advertiser_mismatch: ['bad_request', "advertiserId is not this offer's advertiser"],
  partner_not_found: ['bad_request', 'publisherId does not belong to this network'],
  partner_inactive: ['validation_failed', 'This partner is not active — only active partners can be credited with a conversion.'],
  partner_denied: ['validation_failed', 'This partner is blocked on this offer.'],
  partner_not_approved: ['validation_failed', 'This partner is not approved to run this private / request-access offer.'],
};

export function offlineRoutes(): Router {
  const r = Router();

  r.get('/conversions', asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT conversion_id, created_at, offer_id, publisher_id, event_name, status, payout, revenue, currency, transaction_id
         FROM conversions WHERE network_id = $1 AND source = 'manual'
        ORDER BY created_at DESC LIMIT ${LIST_CAP}`,
      [req.scope!.networkId],
    );
    warnIfCapped(rows, LIST_CAP, 'offline.conversions');
    sendOk(res, rows);
  }));

  r.post('/conversions', requireRole('admin', 'manager'), validateBody(createSchema), asyncHandler(async (req, res) => {
    const networkId = req.scope!.networkId;
    const b = req.body as z.infer<typeof createSchema>;
    // Tenant integrity + partner access + manual-approval policy (shared with Conversion Imports).
    const offer = await loadManualConversionOffer(networkId, b.offerId);
    if (!offer) throw badRequest('offerId does not belong to this network');
    const decision = await evaluateManualConversion({
      networkId, offer, offerLabel: b.offerId, publisherRef: b.publisherId ?? null, requestedStatus: b.status,
    });
    if (!decision.ok) {
      const [code, message] = DENIAL_ERRORS[decision.error.code];
      throw new AppError(code, message, { reason: decision.error.code });
    }
    const { publisherId, status, reason } = decision;
    // Currency: explicit (validated above) or the offer's (network default when the offer has none).
    // A malformed stored offer currency is refused rather than booked: the ledger row would be unpayable.
    const currency = b.currency ?? offer.currency;
    if (!CURRENCY_RE.test(currency)) {
      throw validationFailed(`The offer's currency "${currency}" is not a 3-letter code — pass "currency" explicitly.`, { currency: [`Offer currency "${currency}" is invalid`] });
    }

    const conversionId = randomUUID().replace(/-/g, '');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
           event_name, status, payout, revenue, currency, transaction_id, source, raw_params, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual','{}'::jsonb,$13)`,
        [conversionId, networkId, b.clickId ?? conversionId, offer.id, publisherId, offer.advertiserId,
          b.event ?? null, status, b.payout ?? null, b.revenue ?? null, currency, b.txnId ?? null, reason],
      );
      if (status === 'approved') {
        await writeConversionLedger(client, {
          networkId, conversionId, publisherId, advertiserId: offer.advertiserId,
          payout: b.payout ?? null, revenue: b.revenue ?? null, currency,
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
    sendOk(res, { conversionId }, undefined, 201);
  }));

  return r;
}
