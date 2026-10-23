/**
 * The admin dashboard's date windows, all in the REPORT zone (useReportZone — the network's unless
 * the viewer picked another). Pure; built only on the shared zone helpers (lib/reportZone,
 * lib/reportTime, lib/datetime) — tested in __tests__/range.test.ts.
 *
 *  - Window: from the start of the first zone day (a plain date — the API reads it as that zone
 *    day's first instant) up to NOW (an instant, taken as given).
 *  - Comparison: the same span shifted back — the same number of zone days earlier, ending at the
 *    same WALL time of day (Today compares with yesterday up to the same time). DST-safe: the wall
 *    time is mapped back to an instant with the zone's offset AT that instant, so a 23- or 25-hour
 *    day still compares 00:00 → 14:32 with 00:00 → 14:32.
 */
import { addCalendarDays, todayIn } from '../../lib/reportZone';
import { bucketLabel, reportBucketDay } from '../../lib/reportTime';
import { formatDateTime, utcOffsetLabel } from '../../lib/datetime';

export type RangePreset = 'today' | '7d' | '30d' | '90d';

export const RANGE_PRESETS: readonly { id: RangePreset; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
];

export const isRangePreset = (v: unknown): v is RangePreset => RANGE_PRESETS.some((p) => p.id === v);
export const presetDays = (p: RangePreset): number => RANGE_PRESETS.find((x) => x.id === p)!.days;
export const presetLabel = (p: RangePreset): string => RANGE_PRESETS.find((x) => x.id === p)!.label;

/** One API window: `from` a zone day (YYYY-MM-DD), `to` an ISO instant. */
export interface Window { from: string; to: string }

export interface DashboardRange {
  preset: RangePreset;
  tz: string;
  /** First and last zone day of the current window (YYYY-MM-DD). */
  firstDay: string;
  lastDay: string;
  current: Window;
  previous: Window;
  /** "vs. same time yesterday" / "vs. previous 7 days". */
  compareLabel: string;
  /** Graph buckets: hours of today, or the window's days. */
  bucket: 'hour' | 'day';
  /** Bucket keys in order — `bucketKeyOf` maps an API row onto them. */
  buckets: string[];
  /** Short axis label per bucket ("14:00", "Oct 17"). */
  bucketLabels: string[];
}

/** Minutes east of UTC for `tz` at `at` — read from the DST-aware `utcOffsetLabel`. */
function offsetMinutes(tz: string, at: Date): number {
  const m = /^UTC([+-])(\d{2}):(\d{2})$/.exec(utcOffsetLabel(tz, at));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * The instant at wall time `hms` (HH:mm:ss) on `day` (YYYY-MM-DD) in `tz`. The offset is taken at the
 * resulting instant (second pass), so a wall time just past a DST change lands on the right side.
 * A wall time that doesn't exist (the spring-forward gap) resolves to the instant one hour away; a
 * repeated one (fall-back) to its first occurrence.
 */
export function zonedWallInstant(day: string, hms: string, tz: string): Date {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi, s] = hms.split(':').map(Number) as [number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = asUtc - offsetMinutes(tz, new Date(asUtc)) * 60_000;
  return new Date(asUtc - offsetMinutes(tz, new Date(first)) * 60_000);
}

/** `now`'s wall time of day in `tz`, `days` zone days earlier — as an instant. */
export function sameWallTimeDaysAgo(now: Date, days: number, tz: string): Date {
  const [day, time] = formatDateTime(now, tz).split(' ') as [string, string];
  return zonedWallInstant(addCalendarDays(day, -days), time, tz);
}

const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const DAY_YEAR_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const ymdDate = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d)); };

/** "Oct 17" — a calendar day label (the date as written, no zone shift). */
export const formatDay = (ymd: string): string => DAY_FMT.format(ymdDate(ymd));
/** "Oct 17, 2026". */
export const formatDayYear = (ymd: string): string => DAY_YEAR_FMT.format(ymdDate(ymd));

/** A dashboard window for `preset` in `tz`, as of `now`. */
export function buildRange(preset: RangePreset, tz: string, now: Date = new Date()): DashboardRange {
  const days = presetDays(preset);
  const lastDay = todayIn(tz, now);
  const firstDay = addCalendarDays(lastDay, -(days - 1));
  const current: Window = { from: firstDay, to: now.toISOString() };
  const previous: Window = {
    from: addCalendarDays(firstDay, -days),
    to: sameWallTimeDaysAgo(now, days, tz).toISOString(),
  };
  let buckets: string[];
  let bucketLabels: string[];
  if (preset === 'today') {
    const hourNow = Number(formatDateTime(now, tz).slice(11, 13));
    const hours = Array.from({ length: hourNow + 1 }, (_, h) => String(h).padStart(2, '0'));
    buckets = hours.map((h) => `${lastDay} ${h}:00`);
    bucketLabels = hours.map((h) => `${h}:00`);
  } else {
    buckets = Array.from({ length: days }, (_, i) => addCalendarDays(firstDay, i));
    bucketLabels = buckets.map(formatDay);
  }
  return {
    preset, tz, firstDay, lastDay, current, previous,
    compareLabel: preset === 'today' ? 'vs. same time yesterday' : `vs. previous ${days} days`,
    bucket: preset === 'today' ? 'hour' : 'day',
    buckets, bucketLabels,
  };
}

/** The bucket key of an API row's `day` / `hour` dimension (its own wall date / hour — lib/reportTime). */
export function bucketKeyOf(raw: string, bucket: 'hour' | 'day'): string {
  return bucket === 'day' ? reportBucketDay(raw) : bucketLabel('hour', raw);
}

/** "Oct 15 – Oct 21, 2026" / "Today, Oct 21, 2026" — the date range button's text. */
export function rangeText(r: DashboardRange): string {
  return r.preset === 'today' ? `Today, ${formatDayYear(r.lastDay)}` : `${formatDay(r.firstDay)} – ${formatDayYear(r.lastDay)}`;
}

/** "the last 30 days" / "today" — for empty states ("No traffic — the last 30 days"). */
export function periodPhrase(p: RangePreset): string {
  return p === 'today' ? 'today' : `the last ${presetDays(p)} days`;
}
