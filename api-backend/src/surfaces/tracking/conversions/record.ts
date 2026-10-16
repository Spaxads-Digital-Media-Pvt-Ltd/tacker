/**
 * recordConversion() — the ONE attribution path shared by S2S postback, pixel, iframe and the
 * advertiser API (spec §6). Guarantees identical behavior regardless of method: match click_id,
 * authenticate, enforce the attribution window, dedup idempotently (Redis + DB guards), resolve
 * payout/revenue (frozen from the click, incl. geo overrides), write the conversion, and — when
 * approved — enqueue the outbound postback to the publisher.
 *
 * Several conversions per click (Everflow model): each event follows its duplicate rule — its goal's,
 * else the offer's (lib/offer-settings DuplicateMode):
 *  - a transaction id is unique per (offer, event) — DB index conversions_offer_event_txn_key — so
 *    a repeat of one is a duplicate, while a lead and its later sale may share the advertiser's id;
 *  - `one_per_click`: one conversion per (network, click, event), whatever the transaction id;
 *  - `unique_txn` (default): many per click with distinct transaction ids; without one, one per
 *    (network, click, event);
 *  - `every_postback`: without a transaction id every postback counts, except an identical repeat
 *    within RETRY_WINDOW_S (the advertiser's retry).
 * The (click, event) checks run inside the insert transaction under an advisory lock, so they hold
 * permanently and under concurrency; the Redis key in front of them is only the fast path. Any status
 * counts: a rejected conversion can't be replaced by a later approved repeat.
 *
 * Every result carries a reason — why the conversion was held / rejected, or why nothing was recorded
 * — for the inbound postback log (./inbound-log.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
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
import { duplicateModeOf, type DuplicateMode } from '../../../lib/offer-settings/index.js';
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
import { checkConversionAbuse, CONV_ABUSE_LIMIT } from '../../../lib/conversion-abuse.js';
import { capCountedSql } from '../../../lib/conversion-caps.js';
import { logger } from '../../../lib/logger.js';
import { rejectedClickSql } from '../../../lib/click-rejections.js';

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

/** Why a request recorded nothing (outcome duplicate / click_not_found / security_failed). */
export type NotRecordedReason =
 | 'missing_click_id' | 'unknown_click' | 'click_not_owned'
 | 'missing_security_code' | 'wrong_security_code' | 'no_security_code_configured' | 'browser_origin_not_allowed'
 | 'duplicate_transaction_id' | 'duplicate_click_event' | 'repeat_within_60s';

export interface RecordConversionResult {
 outcome: ConversionOutcome;
 conversionId?: string;
 /** The conversion's reason (held / rejected / capped …, null when none), or why nothing was recorded. */
 reason?: string | null;
 offerId?: string;
 publisherId?: string | null;
 advertiserId?: string | null;
 /** The event as recorded: the request's, else the offer's base event name. */
 event?: string | null;
 payout?: string | null;
 revenue?: string | null;
 currency?: string | null;
}

type ClickRow = StoredClick;

