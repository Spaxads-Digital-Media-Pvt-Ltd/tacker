import { describe, it, expect } from 'vitest';
import { mapPgClickToCh, mapPgConversionToCh, type PgClickRow, type PgConversionRow } from '../../src/lib/analytics/backfill-mapper';

describe('backfill mapper', () => {
 describe('mapPgClickToCh', () => {
 it('maps all fields from PG to CH click row', () => {
 const pg: PgClickRow = {
 click_id: 'ck-1',
 network_id: '11111111-1111-1111-1111-111111111111',
 offer_id: '22222222-2222-2222-2222-222222222222',
 publisher_id: '33333333-3333-3333-3333-333333333333',
 smart_link_id: null,
 created_at: '2026-01-01T00:00:00.000Z',
 ip: '192.168.1.1',
 country: 'US',
 region: 'CA',
 city: 'SF',
 isp: 'ISP',
 device: 'mobile',
 os: 'iOS',
 browser: 'Safari',
 referrer: 'https://example.com',
 user_agent: 'Mozilla/5.0',
 sub1: 'a',
 sub2: 'b',
 sub3: 'c',
 sub4: 'd',
 sub5: 'e',
 is_unique: true,
 fraud_score: 42,
 fraud_flags: ['bot'],
 resolved_payout: '10.50',
 resolved_revenue: '20.75',
 currency: 'USD',
 };

 const ch = mapPgClickToCh(pg);
 expect(ch.click_id).toBe('ck-1');
 expect(ch.network_id).toBe(pg.network_id);
 expect(ch.timestamp).toBe('2026-01-01T00:00:00.000Z');
 expect(ch.ip).toBe('192.168.1.1');
 expect(ch.is_unique).toBe(1);
 expect(ch.fraud_score).toBe(42);
 expect(ch.fraud_flags).toEqual(['bot']);
 expect(ch.payout).toBe('10.50');
 expect(ch.revenue).toBe('20.75');
 expect(ch.currency).toBe('USD');
 });

 it('handles null fields', () => {
 const pg: PgClickRow = {
 click_id: 'ck-2',
 network_id: 'n1',
 offer_id: 'o1',
 publisher_id: null,
 smart_link_id: null,
 created_at: '2026-01-01T00:00:00.000Z',
 ip: null,
 country: null,
 region: null,
 city: null,
 isp: null,
 device: null,
 os: null,
 browser: null,
 referrer: null,
 user_agent: null,
 sub1: null,
 sub2: null,
 sub3: null,
 sub4: null,
 sub5: null,
 is_unique: null,
 fraud_score: 0,
 fraud_flags: null,
 resolved_payout: null,
 resolved_revenue: null,
 currency: null,
 };
 const ch = mapPgClickToCh(pg);
 expect(ch.publisher_id).toBeNull();
 expect(ch.ip).toBeNull();
 expect(ch.is_unique).toBeNull();
 expect(ch.fraud_flags).toEqual([]);
 });

 it('clamps fraud_score to UInt16 range', () => {
 const pg: PgClickRow = {
 click_id: 'ck',
 network_id: 'n',
 offer_id: 'o',
 publisher_id: null,
 smart_link_id: null,
 created_at: '2026-01-01',
 ip: null,
 country: null, region: null, city: null, isp: null,
 device: null, os: null, browser: null,
 referrer: null, user_agent: null,
 sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
 is_unique: false,
 fraud_score: 100000,
 fraud_flags: [],
 resolved_payout: null, resolved_revenue: null, currency: null,
 };
 expect(mapPgClickToCh(pg).fraud_score).toBe;

 pg.fraud_score = -5;
 expect(mapPgClickToCh(pg).fraud_score).toBe(0);
 });

 it('preserves IPv6 addresses', () => {
 const pg: PgClickRow = {
 click_id: 'ck',
 network_id: 'n',
 offer_id: 'o',
 publisher_id: null,
 smart_link_id: null,
 created_at: '2026-01-01',
 ip: '2001:db8::1',
 country: null, region: null, city: null, isp: null,
 device: null, os: null, browser: null,
 referrer: null, user_agent: null,
 sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
 is_unique: false,
 fraud_score: 0,
 fraud_flags: [],
 resolved_payout: null, resolved_revenue: null, currency: null,
 };
 expect(mapPgClickToCh(pg).ip).toBe('2001:db8::1');
 });

 it('converts false to 0 and true to 1', () => {
 const pg: PgClickRow = {
 click_id: 'ck',
 network_id: 'n',
 offer_id: 'o',
 publisher_id: null,
 smart_link_id: null,
 created_at: '2026-01-01',
 ip: null,
 country: null, region: null, city: null, isp: null,
 device: null, os: null, browser: null,
 referrer: null, user_agent: null,
 sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
 is_unique: false,
 fraud_score: 0,
 fraud_flags: [],
 resolved_payout: null, resolved_revenue: null, currency: null,
 };
 expect(mapPgClickToCh(pg).is_unique).toBe(0);

 pg.is_unique = true;
 expect(mapPgClickToCh(pg).is_unique).toBe(1);
 });
 });

 describe('mapPgConversionToCh', () => {
 it('maps all fields from PG to CH conversion row', () => {
 const pg: PgConversionRow = {
 conversion_id: 'cv-1',
 network_id: '11111111-1111-1111-1111-111111111111',
 click_id: 'ck-1',
 offer_id: '22222222-2222-2222-2222-222222222222',
 publisher_id: '33333333-3333-3333-3333-333333333333',
 advertiser_id: '44444444-4444-4444-4444-444444444444',
 goal_id: '55555555-5555-5555-5555-555555555555',
 created_at: '2026-01-01T00:00:00.000Z',
 status: 'approved',
 reason: null,
 source: 'postback',
 event_name: 'purchase',
 payout: '10.00',
 revenue: '20.00',
 currency: 'USD',
 country: 'US',
 region: 'CA',
 city: 'SF',
 isp: 'ISP',
 device: 'desktop',
 os: 'Linux',
 browser: 'Firefox',
 sub1: 'a', sub2: 'b', sub3: 'c', sub4: 'd', sub5: 'e',
 fraud_score: 10,
 fraud_flags: ['vpn'],
 };
 const ch = mapPgConversionToCh(pg);
 expect(ch.conversion_id).toBe('cv-1');
 expect(ch.click_id).toBe('ck-1');
 expect(ch.timestamp).toBe('2026-01-01T00:00:00.000Z');
 expect(ch.status).toBe('approved');
 expect(ch.payout).toBe('10.00');
 expect(ch.revenue).toBe('20.00');
 expect(ch.fraud_flags).toEqual(['vpn']);
 });

 it('handles nulls', () => {
 const pg: PgConversionRow = {
 conversion_id: 'cv-1',
 network_id: 'n',
 click_id: 'ck',
 offer_id: 'o',
 publisher_id: null,
 advertiser_id: null,
 goal_id: null,
 created_at: '2026-01-01',
 status: 'pending',
 reason: null,
 source: null,
 event_name: null,
 payout: null,
 revenue: null,
 currency: null,
 country: null, region: null, city: null, isp: null,
 device: null, os: null, browser: null,
 sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
 fraud_score: 0,
 fraud_flags: null,
 };
 const ch = mapPgConversionToCh(pg);
 expect(ch.fraud_flags).toEqual([]);
 expect(ch.payout).toBeNull();
 });

 it('clamps fraud_score', () => {
 const pg: PgConversionRow = {
 conversion_id: 'cv', network_id: 'n', click_id: 'ck', offer_id: 'o',
 publisher_id: null, advertiser_id: null, goal_id: null,
 created_at: '2026-01-01',
 status: 'pending', reason: null, source: null, event_name: null,
 payout: null, revenue: null, currency: null,
 country: null, region: null, city: null, isp: null,
 device: null, os: null, browser: null,
 sub1: null, sub2: null, sub3: null, sub4: null, sub5: null,
 fraud_score: 999999,
 fraud_flags: [],
 };
 expect(mapPgConversionToCh(pg).fraud_score).toBe;
 });
 });
});
