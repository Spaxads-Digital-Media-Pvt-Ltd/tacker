import { z } from 'zod';
import { isRedirectUrlSafe } from './url-security.js';

export const redirectUrl = z.string().url().refine(isRedirectUrlSafe, {
 message: 'Only http and https URLs are allowed as redirect destinations',
});

export function redirectUrlWithMax(maxLength = 2000) {
 return z.string().max(maxLength).url().refine(isRedirectUrlSafe, {
 message: 'Only http and https URLs are allowed as redirect destinations',
 });
}

/** A partner postback URL — the same rule on every postback API (/api/postbacks, the partner's
 *  and the offer's postbacks): http(s) only, ≤ 2000. Delivery also goes through the SSRF guard. */
export const postbackUrl = z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL');
