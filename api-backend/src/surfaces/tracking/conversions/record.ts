/**
 * recordConversion() — the ONE attribution path shared by S2S postback, pixel, and iframe
 * (spec §6). Guarantees identical behavior regardless of method: match click_id, enforce the
 * attribution window, dedup idempotently (Redis + DB unique), resolve payout/revenue (frozen from
 * the click, incl. geo overrides), write the conversion, and — when approved — enqueue the
 * outbound postback to the publisher.
 *
 * Dedup policy: a conversion WITH a transaction id is unique per (offer, transaction id) — DB index.
 * A conversion WITHOUT one is unique per (network, click, event): once any conversion exists for
 * that click + event name (any status), the same click + event without a transaction id can never
 * convert again — not only within the 48h Redis window. Distinct events still convert separately.
 *
 * Ledger dual-entry (spec §8) plugs in at Phase 4 where marked.
 */
import { randomUUID } from 'node:crypto';
import { pool, query } from '../../../lib/db/pool.js';
import type { PoolClient } from 'pg';
import { getRedis } from '../../../lib/redis.js';
import { addMoney, subMoney, moneySign, normalizeMoney, percentOfMoney } from '../../../lib/money.js';
import { getOfferConfig } from '../offer-cache.js';
import { isActivePartner } from '../partner-status.js';
import {
 applicableSettings, customPricing, capLimits, capWindowStart,
 type ClickAttrs, type CustomSettingConfig,
} from '../../../lib/offer-settings/custom-settings.js';
import { getStoredClick, type StoredClick } from '../click-store.js';
import { writeConversionLedger } from '../../../lib/ledger/ledger.js';
import { getFraudConfig } from '../../../lib/fraud/rules.js';
import { findMatchingControl } from '../../../lib/postback-controls/evaluate.js';
import { applyTieredCommission } from '../../../lib/tiered-commissions/evaluate.js';
import { evaluateCustomerValueRules, recordCustomerValueFiring } from '../../../lib/customer-value/evaluate.js';
import { enqueueOutboundPostback } from './enqueue-postback.js';
import { emitAutomationEvent } from '../../../lib/automation/webhooks.js';
import { tierPayout } from '../../../lib/partner-tiers.js';
import { enqueueFacebookCapi } from '../../../lib/integrations/enqueue.js';
import { loadIntegrations } from '../../../lib/integrations/settings.js';
import { allowedConversionHosts, conversionOriginAllowed, type RequestOrigin } from './origin.js';
import { getAnalyticsWriter } from '../../../lib/analytics/writer.js';
import { timingSafeCompare } from '../../../lib/secure-code-compare.js';
import { checkConversionAbuse } from '../../../lib/conversion-abuse.js';
import { logger } from '../../../lib/logger.js';

/** Request params that carry the sale / order value — explicit names first, so an older integration
 * sending `amount=<payout>&sale_amount=<order>` keeps its revenue base. Only ever the base for
 * Percentage / Mixed revenue, never the partner payout (audit F-02). */
export const SALE_AMOUNT_PARAMS = ['sale_amount', 'order_amount', 'amount'] as const;

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
 /** Sale / order value (see SALE_AMOUNT_PARAMS): the base for Percentage / Mixed revenue only.
  * When omitted, it's read from rawParams by the same aliases. */
 saleAmount?: string | null;
 secureCode: string | null;
 skipSecureCode?: boolean;
 source: 'postback' | 'pixel' | 'iframe';
 rawParams: Record<string, unknown>;
 /** Browser-fired sources (pixel / iframe): the page and host headers that bind the conversion to
  * the offer's own site. Ignored for postbacks. */
 requestOrigin?: RequestOrigin;
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
 sub1, sub2, sub3, sub4, sub5, country, device, os, browser
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
/**
 * Offer Custom Settings › Caps for this partner on this offer (F-12): conversions / payout / revenue
 * per day / week / month (UTC) or all time, over the partner's non-rejected conversions on the offer.
 * Runs inside the insert transaction, serialized per offer + partner (same pattern as the offer caps).
 * Returns the reject reason, or null.
 */
