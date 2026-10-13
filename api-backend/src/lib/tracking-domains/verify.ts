/**
 * Custom tracking-domain verification + activation (audit F-15). A custom host proves the network
 * controls it by publishing a DNS TXT record
 *
 *     _tracker-verify.<host>   TXT   "<verification_token>"
 *
 * Verifying (on demand — POST /api/tracking-domains/:id/verify — or the background re-check in
 * workers/processors/domain-verify.ts) looks the record up; on a match the domain becomes
 * verification_state 'verified' + status 'active', so the tracking host resolver serves it. A manual
 * check that misses marks it 'failed' (the operator sees why); the background re-check leaves it
 * 'pending' and tries again later.
 *
 * TLS: there is no ACME client in this codebase. Certificates for custom hosts are expected to come
 * from the edge in front of the tracking surface (Cloudflare for SaaS, Caddy on-demand TLS, a cloud LB
 * with managed certs) — the tracking surface exposes GET /_tls/ask?domain=<host> (200 only for an
 * active + verified host) for edges that ask before issuing. A deployment with its own issuer plugs it
 * in with setCertificateIssuer(); until a certificate is confirmed, ssl_status stays 'pending' — never
 * 'issued' for a host that hasn't verified.
 */
import { resolveTxt } from 'node:dns/promises';
import { query } from '../db/pool.js';
import { invalidateHost } from '../../surfaces/tracking/host-resolver-db.js';

export const VERIFY_LABEL = '_tracker-verify';

export interface DnsRecord { type: 'TXT'; name: string; value: string }

/** The record the operator must publish for `host`. */
export const verificationRecord = (host: string, token: string): DnsRecord =>
 ({ type: 'TXT', name: `${VERIFY_LABEL}.${host}`, value: token });

type TxtResolver = (name: string) => Promise<string[][]>;
let txtResolver: TxtResolver = resolveTxt;
/** Swap the DNS TXT lookup (tests). */
export function setTxtResolver(fn: TxtResolver): void { txtResolver = fn; }

export interface CertificateIssuer { issue(host: string): Promise<'issued' | 'pending' | 'error'> }
/** Default: the edge issues the certificate; we can't confirm it, so it stays 'pending'. */
let issuer: CertificateIssuer = { issue: async () => 'pending' };
export function setCertificateIssuer(next: CertificateIssuer): void { issuer = next; }

/** Does `host`'s verification record carry `token`? Multi-string TXT records are joined, per RFC 7208. */
export async function txtMatches(host: string, token: string): Promise<{ ok: boolean; reason: string }> {
 try {
 const records = (await txtResolver(`${VERIFY_LABEL}.${host}`)).map((chunks) => chunks.join(''));
 return records.some((r) => r.trim() === token)
 ? { ok: true, reason: 'TXT record found' }
 : { ok: false, reason: `TXT record ${VERIFY_LABEL}.${host} exists but doesn't carry the verification token` };
 } catch (err) {
 const code = (err as { code?: string }).code;
 return { ok: false, reason: code === 'ENOTFOUND' || code === 'ENODATA' ? `No TXT record at ${VERIFY_LABEL}.${host} yet` : `DNS lookup failed (${code ?? 'error'})` };
 }
}

interface DomainRow { id: string; host: string; mode: string; verification_token: string | null; verification_state: string }

/**
 * Check one custom domain now. Match → verified + active (+ certificate step), the host resolver's
 * cache busted so it serves immediately. Miss → 'failed' when an operator asked, unchanged ('pending')
 * when the background re-check did.
 */
export async function verifyTrackingDomain(
 networkId: string, domainId: string, opts: { onMiss: 'fail' | 'keep' },
): Promise<{ verified: boolean; reason: string } | null> {
 const { rows } = await query<DomainRow>(
 'SELECT id, host, mode, verification_token, verification_state FROM tracking_domains WHERE network_id = $1 AND id = $2',
 [networkId, domainId],
 );
 const d = rows[0];
 if (!d) return null;
 if (d.mode !== 'custom' || d.verification_state === 'verified') return { verified: d.verification_state === 'verified', reason: 'Already verified' };
 if (!d.verification_token) return { verified: false, reason: 'This domain has no verification token' };

 const check = await txtMatches(d.host, d.verification_token);
 if (check.ok) {
 const ssl = await issuer.issue(d.host).catch(() => 'error' as const);
 await query(
 `UPDATE tracking_domains SET verification_state = 'verified', status = 'active', ssl_status = $3
 WHERE network_id = $1 AND id = $2`,
 [networkId, d.id, ssl],
 );
 await invalidateHost(d.host);
 return { verified: true, reason: check.reason };
 }
 if (opts.onMiss === 'fail') {
 await query(`UPDATE tracking_domains SET verification_state = 'failed' WHERE network_id = $1 AND id = $2`, [networkId, d.id]);
 }
 return { verified: false, reason: check.reason };
}

/** Background re-check: every custom domain still waiting for its TXT record (all networks). */
export async function recheckPendingDomains(): Promise<{ checked: number; verified: number }> {
 const { rows } = await query<{ id: string; network_id: string }>(
 `SELECT id, network_id FROM tracking_domains
 WHERE mode = 'custom' AND verification_state IN ('unverified', 'pending') AND status <> 'disabled'
 ORDER BY created_at LIMIT 500`,
 );
 let verified = 0;
 for (const d of rows) {
 const r = await verifyTrackingDomain(d.network_id, d.id, { onMiss: 'keep' });
 if (r?.verified) verified++;
 }
 return { checked: rows.length, verified };
}
