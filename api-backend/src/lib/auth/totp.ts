/**
 * Time-based one-time passwords (RFC 6238 / RFC 4226) for the platform team's two-factor sign-in — the codes
 * an authenticator app (Google Authenticator, 1Password, Authy…) shows: HMAC-SHA1, 30-second steps, 6 digits,
 * one step of clock drift either way. A code's step is remembered so the same code can't be used twice.
 * Recovery codes: 10 one-time codes (xxxxx-xxxxx), stored only as SHA-256 hashes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not a base32 secret');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret (160 bits, as authenticator apps expect), base32. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

/** The code for one time step. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);
export const totp = (secretB32: string, ms: number = Date.now()): string => hotp(base32Decode(secretB32), stepAt(ms));

/**
 * The step a 6-digit code matches (now, or one step before / after), or null. A step at or before
 * `lastStep` is refused (that code — or an older one — was already used).
 */
export function verifyTotp(secretB32: string, code: string, ms: number = Date.now(), lastStep: number | null = null): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(ms);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(hotp(key, step));
    if (timingSafeEqual(want, Buffer.from(c))) return step;
  }
  return null;
}

/** otpauth://totp/<issuer>:<account>?secret=…&issuer=… — what an authenticator app scans or opens. */
export const otpauthUrl = (issuer: string, account: string, secretB32: string): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/** 10 one-time recovery codes like "k7m2p-x9q4w". */
export function generateRecoveryCodes(n = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = Array.from(b, (x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const hashRecoveryCode = (code: string): string => createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
export const looksLikeRecoveryCode = (code: string): boolean => /^[a-z0-9]{5}-[a-z0-9]{5}$/i.test(code.trim());
