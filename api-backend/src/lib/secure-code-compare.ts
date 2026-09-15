/**
 * Timing-safe string comparison for secureCode validation.
 *
 * Uses Node.js crypto.timingSafeEqual with a constant-time comparison after
 * normalizing inputs. Different-length inputs are rejected without calling
 * timingSafeEqual (which would throw on unequal-length buffers).
 *
 * Always returns false on malformed/missing input — never throws.
 */

import crypto from 'node:crypto';

const MIN_LEN = 8;

export interface TimingSafeResult {
 ok: boolean;
 /** Length of the reference value (always a fixed positive number when result is produced). */
 refLen: number;
}

/**
 * Compare a provided value against a reference value in constant time.
 *
 * @param provided Value from the caller (attacker-controlled).
 * @param reference Expected value from configuration.
 * @returns true only when both are valid fixed-length strings that match exactly.
 */
export function timingSafeCompare(provided: unknown, reference: string): TimingSafeResult {
 const refLen = reference.length;

 if (typeof provided !== 'string') return { ok: false, refLen };
 const pLen = provided.length;

 if (pLen !== refLen) return { ok: false, refLen };

 if (refLen < MIN_LEN) return { ok: false, refLen };

 const a = Buffer.from(provided, 'utf8');
 const b = Buffer.from(reference, 'utf8');

 try {
 const eq = crypto.timingSafeEqual(a, b);
 return { ok: eq, refLen };
 } catch {
 return { ok: false, refLen };
 }
}
