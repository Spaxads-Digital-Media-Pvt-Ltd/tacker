// Customer Value › Conversion Events (lib/conversionEvents.ts) — the real row / export / paging code,
// the real CSV writer (lib/export toCsv) and the same xlsx call the Excel export makes.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import * as XLSX from 'xlsx';
import { eventExportRow, formatEventTime, loadAllEvents, EVENTS_PAGE_SIZE, type ConversionEvent } from '../conversionEvents.ts';
import { conversionMoney } from '../conversionReport.ts';
import { toCsv } from '../export.ts';

const ev = (over: Partial<ConversionEvent> = {}): ConversionEvent => ({
  conversionId: 'c1', createdAt: '2026-05-03T10:04:05.000Z', offerId: 'o1', offerName: 'Offer A', eventName: 'sale',
  status: 'approved', payout: '1.2345', revenue: '3.0050', currency: 'USD',
  dataPoints: [{ name: 'Deposit', parameterKey: 'deposit', value: '150' }], ruleName: 'VIP', ...over,
});

describe('table money — the conversion\'s own currency, never an assumed "$"', () => {
  it('USD / EUR / GBP use their own symbol (display rounds to 2 places; exports keep the exact text)', () => {
    assert.strictEqual(conversionMoney('1.2345', 'USD').text, '$1.23');
    assert.strictEqual(conversionMoney('0.0015', 'EUR').text, '€0.00');
    assert.strictEqual(conversionMoney('7.0000', 'GBP').text, '£7.00');
  });
  it('no currency recorded → a plain amount with a note (was "$7.00")', () => {
    const m = conversionMoney('7.0000', null);
    assert.strictEqual(m.text, '7.00');
    assert.match(m.title ?? '', /No currency/);
  });
  it('no amount → "—"', () => {
    assert.strictEqual(conversionMoney(null, 'USD').text, '—');
  });
});

describe('export row', () => {
  it('keeps the existing column order and adds currency last', () => {
    assert.deepStrictEqual(Object.keys(eventExportRow(ev())),
      ['conversionId', 'created', 'offer', 'event', 'status', 'payout', 'revenue', 'dataPoints', 'ruleApplied', 'currency']);
  });
  it('exact API money text and the conversion\'s currency (was "$1.23" / "$0.00")', () => {
    const r = eventExportRow(ev({ payout: '0.0005', revenue: '0.0015', currency: 'EUR' }));
    assert.deepStrictEqual({ payout: r.payout, revenue: r.revenue, currency: r.currency }, { payout: '0.0005', revenue: '0.0015', currency: 'EUR' });
  });
  it('missing amount / currency / event / rule → "—"', () => {
    const r = eventExportRow(ev({ payout: null, revenue: null, currency: null, eventName: null, ruleName: null }));
    assert.deepStrictEqual({ payout: r.payout, revenue: r.revenue, currency: r.currency, event: r.event, ruleApplied: r.ruleApplied }, { payout: '—', revenue: '—', currency: '—', event: '—', ruleApplied: '—' });
    assert.strictEqual(eventExportRow(ev({ currency: undefined })).currency, '—'); // an older API without the field
  });
  it('created as UTC "MM/DD/YYYY HH:MM:SS"', () => {
    assert.strictEqual(formatEventTime('2026-05-03T10:04:05.000Z'), '05/03/2026 10:04:05');
    assert.strictEqual(eventExportRow(ev()).created, '05/03/2026 10:04:05');
  });
});

describe('CSV and Excel output', () => {
  const rows = [
    eventExportRow(ev()),
    eventExportRow(ev({ conversionId: 'c2', payout: '0.0005', revenue: '0.0015', currency: 'EUR', dataPoints: [{ name: 'Note', parameterKey: 'note', value: 'a, "b"' }] })),
    eventExportRow(ev({ conversionId: 'c3', payout: '7.0000', revenue: null, currency: null })),
  ];
  it('CSV: header with currency last, exact amounts, quotes/commas escaped', () => {
    const csv = toCsv(rows);
    // Drop a leading byte-order mark if the writer adds one (compared by char code).
    const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).trim().split(/\r?\n/);
    assert.strictEqual(lines[0], 'conversionId,created,offer,event,status,payout,revenue,dataPoints,ruleApplied,currency');
    assert.strictEqual(lines[1], 'c1,05/03/2026 10:04:05,Offer A,sale,approved,1.2345,3.0050,Deposit=150,VIP,USD');
    assert.strictEqual(lines[2], 'c2,05/03/2026 10:04:05,Offer A,sale,approved,0.0005,0.0015,"Note=a, ""b""",VIP,EUR');
    assert.strictEqual(lines[3], 'c3,05/03/2026 10:04:05,Offer A,sale,approved,7.0000,—,Deposit=150,VIP,—');
  });
  it('Excel: the same columns, and money cells keep the exact text (not a re-rounded number)', () => {
    const ws = XLSX.utils.json_to_sheet(rows); // what lib/export downloadXlsx does
    const back = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true });
    assert.deepStrictEqual(Object.keys(back[0]!), Object.keys(rows[0]!));
    assert.deepStrictEqual(back.map((r) => [r['payout'], r['revenue'], r['currency']]),
      [['1.2345', '3.0050', 'USD'], ['0.0005', '0.0015', 'EUR'], ['7.0000', '—', '—']]);
    assert.strictEqual(ws['F3']?.t, 's'); // payout of row 2 is stored as text "0.0005"
  });
});

describe('loadAllEvents — every page, or nothing', () => {
  const fake = (n: number, failAtOffset?: number) => {
    const all = Array.from({ length: n }, (_, i) => ev({ conversionId: `c${i}` }));
    const calls: [number, number][] = [];
    const get = async (limit: number, offset: number) => {
      calls.push([limit, offset]);
      if (offset === failAtOffset) throw new Error('Request failed with status 500');
      return all.slice(offset, offset + limit);
    };
    return { all, calls, get };
  };
  it(`pages ${EVENTS_PAGE_SIZE} at a time until a short page, in API order`, async () => {
    const f = fake(1120);
    const r = await loadAllEvents(f.get, 10_000);
    assert.strictEqual(r.rows.length, 1120);
    assert.deepStrictEqual(r.rows.map((e) => e.conversionId), f.all.map((e) => e.conversionId));
    assert.deepStrictEqual(f.calls, [[500, 0], [500, 500], [500, 1000]]);
    assert.strictEqual(r.capped, false);
  });
  it('one page of results → one request', async () => {
    const f = fake(26);
    assert.strictEqual((await loadAllEvents(f.get, 10_000)).rows.length, 26);
    assert.strictEqual(f.calls.length, 1);
  });
  it('a later page failing rejects — no partial export', async () => {
    const f = fake(1120, 500);
    await assert.rejects(loadAllEvents(f.get, 10_000), /500/);
  });
  it('more than the cap → stops at the cap and reports it', async () => {
    const f = fake(1200);
    const r = await loadAllEvents(f.get, 1000);
    assert.strictEqual(r.rows.length, 1000);
    assert.strictEqual(r.capped, true);
  });
  it('no events → empty, not capped', async () => {
    assert.deepStrictEqual(await loadAllEvents(fake(0).get, 10_000), { rows: [], capped: false });
  });
});
