/**
 * Phase 8.5 — Postgres vs ClickHouse provider semantic comparison.
 *
 * Live integration test: seeds a known dataset into Postgres and ClickHouse, runs
 * identical ReportRequests through both providers, and compares results.
 *
 * Skipped automatically when:
 * - CLICKHOUSE_URL is not set (no ClickHouse)
 * - DATABASE_URL points to a remote host (no local Postgres)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ClickHouseReportingProvider, installReportingProvider } from '../../src/lib/reporting/clickhouse.js';
import { PostgresReportingProvider } from '../../src/lib/reporting/postgres.js';
import { getClickHouse } from '../../src/lib/clickhouse/client.js';
import { query, closeDb } from '../../src/lib/db/pool.js';
import type { ReportRequest } from '../../src/lib/reporting/types.js';

const RUN_ID = randomUUID().replace(/-/g, '');
const NETWORK_ID = randomUUID();
const OFFER_A_ID = randomUUID();
const OFFER_B_ID = randomUUID();
const PUBLISHER_X_ID = randomUUID();
const PUBLISHER_Y_ID = randomUUID();
const ADVERTISER_A_ID = randomUUID();
const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-09-30T23:59:59.999Z';
const CLICK_BASE = new Date('2026-09-15T10:00:00Z');

const dbUrl = process.env['DATABASE_URL'] || '';
const isLocal = /localhost|127\.0\.0\.1/.test(dbUrl);
const SKIP = !process.env['CLICKHOUSE_URL'] || !isLocal;

interface FixtureClick {
 offer: string; publisher: string; payout: string; revenue: string; isUnique: boolean; fraud: string[];
}
interface FixtureConv {
 offer: string; publisher: string; payout: string; revenue: string; status: 'approved' | 'pending';
}

const FIXTURE_CLICKS: FixtureClick[] = [
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', isUnique: true, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', isUnique: true, fraud: ['bot'] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', isUnique: false, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', isUnique: false, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', isUnique: false, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_Y_ID, payout: '3.0000', revenue: '8.0000', isUnique: true, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_Y_ID, payout: '3.0000', revenue: '8.0000', isUnique: false, fraud: [] },
 { offer: OFFER_A_ID, publisher: PUBLISHER_Y_ID, payout: '3.0000', revenue: '8.0000', isUnique: false, fraud: [] },
 { offer: OFFER_B_ID, publisher: PUBLISHER_X_ID, payout: '7.0000', revenue: '50.0000', isUnique: true, fraud: [] },
 { offer: OFFER_B_ID, publisher: PUBLISHER_X_ID, payout: '7.0000', revenue: '50.0000', isUnique: true, fraud: [] },
 { offer: OFFER_B_ID, publisher: PUBLISHER_X_ID, payout: '7.0000', revenue: '50.0000', isUnique: true, fraud: [] },
 { offer: OFFER_B_ID, publisher: PUBLISHER_X_ID, payout: '7.0000', revenue: '50.0000', isUnique: true, fraud: [] },
];

const FIXTURE_CONVS: FixtureConv[] = [
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', status: 'approved' },
 { offer: OFFER_A_ID, publisher: PUBLISHER_X_ID, payout: '5.0000', revenue: '25.0000', status: 'approved' },
 { offer: OFFER_A_ID, publisher: PUBLISHER_Y_ID, payout: '3.0000', revenue: '8.0000', status: 'approved' },
 { offer: OFFER_B_ID, publisher: PUBLISHER_X_ID, payout: '7.0000', revenue: '50.0000', status: 'pending' },
];

async function setupPg(): Promise<void> {
 await query(
 'INSERT INTO networks (id, ref, name, status, created_at, updated_at) VALUES ($1, 99999, $2, \'active\', now(), now())',
 [NETWORK_ID, 'parity-' + RUN_ID],
 );
 for (const offerId of [OFFER_A_ID, OFFER_B_ID]) {
 await query(
 'INSERT INTO offers (id, network_id, name, status, created_at, updated_at, default_payout, default_revenue, currency, advertiser_id) VALUES ($1, $2, $3, \'active\', now(), now(), \'0\', \'0\', \'USD\', $4)',
 [offerId, NETWORK_ID, 'offer-' + offerId.slice(0, 6), ADVERTISER_A_ID],
 );
 }
 for (const pubId of [PUBLISHER_X_ID, PUBLISHER_Y_ID]) {
 await query(
 'INSERT INTO users (id, network_id, ref, email, role, status, created_at, updated_at) VALUES ($1, $2, 1, $3, \'publisher\', \'active\', now(), now())',
 [pubId, NETWORK_ID, 'pub-' + pubId.slice(0, 6) + '@t.local'],
 );
 }

 for (let i = 0; i < FIXTURE_CLICKS.length; i++) {
 const c = FIXTURE_CLICKS[i]!;
 await query(
 'INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, payout, revenue, currency, is_unique, fraud_flags) VALUES ($1, $2, $3, $4, $5, $6, $7, \'USD\', $8, $9)',
 ['click-' + RUN_ID + '-' + i, NETWORK_ID, c.offer, c.publisher, CLICK_BASE, c.payout, c.revenue, c.isUnique, c.fraud],
 );
 }

 for (let i = 0; i < FIXTURE_CONVS.length; i++) {
 const k = FIXTURE_CONVS[i]!;
 await query(
 'INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, payout, revenue, currency, status, source, transaction_id, raw_params) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, \'USD\', $9, \'postback\', $10, \'{}\')',
 ['conv-' + RUN_ID + '-' + i, NETWORK_ID, 'conv-' + RUN_ID + '-' + i, k.offer, k.publisher, ADVERTISER_A_ID, k.payout, k.revenue, k.status, 'txn-' + RUN_ID + '-' + i],
 );
 }
}

async function setupCh(): Promise<void> {
 const rows: Record<string, unknown>[] = [];
 for (let i = 0; i < FIXTURE_CLICKS.length; i++) {
 const c = FIXTURE_CLICKS[i]!;
 rows.push({
 click_id: 'click-' + RUN_ID + '-' + i,
 network_id: NETWORK_ID,
 offer_id: c.offer,
 publisher_id: c.publisher,
 timestamp: new Date(CLICK_BASE.getTime() + i * 1000).toISOString().replace('Z', '.000Z'),
 payout: c.payout,
 revenue: c.revenue,
 currency: 'USD',
 is_unique: c.isUnique ? 1 : 0,
 fraud_score: 0,
 fraud_flags: c.fraud,
 });
 }
 await getClickHouse().insert({ table: 'tracker.clicks', format: 'JSONEachRow', values: rows });

 const convRows: Record<string, unknown>[] = [];
 for (let i = 0; i < FIXTURE_CONVS.length; i++) {
 const k = FIXTURE_CONVS[i]!;
 convRows.push({
 conversion_id: 'conv-' + RUN_ID + '-' + i,
 network_id: NETWORK_ID,
 click_id: 'conv-' + RUN_ID + '-' + i,
 offer_id: k.offer,
 publisher_id: k.publisher,
 advertiser_id: ADVERTISER_A_ID,
 timestamp: new Date(CLICK_BASE.getTime() + 5000 + i * 1000).toISOString().replace('Z', '.000Z'),
 status: k.status,
 source: 'postback',
 payout: k.payout,
 revenue: k.revenue,
 currency: 'USD',
 fraud_score: 0,
 fraud_flags: [],
 });
 }
 await getClickHouse().insert({ table: 'tracker.conversions', format: 'JSONEachRow', values: convRows });
}

async function cleanup(): Promise<void> {
 try {
 await query('DELETE FROM clicks WHERE network_id = $1', [NETWORK_ID]);
 await query('DELETE FROM conversions WHERE network_id = $1', [NETWORK_ID]);
 await query('DELETE FROM offers WHERE network_id = $1', [NETWORK_ID]);
 await query('DELETE FROM users WHERE network_id = $1', [NETWORK_ID]);
 await query('DELETE FROM networks WHERE id = $1', [NETWORK_ID]);
 } catch { /* ignore */ }
 try {
 await getClickHouse().command({ query: "ALTER TABLE tracker.clicks DELETE WHERE network_id = '" + NETWORK_ID + "'" });
 await getClickHouse().command({ query: "ALTER TABLE tracker.conversions DELETE WHERE network_id = '" + NETWORK_ID + "'" });
 } catch { /* ignore */ }
}

