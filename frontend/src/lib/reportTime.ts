/**
 * Day/hour bucket labels for the Daily and Hourly reports and the analytics pages' Day / Hour cells.
 * Pure, no imports — `node --test` runs it (see lib/__tests__/reportTime.test.ts).
 *
 * A bucket is labelled by its OWN wall time. The API buckets days / hours in the report's time zone
 * (D7) and writes a zoned bucket as local wall time with its offset ('2026-10-13T00:00:00+05:30'), a
 * UTC one as an ISO instant ('2026-10-13T00:00:00.000Z'); the ClickHouse provider writes
 * '2026-10-13 00:00:00' (no designator, UTC). In every case the date and hour written ARE the
 * bucket's, so labels read them literally — converting a zoned bucket to UTC first moved it to the
 * previous day.
 */

/** A report bucket timestamp as a Date, treating a string without a time zone as UTC. */
export function parseReportTimestamp(s: string): Date {
  const t = s.trim().replace(' ', 'T');
  // Date only ("2026-10-01") → UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00Z`);
  // Already zoned after the time part: trailing Z, or a ±HH[[:]MM] offset (normalised to ±HH:MM).
  if (/Z$/i.test(t)) return new Date(t);
  const off = /^(.*T[\d:.]+)([+-]\d{2}):?(\d{2})?$/.exec(t);
  if (off) return new Date(`${off[1]}${off[2]}:${off[3] ?? '00'}`);
  return new Date(`${t}Z`);
}

const pad = (n: number) => String(n).padStart(2, '0');
const WALL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

/** The bucket's own date + hour as written (see the header); a string in another shape is read as an instant in UTC. */
function wall(s: string): { y: string; m: string; d: string; h: string } {
  const w = WALL.exec(s.trim());
  if (w) return { y: w[1]!, m: w[2]!, d: w[3]!, h: w[4] ?? '00' };
  const t = parseReportTimestamp(s);
  return { y: String(t.getUTCFullYear()), m: pad(t.getUTCMonth() + 1), d: pad(t.getUTCDate()), h: pad(t.getUTCHours()) };
}

/** The bucket's calendar day (YYYY-MM-DD) — what report `from`/`to` params take (with the same `tz`). */
export function reportBucketDay(s: string): string {
  const w = wall(s);
  return `${w.y}-${w.m}-${w.d}`;
}

/** "MM/DD/YYYY" — the Daily Report's date label. */
export function formatReportDay(s: string): string {
  const w = wall(s);
  return `${w.m}/${w.d}/${w.y}`;
}

/** "MM/DD/YYYY HH:00" — the Hourly Report's hour label. */
export function formatReportHour(s: string): string {
  const w = wall(s);
  return `${w.m}/${w.d}/${w.y} ${w.h}:00`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 16 · 00:00" — an hour bucket's own wall time in the report's zone, short (chart axis labels). */
export function formatReportHourShort(s: string): string {
  const w = wall(s);
  return `${MONTHS[Number(w.m) - 1] ?? w.m} ${Number(w.d)} · ${w.h}:00`;
}

/** A Day / Hour dimension cell: "2026-10-13" / "2026-10-13 05:00"; any other dimension's value unchanged. */
export function bucketLabel(dim: string, raw: string): string {
  if (dim !== 'day' && dim !== 'hour') return raw;
  const w = wall(raw);
  return dim === 'day' ? `${w.y}-${w.m}-${w.d}` : `${w.y}-${w.m}-${w.d} ${w.h}:00`;
}
