// Daily/Hourly bucket labels (lib/reportTime.ts) — imports the real module. Run under a non-UTC
// TZ too (e.g. TZ=America/New_York) to see the ClickHouse case fail without the fix.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { bucketLabel, formatReportDay, formatReportHour, formatReportHourShort, parseReportTimestamp, reportBucketDay } from '../reportTime.ts';

describe('parseReportTimestamp', () => {
  it('reads a Postgres ISO string unchanged', () => {
    assert.strictEqual(parseReportTimestamp('2026-10-01T05:00:00.000Z').toISOString(), '2026-10-01T05:00:00.000Z');
  });
  it('reads a ClickHouse "YYYY-MM-DD HH:MM:SS" (no zone) as UTC, not local time', () => {
    assert.strictEqual(parseReportTimestamp('2026-10-01 05:00:00').toISOString(), '2026-10-01T05:00:00.000Z');
    assert.strictEqual(parseReportTimestamp('2026-10-01T00:00:00').toISOString(), '2026-10-01T00:00:00.000Z');
  });
  it('keeps an explicit offset', () => {
    assert.strictEqual(parseReportTimestamp('2026-10-01T05:00:00+02:00').toISOString(), '2026-10-01T03:00:00.000Z');
    assert.strictEqual(parseReportTimestamp('2026-10-01 05:00:00+00').toISOString(), '2026-10-01T05:00:00.000Z');
  });
  it('reads a bare date as UTC midnight', () => {
    assert.strictEqual(parseReportTimestamp('2026-10-01').toISOString(), '2026-10-01T00:00:00.000Z');
  });
});

describe('report bucket labels', () => {
  it('formats the day identically for Postgres and ClickHouse', () => {
    assert.strictEqual(formatReportDay('2026-10-01T00:00:00.000Z'), '10/01/2026');
    assert.strictEqual(formatReportDay('2026-10-01 00:00:00'), '10/01/2026');
  });
  it('formats the hour identically for Postgres and ClickHouse', () => {
    assert.strictEqual(formatReportHour('2026-10-01T23:00:00.000Z'), '10/01/2026 23:00');
    assert.strictEqual(formatReportHour('2026-10-01 23:00:00'), '10/01/2026 23:00');
  });
  it('gives the UTC day for from/to params', () => {
    assert.strictEqual(reportBucketDay('2026-10-01T23:00:00.000Z'), '2026-10-01');
    assert.strictEqual(reportBucketDay('2026-10-01 23:00:00'), '2026-10-01');
  });
});

describe('zoned buckets are labelled by their own wall time (D7)', () => {
  it('a Kolkata day / hour keeps its local date and hour — never shifted to UTC', () => {
    assert.strictEqual(formatReportDay('2026-10-13T00:00:00+05:30'), '10/13/2026');
    assert.strictEqual(reportBucketDay('2026-10-13T00:00:00+05:30'), '2026-10-13');
    assert.strictEqual(formatReportHour('2026-10-13T01:00:00+05:30'), '10/13/2026 01:00');
    assert.strictEqual(formatReportHour('2026-03-08T03:00:00-04:00'), '03/08/2026 03:00'); // New York, just after spring-forward
  });
  it('Day / Hour cells on the analytics pages', () => {
    assert.strictEqual(bucketLabel('day', '2026-10-13T00:00:00+05:30'), '2026-10-13');
    assert.strictEqual(bucketLabel('hour', '2026-10-13T05:00:00.000Z'), '2026-10-13 05:00');
    assert.strictEqual(bucketLabel('hour', '2026-10-13 05:00:00'), '2026-10-13 05:00');
    assert.strictEqual(bucketLabel('country', 'IN'), 'IN');
  });
});

describe('formatReportHourShort (hourly chart labels)', () => {
  it('reads the bucket’s own date and hour: "Oct 16 · 00:00"', () => {
    assert.strictEqual(formatReportHourShort('2026-10-16T00:00:00.000Z'), 'Oct 16 · 00:00');
    assert.strictEqual(formatReportHourShort('2026-10-03 17:00:00'), 'Oct 3 · 17:00');
  });
  it('a zoned bucket keeps its wall time (not shifted to UTC)', () => {
    assert.strictEqual(formatReportHourShort('2026-10-13T00:00:00+05:30'), 'Oct 13 · 00:00');
    assert.strictEqual(formatReportHourShort('2026-01-01T23:00:00-05:00'), 'Jan 1 · 23:00');
  });
});
