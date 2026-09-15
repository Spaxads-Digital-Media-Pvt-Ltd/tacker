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