async function findClick(networkId: string, clickId: string): Promise<ClickRow | null> {
 const cached = await getStoredClick(networkId, clickId);
 if (cached) return cached;
 const { rows } = await query<ClickRow>(
 `SELECT offer_id, publisher_id, created_at, resolved_payout, resolved_revenue, currency,
 sub1, sub2, sub3, sub4, sub5, country, device, os, browser
 FROM clicks WHERE click_id = $1 AND network_id = $2 AND NOT ${rejectedClickSql()} LIMIT 1`,
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
 /** The event's own duplicate rule; null = the offer's. */
 duplicate_mode: DuplicateMode | null;
}

/**
 * Offer Custom Settings › Caps for this partner on this offer (F-12): conversions / payout / revenue
 * per day / week / month (UTC) or all time, over the partner's conversions on the offer that use up a
 * cap (lib/conversion-caps). Runs inside the insert transaction, serialized per offer + partner (same
 * pattern as the offer caps). Returns the over-cap reason, or null.
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
 WHERE network_id = $1 AND offer_id = $2 AND publisher_id = $3 AND ${capCountedSql()}
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

/**
 * Offer / goal conversion caps (Edit Offer › Caps, goal caps). Counts this offer's conversions that use
 * up a cap (lib/conversion-caps: not rejected, not already held over caps) — today in UTC (same day
 * boundary as the click cap) or all-time — inside the insert transaction, serialized per offer with a
 * transaction-scoped advisory lock so concurrent postbacks can't overshoot. The lock is only taken
 * when a cap is actually configured. Returns the over-cap reason, or null when under every cap.
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
 let where = `network_id = $1 AND offer_id = $2 AND ${capCountedSql()}`;
 if (c.goalId) { params.push(c.goalId); where += ` AND goal_id = $${params.length}`; }
 if (c.daily) where += ` AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
 const { rows } = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM conversions WHERE ${where}`, params);
 if ((rows[0]?.n ?? 0) >= c.cap!) return c.reason;
 }
 return null;
}

async function resolveGoal(networkId: string, offerId: string, event: string | null): Promise<GoalPricing | null> {
 const { rows } = await query<GoalPricing>(
 `SELECT id, payout, revenue, currency, event_name, is_default, daily_conversion_cap, total_conversion_cap, duplicate_mode FROM offer_goals
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

/** How long the Redis fast-path key of a transaction id / (click, event) lives. */
const IDEM_TTL_S = 172_800;
/** every_postback without a transaction id: an identical request within this many seconds is a retry. */
export const RETRY_WINDOW_S = 60;

export interface DedupeRule {
 /** The Redis fast-path key (SET NX). */
 key: string;
 ttlS: number;
 /** Why a repeat is turned away. */
 reason: Extract<NotRecordedReason, 'duplicate_transaction_id' | 'duplicate_click_event' | 'repeat_within_60s'>;
 /** The check inside the insert transaction: any earlier conversion for this click + event
  * ('click_event'), one without a transaction id ('click_event_no_txn'), or none — the transaction-id
  * index covers the rest. */
 dbCheck: 'click_event' | 'click_event_no_txn' | null;
}

/** JSON with object keys sorted, so the same params in another order fingerprint alike. */
const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) =>
 x && typeof x === 'object' && !Array.isArray(x)
 ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
 : x);

/** How a conversion request is deduplicated under its event's duplicate rule (see the header). */
export function dedupeRule(k: {
 networkId: string; offerId: string; clickId: string; event: string | null; txnId: string | null;
 mode: DuplicateMode; rawParams?: Record<string, unknown>;
}): DedupeRule {
 const key = (...parts: unknown[]) => `convidem:${JSON.stringify(parts)}`;
 if (k.mode === 'one_per_click') {
 return { key: key('click', k.networkId, k.clickId, k.event), ttlS: IDEM_TTL_S, reason: 'duplicate_click_event', dbCheck: 'click_event' };
 }
 if (k.txnId != null) {
 return { key: key('txn', k.networkId, k.offerId, k.event, k.txnId), ttlS: IDEM_TTL_S, reason: 'duplicate_transaction_id', dbCheck: null };
 }
 if (k.mode === 'unique_txn') {
 return { key: key('click', k.networkId, k.clickId, k.event), ttlS: IDEM_TTL_S, reason: 'duplicate_click_event', dbCheck: 'click_event_no_txn' };
 }
 const fingerprint = createHash('sha256').update(stableJson(k.rawParams ?? {})).digest('base64url');
 return { key: key('retry', k.networkId, k.clickId, k.event, fingerprint), ttlS: RETRY_WINDOW_S, reason: 'repeat_within_60s', dbCheck: null };
}