async function customCapReached(
 client: PoolClient, networkId: string, offerId: string, publisherId: string,
 settings: CustomSettingConfig[], payout: string | null, revenue: string | null,
): Promise<string | null> {
 const checks = settings.flatMap((s) => (['conversions', 'payout', 'revenue'] as const)
 .flatMap((kind) => capLimits(s.caps, kind).map(([interval, limit]) => ({ kind, interval, limit }))));
 if (!checks.length) return null;
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(['customcap', networkId, offerId, publisherId])]);
 const over = (sum: string, add: string | null, limit: number) =>
 add != null && moneySign(subMoney(addMoney(sum, add), normalizeMoney(limit))) > 0;
 for (const c of checks) {
 const { rows } = await client.query<{ n: string; payout: string; revenue: string }>(
 `SELECT COUNT(*)::text AS n, COALESCE(SUM(payout), 0)::text AS payout, COALESCE(SUM(revenue), 0)::text AS revenue
 FROM conversions
 WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3 AND status <> 'rejected'
 AND ($4::timestamptz IS NULL OR created_at >= $4)`,
 [networkId, offerId, publisherId, capWindowStart(c.interval)],
 );
 const r = rows[0]!;
 if (c.kind === 'conversions' && Number(r.n) >= c.limit) return 'custom_conversion_cap_reached';
 if (c.kind === 'payout' && over(r.payout, payout, c.limit)) return 'custom_payout_cap_reached';
 if (c.kind === 'revenue' && over(r.revenue, revenue, c.limit)) return 'custom_revenue_cap_reached';
 }
 return null;
}

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

/** Deletes the idempotency key only while it still holds THIS attempt's token (atomic compare-and-delete). */
const RELEASE_IF_OWNER = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * After a failed attempt (nothing committed), free the idempotency key so a legitimate retry isn't
 * answered "duplicate" for 48h with nothing stored. Only this attempt's own key is removed (token
 * match), and a cleanup failure is logged — never thrown over the original error.
 */
async function releaseIdemKey(redis: ReturnType<typeof getRedis>, key: string, token: string): Promise<void> {
 try {
 await redis.eval(RELEASE_IF_OWNER, 1, key, token);
 } catch (cleanupErr) {
 logger.warn({ err: cleanupErr, key }, 'conversion idempotency key cleanup failed');
 }
}

export async function recordConversion(input: RecordConversionInput): Promise<RecordConversionResult> {
 const redis = getRedis();

 // Fast idempotency pre-check (authoritative guards are in the DB: the (offer, transaction_id)
 // unique index, and the per-(network, click, event) check for conversions without a transaction id).
 // The value is a per-attempt token so only this attempt can release the key after a failure.
 const idemKey = `convidem:${input.clickId}:${input.txnId ?? input.event ?? 'default'}`;
 const idemToken = randomUUID();
 const acquired = await redis.set(idemKey, idemToken, 'EX', 172800, 'NX');
 if (acquired !== 'OK') return { outcome: 'duplicate' };

 const state = { committed: false };
 try {
 return await recordWithIdemKey(input, redis, idemKey, state);
 } catch (err) {
 // Nothing was recorded → let a retry through. Once the insert transaction has committed the key
 // stays (a later error, e.g. enqueueing the partner postback, must not reopen a recorded conversion).
 if (!state.committed) await releaseIdemKey(redis, idemKey, idemToken);
 throw err;
 }
}

