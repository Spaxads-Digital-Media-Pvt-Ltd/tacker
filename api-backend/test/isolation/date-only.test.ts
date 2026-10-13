/**
 * DATE columns read back as the same calendar day on any server timezone (audit F-19) — no DB needed.
 * node-pg parses a DATE into a JS Date at LOCAL midnight (`new Date(y, m, d)`); dateOnly() must turn
 * that back into the same 'YYYY-MM-DD', where toISOString().slice(0, 10) shifts it east of UTC.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { dateOnly, dateOnlyOrNull } from '../../src/lib/date-only.js';

const originalTz = process.env.TZ;
afterAll(() => { process.env.TZ = originalTz; });

describe.each(['Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles', 'UTC'])('server timezone %s', (tz) => {
  it('a DATE parsed the way node-pg does comes back as the same day', () => {
    process.env.TZ = tz;
    const asPgParsesIt = new Date(2026, 9, 1); // DATE '2026-10-01' → local midnight
    expect(dateOnly(asPgParsesIt)).toBe('2026-10-01');
    expect(dateOnly(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(dateOnly(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('dateOnly', () => {
  it('the old toISOString().slice(0, 10) is a day early east of UTC — the bug this replaces', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(new Date(2026, 9, 1).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(dateOnly(new Date(2026, 9, 1))).toBe('2026-10-01');
  });

  it('strings pass through (already a date or a timestamp); null stays null', () => {
    expect(dateOnly('2026-10-01')).toBe('2026-10-01');
    expect(dateOnly('2026-10-01T23:00:00Z')).toBe('2026-10-01');
    expect(dateOnlyOrNull(null)).toBeNull();
    expect(dateOnlyOrNull(undefined)).toBeNull();
  });
});
