// Dashboard windows (pages/dashboard/range.ts) — zone days, same-time comparison, DST, buckets.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { bucketKeyOf, buildRange, formatDay, rangeText, sameWallTimeDaysAgo, zonedWallInstant } from '../range.ts';

const iso = (s: string) => new Date(s).toISOString();

describe('zonedWallInstant', () => {
  it('maps a wall time to its instant in fixed-offset and DST zones', () => {
    assert.strictEqual(zonedWallInstant('2026-10-21', '14:32:00', 'UTC').toISOString(), iso('2026-10-21T14:32:00Z'));
    assert.strictEqual(zonedWallInstant('2026-10-21', '14:32:00', 'Asia/Kolkata').toISOString(), iso('2026-10-21T09:02:00Z'));
    // New York: EDT (UTC−4) in summer, EST (UTC−5) in winter.
    assert.strictEqual(zonedWallInstant('2026-07-01', '09:00:00', 'America/New_York').toISOString(), iso('2026-07-01T13:00:00Z'));
    assert.strictEqual(zonedWallInstant('2026-12-01', '09:00:00', 'America/New_York').toISOString(), iso('2026-12-01T14:00:00Z'));
  });

  it('a repeated fall-back hour resolves to its first occurrence', () => {
    // 2026-11-01 01:30 happens at 05:30Z (EDT) and again at 06:30Z (EST).
    assert.strictEqual(zonedWallInstant('2026-11-01', '01:30:00', 'America/New_York').toISOString(), iso('2026-11-01T05:30:00Z'));
  });
});

describe('sameWallTimeDaysAgo (DST-safe comparison end)', () => {
  it('Today vs yesterday ends at the same wall time, across a spring-forward day', () => {
    // 2026-03-09 14:32 EDT = 18:32Z; yesterday (the DST day itself, already EDT by 14:32) 14:32 = 18:32Z.
    assert.strictEqual(sameWallTimeDaysAgo(new Date('2026-03-09T18:32:00Z'), 1, 'America/New_York').toISOString(), iso('2026-03-08T18:32:00Z'));
    // On the DST day at 14:32 EDT, yesterday 14:32 was EST: 19:32Z — 23 h earlier, not 24.
    assert.strictEqual(sameWallTimeDaysAgo(new Date('2026-03-08T18:32:00Z'), 1, 'America/New_York').toISOString(), iso('2026-03-07T19:32:00Z'));
  });

  it('across a fall-back day the gap is 25 h', () => {
    // 2026-11-02 10:00 EST = 15:00Z; 2026-11-01 10:00 is already EST too → 15:00Z the day before.
    assert.strictEqual(sameWallTimeDaysAgo(new Date('2026-11-02T15:00:00Z'), 1, 'America/New_York').toISOString(), iso('2026-11-01T15:00:00Z'));
    // 2026-11-01 10:00 EST = 15:00Z; 2026-10-31 10:00 EDT = 14:00Z.
    assert.strictEqual(sameWallTimeDaysAgo(new Date('2026-11-01T15:00:00Z'), 1, 'America/New_York').toISOString(), iso('2026-10-31T14:00:00Z'));
  });
});

describe('buildRange', () => {
  const now = new Date('2026-10-21T09:02:30Z'); // 14:32:30 in Kolkata

  it('Today: zone day start → now, compared with yesterday up to the same time', () => {
    const r = buildRange('today', 'Asia/Kolkata', now);
    assert.deepStrictEqual(r.current, { from: '2026-10-21', to: now.toISOString() });
    assert.deepStrictEqual(r.previous, { from: '2026-10-20', to: iso('2026-10-20T09:02:30Z') });
    assert.strictEqual(r.compareLabel, 'vs. same time yesterday');
    assert.strictEqual(r.bucket, 'hour');
    assert.strictEqual(r.buckets.length, 15); // 00:00 … 14:00
    assert.strictEqual(r.buckets[14], '2026-10-21 14:00');
    assert.strictEqual(r.bucketLabels[0], '00:00');
  });

  it('the zone decides "today" (UTC is still on the previous day at 02:00 Kolkata)', () => {
    const early = new Date('2026-10-20T20:30:00Z'); // 02:00 on Oct 21 in Kolkata, 20:30 Oct 20 UTC
    assert.strictEqual(buildRange('today', 'Asia/Kolkata', early).firstDay, '2026-10-21');
    assert.strictEqual(buildRange('today', 'UTC', early).firstDay, '2026-10-20');
  });

  it('Last 7 days: 7 zone days including today, compared with the 7 before', () => {
    const r = buildRange('7d', 'Asia/Kolkata', now);
    assert.strictEqual(r.firstDay, '2026-10-15');
    assert.strictEqual(r.lastDay, '2026-10-21');
    assert.deepStrictEqual(r.previous, { from: '2026-10-08', to: iso('2026-10-14T09:02:30Z') });
    assert.strictEqual(r.compareLabel, 'vs. previous 7 days');
    assert.strictEqual(r.bucket, 'day');
    assert.deepStrictEqual(r.buckets, ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
    assert.strictEqual(r.bucketLabels[2], 'Oct 17');
  });

  it('30 / 90 days span month boundaries by calendar day', () => {
    assert.strictEqual(buildRange('30d', 'UTC', now).firstDay, '2026-09-22');
    const r90 = buildRange('90d', 'UTC', now);
    assert.strictEqual(r90.buckets.length, 90);
    assert.strictEqual(r90.previous.from, '2026-04-25');
  });

  it('a DST window keeps whole zone days', () => {
    const r = buildRange('7d', 'America/New_York', new Date('2026-03-10T16:00:00Z'));
    assert.strictEqual(r.firstDay, '2026-03-04');
    assert.strictEqual(r.buckets.length, 7);
    assert.strictEqual(r.previous.to, iso('2026-03-03T17:00:00Z')); // 12:00 EST then, 12:00 EDT now
  });
});

describe('bucketKeyOf / labels', () => {
  it('reads the bucket as written (zoned, UTC instant or ClickHouse form)', () => {
    assert.strictEqual(bucketKeyOf('2026-10-13T00:00:00+05:30', 'day'), '2026-10-13');
    assert.strictEqual(bucketKeyOf('2026-10-13T05:00:00+05:30', 'hour'), '2026-10-13 05:00');
    assert.strictEqual(bucketKeyOf('2026-10-13T00:00:00.000Z', 'day'), '2026-10-13');
    assert.strictEqual(bucketKeyOf('2026-10-13 07:00:00', 'hour'), '2026-10-13 07:00');
  });

  it('range text and day labels', () => {
    const now = new Date('2026-10-21T09:02:30Z');
    assert.strictEqual(rangeText(buildRange('7d', 'UTC', now)), 'Oct 15 – Oct 21, 2026');
    assert.strictEqual(rangeText(buildRange('today', 'UTC', now)), 'Today, Oct 21, 2026');
    assert.strictEqual(formatDay('2026-01-05'), 'Jan 5');
  });
});
