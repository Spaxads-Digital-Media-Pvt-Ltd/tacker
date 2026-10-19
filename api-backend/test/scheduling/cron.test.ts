/**
 * The 5-field cron behind scheduled reports (audit F-24): parsing (with errors that say what's
 * wrong) and the next run time in a time zone — including across DST changes.
 */
import { describe, it, expect } from 'vitest';
import { parseCron, nextCronTime } from '../../src/lib/scheduling/cron.js';

const at = (iso: string) => new Date(iso);
const next = (expr: string, after: string, tz?: string) => nextCronTime(expr, at(after), tz)?.toISOString() ?? null;

describe('parseCron', () => {
  it('reads numbers, ranges, lists, steps and month / weekday names', () => {
    const c = parseCron('*/15 8-10 1,15 JAN-MAR mon-fri');
    expect([...c.minutes]).toEqual([0, 15, 30, 45]);
    expect([...c.hours]).toEqual([8, 9, 10]);
    expect([...c.days]).toEqual([1, 15]);
    expect([...c.months]).toEqual([1, 2, 3]);
    expect([...c.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([c.domAny, c.dowAny]).toEqual([false, false]);
    expect([...parseCron('0 0 * * *').hours]).toEqual([0]);
    expect([...parseCron('5/20 * * * *').minutes]).toEqual([5, 25, 45]); // a start + step runs to the end
  });

  it('day-of-week 7 is Sunday, like 0', () => {
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
    expect([...parseCron('0 0 * * 5-7').weekdays].sort()).toEqual([0, 5, 6]);
  });

  it.each([
    ['0 8 * *', /5 fields/],
    ['0 8 * * * *', /5 fields/],
    ['60 8 * * *', /minute: "60" is out of range 0-59/],
    ['0 24 * * *', /hour: "24" is out of range/],
    ['0 8 0 * *', /day-of-month: "0" is out of range 1-31/],
    ['0 8 * 13 *', /month: "13" is out of range/],
    ['0 8 * * 8', /day-of-week: "8" is out of range/],
    ['0 8 * * FUNDAY', /day-of-week: "FUNDAY"/],
    ['*/0 8 * * *', /minute: bad step/],
    ['0 10-8 * * *', /hour: "10-8" runs backwards/],
    ['', /5 fields/],
  ])('%j is refused (%s)', (expr, msg) => {
    expect(() => parseCron(expr)).toThrow(msg);
  });
});

describe('nextCronTime', () => {
  it('is strictly after `after`, in UTC by default', () => {
    expect(next('0 8 * * *', '2026-10-14T07:59:00Z')).toBe('2026-10-14T08:00:00.000Z');
    expect(next('0 8 * * *', '2026-10-14T08:00:00Z')).toBe('2026-10-15T08:00:00.000Z'); // not the same minute again
    expect(next('*/15 * * * *', '2026-10-14T10:07:30Z')).toBe('2026-10-14T10:15:00.000Z');
    expect(next('0 8 * * 1', '2026-10-14T12:00:00Z')).toBe('2026-10-19T08:00:00.000Z'); // Wed → next Monday
    expect(next('0 6 1 * *', '2026-12-15T00:00:00Z')).toBe('2027-01-01T06:00:00.000Z'); // over the year end
  });

  it('runs in the given time zone (08:00 Kolkata is 02:30 UTC)', () => {
    expect(next('0 8 * * *', '2026-10-14T02:00:00Z', 'Asia/Kolkata')).toBe('2026-10-14T02:30:00.000Z');
    expect(next('0 8 * * *', '2026-10-14T03:00:00Z', 'Asia/Kolkata')).toBe('2026-10-15T02:30:00.000Z');
    // Monday 00:30 in Kolkata is still Sunday in UTC — the weekday is the zone's.
    expect(next('30 0 * * MON', '2026-10-14T00:00:00Z', 'Asia/Kolkata')).toBe('2026-10-18T19:00:00.000Z');
  });

  it('follows DST: the same local time maps to a different UTC hour after the change', () => {
    // New York leaves DST on Sun 2026-11-01: 08:00 EDT is 12:00 UTC, 08:00 EST is 13:00 UTC.
    expect(next('0 8 * * *', '2026-10-31T13:00:00Z', 'America/New_York')).toBe('2026-11-01T13:00:00.000Z');
    expect(next('0 8 * * *', '2026-10-30T13:00:00Z', 'America/New_York')).toBe('2026-10-31T12:00:00.000Z');
    // 01:30 happens twice that night — it runs once, at the first one (EDT).
    expect(next('30 1 * * *', '2026-11-01T00:00:00Z', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    expect(next('30 1 * * *', '2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-02T06:30:00.000Z');
    // 02:30 doesn't exist on spring-forward day (2026-03-08) — that day is skipped.
    expect(next('30 2 * * *', '2026-03-07T12:00:00Z', 'America/New_York')).toBe('2026-03-09T06:30:00.000Z');
  });

  it('day-of-month and day-of-week both restricted → either one matches (classic cron)', () => {
    // From Wed 2026-10-14: Friday the 16th comes before the 20th.
    expect(next('0 0 20 * FRI', '2026-10-14T12:00:00Z')).toBe('2026-10-16T00:00:00.000Z');
    expect(next('0 0 20 * FRI', '2026-10-17T00:00:00Z')).toBe('2026-10-20T00:00:00.000Z');
    // Only the day-of-month restricted → only that day.
    expect(next('0 0 20 * *', '2026-10-14T12:00:00Z')).toBe('2026-10-20T00:00:00.000Z');
  });

  it('a date that never comes (31 February) → null; a leap day waits for the leap year', () => {
    expect(next('0 0 31 2 *', '2026-10-14T00:00:00Z')).toBeNull();
    expect(next('0 0 30 2 *', '2026-10-14T00:00:00Z')).toBeNull();
    expect(next('0 0 29 2 *', '2026-10-14T00:00:00Z')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('accepts a parsed spec as well as the expression', () => {
    const spec = parseCron('0 9 * * *');
    expect(nextCronTime(spec, at('2026-10-14T10:00:00Z'))?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
  });
});
