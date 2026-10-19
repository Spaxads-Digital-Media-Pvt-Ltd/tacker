/**
 * Inbound postback log: one row for EVERY conversion request the tracker processes — S2S postback,
 * pixel, iframe and the advertiser API — with what happened to it: recorded (approved / pending /
 * rejected, with the conversion and its reason) or not (duplicate, unknown click, wrong security
 * code, … — and why). Nothing an advertiser sends goes unrecorded, so reconciling with their own or
 * another tracker's numbers is a matter of comparing lines. Read by Reporting › Advertiser Postback
 * (GET /api/reports/inbound-postbacks); pruned on the network's click window (lib/retention).
 *
 * Not logged: a request for an unknown tracking host (there is no network to log it under) and one
 * the rate limiter refuses before it is processed.
 *
 * Written before the response (one small insert, so rows keep the order requests were answered in);
 * a failed write is logged and never fails the postback. Params are stored redacted (secure_code and
 * other secrets → "[redacted]") and bounded.
 */
import { isIP } from 'node:net';
import { query } from '../../../lib/db/pool.js';
import { redactRawParams } from '../../../lib/reporting/redact.js';
import { normalizeMoney } from '../../../lib/money.js';
import { logger } from '../../../lib/logger.js';
import type { ConversionOutcome, RecordConversionResult } from './record.js';

export type InboundSource = 'postback' | 'pixel' | 'iframe' | 'api';
/** A conversion outcome, or `error` when processing failed (the caller answered 5xx). */
export type InboundOutcome = ConversionOutcome | 'error';

export interface InboundPostback {
 networkId: string;
 source: InboundSource;
 method: string | null;
 clickId: string | null;
 transactionId: string | null;
 event: string | null;
 /** The sale / order amount as sent (stored when it is a valid money value). */
 saleAmount: string | null;
 httpStatus: number;
 ip: string | null;
 userAgent: string | null;
 params: Record<string, unknown>;
 result: Omit<RecordConversionResult, 'outcome'> & { outcome: InboundOutcome };
}

const MAX_PARAMS = 100;
const MAX_VALUE = 2_000;

const text = (s: string | null | undefined, max: number): string | null => (s == null || s === '' ? null : s.slice(0, max));

function money(v: string | null | undefined): string | null {
 if (v == null) return null;
 try { return normalizeMoney(v); } catch { return null; }
}

/** At most MAX_PARAMS keys, long values cut — a request body can't bloat the log. */
function boundParams(params: Record<string, unknown>): Record<string, unknown> {
 const cut = (v: unknown): unknown => typeof v === 'string' ? v.slice(0, MAX_VALUE)
 : Array.isArray(v) ? v.slice(0, 10).map(cut)
 : v && typeof v === 'object' ? JSON.stringify(v).slice(0, MAX_VALUE)
 : v;
 return Object.fromEntries(Object.entries(params).slice(0, MAX_PARAMS).map(([k, v]) => [k.slice(0, 200), cut(v)]));
}

export async function writeInboundLog(e: InboundPostback): Promise<void> {
 const r = e.result;
 await query(
 `INSERT INTO inbound_postback_logs (
 network_id, source, method, click_id, transaction_id, event_name, offer_id, publisher_id, advertiser_id,
 outcome, reason, conversion_id, payout, revenue, currency, sale_amount, http_status, ip, user_agent, params
 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
 [
 e.networkId, e.source, text(e.method, 10), text(e.clickId, 200), text(e.transactionId, 500), text(r.event ?? e.event, 200),
 r.offerId ?? null, r.publisherId ?? null, r.advertiserId ?? null,
 r.outcome, text(r.reason, 500), r.conversionId ?? null, money(r.payout), money(r.revenue), text(r.currency, 3),
 money(e.saleAmount), e.httpStatus, e.ip && isIP(e.ip) ? e.ip : null, text(e.userAgent, 512),
 JSON.stringify(boundParams(redactRawParams(e.params))),
 ],
 );
}

/** writeInboundLog that never throws: a failed write is logged, the request carries on. */
export async function logInbound(e: InboundPostback): Promise<void> {
 try {
 await writeInboundLog(e);
 } catch (err) {
 logger.warn({ err, networkId: e.networkId, source: e.source }, 'inbound postback log write failed');
 }
}