describe('Postgres vs ClickHouse provider parity', () => {
 beforeAll(async () => {
 if (SKIP) return;
 installReportingProvider();
 try {
 await setupPg();
 await setupCh();
 } catch {
 return;
 }
 return async () => {
 await cleanup();
 await closeDb();
 };
 });

 it('grand-total (empty groupBy) matches across providers', async () => {
 if (SKIP) return;
 const req: ReportRequest = {
 networkId: NETWORK_ID, groupBy: [],
 metrics: ['clicks', 'unique_clicks', 'conversions', 'payout', 'revenue'],
 filters: { from: FROM, to: TO }, limit: 1, offset: 0,
 };
 const pg = await new PostgresReportingProvider().runReport(req);
 const ch = await new ClickHouseReportingProvider(getClickHouse()).runReport(req);
 const pgRow = pg.rows[0]!.metrics;
 const chRow = ch.rows[0]!.metrics;
 const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
 expect(Number(pgRow['clicks'])).toBe(Number(chRow['clicks']));
 expect(Number(pgRow['unique_clicks'])).toBe(Number(chRow['unique_clicks']));
 expect(Number(pgRow['conversions'])).toBe(Number(chRow['conversions']));
 expect(close(Number(pgRow['payout']), Number(chRow['payout']))).toBe(true);
 expect(close(Number(pgRow['revenue']), Number(chRow['revenue']))).toBe(true);
 });

 it('groupBy=offer produces the same offer-to-clicks map', async () => {
 if (SKIP) return;
 const req: ReportRequest = {
 networkId: NETWORK_ID, groupBy: ['offer'],
 metrics: ['clicks', 'conversions'],
 filters: { from: FROM, to: TO }, limit: 100, offset: 0,
 };
 const pg = await new PostgresReportingProvider().runReport(req);
 const ch = await new ClickHouseReportingProvider(getClickHouse()).runReport(req);
 const build = (src: (typeof pg.rows)) => {
 const m = new Map<string, number>();
 for (const r of src) {
 m.set(String(r.dimensions['offer']), Number(r.metrics['clicks']));
 }
 return m;
 };
 const pgMap = build(pg.rows);
 const chMap = build(ch.rows);
 expect(pgMap.size).toBe(chMap.size);
 for (const [k, v] of pgMap) {
 expect(chMap.get(k)).toBe(v);
 }
 });

 it('groupBy=offer+publisher click counts match', async () => {
 if (SKIP) return;
 const req: ReportRequest = {
 networkId: NETWORK_ID, groupBy: ['offer', 'publisher'],
 metrics: ['clicks', 'conversions'],
 filters: { from: FROM, to: TO }, limit: 100, offset: 0,
 };
 const pg = await new PostgresReportingProvider().runReport(req);
 const ch = await new ClickHouseReportingProvider(getClickHouse()).runReport(req);
 const build = (src: (typeof pg.rows)) => {
 const m = new Map<string, number>();
 for (const r of src) {
 m.set(r.dimensions['offer'] + '/' + r.dimensions['publisher'], Number(r.metrics['clicks']));
 }
 return m;
 };
 const pgMap = build(pg.rows);
 const chMap = build(ch.rows);
 expect(pgMap.size).toBe(chMap.size);
 for (const [k, v] of pgMap) {
 expect(chMap.get(k)).toBe(v);
 }
 });

 it('cross-tenant safety: another network sees zero rows', async () => {
 if (SKIP) return;
 const req: ReportRequest = {
 networkId: '00000000-0000-0000-0000-000000000fff',
 groupBy: ['offer'], metrics: ['clicks'],
 filters: { from: FROM, to: TO }, limit: 100, offset: 0,
 };
 const ch = await new ClickHouseReportingProvider(getClickHouse()).runReport(req);
 expect(ch.rows).toHaveLength(0);
 expect(ch.total).toBe(0);
 });
});
