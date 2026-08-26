/**
 * recordConversion() — the ONE attribution path shared by S2S postback, pixel, and iframe
 * (spec §6). Guarantees identical behavior regardless of method: match click_id, enforce the
 * attribution window, dedup idempotently (Redis + DB unique), resolve payout/revenue (frozen from
 * the click, incl. geo overrides), write the conversion, and — when approved — enqueue the
 * outbound postback to the publisher.
 *
 * Ledger dual-entry (spec §8) plugs in at Phase 4 where marked.
 */
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../../lib/db/pool.js';
import { getRedis } from '../../../lib/redis.js';
import { normalizeMoney } from '../../../lib/money.js';
import { getOfferConfig } from '../offer-cache.js';
import { getStoredClick, type StoredClick } from '../click-store.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { getFraudConfig } from '../../../lib/fraud/rules.js';
import { findMatchingControl } from '../../../lib/postback-controls/evaluate.js';
import { applyTieredCommission } from '../../../lib/tiered-commissions/evaluate.js';
import { evaluateCustomerValueRules, recordCustomerValueFiring } from '../../../lib/customer-value/evaluate.js';
import { enqueueOutboundPostback } from './enqueue-postback.js';

export type ConversionOutcome =
  | 'approved' | 'pending' | 'rejected' | 'duplicate' | 'click_not_found' | 'security_failed';

export interface RecordConversionInput {
  networkId: string;
  clickId: string;
  txnId: string | null;
  event: string | null;
  statusHint: string | null;
  payoutParam: string | null;
  revenueParam: string | null;
  /** secure_code sent by the advertiser on an S2S postback (validated against offer/network code). */
  secureCode: string | null;
  /** Skip secure_code enforcement — set for already-authenticated callers (public API key). */
  skipSecureCode?: boolean;
  source: 'postback' | 'pixel' | 'iframe';
  rawParams: Record<string, unknown>;
}

export interface RecordConversionResult {
  outcome: ConversionOutcome;
  conversionId?: string;
}

type ClickRow = StoredClick;

/** Attribution lookup: Redis fast path (spec §6) → durable clicks table fallback. */
async function findClick(networkId: string, clickId: string): Promise<ClickRow | null> {
  const cached = await getStoredClick(networkId, clickId);
  if (cached) return cached;
  const { rows } = await query<ClickRow>(
    `SELECT offer_id, publisher_id, created_at, resolved_payout, resolved_revenue, currency,
            sub1, sub2, sub3, sub4, sub5
       FROM clicks WHERE click_id = $1 AND network_id = $2 LIMIT 1`,
    [clickId, networkId],
  );
  return rows[0] ?? null;
}

function mapStatus(hint: string | null): 'approved' | 'pending' | 'rejected' {
  const h = (hint ?? '').toLowerCase();
  if (['approved', 'confirmed', 'sale', 'success', '1'].includes(h)) return 'approved';
  if (['rejected', 'declined', 'reversed', 'cancelled', 'canceled'].includes(h)) return 'rejected';
  return 'pending';
}

function safeMoney(v: string | null): string | null {
  if (v == null) return null;
  try {
    return normalizeMoney(v);
  } catch {
    return null;
  }
}

interface GoalPricing { id: string; payout: string | null; revenue: string | null; currency: string | null; }

/**
 * Resolve which offer goal an inbound conversion maps to (spec feature-depth: multi-goal offers).
 * Prefers an exact event_name match; otherwise the offer's default goal. Returns null when the
 * offer defines no goals (legacy single-payout offers) — the caller then falls back to the frozen
 * click pricing. Goal pricing overrides the frozen click default, but an explicit postback
 * payout/revenue param still wins over everything.
 */
async function resolveGoal(networkId: string, offerId: string, event: string | null): Promise<GoalPricing | null> {
  const { rows } = await query<GoalPricing & { is_default: boolean }>(
    `SELECT id, payout, revenue, currency, is_default FROM offer_goals
       WHERE network_id = $1 AND offer_id = $2 AND status = 'active'
         AND (lower(event_name) = lower($3) OR is_default = true)
       ORDER BY (lower(event_name) = lower($3)) DESC NULLS LAST, is_default DESC
       LIMIT 1`,
    [networkId, offerId, event],
  );
  return rows[0] ?? null;
}

