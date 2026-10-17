/**
 * Super Admin › Trust & safety — what only the platform can see across its networks, and privacy requests.
 *
 * - scanTrust (hourly, workers › platform-trust; or "Scan now"): the addresses that sent flagged or rejected
 *   clicks to MORE THAN ONE network in the last 24 hours — or 50+ flagged clicks anywhere — into
 *   platform_fraud_ips, and the 24-hour click totals and rejection reasons into platform_settings
 *   'trust_scan'. It reads the raw clicks table, so it runs in the background, never in a page request.
 * - Privacy (GDPR / CCPA) requests about a visitor, identified by an IP, a click id, a sub id value or an
 *   email, in one network or all: erasure clears the personal fields of the matching clicks (IP, user agent,
 *   referrer, city / region, ad click ids, sub ids), their conversions' raw postback parameters and the
 *   postback logs that carried them — never an amount, so the money ledger and reports stay whole. Access
 *   exports what is held about the subject. The subject is masked once the request is done (its hash stays).
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';

// ---------- The cross-network scan ----------

export interface TrustScan {
  computedAt: string;
  totalClicks: number;
  flaggedClicks: number;
  reasons: { reason: string; clicks: number }[];
  suspiciousIps: number;
}

/** Flagged = scored as fraud (50+) or carrying a flag (a rejection reason is a flag too). */
const FLAGGED = `(fraud_score >= 50 OR cardinality(fraud_flags) > 0)`;

