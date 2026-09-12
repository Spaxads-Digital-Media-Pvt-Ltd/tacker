/**
 * test_geo production guard (A-5 finding) — pure function test.
 *
 * Verifies that `test_geo` (and `geo`) only force a country override in dev/test:
 * - production: always null (no override)
 * - dev/test: geo=XX takes priority, then test_geo=XX
 *
 * `resolveForcedGeo` is defined in tracking/geo-rules.ts and used in app.ts to enforce the
 * production boundary. Testing the pure function is sufficient — building the full Fastify
 * tracking app requires 15+ infra connections that can't be mocked in a unit test.
 */
import { describe, it, expect } from 'vitest';
import { resolveForcedGeo } from '../../src/surfaces/tracking/geo-rules.js';

describe('test_geo production guard (A-5)', () => {
 it('ignores test_geo in production mode', () => {
 expect(resolveForcedGeo('production', null, 'US')).toBeNull();
 });

 it('ignores geo=XX in production mode', () => {
 expect(resolveForcedGeo('production', 'DE', null)).toBeNull();
 });

 it('returns null for both params in production', () => {
 expect(resolveForcedGeo('production', null, null)).toBeNull();
 });

 it('forces country via test_geo in dev mode', () => {
 expect(resolveForcedGeo('development', null, 'US')).toBe('US');
 });

 it('geo=XX takes priority over test_geo in dev mode', () => {
 expect(resolveForcedGeo('development', 'GB', 'US')).toBe('GB');
 });

 it('lowercases are uppercased', () => {
 expect(resolveForcedGeo('development', null, 'us')).toBe('US');
 });

 it('truncates to 2 chars', () => {
 expect(resolveForcedGeo('development', null, 'USA')).toBe('US');
 });

 it('returns null for empty string input', () => {
 expect(resolveForcedGeo('development', '', '')).toBeNull();
 });

 it('returns null for whitespace-only input', () => {
 expect(resolveForcedGeo('development', null, ' ')).toBeNull();
 });
});
