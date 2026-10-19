/**
 * The report time zone (D7 / O10). Every report page works in whole days of ONE zone — the network's
 * (Settings › General) by default, or the one picked beside the date range — and asks the API with
 * plain dates + `tz`: the API turns them into that zone's day bounds and buckets days / hours in it.
 * "Today" and the presets (last 30 days, …) are that zone's too. Pure helpers; the hook that knows
 * the network's zone and the picked one is lib/useReportZone.ts.
 */

const isUtc = (tz: string) => tz === 'UTC' || tz === 'Etc/UTC';

/** Today's calendar date (YYYY-MM-DD) in `tz` (UTC when the zone isn't usable). */
export function todayIn(tz: string, now: Date = new Date()): string {
  try {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)) p[x.type] = x.value;
    if (p['year'] && p['month'] && p['day']) return `${p['year']}-${p['month']}-${p['day']}`;
  } catch { /* fall through */ }
  return now.toISOString().slice(0, 10);
}

/**
 * The latest "today" anywhere (UTC+14). A range is refused as "in the future" only past it: whatever
 * zone a report is in, its today is never later than this (UTC's today was, before 05:30 in Kolkata).
 */
export function latestToday(now: Date = new Date()): string {
  return todayIn('Etc/GMT-14', now);
}

/** `date` (YYYY-MM-DD) ± `days` calendar days. */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The calendar date `n` days before today in `tz`. */
export function daysAgoIn(n: number, tz: string, now: Date = new Date()): string {
  return addCalendarDays(todayIn(tz, now), -n);
}

/** A report range as query params: plain dates, plus `tz` unless it's UTC (the API's default). */
export function zoneRangeParams(from: string, to: string, tz: string): { from: string; to: string; tz?: string } {
  return isUtc(tz) ? { from, to } : { from, to, tz };
}
