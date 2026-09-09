/**
 * ClickHouse-backed AnalyticsWriter (spec §2, §3B, §9; Phase 8 analytics store).
 *
 * Implements the `AnalyticsWriter` interface from `./writer.ts` against the tables defined in
 * `clickhouse/migrations/0001_clicks.sql` and `0002_conversions.sql`. Callers depend only on the
 * interface — swap out the writer implementation, no other code changes.
 *
 * Failure semantics (spec §5, §11):
 * - Postgres remains the source of truth. Analytics is best-effort.
 * - writeClicks / writeConversions are called AFTER the Postgres write has committed in the
 * caller (click-persist worker, recordConversion). An analytics failure therefore cannot turn a
 * successful business transaction into a failed one.
 * - Analytics failures are LOGGED (pino `error`) and swallowed. The caller sees a successful
 * promise resolution. We do NOT re-queue the BullMQ job — the Postgres write already succeeded
 * and the ON CONFLICT DO NOTHING makes a re-run a no-op for the primary store; retrying for
 *  analytics alone would just re-attempt the same insert that already failed (network blip,
 * auth misconfig, etc.) without giving the operator a chance to fix root cause.
 * - For at-least-once delivery of analytics events: a separate "failed analytics" log line
 * carries the row payload (with redact for sensitive fields). A future Phase 8.4+ job can
 * replay these from logs OR (preferred) a future `analytics_outbox` table.
 *
 * Tenant isolation:
 * - Every row carries `network_id`. The `mapClick` and `mapConversion` functions DROP events
 * with an empty/invalid `networkId` before they reach ClickHouse (logged as a warning).
 * - The Postgres-side mandatory network_id filter pattern translates 1:1 to analytics queries
 * in Phase 8.5+; for writes we simply require every event to carry the tenant.
 *
 * Batching:
 * - The ClickHouse `insert({ values })` API already batches all rows in one HTTP request. The
 * @clickhouse/client emits one POST body containing all JSON rows. We do not need a separate
 * accumulator here — BullMQ workers already fan in at concurrency=8, so callers batch naturally
 * by handing us an array.
 * - `format: 'JSONEachRow'` is the most forgiving format for forward-compatible schemas: it
 * sends one JSON object per line; column ordering matches the table. Combined with an explicit
 * `columns` list, new columns added by future migrations don't break older writers.
 */
import type { ClickHouseClient } from '@clickhouse/client';
import { logger } from '../logger.js';
import { getClickHouse, isClickHouseEnabled } from '../clickhouse/client.js';
import {
 setAnalyticsWriter,
 type AnalyticsWriter,
 type ClickEvent,
 type ConversionEvent,
} from './writer.js';

const log = logger.child({ module: 'analytics.clickhouse' });

// --- mapping ---------------------------------------------------------------

/**
 * Validate UUID format. ClickHouse `UUID` columns reject non-UUID strings; we drop rather than
 *  coerce, because silently inventing UUIDs would risk cross-tenant writes if a malformed id ever
 * collided.
 */