export async function recordConversion(rawInput: RecordConversionInput): Promise<RecordConversionResult> {
 const redis = getRedis();
 // A blank transaction id is no transaction id (it would otherwise make every blank one a duplicate).
 const input = { ...rawInput, txnId: rawInput.txnId != null && rawInput.txnId.trim() !== '' ? rawInput.txnId : null };

 // Match the originating click (Redis fast path -> DB fallback).
 const click = await findClick(input.networkId, input.clickId);
 if (!click) return { outcome: 'click_not_found', reason: 'unknown_click' };

 const offer = await getOfferConfig(input.networkId, click.offer_id);
 const who = { offerId: click.offer_id, publisherId: click.publisher_id, advertiserId: offer?.advertiserId ?? null };

 // Postback secure_code (S2S authentication). T-1: timing-safe comparison. Fails CLOSED: every
 // network gets a code at creation (migration 1700000067000 backfills and defaults it), so a
 // postback with no configured code at all — e.g. after Settings > Security "Clear" — is rejected
 // instead of accepted from anyone who has seen a click_id. API-key callers pass skipSecureCode.
 if (input.source === 'postback' && !input.skipSecureCode) {
 const required = offer?.securityCode || offer?.networkSecurityCode || null;
 if (!required || !timingSafeCompare(input.secureCode, required).ok) {
 const reason: NotRecordedReason = !required ? 'no_security_code_configured' : input.secureCode ? 'wrong_security_code' : 'missing_security_code';
 return { outcome: 'security_failed', reason, ...who };
 }
 }

 // Pixel / iframe are fired by the visitor's browser and carry no secret. Bind them to the offer's
 // own site (Referer / Origin, see ./origin.ts) so a partner can't fire them from their own pages,
 // and (below) never let them set the price.
 const browserFired = input.source === 'pixel' || input.source === 'iframe';
 if (browserFired && !conversionOriginAllowed(input.requestOrigin, allowedConversionHosts(offer, input.requestOrigin?.host ?? null))) {
 return { outcome: 'security_failed', reason: 'browser_origin_not_allowed', ...who };
 }

 // The event's duplicate rule — its goal's, else the offer's — decides how this request is deduped.
 const eventName = input.event ?? offer?.revenue?.baseEventName ?? null;
 const goal = await resolveGoal(input.networkId, click.offer_id, input.event);
 const rule = dedupeRule({
 networkId: input.networkId, offerId: click.offer_id, clickId: input.clickId, event: eventName, txnId: input.txnId,
 mode: goal?.duplicate_mode ?? duplicateModeOf(offer?.revenue), rawParams: input.rawParams,
 });

 // Fast idempotency pre-check, only once the request is authenticated (the authoritative guards are in
 // the DB). The value is a per-attempt token so only this attempt can release the key after a failure.
 const idemToken = randomUUID();
 const acquired = await redis.set(rule.key, idemToken, 'EX', rule.ttlS, 'NX');
 if (acquired !== 'OK') return { outcome: 'duplicate', reason: rule.reason, ...who, event: eventName };

 const state = { committed: false };
 try {
 return await recordAttributed({ input, redis, click, offer, goal, eventName, rule, browserFired }, state);
 } catch (err) {
 // Nothing was recorded → let a retry through. Once the insert transaction has committed the key
 // stays (a later error, e.g. enqueueing the partner postback, must not reopen a recorded conversion).
 if (!state.committed) await releaseIdemKey(redis, rule.key, idemToken);
 throw err;
 }
}

interface Attributed {
 input: RecordConversionInput & { txnId: string | null };
 redis: ReturnType<typeof getRedis>;
 click: ClickRow;
 offer: Awaited<ReturnType<typeof getOfferConfig>>;
 goal: GoalPricing | null;
 eventName: string | null;
 rule: DedupeRule;
 browserFired: boolean;
}

