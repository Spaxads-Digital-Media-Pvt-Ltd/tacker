/**
 * URL security for redirect destinations (AP-3).
 *
 * Enforces:
 * - Only http: and https: schemes are safe for external redirects.
 * - Rejects javascript:, data:, vbscript:, file:, blob:, chrome:, about:, etc.
 * - Rejects protocol-relative URLs (//evil.com).
 * - Rejects URLs with control characters (CRLF injection, header injection).
 * - Rejects obviously malformed URLs.
 *
 * Defense-in-depth: call at BOTH write time (offer CRUD) and runtime (before Location header).
 */

const SAFE_SCHEMES = new Set(['http', 'https']);

/**
 * Returns a rejection reason string, or null if the URL is safe to redirect to.
 * Does NOT throw.
 */
export function getRedirectUrlRejectReason(raw: string | null | undefined): string | null {
 if (!raw || typeof raw !== 'string') return null;

 const trimmed = raw.trim();
 if (!trimmed) return 'empty_url';

 // Reject any control characters before parsing — prevents header injection.
 for (let i = 0; i < trimmed.length; i++) {
 const cp = trimmed.charCodeAt(i);
 if (cp <= 0x1f || cp === 0x7f) return 'control_character';
 }

 let parsed: URL;
 try {
 parsed = new URL(trimmed);
 } catch {
 return 'malformed_url';
 }

 // new URL('//evil.com', 'https://x') → protocol is ''
 if (!parsed.protocol) return 'no_scheme';

 const scheme = parsed.protocol.toLowerCase().replace(/:$/, '');
 if (!SAFE_SCHEMES.has(scheme)) return 'unsafe_scheme';

 if (!parsed.hostname) return 'no_host';

 return null;
}

/** True when the URL is safe for use as a redirect destination. */
export function isRedirectUrlSafe(raw: string | null | undefined): boolean {
 return getRedirectUrlRejectReason(raw) === null;
}

/** Log-structured metadata for blocked redirect attempts. */
export interface RedirectUrlViolation {
 offerId?: string;
 networkId?: string;
 geoRuleId?: string;
 reason: string;
 redirectSource: 'destination' | 'fallback' | 'geo_override';
}
