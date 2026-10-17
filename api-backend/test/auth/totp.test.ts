/** TOTP (lib/auth/totp.ts) against RFC 6238's SHA-1 test vectors, base32, replay, drift, recovery codes. */
import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, hotp, totp, verifyTotp, stepAt, generateSecret, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode, otpauthUrl } from '../../src/lib/auth/totp.js';

// RFC 6238 Appendix B: the ASCII secret "12345678901234567890", 8 digits.
const RFC_SECRET = Buffer.from('12345678901234567890');
const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];

describe('TOTP', () => {
  it('matches the RFC 6238 vectors (SHA-1, 8 digits)', () => {
    for (const [t, code] of vectors) expect(hotp(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
  });
  it('base32 round-trips', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').equals(RFC_SECRET)).toBe(true);
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('verifies now and one step of drift; refuses replays and wrong codes', () => {
    const s = generateSecret();
    const now = Date.UTC(2026, 9, 17, 12, 0, 10);
    const step = stepAt(now);
    expect(verifyTotp(s, totp(s, now), now)).toBe(step);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
    expect(verifyTotp(s, totp(s, now), now, step)).toBeNull(); // already used
    expect(verifyTotp(s, '12345', now)).toBeNull();
    expect(verifyTotp(s, totp(s, now).replace(/^./, (c) => String((Number(c) + 1) % 10)), now)).toBeNull();
  });
  it('recovery codes and the otpauth link', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(looksLikeRecoveryCode(c)).toBe(true);
    expect(hashRecoveryCode(` ${codes[0]!.toUpperCase()} `)).toBe(hashRecoveryCode(codes[0]!));
    expect(otpauthUrl('Tracker', 'a@b.c', 'ABC')).toBe('otpauth://totp/Tracker%3Aa%40b.c?secret=ABC&issuer=Tracker&algorithm=SHA1&digits=6&period=30');
  });
});
