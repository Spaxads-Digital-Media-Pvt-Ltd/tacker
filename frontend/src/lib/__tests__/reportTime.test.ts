// Daily/Hourly bucket labels (lib/reportTime.ts) — imports the real module. Run under a non-UTC
// TZ too (e.g. TZ=America/New_York) to see the ClickHouse case fail without the fix.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { formatReportDay, formatReportHour, parseReportTimestamp, reportBucketDay } from '../reportTime.ts';

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