function isUuid(v: string | null | undefined): v is string {
 if (!v) return false;
 return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isIsoTimestamp(v: string | null | undefined): v is string {
 if (!v) return false;
 const t = Date.parse(v);
 return Number.isFinite(t);
}

// ClickHouse schema (mirror of 0001_clicks.sql). Order matches the table — kept in sync by code
// review when migrations change.
const CLICK_COLUMNS = [
 'click_id',
 'network_id',
 'offer_id',
 'publisher_id',
 'smart_link_id',
 'timestamp',
 'payout',
 'revenue',
 'currency',
 'ip',
 'country',
 'region',
 'city',
 'isp',
 'device',
 'os',
 'browser',
 'referrer',
 'user_agent',
 'sub1',
 'sub2',
 'sub3',
 'sub4',
 'sub5',
 'is_unique',
 'fraud_score',
 'fraud_flags',
] as const;

const CONVERSION_COLUMNS = [
 'conversion_id',
 'network_id',
 'click_id',
 'offer_id',
 'publisher_id',
 'advertiser_id',
 'goal_id',
 'timestamp',
 'status',
 'reason',
 'source',
 'event_name',
 'payout',
 'revenue',
 'currency',
 'country',
 'region',
 'city',
 'isp',
 'device',
 'os',
 'browser',
 'sub1',
 'sub2',
 'sub3',
 'sub4',
 'sub5',
 'smart_link_id',
 'fraud_score',
 'fraud_flags',
] as const;

function ipToIpv6String(ip: string | null): string | null {
 if (!ip) return null;
 // ClickHouse `IPv6` accepts both IPv4 and IPv6 strings. Pass through as-is; the column uses
 // assumeDual() at SELECT time when needed (handled in Phase 8.5 reporting).
 return ip;
}

interface ClickRow {
 click_id: string;
 network_id: string;
 offer_id: string;
 publisher_id: string | null;
 smart_link_id: string | null;
 timestamp: string;
 payout: string | null;
 revenue: string | null;
 currency: string | null;
 ip: string | null;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 referrer: string | null;
 user_agent: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 is_unique: number;
 fraud_score: number;
 fraud_flags: string[];
}

function mapClick(e: ClickEvent): ClickRow | null {
 if (!e.clickId) return null;
 if (!isUuid(e.networkId)) return null;
 if (!isUuid(e.offerId)) return null;
 if (!isIsoTimestamp(e.timestamp)) return null;
 return {
 click_id: e.clickId,
 network_id: e.networkId,
 offer_id: e.offerId,
 publisher_id: isUuid(e.publisherId) ? e.publisherId : null,
 smart_link_id: isUuid(e.smartLinkId) ? e.smartLinkId : null,
 timestamp: e.timestamp,
 payout: e.payout,
 revenue: e.revenue,
 currency: e.currency,
 ip: ipToIpv6String(e.ip),
 country: e.country,
 region: e.region,
 city: e.city,
 isp: e.isp,
 device: e.device,
 os: e.os,
 browser: e.browser,
 referrer: e.referrer,
 user_agent: e.userAgent,
 sub1: e.sub1,
 sub2: e.sub2,
 sub3: e.sub3,
 sub4: e.sub4,
 sub5: e.sub5,
 is_unique: e.isUnique ? 1 : 0,
 fraud_score: Math.max(0, Math.min(0xffff, Math.trunc(e.fraudScore ?? 0))),
 fraud_flags: Array.isArray(e.fraudFlags) ? e.fraudFlags.filter((s): s is string => typeof s === 'string') : [],
 };
}

interface ConversionRow {
 conversion_id: string;
 network_id: string;
 click_id: string;
 offer_id: string;
 publisher_id: string | null;
 advertiser_id: string | null;
 goal_id: string | null;
 timestamp: string;
 status: string;
 reason: string | null;
 source: string;
 event_name: string | null;
 payout: string | null;
 revenue: string | null;
 currency: string | null;
 country: string | null;
 region: string | null;
 city: string | null;
 isp: string | null;
 device: string | null;
 os: string | null;
 browser: string | null;
 sub1: string | null;
 sub2: string | null;
 sub3: string | null;
 sub4: string | null;
 sub5: string | null;
 smart_link_id: string | null;
 fraud_score: number;
 fraud_flags: string[];
}

function mapConversion(e: ConversionEvent): ConversionRow | null {
 if (!e.conversionId) return null;
 if (!e.clickId) return null;
 if (!isUuid(e.networkId)) return null;
 if (!isUuid(e.offerId)) return null;
 if (!isIsoTimestamp(e.timestamp)) return null;
 return {
 conversion_id: e.conversionId,
 network_id: e.networkId,
 click_id: e.clickId,
 offer_id: e.offerId,
 publisher_id: isUuid(e.publisherId) ? e.publisherId : null,
 advertiser_id: isUuid(e.advertiserId) ? e.advertiserId : null,
 goal_id: isUuid(e.goalId) ? e.goalId : null,
 timestamp: e.timestamp,
 status: e.status,
 reason: e.reason,
 source: e.source,
 event_name: e.eventName,
 payout: e.payout,
 revenue: e.revenue,
 currency: e.currency,
 country: e.country,
 region: e.region,
 city: e.city,
 isp: e.isp,
 device: e.device,
 os: e.os,
 browser: e.browser,
 sub1: e.sub1,
 sub2: e.sub2,
 sub3: e.sub3,
 sub4: e.sub4,
 sub5: e.sub5,
 smart_link_id: isUuid(e.smartLinkId) ? e.smartLinkId : null,
 fraud_score: Math.max(0, Math.min(0xffff, Math.trunc(e.fraudScore ?? 0))),
 fraud_flags: Array.isArray(e.fraudFlags) ? e.fraudFlags.filter((s): s is string => typeof s === 'string') : [],
 };
}

// --- writer ----------------------------------------------------------------

export class ClickHouseAnalyticsWriter implements AnalyticsWriter {
 private readonly client: ClickHouseClient;

 constructor(client: ClickHouseClient = getClickHouse()) {
 this.client = client;
 }

 async writeClicks(events: ClickEvent[]): Promise<void> {
 if (events.length === 0) return;
 const rows: ClickRow[] = [];
 let dropped = 0;
 for (const e of events) {
 const r = mapClick(e);
 if (r) rows.push(r);
 else dropped += 1;
 }
 if (dropped > 0) {
 log.warn({ dropped, total: events.length }, '[analytics] dropped click events with missing/invalid required fields');
 }
 if (rows.length === 0) return;
 try {
 await this.client.insert({
 table: 'clicks',
 format: 'JSONEachRow',
 columns: [...CLICK_COLUMNS],
 values: rows,
 });
 } catch (err) {
 // Swallow + log. ClickHouse failures must NOT corrupt the primary Postgres flow.
 log.error(
 { err, rows: rows.length, sample: rows[0] },
 '[analytics] click insert failed; postgres remains source of truth',
 );
 }
 }

 async writeConversions(events: ConversionEvent[]): Promise<void> {
 if (events.length === 0) return;
 const rows: ConversionRow[] = [];
 let dropped = 0;
 for (const e of events) {
 const r = mapConversion(e);
 if (r) rows.push(r);
 else dropped += 1;
 }
 if (dropped > 0) {
 log.warn({ dropped, total: events.length }, '[analytics] dropped conversion events with missing/invalid required fields');
 }
 if (rows.length === 0) return;
 try {
 await this.client.insert({
 table: 'conversions',
 format: 'JSONEachRow',
 columns: [...CONVERSION_COLUMNS],
 values: rows,
 });
 } catch (err) {
 log.error(
 { err, rows: rows.length, sample: rows[0] },
 '[analytics] conversion insert failed; postgres remains source of truth',
 );
 }
 }
}

/**
 * Install the ClickHouse-backed AnalyticsWriter if ClickHouse is configured. Otherwise the
 * existing NoopAnalyticsWriter stays in place. Idempotent.
 *
 * Returns true if the ClickHouse writer was installed, false otherwise (so the caller can log).
 */
export function installClickHouseAnalyticsWriter(): boolean {
 if (!isClickHouseEnabled()) {
 log.info('clickhouse not configured — analytics writer stays noop');
 return false;
 }
 setAnalyticsWriter(new ClickHouseAnalyticsWriter());
 log.info('clickhouse analytics writer installed');
 return true;
}
