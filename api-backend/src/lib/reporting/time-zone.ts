/**
 * Report time zones (audit F-20). Aggregates bucket days / hours in a report time zone (Postgres
 * `date_trunc(field, ts, zone)` does the bucketing); these helpers do the edges in JS — a plain date
 * (YYYY-MM-DD) as that zone's local day, and a bucket instant written as local wall time with its
 * offset ('2026-10-13T00:00:00+05:30'), so `.slice(0, 10)` is the local date and `new Date()` still
 * parses it to the same instant. Uses the runtime's IANA data (Intl) — no dependency.
 */

export const isUtcZone = (tz: string | null | undefined): boolean => !tz || tz === 'UTC' || tz === 'Etc/UTC';

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, tz: string): Record<string, number> {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Local − UTC at instant `ms`, in minutes. */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  const asUtc = Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

/** The instant as local wall time in `tz` with its offset, e.g. '2026-10-13T00:00:00+05:30'. */
export function formatInZone(d: Date, tz: string): string {
  const ms = d.getTime();
  const p = partsIn(ms, tz);
  const off = tzOffsetMinutes(ms, tz);
  const sign = off < 0 ? '-' : '+';
  return `${p['year']}-${pad(p['month']!)}-${pad(p['day']!)}T${pad(p['hour']!)}:${pad(p['minute']!)}:${pad(p['second']!)}`
    + `${sign}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** The local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export const localDate = (d: Date, tz: string): string => formatInZone(d, tz).slice(0, 10);

/** The instant local midnight of `date` (YYYY-MM-DD) starts in `tz` (DST-safe). */
export function zonedDayStart(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let ms = guess - tzOffsetMinutes(guess, tz) * 60_000;
  const again = guess - tzOffsetMinutes(ms, tz) * 60_000;
  if (again !== ms) ms = again;
  return new Date(ms);
}

/** `date` ± `days` calendar days (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The last microsecond before `start`, as ISO text ('…:59.999999Z') — an inclusive `to`. */
export function inclusiveBefore(start: Date): string {
  return new Date(start.getTime() - 1).toISOString().replace(/Z$/, '999Z');
}
