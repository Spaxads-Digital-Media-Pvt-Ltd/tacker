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
import type { PoolClient } from 'pg';
import { getRedis } from '../../../lib/redis.js';
import { addMoney, normalizeMoney, percentOfMoney } from '../../../lib/money.js';
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

function paramStr(params: Record<string, unknown>, keys: string[]): string | null {
 for (const k of keys) {
 const v = params[k];
 const s = Array.isArray(v) ? v[0] : v;
 if (typeof s === 'string' && s.trim()) return s.trim();
 }
 return null;
}

function safeMoney(v: string | null): string | null {
 if (v == null) return null;
 try {
 return normalizeMoney(v);
 } catch {
 return null;
 }
}

interface GoalPricing {
 id: string; payout: string | null; revenue: string | null; currency: string | null; event_name: string | null; is_default: boolean;
 daily_conversion_cap: number | null; total_conversion_cap: number | null;
}

/**
 * Offer / goal conversion caps (Edit Offer › Caps, goal caps). Counts this offer's non-rejected
 * conversions (today in UTC — same day boundary as the click cap — or all-time) inside the insert
 * transaction, serialized per offer with a transaction-scoped advisory lock so concurrent postbacks
 * can't overshoot. The lock is only taken when a cap is actually configured. Returns the reject
 * reason, or null when under every cap.
 */
async function conversionCapReached(
 client: PoolClient, networkId: string, offerId: string,
 offerCaps: { daily: number | null; total: number | null }, goal: GoalPricing | null,
): Promise<string | null> {
 const checks: { reason: string; cap: number | null | undefined; goalId: string | null; daily: boolean }[] = [
 { reason: 'daily_conversion_cap_reached', cap: offerCaps.daily, goalId: null, daily: true },
 { reason: 'total_conversion_cap_reached', cap: offerCaps.total, goalId: null, daily: false },
 { reason: 'goal_daily_conversion_cap_reached', cap: goal?.daily_conversion_cap, goalId: goal?.id ?? null, daily: true },
 { reason: 'goal_total_conversion_cap_reached', cap: goal?.total_conversion_cap, goalId: goal?.id ?? null, daily: false },
 ].filter((c) => c.cap != null && c.cap > 0 && (c.goalId !== null || !c.reason.startsWith('goal_')));
 if (!checks.length) return null;
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`convcap:${offerId}`]);
 for (const c of checks) {
 const params: unknown[] = [networkId, offerId];
 let where = `network_id = $1 AND offer_id = $2 AND status <> 'rejected'`;
 if (c.goalId) { params.push(c.goalId); where += ` AND goal_id = $${params.length}`; }
 if (c.daily) where += ` AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
 const { rows } = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversions WHERE ${where}`, params);
 if ((rows[0]?.n ?? 0) >= c.cap!) return c.reason;
 }
 return null;
}