export async function recordConversion(input: RecordConversionInput): Promise<RecordConversionResult> {
  const redis = getRedis();

  // Fast idempotency pre-check (authoritative guard is the DB unique index below).
  const idemKey = `convidem:${input.clickId}:${input.txnId ?? input.event ?? 'default'}`;
  const acquired = await redis.set(idemKey, '1', 'EX', 172800, 'NX'); // 48h
  if (acquired !== 'OK') return { outcome: 'duplicate' };

  // Match the originating click (Redis fast path → DB fallback).
  const click = await findClick(input.networkId, input.clickId);
  if (!click) {
    await redis.del(idemKey); // allow a retry once the click exists (async persistence lag)
    return { outcome: 'click_not_found' };
  }

  const offer = await getOfferConfig(input.networkId, click.offer_id);

  // Postback secure_code (extra S2S security layer). Offer code overrides the network-wide code.
  // Only enforced for S2S postbacks; pixels/iframes can't carry a secret.
  if (input.source === 'postback' && !input.skipSecureCode) {
    const required = offer?.securityCode || offer?.networkSecurityCode || null;
    if (required && input.secureCode !== required) {
      await redis.del(idemKey); // let a correctly-signed retry through
      return { outcome: 'security_failed' };
    }
  }

  // Attribution window (spec §6). Outside → recorded but rejected (kept for audit/history).
  const ageS = (Date.now() - new Date(click.created_at).getTime()) / 1000;
  const windowS = offer?.attributionWindowS ?? 2592000;
  let status = mapStatus(input.statusHint);
  let reason: string | null = null;
  if (ageS > windowS) {
    status = 'rejected';
    reason = 'outside_attribution_window';
  }

  // Cheap per-conversion fraud scoring (spec §10). Heavier publisher-level analysis runs in the
  // async fraud scan. A conversion firing suspiciously fast after its click is the classic signal.
  const cfg = await getFraudConfig(input.networkId);
  const fraudFlags: string[] = [];
  let fraudScore = 0;
  if (cfg.enabled && ageS < cfg.minClickToConversionSeconds) {
    fraudFlags.push('too_fast');
    fraudScore += 50;
  }

  // Goal-aware pricing: match the event to an offer goal (or the default goal). Goal pricing
  // overrides the frozen click default; an explicit postback payout/revenue param still wins.
  const goal = await resolveGoal(input.networkId, click.offer_id, input.event);
  let payout = safeMoney(input.payoutParam) ?? goal?.payout ?? click.resolved_payout ?? offer?.defaultPayout ?? null;
  let revenue = safeMoney(input.revenueParam) ?? goal?.revenue ?? click.resolved_revenue ?? offer?.defaultRevenue ?? null;
  const currency = click.currency ?? goal?.currency ?? offer?.currency ?? null;
  const goalId = goal?.id ?? null;
  const conversionId = randomUUID().replace(/-/g, '');
  const advertiserId = offer?.advertiserId ?? null;

  // Advertiser Postback Controls (real rule engine, not just CRUD — see lib/postback-controls).
  // A hard attribution-window rejection is a tracking-integrity rule, not a business one; controls
  // don't override it. Otherwise the first active, in-effect, matching control wins.
  if (status !== 'rejected' || reason !== 'outside_attribution_window') {
    const control = await findMatchingControl(input.networkId, {
      offerId: click.offer_id, advertiserId, publisherId: click.publisher_id,
      event: input.event, payout, revenue, source: input.source,
      sub1: click.sub1, sub2: click.sub2, sub3: click.sub3, sub4: click.sub4, sub5: click.sub5,
    });
    if (control) {
      status = control.controlType === 'accept' ? 'approved' : control.controlType === 'reject' ? 'rejected' : 'pending';
      reason = `postback_control:${control.name}`;
    }
  }

  // Advertiser Tiered Commissions (real rule engine — see lib/tiered-commissions). Only meaningful
  // for conversions that will actually pay out; adjusts payout/revenue once a Partner crosses a
  // volume threshold in the commission's rolling period.
  if (status === 'approved' && (payout != null || revenue != null)) {
    const adjusted = await applyTieredCommission(input.networkId, {
      offerId: click.offer_id, advertiserId, publisherId: click.publisher_id,
      payout: Number(payout ?? 0), revenue: Number(revenue ?? 0),
    });
    if (adjusted.appliedId) {
      payout = payout != null ? adjusted.payout.toFixed(4) : payout;
      revenue = revenue != null ? adjusted.revenue.toFixed(4) : revenue;
    }
  }

  // Customer Value (real rule engine — see lib/customer-value/evaluate.ts). Requires a `user_id`
  // in the caller's raw params to identify the customer; only meaningful for conversions that
  // will actually pay out. Runs after Tiered Commissions so the more specific, customer-targeted
  // rule can further override.
  let cvAppliedId: string | null = null;
  if (status === 'approved' && (payout != null || revenue != null)) {
    const userIdParam = input.rawParams['user_id'];
    const userId = typeof userIdParam === 'string' && userIdParam.length > 0 ? userIdParam : null;
    const cvResult = await evaluateCustomerValueRules({
      networkId: input.networkId, offerId: click.offer_id, advertiserId, publisherId: click.publisher_id,
      userId, payout: Number(payout ?? 0), revenue: Number(revenue ?? 0), rawParams: input.rawParams,
    });
    if (cvResult.appliedId) {
      if (cvResult.payoutOverridden) payout = cvResult.payout.toFixed(4);
      if (cvResult.revenueOverridden) revenue = cvResult.revenue.toFixed(4);
      cvAppliedId = cvResult.appliedId;
    }
  }

  // Insert the conversion AND (if approved) its dual ledger entries in ONE transaction (spec §8).
  // DB unique (offer_id, txn_id) is the authoritative idempotency guard.
  const client = await pool.connect();
  let insertedOk = false;
  try {
    await client.query('BEGIN');
    const ins = await client.query<{ conversion_id: string }>(
      `INSERT INTO conversions (
         conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
         event_name, status, reason, payout, revenue, currency, transaction_id, source, raw_params,
         fraud_score, fraud_flags, goal_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (offer_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
       RETURNING conversion_id`,
      [
        conversionId, input.networkId, input.clickId, click.offer_id, click.publisher_id,
        advertiserId, input.event, status, reason, payout, revenue, currency,
        input.txnId, input.source, JSON.stringify(input.rawParams),
        fraudScore, fraudFlags, goalId,
      ],
    );
    insertedOk = ins.rows.length > 0;
    if (insertedOk && status === 'approved') {
      // Dual entry: publisher earning credit + advertiser billing debit, same conversion_id.
      await writeConversionLedger(client, {
        networkId: input.networkId, conversionId,
        publisherId: click.publisher_id, advertiserId,
        payout, revenue, currency: currency ?? 'USD',
      });
      if (cvAppliedId) {
        const userIdParam = input.rawParams['user_id'];
        await recordCustomerValueFiring(client, {
          networkId: input.networkId, ruleId: cvAppliedId,
          userId: String(userIdParam), conversionId,
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

  if (!insertedOk) return { outcome: 'duplicate' };

  // Fire the publisher's outbound postback only for approved conversions (spec §6).
  if (status === 'approved') {
    await enqueueOutboundPostback({
      networkId: input.networkId,
      conversionId,
      offerId: click.offer_id,
      publisherId: click.publisher_id,
      clickId: input.clickId,
      event: input.event,
      payout, currency,
      txnId: input.txnId,
      subs: [click.sub1, click.sub2, click.sub3, click.sub4, click.sub5],
    });
  }

  return { outcome: status, conversionId };
}
