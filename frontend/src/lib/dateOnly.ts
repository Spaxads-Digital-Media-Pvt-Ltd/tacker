/**
 * Format a date-only value ("YYYY-MM-DD"). `new Date('2026-09-01')` parses as UTC midnight, which
 * shows the previous day in timezones west of UTC — build the date in local time instead.
 */
function ymdParts(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}

/** "YYYY-MM-DD" picked in a date input → the instant that day STARTS locally. */
export function startOfLocalDayIso(ymd: string): string {
  const p = ymdParts(ymd);
  return p ? new Date(p[0], p[1], p[2], 0, 0, 0, 0).toISOString() : ymd;
}

/** "YYYY-MM-DD" picked as an END date → the last instant of that day locally (the day is included). */
export function endOfLocalDayIso(ymd: string): string {
  const p = ymdParts(ymd);
  return p ? new Date(p[0], p[1], p[2], 23, 59, 59, 999).toISOString() : ymd;
}

/** A stored timestamp → "YYYY-MM-DD" in local time, for a date input. */
export function localYmd(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateOnly(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
}