async function recordWithIdemKey(
 input: RecordConversionInput, redis: ReturnType<typeof getRedis>, idemKey: string, state: { committed: boolean },
): Promise<RecordConversionResult> {
 // Match the originating click (Redis fast path -> DB fallback).
 const click = await findClick(input.networkId, input.clickId);
 if (!click) {
 await redis.del(idemKey);
 return { outcome: 'click_not_found' };
 }

 const offer = await getOfferConfig(input.networkId, click.offer_id);

 // Postback secure_code (S2S authentication). T-1: timing-safe comparison. Fails CLOSED: every
 // network gets a code at creation (migration 1700000067000 backfills and defaults it), so a
 // postback with no configured code at all — e.g. after Settings > Security "Clear" — is rejected
 // instead of accepted from anyone who has seen a click_id. API-key callers pass skipSecureCode.
 if (input.source === 'postback' && !input.skipSecureCode) {
 const required = offer?.securityCode || offer?.networkSecurityCode || null;
 if (!required || !timingSafeCompare(input.secureCode, required).ok) {
 await redis.del(idemKey);
 return { outcome: 'security_failed' };
 }
 }

 // Pixel / iframe are fired by the visitor's browser and carry no secret. Bind them to the offer's
 // own site (Referer / Origin, see ./origin.ts) so a partner can't fire them from their own pages,
 // and (below) never let them set the price.
 const browserFired = input.source === 'pixel' || input.source === 'iframe';
 if (browserFired && !conversionOriginAllowed(input.requestOrigin, allowedConversionHosts(offer, input.requestOrigin?.host ?? null))) {
 await redis.del(idemKey);
 return { outcome: 'security_failed' };
 }

 // T-2: per-click conversion abuse guard — limit distinct txnId variation per click. Only AFTER the
 // request is authenticated: run before the security check, unauthenticated attempts with a leaked
 // click id used up the click's allowance and the advertiser's real conversions were then refused.
 // Fail open on Redis errors.
 if (input.txnId && input.txnId.trim().length > 0) {
 const abuse = await checkConversionAbuse(redis, input.clickId, input.txnId, input.networkId);
 if (abuse.limited) return { outcome: 'rejected' };
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
 // Only the authenticated S2S postback (or an API-key caller) may name a payout / revenue; a
 // browser-fired pixel or iframe is priced from the goal / click / offer defaults alone.
 const clientPayout = browserFired ? null : safeMoney(input.payoutParam);
 const clientRevenue = browserFired ? null : safeMoney(input.revenueParam);
 let payout = clientPayout ?? eventGoal?.payout ?? clickOverride(click.resolved_payout, offer?.defaultPayout)
 ?? goal?.payout ?? click.resolved_payout ?? offer?.defaultPayout ?? null;
 let revenue = clientRevenue ?? eventGoal?.revenue ?? clickOverride(click.resolved_revenue, offer?.defaultRevenue)
 ?? goal?.revenue ?? click.resolved_revenue ?? offer?.defaultRevenue ?? null;
 // The sale amount the advertiser reports (sale_amount / order_amount / amount). A browser-fired
 // conversion's sale amount is visitor-controlled, so it never prices anything.
 const saleAmount = browserFired ? null : safeMoney(input.saleAmount ?? paramStr(input.rawParams, [...SALE_AMOUNT_PARAMS]));
 // Percentage / Mixed revenue: a share of the sale amount (only when the postback didn't send an
 // explicit revenue). The sale amount only ever feeds revenue here — it never sets the partner payout.
 if (clientRevenue == null && revCfg && revCfg.revenueType !== 'fixed' && revCfg.revenuePct != null) {
 if (saleAmount != null) {
 const share = percentOfMoney(saleAmount, revCfg.revenuePct);
 revenue = revCfg.revenueType === 'mixed' ? addMoney(revenue ?? '0', share) : share;
 }
 }
 // Offer Custom Settings › Revenue & Payout (F-12): this partner's own rate on this offer — or on
 // the goal that fired — beats the goal / partner / country / default rate (an explicit S2S payout
 // or revenue still wins). Matched against the click: its time, country, device, OS and browser.
 const clickAttrs: ClickAttrs = {
 country: click.country ?? null, device: click.device ?? null, os: click.os ?? null, browser: click.browser ?? null,
 };
 const custom = click.publisher_id ? customPricing(offer?.customSettings, {
 publisherId: click.publisher_id, attrs: clickAttrs, clickAt: new Date(click.created_at),
 eventGoalId: eventGoal?.id ?? null, defaultGoalId: goal?.is_default ? goal.id : null, saleAmount,
 }) : null;
 if (custom) {
 if (clientPayout == null && custom.payout != null) payout = custom.payout;
 if (clientRevenue == null && custom.revenue != null) revenue = custom.revenue;
 }
 // Partner Tiers (F-17b): a tier member is paid the tier margin off this conversion's final revenue —
 // unless the payout is already their own (an S2S payout param, their custom setting, their per-offer
 // override). It beats the goal / country / default payout.
 const ownRate = clientPayout != null || custom?.payout != null
 || (click.publisher_id != null && offer?.partnerPayouts?.[click.publisher_id] != null);
 const tierRate = !ownRate && click.publisher_id ? tierPayout(revenue, offer?.tierMargins?.[click.publisher_id]) : null;
 if (tierRate != null) payout = tierRate;
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
 // Partner no longer active (F-08). /click only attributes active partners, but a partner can be
 // set pending/inactive (e.g. banned for fraud) or deleted after the click. They never auto-earn:
 // the conversion waits in pending for an admin — approving it later books the ledger as usual.
 if (status === 'approved' && click.publisher_id && !(await isActivePartner(input.networkId, click.publisher_id))) {
 status = 'pending';
 reason = 'partner_not_active';
 }
 // "Manually Approve Conversions" → anything that would auto-approve waits in pending.
 if (revCfg?.manualApproval && status === 'approved') {
 status = 'pending';
 reason = 'manual_approval_required';
 }
 // Offer Custom Settings › Throttle Rates (F-12): this share of the partner's conversions gets the
 // setting's status (rejected unless it says pending). Layers with the offer's own throttle below.
 if (status !== 'rejected' && click.publisher_id) {
 const t = applicableSettings(offer?.customSettings, 'throttle_rates', click.publisher_id, clickAttrs, new Date())
 .find((c) => c.throttleRate != null && Number(c.throttleRate) > 0);
 if (t && Math.random() * 100 < Number(t.throttleRate)) {
 status = t.conversionStatus ?? 'rejected';
 reason = 'custom_throttle';
 }
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
 // Customer Value rules key off the client-supplied user_id (and other raw params), so a
 // browser-fired conversion could pick its own bonus; it stays at the default price instead.
 if (!browserFired && status === 'approved' && (payout != null || revenue != null)) {
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
 // No transaction id → at most one conversion per (network, click, event name), permanently (the
 // DB index only covers non-null transaction ids; the Redis key above expires after 48h). The
 // transaction-scoped advisory lock serialises concurrent attempts for the same click + event, and
 // the check runs after it, so the second attempt sees the first's committed row. Taken before the
 // cap lock, always in that order.
 let noTxnDuplicate = false;
 if (input.txnId == null) {
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
 [JSON.stringify(['convnotxn', input.networkId, input.clickId, eventName])]);
 const prior = await client.query(
 `SELECT 1 FROM conversions
 WHERE network_id = $1 AND click_id = $2 AND transaction_id IS NULL AND event_name IS NOT DISTINCT FROM $3
 LIMIT 1`,
 [input.networkId, input.clickId, eventName],
 );
 noTxnDuplicate = prior.rows.length > 0;
 }
 if (!noTxnDuplicate && status !== 'rejected') {
 const capReason = await conversionCapReached(client, input.networkId, click.offer_id,
 { daily: offer?.dailyConversionCap ?? null, total: offer?.totalConversionCap ?? null }, goal);
 if (capReason) { status = 'rejected'; reason = capReason; throttled = false; }
 }
 if (!noTxnDuplicate && status !== 'rejected' && click.publisher_id) {
 const capReason = await customCapReached(client, input.networkId, click.offer_id, click.publisher_id,
 applicableSettings(offer?.customSettings, 'caps', click.publisher_id, clickAttrs, new Date()), payout, revenue);
 if (capReason) { status = 'rejected'; reason = capReason; throttled = false; }
 }
 const ins = noTxnDuplicate ? { rows: [] as { conversion_id: string }[] } : await client.query<{ conversion_id: string }>(
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
 state.committed = true;
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
 if (!throttled && (offer?.firePartnerPostback ?? true) && (custom?.firePartnerPostback ?? true)) {
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

 // Automation webhooks (F-17a): one cached Redis read; nothing is queued unless a webhook listens.
 await emitAutomationEvent(input.networkId,
 status === 'approved' ? ['conversion.created', 'conversion.approved']
 : status === 'rejected' ? ['conversion.created', 'conversion.rejected'] : 'conversion.created',
 {
 conversionId, clickId: input.clickId, offerId: click.offer_id, publisherId: click.publisher_id,
 status, reason, event: eventName, payout, revenue, currency,
 });

 return { outcome: status, conversionId };
}
