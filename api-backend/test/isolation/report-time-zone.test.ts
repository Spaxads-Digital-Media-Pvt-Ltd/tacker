/**
 * Report time zones and rollup eligibility (audit F-20) — no DB.
 *  - A bucket instant is written as local wall time with its offset; a plain date is that zone's local
 *    day (DST and :30 / :45 offsets included).
 *  - buildReportRequest: `tz` turns a plain-date from/to into the zone's day and sets timeZone; UTC
 *    (or no tz) leaves the request exactly as before; an unknown zone is refused.
 *  - Which reports the rollups can answer.
 */
import { describe, it, expect } from 'vitest';
import { formatInZone, zonedDayStart, inclusiveBefore, localDate, addDays, isValidTimeZone } from '../../src/lib/reporting/time-zone.js';
import { buildReportRequest, reportQuerySchema } from '../../src/lib/reporting/request.js';
import { rollupEligible } from '../../src/lib/reporting/postgres.js';
import type { ReportRequest } from '../../src/lib/reporting/types.js';

const NET = '00000000-0000-4000-8000-0000000000aa';
const parse = (q: Record<string, string>) => reportQuerySchema.parse(q);

describe('time-zone helpers', () => {
  it('formats an instant as local wall time + offset (half- and quarter-hour zones, DST)', () => {
    const t = new Date('2026-10-12T18:30:00.000Z');
    expect(formatInZone(t, 'Asia/Kolkata')).toBe('2026-10-13T00:00:00+05:30');
    expect(formatInZone(t, 'Asia/Kathmandu')).toBe('2026-10-13T00:15:00+05:45');
    expect(formatInZone(t, 'America/New_York')).toBe('2026-10-12T14:30:00-04:00');
    expect(formatInZone(new Date('2026-12-01T05:00:00Z'), 'America/New_York')).toBe('2026-12-01T00:00:00-05:00');
    expect(formatInZone(t, 'UTC')).toBe('2026-10-12T18:30:00+00:00');
    expect(localDate(t, 'Asia/Kolkata')).toBe('2026-10-13');
  });

  it("finds the instant a zone's local day starts, across DST changes", () => {
    expect(zonedDayStart('2026-10-13', 'Asia/Kolkata').toISOString()).toBe('2026-10-12T18:30:00.000Z');
    expect(zonedDayStart('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z'); // spring forward later that night
    expect(zonedDayStart('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(zonedDayStart('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z'); // fall back later that night
    expect(zonedDayStart('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(zonedDayStart('2026-10-13', 'UTC').toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('inclusiveBefore / addDays / isValidTimeZone', () => {
    expect(inclusiveBefore(new Date('2026-10-12T18:30:00.000Z'))).toBe('2026-10-12T18:29:59.999999Z');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('buildReportRequest with tz', () => {
  it('a plain-date range is the zone\'s local days; datetimes are taken as given', () => {
    const r = buildReportRequest(NET, parse({ groupBy: 'day', from: '2026-10-13', to: '2026-10-14', tz: 'Asia/Kolkata' }), 'admin');
    expect(r.timeZone).toBe('Asia/Kolkata');
    expect(r.filters.from).toBe('2026-10-12T18:30:00.000Z');
    expect(r.filters.to).toBe('2026-10-14T18:29:59.999999Z');
    const dt = buildReportRequest(NET, parse({ groupBy: 'day', from: '2026-10-13T06:00:00Z', tz: 'Asia/Kolkata' }), 'admin');
    expect(dt.filters.from).toBe('2026-10-13T06:00:00Z');
  });

  it('UTC (or no tz) leaves the request as before', () => {
    const queries: Record<string, string>[] = [{ groupBy: 'day', from: '2026-10-13', to: '2026-10-13' }, { groupBy: 'day', from: '2026-10-13', to: '2026-10-13', tz: 'UTC' }];
    for (const q of queries) {
      const r = buildReportRequest(NET, parse(q), 'admin');
      expect(r.timeZone).toBeUndefined();
      expect(r.filters).toMatchObject({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-13T23:59:59.999999Z' });
    }
  });

  it('an unknown zone is refused', () => {
    expect(reportQuerySchema.safeParse({ tz: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('rollupEligible', () => {
  const req = (groupBy: ReportRequest['groupBy'], filters: ReportRequest['filters'] = {}): ReportRequest =>
    ({ networkId: NET, groupBy, metrics: ['clicks'], filters, limit: 10, offset: 0 });
  it('dimensions and filters the rollups carry → yes; anything else → raw', () => {
    expect(rollupEligible(req([]))).toBe(true);
    expect(rollupEligible(req(['offer', 'day'], { from: 'x', offerId: ['a', 'b'], excludeCountry: 'US', advertiserId: 'a' }))).toBe(true);
    expect(rollupEligible(req(['smartLink', 'hour', 'publisher', 'device']))).toBe(true);
    expect(rollupEligible(req(['city']))).toBe(false);
    expect(rollupEligible(req(['offer'], { sub1: 'x' }))).toBe(false);
    expect(rollupEligible(req(['offer'], { excludeInvalid: true }))).toBe(false);
    expect(rollupEligible(req(['offer'], { isp: [] }))).toBe(true); // empty = not filtering
  });
});
