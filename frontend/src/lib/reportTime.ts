/**
 * Day/hour bucket labels for the Daily and Hourly reports. Pure, no imports — `node --test` runs it
 * (see lib/__tests__/reportTime.test.ts).
 *
 * Report buckets are UTC. Postgres returns them as ISO strings with a `Z`
 * ("2026-10-01T00:00:00.000Z"), but the ClickHouse provider returns "2026-10-01 00:00:00" with no
 * zone designator — which `new Date()` parses as LOCAL time, landing a day/hour off outside UTC.
 * A timestamp without a designator is therefore read as UTC here.
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
const mdy = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

/** The UTC calendar day (YYYY-MM-DD) of a report bucket — what report `from`/`to` params take. */
export function reportBucketDay(s: string): string {
  const d = parseReportTimestamp(s);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "MM/DD/YYYY" (UTC) — the Daily Report's date label. */
export function formatReportDay(s: string): string {
  return mdy(parseReportTimestamp(s));
}

/** "MM/DD/YYYY HH:00" (UTC) — the Hourly Report's hour label. */
export function formatReportHour(s: string): string {
  const d = parseReportTimestamp(s);
  return `${mdy(d)} ${pad(d.getUTCHours())}:00`;
}