export async function scanTrust(now: Date = new Date()): Promise<TrustScan> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  return withTransaction(async (c) => {
    await c.query(`SET LOCAL statement_timeout = '120s'`);
    await c.query('DELETE FROM platform_fraud_ips');
    const ips = await c.query(
      `WITH c AS (
         SELECT host(ip) AS ip, network_id, fraud_score, fraud_flags, created_at, ${FLAGGED} AS flagged
           FROM clicks WHERE created_at >= $1 AND ip IS NOT NULL
       ), agg AS (
         SELECT ip, array_agg(DISTINCT network_id) AS network_ids, COUNT(*)::int AS clicks,
                COUNT(*) FILTER (WHERE flagged)::int AS flagged, ROUND(AVG(fraud_score))::int AS avg_score,
                MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
           FROM c GROUP BY ip
          HAVING COUNT(DISTINCT network_id) FILTER (WHERE flagged) >= 2 OR COUNT(*) FILTER (WHERE flagged) >= 50
          ORDER BY COUNT(*) FILTER (WHERE flagged) DESC LIMIT 200
       )
       INSERT INTO platform_fraud_ips (ip, network_ids, clicks, flagged, avg_score, first_seen, last_seen, computed_at)
       SELECT ip, network_ids, clicks, flagged, avg_score, first_seen, last_seen, $2 FROM agg`, [since, now.toISOString()]);
    // Each address's three most common flags — one grouped pass over just those addresses' clicks.
    if (ips.rowCount) {
      await c.query(
        `UPDATE platform_fraud_ips f SET top_flags = t.flags
           FROM (SELECT ip, array_agg(flag ORDER BY n DESC) FILTER (WHERE rn <= 3) AS flags
                   FROM (SELECT host(cl.ip) AS ip, flag, COUNT(*) AS n, ROW_NUMBER() OVER (PARTITION BY host(cl.ip) ORDER BY COUNT(*) DESC) AS rn
                           FROM clicks cl CROSS JOIN LATERAL unnest(cl.fraud_flags) AS flag
                          WHERE cl.created_at >= $1 AND cl.ip IS NOT NULL AND host(cl.ip) IN (SELECT ip FROM platform_fraud_ips)
                          GROUP BY host(cl.ip), flag) x
                  GROUP BY ip) t
          WHERE f.ip = t.ip AND t.flags IS NOT NULL`, [since]);
    }
    const totals = (await c.query<{ total: string; flagged: string }>(
      `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE ${FLAGGED})::text AS flagged FROM clicks WHERE created_at >= $1`, [since])).rows[0]!;
    const reasons = (await c.query<{ reason: string; clicks: number }>(
      `SELECT fraud_flags[1] AS reason, COUNT(*)::int AS clicks FROM clicks
        WHERE created_at >= $1 AND cardinality(fraud_flags) > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, [since])).rows;
    const scan: TrustScan = {
      computedAt: now.toISOString(), totalClicks: Number(totals.total), flaggedClicks: Number(totals.flagged), reasons, suspiciousIps: ips.rowCount ?? 0,
    };
    await c.query(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES ('trust_scan', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(scan)]);
    return scan;
  });
}

export async function lastTrustScan(): Promise<TrustScan | null> {
  return (await query<{ value: TrustScan }>(`SELECT value FROM platform_settings WHERE key = 'trust_scan'`)).rows[0]?.value ?? null;
}

// ---------- Privacy requests ----------

export const SUBJECT_TYPES = ['ip', 'click_id', 'sub_id', 'email'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const REGULATIONS = ['gdpr', 'ccpa', 'other'] as const;
export type Regulation = (typeof REGULATIONS)[number];
/** Days to answer: GDPR one month (art. 12(3)), CCPA 45 days. */
export const DUE_DAYS: Record<Regulation, number> = { gdpr: 30, ccpa: 45, other: 30 };

/** The subject as matched and hashed: an IPv4-mapped IPv6 address as IPv4, an email lower-cased. */
export function normalizeSubject(type: SubjectType, subject: string): string {
  const s = subject.trim();
  if (type === 'ip') { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s); return (m ? m[1]! : s).toLowerCase(); }
  return type === 'email' ? s.toLowerCase() : s;
}

/** Why this subject can't be used, or null. */
export function subjectError(type: SubjectType, subject: string): string | null {
  const s = normalizeSubject(type, subject);
  if (!s) return 'Enter what identifies the person.';
  if (type === 'ip' && !isIP(s)) return 'Enter an IPv4 or IPv6 address.';
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'Enter an email address.';
  if ((type === 'sub_id' || type === 'click_id') && s.length < 4) return 'Enter at least 4 characters — a shorter value would match other people’s data.';
  return null;
}

export const hashSubject = (type: SubjectType, subject: string): string =>
  createHash('sha256').update(`${type}:${normalizeSubject(type, subject)}`).digest('hex');

/** What stays visible once a request is done: "203.0.*.*", "j***@example.com", "a1b2c3…". */
export function maskSubject(type: SubjectType, subject: string): string {
  const s = normalizeSubject(type, subject);
  if (type === 'ip') return isIP(s) === 4 ? s.split('.').slice(0, 2).concat('*', '*').join('.') : `${s.split(':').slice(0, 3).join(':')}:…`;
  if (type === 'email') { const [u, d] = s.split('@'); return `${(u ?? '').slice(0, 1)}***@${d ?? ''}`; }
  return `${s.slice(0, Math.min(6, Math.max(2, s.length - 4)))}…`;
}

export interface PrivacyRequestRow {
  id: string; network_id: string | null; kind: 'erasure' | 'access'; subject_type: SubjectType; subject: string;
}

export interface ErasureResult {
  clicks: number; conversions: number; inboundPostbacks: number; outboundPostbacks: number; networks: number;
  /** Impressions whose personal fields were cleared, and Email Ownership records removed (both optional:
   * absent on results recorded before impressions / email ownership existed). */
  impressions?: number; emailOwnerships?: number;
}

/** The SQL matching the subject's clicks (alias-free; $1 = the subject). */
function clickMatch(type: SubjectType): string {
  switch (type) {
    case 'ip': return `ip = $1::inet`;
    case 'click_id': return `click_id = $1`;
    case 'sub_id': return `$1 IN (sub1, sub2, sub3, sub4, sub5)`;
    case 'email': return `$1 IN (lower(sub1), lower(sub2), lower(sub3), lower(sub4), lower(sub5))`;
  }
}

/** The subject's clicks (network → click ids) — in one network or every network. */
async function matchingClicks(c: Pick<PoolClient, 'query'>, r: PrivacyRequestRow, subject: string): Promise<Map<string, string[]>> {
  const rows = (await c.query<{ network_id: string; click_id: string }>(
    `SELECT network_id, click_id FROM clicks WHERE ${clickMatch(r.subject_type)} ${r.network_id ? 'AND network_id = $2' : ''}`,
    r.network_id ? [subject, r.network_id] : [subject])).rows;
  const by = new Map<string, string[]>();
  for (const row of rows) by.set(row.network_id, [...(by.get(row.network_id) ?? []), row.click_id]);
  return by;
}

/** Clears what is held about the subject (personal fields only — never an amount). */
export async function eraseSubject(r: PrivacyRequestRow): Promise<ErasureResult> {
  const subject = normalizeSubject(r.subject_type, r.subject);
  return withTransaction(async (c) => {
    await c.query(`SET LOCAL statement_timeout = '120s'`);
    const out: ErasureResult = { clicks: 0, conversions: 0, inboundPostbacks: 0, outboundPostbacks: 0, networks: 0, impressions: 0, emailOwnerships: 0 };
    const byNetwork = await matchingClicks(c, r, subject);
    const wholeClick = r.subject_type === 'ip' || r.subject_type === 'click_id';
    for (const [networkId, ids] of byNetwork) {
      out.networks += 1;
      // Clicks: an IP / click id erases the whole click's personal fields; a sub id / email only the matching sub ids.
      const clicks = wholeClick
        ? await c.query(
          `UPDATE clicks SET ip = NULL, user_agent = NULL, referrer = NULL, city = NULL, region = NULL, fbclid = NULL, gclid = NULL,
                  sub1 = NULL, sub2 = NULL, sub3 = NULL, sub4 = NULL, sub5 = NULL
            WHERE network_id = $1 AND click_id = ANY($2::text[])`, [networkId, ids])
        : await c.query(
          `UPDATE clicks SET sub1 = CASE WHEN lower(sub1) = lower($3) THEN NULL ELSE sub1 END, sub2 = CASE WHEN lower(sub2) = lower($3) THEN NULL ELSE sub2 END,
                  sub3 = CASE WHEN lower(sub3) = lower($3) THEN NULL ELSE sub3 END, sub4 = CASE WHEN lower(sub4) = lower($3) THEN NULL ELSE sub4 END,
                  sub5 = CASE WHEN lower(sub5) = lower($3) THEN NULL ELSE sub5 END
            WHERE network_id = $1 AND click_id = ANY($2::text[])`, [networkId, ids, subject]);
      out.clicks += clicks.rowCount ?? 0;
      // Their conversions' raw postback parameters, and the postbacks that carried them.
      const convs = await c.query<{ conversion_id: string }>(
        `UPDATE conversions SET raw_params = '{}'::jsonb WHERE network_id = $1 AND click_id = ANY($2::text[]) AND raw_params <> '{}'::jsonb RETURNING conversion_id`,
        [networkId, ids]);
      out.conversions += convs.rowCount ?? 0;
      const inbound = await c.query(
        `UPDATE inbound_postback_logs SET params = '{}'::jsonb, ip = NULL, user_agent = NULL WHERE network_id = $1 AND click_id = ANY($2::text[])`, [networkId, ids]);
      out.inboundPostbacks += inbound.rowCount ?? 0;
      const allConversions = (await c.query<{ conversion_id: string }>(
        'SELECT conversion_id FROM conversions WHERE network_id = $1 AND click_id = ANY($2::text[])', [networkId, ids])).rows.map((x) => x.conversion_id);
      if (allConversions.length) {
        const outbound = await c.query(
          `UPDATE postback_logs SET url = regexp_replace(url, '\\?.*$', '?[erased]') WHERE network_id = $1 AND conversion_id = ANY($2::text[]) AND url ~ '\\?'`,
          [networkId, allConversions]);
        out.outboundPostbacks += outbound.rowCount ?? 0;
      }
    }
    // Impressions hold the same personal fields as clicks: an IP erases the impression's, a sub id / email the
    // matching sub ids. Email Ownership holds only the address's sha256 — the subject's records go.
    const iScope = r.network_id ? 'AND network_id = $2' : '';
    const iParams = r.network_id ? [subject, r.network_id] : [subject];
    if (r.subject_type === 'ip') {
      out.impressions = (await c.query(
        `UPDATE impressions SET ip = NULL, user_agent = NULL, referrer = NULL, city = NULL, region = NULL,
                sub1 = NULL, sub2 = NULL, sub3 = NULL, sub4 = NULL, sub5 = NULL
          WHERE ip = $1::inet ${iScope}`, iParams)).rowCount ?? 0;
    } else if (r.subject_type === 'sub_id' || r.subject_type === 'email') {
      out.impressions = (await c.query(
        `UPDATE impressions SET sub1 = CASE WHEN lower(sub1) = lower($1) THEN NULL ELSE sub1 END, sub2 = CASE WHEN lower(sub2) = lower($1) THEN NULL ELSE sub2 END,
                sub3 = CASE WHEN lower(sub3) = lower($1) THEN NULL ELSE sub3 END, sub4 = CASE WHEN lower(sub4) = lower($1) THEN NULL ELSE sub4 END,
                sub5 = CASE WHEN lower(sub5) = lower($1) THEN NULL ELSE sub5 END
          WHERE lower($1) IN (lower(sub1), lower(sub2), lower(sub3), lower(sub4), lower(sub5)) ${iScope}`, iParams)).rowCount ?? 0;
    }
    if (r.subject_type === 'email') {
      out.emailOwnerships = (await c.query(
        `DELETE FROM email_owners WHERE email_hash = encode(sha256(convert_to(lower(btrim($1)), 'UTF8')), 'hex') ${iScope}`, iParams)).rowCount ?? 0;
    }
    // A sub id / email can sit in a conversion's raw parameters without a click carrying it: drop those keys.
    if (!wholeClick) {
      const scope = r.network_id ? 'AND network_id = $2' : '';
      const p = r.network_id ? [subject, r.network_id] : [subject];
      const rawHits = await c.query(
        `UPDATE conversions SET raw_params = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(raw_params) e(k, v) WHERE lower(v #>> '{}') <> lower($1))
          WHERE CASE WHEN jsonb_typeof(raw_params) = 'object' THEN EXISTS (SELECT 1 FROM jsonb_each_text(raw_params) e WHERE lower(e.value) = lower($1)) ELSE false END ${scope}`, p);
      out.conversions += rawHits.rowCount ?? 0;
      const inboundHits = await c.query(
        `UPDATE inbound_postback_logs SET params = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(params) e(k, v) WHERE lower(v #>> '{}') <> lower($1))
          WHERE CASE WHEN jsonb_typeof(params) = 'object' THEN EXISTS (SELECT 1 FROM jsonb_each_text(params) e WHERE lower(e.value) = lower($1)) ELSE false END ${scope}`, p);
      out.inboundPostbacks += inboundHits.rowCount ?? 0;
    }
    return out;
  });
}

/** What is held about the subject (an access request): its clicks and their conversions, as CSV rows. */
export async function exportSubject(r: PrivacyRequestRow): Promise<string[][]> {
  const subject = normalizeSubject(r.subject_type, r.subject);
  const scope = r.network_id ? 'AND cl.network_id = $2' : '';
  const p = r.network_id ? [subject, r.network_id] : [subject];
  const rows = (await query<Record<string, string | null>>(
    `SELECT n.name AS network, cl.click_id, to_char(cl.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS clicked_at_utc,
            host(cl.ip) AS ip, cl.country, cl.region, cl.city, cl.device, cl.os, cl.browser, cl.referrer, cl.user_agent,
            cl.sub1, cl.sub2, cl.sub3, cl.sub4, cl.sub5,
            (SELECT string_agg(cv.conversion_id || ' ' || COALESCE(cv.event_name, 'conversion') || ' ' || cv.status, '; ')
               FROM conversions cv WHERE cv.network_id = cl.network_id AND cv.click_id = cl.click_id) AS conversions
       FROM clicks cl JOIN networks n ON n.id = cl.network_id
      WHERE ${clickMatch(r.subject_type).replace(/\b(ip|click_id|sub[1-5])\b/g, 'cl.$1')} ${scope}
      ORDER BY cl.created_at LIMIT 5000`, p)).rows;
  const head = ['network', 'click_id', 'clicked_at_utc', 'ip', 'country', 'region', 'city', 'device', 'os', 'browser', 'referrer', 'user_agent', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'conversions'];
  return [head, ...rows.map((row) => head.map((h) => row[h] ?? ''))];
}
