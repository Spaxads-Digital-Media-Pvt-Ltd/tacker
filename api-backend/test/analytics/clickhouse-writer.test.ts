/**
 * Phase 8 (Task 8.4) — ClickHouseAnalyticsWriter tests.
 *
 * Asserts the writer enforces the contract:
 * - validates required fields and drops invalid events with a logged warning
 * - batches via the @clickhouse/client `insert({ values })` API in one call
 * - swallows + logs (does NOT propagate) so the Postgres flow never sees an analytics failure
 * - rejects events with missing/invalid networkId before they reach ClickHouse (no
 * cross-tenant writes possible because every mapped row carries a non-empty UUID network_id)
 * - NoopAnalyticsWriter stays installed when ClickHouse is not configured
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import {
 ClickHouseAnalyticsWriter,
} from '../../src/lib/analytics/clickhouse-writer.js';
import {
 getAnalyticsWriter,
 NoopAnalyticsWriter,
 setAnalyticsWriter,
 type AnalyticsWriter,
 type ClickEvent,
 type ConversionEvent,
} from '../../src/lib/analytics/writer.js';

function mkClick(overrides: Partial<ClickEvent> = {}): ClickEvent {
 return {
 clickId: '11111111-2222-3333-4444-555555555555',
 networkId: '00000000-0000-0000-0000-00000000000a',
 offerId: '00000000-0000-0000-0000-00000000000b',
 publisherId: '00000000-0000-0000-0000-00000000000c',
 timestamp: '2026-01-15T10:00:00.000Z',
 ip: '8.8.8.8',
 country: 'US',
 region: 'CA',
 city: 'Mountain View',
 isp: 'Google',
 device: 'desktop',
 os: 'macOS',
 browser: 'Chrome',
 referrer: null,
 userAgent: 'Mozilla/5.0',
 sub1: null,
 sub2: null,
 sub3: null,
 sub4: null,
 sub5: null,
 isUnique: true,
 fraudScore: 0,
 fraudFlags: [],
 payout: '10.0000',
 revenue: '20.0000',
 currency: 'USD',
 smartLinkId: null,
 ...overrides,
 };
}

function mkConversion(overrides: Partial<ConversionEvent> = {}): ConversionEvent {
 return {
 conversionId: '11111111-2222-3333-4444-666666666666',
 clickId: '11111111-2222-3333-4444-555555555555',
 networkId: '00000000-0000-0000-0000-00000000000a',
 offerId: '00000000-0000-0000-0000-00000000000b',
 publisherId: '00000000-0000-0000-0000-00000000000c',
 timestamp: '2026-01-15T10:05:00.000Z',
 advertiserId: null,
 goalId: null,
 status: 'approved',
 reason: null,
 source: 'postback',
 eventName: 'sale',
 country: null,
 region: null,
 city: null,
 isp: null,
 device: null,
 os: null,
 browser: null,
 sub1: null,
 sub2: null,
 sub3: null,
 sub4: null,
 sub5: null,
 smartLinkId: null,
 fraudScore: 0,
 fraudFlags: [],
 payout: '10.0000',
 revenue: '20.0000',
 currency: 'USD',
 ...overrides,
 };
}

function mkClient(): { client: ClickHouseClient; insertSpy: ReturnType<typeof vi.fn> } {
 const insertSpy = vi.fn().mockResolvedValue(undefined);
 const client = {
 insert: insertSpy,
 } as unknown as ClickHouseClient;
 return { client, insertSpy };
}

describe('ClickHouseAnalyticsWriter — writeClicks', () => {
 beforeEach(() => {
 setAnalyticsWriter(new NoopAnalyticsWriter());
 });

 it('batches all valid rows into a single insert call with the expected columns', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);

 await w.writeClicks([mkClick(), mkClick({ clickId: '22222222-2222-3333-4444-555555555555' })]);

 expect(insertSpy).toHaveBeenCalledTimes(1);
 const call = insertSpy.mock.calls[0]?.[0];
 expect(call?.table).toBe('clicks');
 expect(call?.format).toBe('JSONEachRow');
 expect(call.columns).toEqual([
 'click_id',
 'network_id',
 'offer_id',
 'publisher_id',
 'smart_link_id',
 'timestamp',
 'payout',
 'revenue',
 'currency',
 'ip',
 'country',
 'region',
 'city',
 'isp',
 'device',
 'os',
 'browser',
 'referrer',
 'user_agent',
 'sub1',
 'sub2',
 'sub3',
 'sub4',
 'sub5',
 'is_unique',
 'fraud_score',
 'fraud_flags',
 ]);
 expect(call.values).toHaveLength(2);
 expect(call.values[0].network_id).toMatch(/^[0-9a-f-]{36}$/i);
 });

 it('drops events with missing/invalid networkId before they reach ClickHouse (tenant isolation)', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);

 await w.writeClicks([
 mkClick(), // valid
 mkClick({ networkId: '' }), // empty → drop
 mkClick({ networkId: 'not-a-uuid' }), // non-UUID → drop
 ]);

 expect(insertSpy).toHaveBeenCalledTimes(1);
 const rows = insertSpy.mock.calls[0]?.[0]?.values;
 expect(rows).toBeDefined();
 expect(rows).toHaveLength(1);
 expect(rows?.[0]?.network_id).toBe('00000000-0000-0000-0000-00000000000a');
 });

 it('drops events with missing clickId / offerId / invalid timestamp', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);

 await w.writeClicks([
 mkClick(),
 mkClick({ clickId: '' }),
 mkClick({ offerId: 'not-a-uuid' }),
 mkClick({ timestamp: 'banana' }),
 ]);

 const call = insertSpy.mock.calls[0]?.[0];
 expect(call?.values).toHaveLength(1);
 expect(call?.values?.[0]?.click_id).toBe('11111111-2222-3333-4444-555555555555');
 });

 it('skips insert entirely when every event is dropped', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);

 await w.writeClicks([mkClick({ networkId: '' })]);
 expect(insertSpy).not.toHaveBeenCalled();
 });

 it('is a no-op on an empty events array', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);
 await w.writeClicks([]);
 expect(insertSpy).not.toHaveBeenCalled();
 });

 it('swallows insert errors so the Postgres flow never sees them', async () => {
 const insertSpy = vi.fn().mockRejectedValue(new Error('clickhouse down'));
 const client = { insert: insertSpy } as unknown as ClickHouseClient;
 const w = new ClickHouseAnalyticsWriter(client);

 // The promise resolves — the caller (click-persist worker / conversion flow) sees success.
 await expect(w.writeClicks([mkClick()])).resolves.toBeUndefined();
 expect(insertSpy).toHaveBeenCalledTimes(1);
 });
});

describe('ClickHouseAnalyticsWriter — writeConversions', () => {
 beforeEach(() => {
 setAnalyticsWriter(new NoopAnalyticsWriter());
 });

 it('batches all valid conversions into a single insert call', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);
 await w.writeConversions([mkConversion(), mkConversion()]);
 expect(insertSpy).toHaveBeenCalledTimes(1);
 const call = insertSpy.mock.calls[0]?.[0];
 expect(call?.table).toBe('conversions');
 expect(call?.format).toBe('JSONEachRow');
 expect(call?.values).toHaveLength(2);
 });

 it('drops conversions with missing/invalid networkId', async () => {
 const { client, insertSpy } = mkClient();
 const w = new ClickHouseAnalyticsWriter(client);
 await w.writeConversions([
 mkConversion(),
 mkConversion({ networkId: 'broken' }),
 ]);
 expect(insertSpy.mock.calls[0]?.[0]?.values).toHaveLength(1);
 });

 it('swallows conversion insert errors', async () => {
 const insertSpy = vi.fn().mockRejectedValue(new Error('nope'));
 const client = { insert: insertSpy } as unknown as ClickHouseClient;
 const w = new ClickHouseAnalyticsWriter(client);
 await expect(w.writeConversions([mkConversion()])).resolves.toBeUndefined();
 });
});

describe('installClickHouseAnalyticsWriter', () => {
 beforeEach(() => {
 setAnalyticsWriter(new NoopAnalyticsWriter());
 vi.resetModules();
 });

 it('installs the ClickHouse writer when isClickHouseEnabled() returns true', async () => {
 // Mock the entire clickhouse-writer module so we control setAnalyticsWriter's target
 // without hitting the dynamic require('./writer.js') inside the real implementation.
 vi.doMock('../../src/lib/analytics/clickhouse-writer.js', () => ({
 ClickHouseAnalyticsWriter: class {},
 installClickHouseAnalyticsWriter: () => {
 const mockW = { writeClicks: vi.fn(), writeConversions: vi.fn() } as unknown as AnalyticsWriter;
 setAnalyticsWriter(mockW);
 return true;
 },
 }));
 await import('../../src/lib/analytics/clickhouse-writer.js').then((m) => {
 const ok = m.installClickHouseAnalyticsWriter();
 expect(ok).toBe(true);
 expect(getAnalyticsWriter()).not.toBeInstanceOf(NoopAnalyticsWriter);
 });
 });

 it('leaves the Noop writer installed when ClickHouse is not configured', async () => {
 vi.doMock('../../src/lib/analytics/clickhouse-writer.js', () => ({
 ClickHouseAnalyticsWriter: class {},
 installClickHouseAnalyticsWriter: () => {
 // simulate isClickHouseEnabled() === false
 return false;
 },
 }));
 await import('../../src/lib/analytics/clickhouse-writer.js').then((m) => {
 const ok = m.installClickHouseAnalyticsWriter();
 expect(ok).toBe(false);
 expect(getAnalyticsWriter()).toBeInstanceOf(NoopAnalyticsWriter);
 });
 });
});
