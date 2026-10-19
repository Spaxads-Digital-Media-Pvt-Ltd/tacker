/**
 * A Postgres DATE value as 'YYYY-MM-DD' (audit F-19) — the one helper for every DATE column read
 * (invoice periods, investigation / reporting-adjustment ranges, customer-value rule dates, …).
 *
 * node-postgres has no DATE type parser installed here (lib/db/pool.ts), so it parses a DATE into a
 * JS Date at LOCAL midnight. `toISOString().slice(0, 10)` then converts to UTC first and returns the
 * previous day on any server east of UTC (2026-10-01 → 2026-09-30 on Asia/Kolkata). This reads the
 * local calendar fields instead, which round-trips exactly whatever the server's timezone. The pool
 * sets no session TimeZone (the database default applies); that setting only changes how timestamptz
 * values render, never a DATE, so this helper doesn't depend on it. Strings pass through.
 */
export function dateOnly(v: string | Date): string {
  if (!(v instanceof Date)) return String(v).slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
}

/** dateOnly() for a nullable column. */
export const dateOnlyOrNull = (v: string | Date | null | undefined): string | null => (v == null ? null : dateOnly(v));
