/**
 * Customer Value rule dates and recurring windows (lib/customer-value/evaluate.ts) — pure, no DB.
 * The End Date used to be built from the Date node-pg returns for a `date` column, giving an
 * Invalid Date that never expired a rule; recurring windows used the server's local time.
 */
import { describe, it, expect } from 'vitest';
import { toYmd, ruleDateBounds, periodStartUtc } from '../../src/lib/customer-value/evaluate.js';

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('toYmd — a `date` column back to its calendar day', () => {
  it('a Date as node-pg builds it (local midnight of the day) keeps that day in any process timezone', () => {
    // node-pg's date parser: new Date(year, monthIndex, day) — LOCAL midnight.
    expect(toYmd(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(toYmd(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
  it('a YYYY-MM-DD string (or a longer ISO string) keeps its first 10 characters', () => {
    expect(toYmd('2026-12-31')).toBe('2026-12-31');
    expect(toYmd('2026-12-31T00:00:00.000Z')).toBe('2026-12-31');
  });
  it('null, empty, invalid → null', () => {
    expect(toYmd(null)).toBeNull();
    expect(toYmd(undefined)).toBeNull();
    expect(toYmd('')).toBeNull();
    expect(toYmd('not a date')).toBeNull();
    expect(toYmd(new Date(Number.NaN))).toBeNull();
  });
});

describe('ruleDateBounds — UTC days, End Date inclusive', () => {
  it('Start Date from 00:00:00.000 UTC, End Date through 23:59:59.999 UTC', () => {
    const b = ruleDateBounds('2026-03-01', '2026-03-31');
    expect(iso(b.start)).toBe('2026-03-01T00:00:00.000Z');
    expect(iso(b.end)).toBe('2026-03-31T23:59:59.999Z');
  });
  it('the same bounds from node-pg Date values (the C1 bug: this used to be an Invalid Date)', () => {
    const b = ruleDateBounds(new Date(2026, 2, 1), new Date(2026, 2, 31));
    expect(iso(b.start)).toBe('2026-03-01T00:00:00.000Z');
    expect(iso(b.end)).toBe('2026-03-31T23:59:59.999Z');
    expect(Number.isNaN(b.end!.getTime())).toBe(false);
  });
  it('no dates → no limits', () => {
    expect(ruleDateBounds(null, null)).toEqual({ start: null, end: null });
  });
  it('boundaries: last millisecond of the End Date is inside, the next is outside', () => {
    const { start, end } = ruleDateBounds('2026-03-01', '2026-03-31');
    expect(at('2026-02-28T23:59:59.999Z') < start!).toBe(true);
    expect(at('2026-03-01T00:00:00.000Z') < start!).toBe(false);
    expect(at('2026-03-31T23:59:59.999Z') > end!).toBe(false);
    expect(at('2026-04-01T00:00:00.000Z') > end!).toBe(true);
  });
});

describe('periodStartUtc — recurring windows in UTC', () => {
  it('daily: 00:00 UTC of the same UTC day, either side of midnight', () => {
    expect(periodStartUtc('daily', at('2026-03-09T23:59:59.999Z')).toISOString()).toBe('2026-03-09T00:00:00.000Z');
    expect(periodStartUtc('daily', at('2026-03-10T00:00:00.000Z')).toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
  it('weekly: Monday 00:00 UTC — a Sunday belongs to the week that started the previous Monday', () => {
    expect(periodStartUtc('weekly', at('2026-03-08T23:59:59.999Z')).toISOString()).toBe('2026-03-02T00:00:00.000Z'); // Sunday
    expect(periodStartUtc('weekly', at('2026-03-09T00:00:00.000Z')).toISOString()).toBe('2026-03-09T00:00:00.000Z'); // Monday
    expect(periodStartUtc('weekly', at('2026-03-11T12:00:00.000Z')).toISOString()).toBe('2026-03-09T00:00:00.000Z'); // Wednesday
  });
  it('weekly across a month / year boundary', () => {
    expect(periodStartUtc('weekly', at('2027-01-01T08:00:00.000Z')).toISOString()).toBe('2026-12-28T00:00:00.000Z'); // Friday
  });
  it('monthly: day 1, either side of a month end', () => {
    expect(periodStartUtc('monthly', at('2026-03-31T23:59:59.999Z')).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(periodStartUtc('monthly', at('2026-04-01T00:00:00.000Z')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
  it('quarterly: 1 Jan / Apr / Jul / Oct, either side of a quarter boundary', () => {
    expect(periodStartUtc('quarterly', at('2026-06-30T23:59:59.999Z')).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(periodStartUtc('quarterly', at('2026-07-01T00:00:00.000Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(periodStartUtc('quarterly', at('2026-12-31T23:00:00.000Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(periodStartUtc('quarterly', at('2027-01-01T00:00:00.000Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('unknown period → all time', () => {
    expect(periodStartUtc('yearly', at('2026-03-09T12:00:00Z')).getTime()).toBe(0);
  });
});
