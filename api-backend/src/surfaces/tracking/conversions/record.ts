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
import { enqueueFacebookCapi } from '../../../lib/integrations/enqueue.js';
import { loadIntegrations } from '../../../lib/integrations/settings.js';
import { getAnalyticsWriter } from '../../../lib/analytics/writer.js';
import { timingSafeCompare } from '../../../lib/secure-code-compare.js';
import { checkConversionAbuse } from '../../../lib/conversion-abuse.js';

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
 secureCode: string | null;
 skipSecureCode?: boolean;
 source: 'postback' | 'pixel' | 'iframe';
 rawParams: Record<string, unknown>;
}

export interface RecordConversionResult {
 outcome: ConversionOutcome;
 conversionId?: string;
}

type ClickRow = StoredClick;

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
 const acquired = await redis.set(idemKey, '1', 'EX', 172800, 'NX');
 if (acquired !== 'OK') return { outcome: 'duplicate' };

 // T-2: per-click conversion abuse guard — limit distinct txnId variation per click.
 // Applied before click lookup. Fail open on Redis errors.
 if (input.txnId && input.txnId.trim().length > 0) {
 const abuse = await checkConversionAbuse(redis, input.clickId, input.txnId, input.networkId);
 if (abuse.limited) return { outcome: 'rejected' };
 }

 // Match the originating click (Redis fast path -> DB fallback).
 const click = await findClick(input.networkId, input.clickId);
 if (!click) {
 await redis.del(idemKey);
 return { outcome: 'click_not_found' };
 }

 const offer = await getOfferConfig(input.networkId, click.offer_id);

 // Postback secure_code (extra S2S security layer). T-1: timing-safe comparison.
 if (input.source === 'postback' && !input.skipSecureCode) {
 const required = offer?.securityCode || offer?.networkSecurityCode || null;
 if (required) {
 const cmp = timingSafeCompare(input.secureCode, required);
 if (!cmp.ok) {
 await redis.del(idemKey);
 return { outcome: 'security_failed' };
 }
 }
 }

 // Attribution window (spec §6).
 const ageS = (Date.now() - new Date(click.created_at).getTime()) / 1000;
 const windowS = offer?.attributionWindowS ?? 2592000;
 let status = mapStatus(input.statusHint);
 let reason: string | null = null;
 if (ageS > windowS) {
 status = 'rejected';
 reason = 'outside_attribution_window';
 }

 const cfg = await getFraudConfig(input.networkId);
 const fraudFlags: string[] = [];
 let fraudScore = 0;
 if (cfg.enabled && ageS < cfg.minClickToConversionSeconds) {
 fraudFlags.push('too_fast');
 fraudScore += 50;
 }

 const goal = await resolveGoal(input.networkId, click.offer_id, input.event);
 let payout = safeMoney(input.payoutParam) ?? goal?.payout ?? click.resolved_payout ?? offer?.defaultPayout ?? null;
 let revenue = safeMoney(input.revenueParam) ?? goal?.revenue ?? click.resolved_revenue ?? offer?.defaultRevenue ?? null;
 const currency = click.currency ?? goal?.currency ?? offer?.currency ?? null;
 const goalId = goal?.id ?? null;
 const conversionId = randomUUID().replace(/-/g, '');
 const advertiserId = offer?.advertiserId ?? null;

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

 await getAnalyticsWriter().writeConversions([
 {
 conversionId,
 clickId: input.clickId,
 networkId: input.networkId,
 offerId: click.offer_id,
 publisherId: click.publisher_id ?? '',
 timestamp: new Date().toISOString(),
 advertiserId,
 goalId,
 status,
 reason,
 source: input.source,
 eventName: input.event,
 country: null,
 region: null,
 city: null,
 isp: null,
 device: null,
 os: null,
 browser: null,
 sub1: click.sub1,
 sub2: click.sub2,
 sub3: click.sub3,
 sub4: click.sub4,
 sub5: click.sub5,
 smartLinkId: null,
 fraudScore,
 fraudFlags,
 payout,
 revenue,
 currency,
 },
 ]);

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

 const integrations = await loadIntegrations(input.networkId);
 if (integrations.fbPixelId && integrations.fbAccessToken) {
 await enqueueFacebookCapi({
 networkId: input.networkId,
 conversionId,
 eventName: input.event,
 payout,
 currency,
 clickId: input.clickId,
 });
 }
 }

 return { outcome: status, conversionId };
}