async function resolveGoal(networkId: string, offerId: string, event: string | null): Promise<GoalPricing | null> {
 const { rows } = await query<GoalPricing>(
 `SELECT id, payout, revenue, currency, event_name, is_default, daily_conversion_cap, total_conversion_cap FROM offer_goals
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

 const revCfg = offer?.revenue;
 const attrCfg = offer?.attribution;

 // "Allow Duplicate Conversions" off → at most one conversion per click, whatever the txn_id.
 // Redis NX guards concurrent postbacks; the DB check covers conversions older than the lock.
 let clickLockKey: string | null = null;
 if (revCfg && revCfg.allowDuplicates === false) {
 clickLockKey = `convclick:${input.networkId}:${input.clickId}`;
 const locked = await redis.set(clickLockKey, '1', 'EX', 172800, 'NX');
 const existing = locked === 'OK'
 ? (await query(`SELECT 1 FROM conversions WHERE network_id = $1 AND click_id = $2 LIMIT 1`, [input.networkId, input.clickId])).rows.length > 0
 : true;
 if (existing) {
 if (locked === 'OK') await redis.del(clickLockKey);
 return { outcome: 'duplicate' };
 }
 }
 const releaseClickLock = async () => { if (clickLockKey) await redis.del(clickLockKey); };

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
 // Pricing precedence: explicit postback param → goal matched BY EVENT NAME → a click-time override
 // (partner / country rate frozen on the click) → the default goal → the click / offer default.
 // A default-goal fallback must not wipe out a partner- or country-specific rate.
 const eventGoal = goal && input.event != null && goal.event_name != null
 && goal.event_name.toLowerCase() === input.event.toLowerCase() ? goal : null;
 const clickOverride = (frozen: string | null | undefined, dflt: string | null | undefined): string | null =>
 frozen != null && dflt != null && safeMoney(frozen) !== safeMoney(dflt) ? frozen : null;
 let payout = safeMoney(input.payoutParam) ?? eventGoal?.payout ?? clickOverride(click.resolved_payout, offer?.defaultPayout)
 ?? goal?.payout ?? click.resolved_payout ?? offer?.defaultPayout ?? null;
 let revenue = safeMoney(input.revenueParam) ?? eventGoal?.revenue ?? clickOverride(click.resolved_revenue, offer?.defaultRevenue)
 ?? goal?.revenue ?? click.resolved_revenue ?? offer?.defaultRevenue ?? null;
 // Percentage / Mixed revenue: a share of the sale amount the advertiser reports (only when the
 // postback didn't send an explicit revenue). `amount` is NOT read here — it's the documented
 // payout-override param, so treating it as a sale amount would also set the partner's payout.
 if (!safeMoney(input.revenueParam) && revCfg && revCfg.revenueType !== 'fixed' && revCfg.revenuePct != null) {
 const sale = safeMoney(paramStr(input.rawParams, ['sale_amount', 'order_amount']));
 if (sale != null) {
 const share = percentOfMoney(sale, revCfg.revenuePct);
 revenue = revCfg.revenueType === 'mixed' ? addMoney(revenue ?? '0', share) : share;
 }
 }
 const eventName = input.event ?? revCfg?.baseEventName ?? null;
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

 // Click-to-conversion time window (Attribution tab). Applied after postback controls so an
 // "accept" control can't approve a conversion outside the allowed window.
 const ctit = attrCfg?.clickToConversion;
 if (ctit?.enabled && status !== 'rejected') {
 if (ageS < ctit.minSeconds) { status = 'rejected'; reason = 'click_to_conversion_too_fast'; }
 else if (ctit.maxSeconds != null && ageS > ctit.maxSeconds) { status = 'rejected'; reason = 'click_to_conversion_too_slow'; }
 }
 // "Manually Approve Conversions" → anything that would auto-approve waits in pending.
 if (revCfg?.manualApproval && status === 'approved') {
 status = 'pending';
 reason = 'manual_approval_required';
 }

 if (status === 'approved' && (payout != null || revenue != null)) {
 const adjusted = await applyTieredCommission(input.networkId, {
 offerId: click.offer_id, advertiserId, publisherId: click.publisher_id,
 payout: payout ?? '0', revenue: revenue ?? '0',
 });
 if (adjusted.appliedId) {
 if (payout != null) payout = adjusted.payout;
 if (revenue != null) revenue = adjusted.revenue;
 }
 }

 let cvAppliedId: string | null = null;
 if (status === 'approved' && (payout != null || revenue != null)) {
 const userIdParam = input.rawParams['user_id'];
 const userId = typeof userIdParam === 'string' && userIdParam.length > 0 ? userIdParam : null;
 const cvResult = await evaluateCustomerValueRules({
 networkId: input.networkId, offerId: click.offer_id, advertiserId, publisherId: click.publisher_id,
 userId, payout: payout ?? '0.0000', revenue: revenue ?? '0.0000', rawParams: input.rawParams,
 });
 if (cvResult.appliedId) {
 if (cvResult.payoutOverridden) payout = cvResult.payout;
 if (cvResult.revenueOverridden) revenue = cvResult.revenue;
 cvAppliedId = cvResult.appliedId;
 }
 }

 // Throttle rate (Attribution tab): this share of approved conversions still bills the advertiser
 // but pays the partner nothing and fires no partner postback.
 let throttled = false;
 const throttle = attrCfg?.throttle;
 if (status === 'approved' && throttle?.enabled && throttle.ratePct > 0 && Math.random() * 100 < throttle.ratePct) {
 throttled = true;
 payout = '0.0000';
 reason = 'throttled';
 }

 const client = await pool.connect();
 let insertedOk = false;
 try {
 await client.query('BEGIN');
 if (status !== 'rejected') {
 const capReason = await conversionCapReached(client, input.networkId, click.offer_id,
 { daily: offer?.dailyConversionCap ?? null, total: offer?.totalConversionCap ?? null }, goal);
 if (capReason) { status = 'rejected'; reason = capReason; throttled = false; }
 }
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
 advertiserId, eventName, status, reason, payout, revenue, currency,
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
 await releaseClickLock();
 throw err;
 } finally {
 client.release();
 }

 if (!insertedOk) {
 await releaseClickLock();
 return { outcome: 'duplicate' };
 }

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
 eventName,
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
 // Offer-level "Fire Partner Postback" toggle (dashboard Postback Configuration tab). Unset/null
 // defaults to true (backward compatible with offers created before this setting existed) — only
 // an explicit false suppresses the outbound enqueue. Ledger/conversion creation above, and other
 // integrations below, are unaffected either way.
 if (!throttled && (offer?.firePartnerPostback ?? true)) {
 await enqueueOutboundPostback({
 networkId: input.networkId,
 conversionId,
 offerId: click.offer_id,
 publisherId: click.publisher_id,
 clickId: input.clickId,
 event: eventName,
 payout, currency,
 txnId: input.txnId,
 subs: [click.sub1, click.sub2, click.sub3, click.sub4, click.sub5],
 });
 }

 const integrations = await loadIntegrations(input.networkId);
 if (integrations.fbPixelId && integrations.fbAccessToken) {
 await enqueueFacebookCapi({
 networkId: input.networkId,
 conversionId,
 eventName,
 payout,
 currency,
 clickId: input.clickId,
 });
 }
 }

 return { outcome: status, conversionId };
}
