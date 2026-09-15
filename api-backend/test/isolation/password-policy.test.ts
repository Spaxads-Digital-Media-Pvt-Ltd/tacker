/**
 * Password policy unit tests (A-3 finding) — no DB or external services needed.
 */
import { describe, it, expect } from 'vitest';
import { passwordSchema, PASSWORD_MIN, PASSWORD_MAX } from '../../src/lib/auth/password-policy.js';

describe('Password policy (A-3)', () => {
 it(`rejects passwords shorter than ${PASSWORD_MIN} characters`, () => {
 const result = passwordSchema.safeParse('Short1!');
 expect(result.success).toBe(false);
 if (!result.success) expect(result.error.issues[0]?.message).toContain(`at least ${PASSWORD_MIN} characters`);
 });

 it(`rejects passwords longer than ${PASSWORD_MAX} characters`, () => {
 const long = 'a'.repeat(PASSWORD_MAX + 1);
 const result = passwordSchema.safeParse(long);
 expect(result.success).toBe(false);
 if (!result.success) expect(result.error.issues[0]?.message).toContain(`at most ${PASSWORD_MAX} characters`);
 });

 it('rejects whitespace-only passwords', () => {
 expect(passwordSchema.safeParse(' ').success).toBe(false);
 expect(passwordSchema.safeParse(' \t\n').success).toBe(false);
 });

 it('rejects empty string', () => {
 expect(passwordSchema.safeParse('').success).toBe(false);
 });

 it('accepts a password at exactly the minimum length', () => {
 expect(passwordSchema.safeParse('A'.repeat(PASSWORD_MIN)).success).toBe(true);
 });

 it('accepts a password at exactly the maximum length', () => {
 expect(passwordSchema.safeParse('A'.repeat(PASSWORD_MAX)).success).toBe(true);
 });

 it('does not trim or transform the value', () => {
 const pw = ' passwordWithLeadingSpace1';
 const result = passwordSchema.safeParse(pw);
 expect(result.success).toBe(true);
 if (result.success) expect(result.data).toBe(pw);
 });

 it('accepts a typical strong password', () => {
 expect(passwordSchema.safeParse('CorrectHorseBatteryStaple42').success).toBe(true);
 });
});