async function recordAttributed(
 { input, redis, click, offer, goal, eventName, rule, browserFired }: Attributed, state: { committed: boolean },
): Promise<RecordConversionResult> {
 const revCfg = offer?.revenue;
 const attrCfg = offer?.attribution;
 const who = { offerId: click.offer_id, publisherId: click.publisher_id, advertiserId: offer?.advertiserId ?? null };

 // T-2: per-click conversion volume — counted only for authenticated, non-duplicate attempts. Past the
 // offer's limit the conversion is still recorded, but held for review (below). Fail open on Redis errors.
 const volume = await checkConversionAbuse(redis, input.clickId, input.networkId,
 revCfg?.clickConversionLimit === undefined ? CONV_ABUSE_LIMIT : revCfg.clickConversionLimit);

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
 // Unusual volume from one click (T-2, above): held for review — recorded, never dropped. Beats an
 // "accept" postback control; a hold or rejection with its own reason keeps it.
 if (volume.limited && (status === 'approved' || (status === 'pending' && reason == null))) {
 status = 'pending';
 reason = 'held_unusual_volume';
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
 let duplicateReason: DedupeRule['reason'] | null = null;
 try {
 await client.query('BEGIN');
 // The (click, event) rule, permanently (the Redis key above expires): one conversion per click +
 // event — any, or (unique_txn without a transaction id) one without a transaction id. The
 // transaction-scoped advisory lock serialises concurrent attempts for the same click + event, and
 // the check runs after it, so the second attempt sees the first's committed row. Taken before the
 // cap lock, always in that order.
 if (rule.dbCheck) {
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
 [JSON.stringify(['convclickevent', input.networkId, input.clickId, eventName])]);
 const prior = await client.query(
 `SELECT 1 FROM conversions
 WHERE network_id = $1 AND click_id = $2 AND event_name IS NOT DISTINCT FROM $3
 ${rule.dbCheck === 'click_event_no_txn' ? 'AND transaction_id IS NULL' : ''}
 LIMIT 1`,
 [input.networkId, input.clickId, eventName],
 );
 if (prior.rows.length > 0) duplicateReason = 'duplicate_click_event';
 }
 // Over caps (Everflow): held as pending, the cap as its reason, for an admin to approve or reject —
 // recorded, never dropped (they used to be rejected). No ledger and no partner postback until approved.
 let overCap: string | null = null;
 if (!duplicateReason && status !== 'rejected') {
 overCap = await conversionCapReached(client, input.networkId, click.offer_id,
 { daily: offer?.dailyConversionCap ?? null, total: offer?.totalConversionCap ?? null }, goal);
 if (!overCap && click.publisher_id) {
 overCap = await customCapReached(client, input.networkId, click.offer_id, click.publisher_id,
 applicableSettings(offer?.customSettings, 'caps', click.publisher_id, clickAttrs, new Date()), payout, revenue);
 }
 }
 if (overCap) { status = 'pending'; reason = overCap; throttled = false; }
 const ins = duplicateReason ? { rows: [] as { conversion_id: string }[] } : await client.query<{ conversion_id: string }>(
 `INSERT INTO conversions (
 conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id,
 event_name, status, reason, payout, revenue, currency, transaction_id, source, raw_params,
 fraud_score, fraud_flags, goal_id
 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
 ON CONFLICT (offer_id, event_name, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
 RETURNING conversion_id`,
 [
 conversionId, input.networkId, input.clickId, click.offer_id, click.publisher_id,
 advertiserId, eventName, status, reason, payout, revenue, currency,
 input.txnId, input.source, JSON.stringify(input.rawParams),
 fraudScore, fraudFlags, goalId,
 ],
 );
 insertedOk = ins.rows.length > 0;
 // Not inserted without a (click, event) duplicate = the transaction id was already used for this
 // offer + event (the unique index).
 if (!insertedOk && !duplicateReason) duplicateReason = 'duplicate_transaction_id';
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
 throw err;
 } finally {
 client.release();
 }

 if (!insertedOk) return { outcome: 'duplicate', reason: duplicateReason, ...who, event: eventName };

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

 return { outcome: status, conversionId, reason, ...who, event: eventName, payout, revenue, currency };
}
