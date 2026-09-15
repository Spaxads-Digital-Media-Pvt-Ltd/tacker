import { describe, it, expect, vi, beforeEach } from 'vitest';
import { timingSafeCompare } from '../../src/lib/secure-code-compare.js';

describe('timingSafeCompare (T-1)', () => {
 beforeEach(() => {
 vi.resetModules();
 });

 it('accepts a correct secureCode', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare('AbCdEfGhIjKl', ref);
 expect(result.ok).toBe(true);
 expect(result.refLen).toBe(12);
 });

 it('rejects an incorrect secureCode', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare('XbCdEfGhIjKl', ref);
 expect(result.ok).toBe(false);
 });

 it('rejects missing secureCode (undefined)', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare(undefined, ref);
 expect(result.ok).toBe(false);
 });

 it('rejects null secureCode', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare(null, ref);
 expect(result.ok).toBe(false);
 });

 it('rejects empty secureCode', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare('', ref);
 expect(result.ok).toBe(false);
 });

 it('rejects different-length secureCode without throwing', () => {
 const ref = 'AbCdEfGhIjKl';
 expect(() => timingSafeCompare('short', ref)).not.toThrow();
 const result = timingSafeCompare('short', ref);
 expect(result.ok).toBe(false);
 });

 it('rejects a longer secureCode without throwing', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare('AbCdEfGhIjKlExtra', ref);
 expect(result.ok).toBe(false);
 });

 it('rejects number input', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare(12345 as any, ref);
 expect(result.ok).toBe(false);
 });

 it('rejects boolean input', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare(true as any, ref);
 expect(result.ok).toBe(false);
 });

 it('rejects object input', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare({ code: 'AbCdEfGhIjKl' } as any, ref);
 expect(result.ok).toBe(false);
 });

 it('rejects very short reference (< MIN_LEN)', () => {
 const result = timingSafeCompare('ab', 'ab');
 expect(result.ok).toBe(false);
 });

 it('handles single-character mismatch correctly', () => {
 const ref = 'AbCdEfGhIjKl';
 const result = timingSafeCompare('AbCdEfGhIJkl', ref);
 expect(result.ok).toBe(false);
 });

 it('reveals no partial-match info via response behavior', () => {
 const ref = 'AbCdEfGhIjKl';
 const missing = timingSafeCompare(undefined, ref);
 const partial = timingSafeCompare('XbCdEfGhIjKl', ref);
 const empty = timingSafeCompare('', ref);
 // All failures must return ok: false — no partial-match info exposed
 expect(missing.ok).toBe(false);
 expect(partial.ok).toBe(false);
 expect(empty.ok).toBe(false);
 // The result is structurally identical regardless of the failure reason
 expect(missing).toEqual({ ok: false, refLen: 12 });
 expect(partial).toEqual({ ok: false, refLen: 12 });
 expect(empty).toEqual({ ok: false, refLen: 12 });
 });
});
