import { describe, it, expect } from 'vitest';
import { addCalendarDays, daysAgoIn, latestToday, todayIn, zoneRangeParams } from '../reportZone';

// 21:30 UTC on 14 Oct = 03:00 on 15 Oct in Kolkata = 17:30 on 14 Oct in New York.
const NOW = new Date('2026-10-14T21:30:00Z');

describe('report zone (D7)', () => {
  it("today and the presets are the zone's days, not UTC's", () => {
    expect(todayIn('Asia/Kolkata', NOW)).toBe('2026-10-15');
    expect(todayIn('America/New_York', NOW)).toBe('2026-10-14');
    expect(todayIn('UTC', NOW)).toBe('2026-10-14');
    expect(daysAgoIn(30, 'Asia/Kolkata', NOW)).toBe('2026-09-15');
    expect(todayIn('Not/AZone', NOW)).toBe('2026-10-14'); // unusable zone → UTC
  });
  it('calendar arithmetic crosses months and years', () => {
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('the range goes to the API as plain dates + tz (UTC needs no tz)', () => {
    expect(zoneRangeParams('2026-10-01', '2026-10-14', 'Asia/Kolkata')).toEqual({ from: '2026-10-01', to: '2026-10-14', tz: 'Asia/Kolkata' });
    expect(zoneRangeParams('2026-10-01', '2026-10-14', 'UTC')).toEqual({ from: '2026-10-01', to: '2026-10-14' });
  });
});

describe('latestToday', () => {
  it("is never earlier than any zone's today (so a Kolkata 'today' is never refused as future)", () => {
    expect(latestToday(NOW)).toBe('2026-10-15');
    expect(latestToday(NOW) >= todayIn('Asia/Kolkata', NOW)).toBe(true);
    expect(latestToday(NOW) >= todayIn('Pacific/Kiritimati', NOW)).toBe(true);
  });
});
