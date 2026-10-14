/**
 * A small 5-field cron (minute hour day-of-month month day-of-week) for scheduled reports (audit F-24),
 * evaluated in a time zone — "0 8 * * 1" is 08:00 every Monday in the network's zone, across DST.
 * Fields take `*`, numbers, `a-b`, lists `a,b`, steps `*`/`a-b` + `/n`, and 3-letter month / weekday
 * names (JAN, MON); day-of-week 0 and 7 are Sunday. As in classic cron, when both day-of-month and
 * day-of-week are restricted a day matching EITHER runs.
 */
import { formatInZone, zonedDayStart, addDays } from '../reporting/time-zone.js';

export interface CronSpec {
  minutes: Set<number>; hours: Set<number>; days: Set<number>; months: Set<number>; weekdays: Set<number>;
  domAny: boolean; dowAny: boolean;
}

const NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function field(src: string, min: number, max: number, label: string): Set<number> {
  const out = new Set<number>();
  const num = (t: string): number => {
    const v = /^\d+$/.test(t) ? Number(t) : NAMES[t.toUpperCase()];
    if (v == null || v < min || v > max) throw new Error(`${label}: "${t}" is out of range ${min}-${max}`);
    return v;
  };
  for (const part of src.split(',')) {
    const [range, stepStr] = part.split('/') as [string, string | undefined];
    const step = stepStr == null ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) throw new Error(`${label}: bad step in "${part}"`);
    let lo: number;
    let hi: number;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) {
      const [a, b] = range.split('-') as [string, string];
      lo = num(a); hi = num(b);
      if (lo > hi) throw new Error(`${label}: "${range}" runs backwards`);
    } else { lo = num(range); hi = stepStr == null ? lo : max; }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parse a 5-field expression; throws an Error saying what's wrong. */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('a schedule is 5 fields: minute hour day-of-month month day-of-week');
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const weekdays = field(dow, 0, 7, 'day-of-week');
  if (weekdays.has(7)) { weekdays.delete(7); weekdays.add(0); }
  return {
    minutes: field(mi, 0, 59, 'minute'), hours: field(h, 0, 23, 'hour'), days: field(dom, 1, 31, 'day-of-month'),
    months: field(mon, 1, 12, 'month'), weekdays, domAny: dom === '*', dowAny: dow === '*',
  };
}

function dayMatches(c: CronSpec, y: number, m: number, d: number): boolean {
  if (!c.months.has(m)) return false;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return c.weekdays.has(wd);
  if (c.dowAny) return c.days.has(d);
  return c.days.has(d) || c.weekdays.has(wd);
}

/** The next run strictly after `after`, in `tz` (null when nothing matches within four years — a leap day does). */
export function nextCronTime(expr: string | CronSpec, after: Date, tz = 'UTC'): Date | null {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  let date = formatInZone(after, tz).slice(0, 10);
  for (let i = 0; i < 1462; i++, date = addDays(date, 1)) {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    if (!dayMatches(c, y, m, d)) continue;
    // Walk the local day minute by minute in UTC steps, matching local hour:minute (DST-safe). When
    // the clocks go back a local time happens twice; it runs once, at the first (walked from midnight,
    // so a run at the first one isn't followed by another an hour later). A time the clocks skip
    // (spring forward) doesn't happen that day.
    const start = zonedDayStart(date, tz).getTime();
    const end = zonedDayStart(addDays(date, 1), tz).getTime();
    const seen = new Set<string>();
    for (let t = start; t < end; t += 60_000) {
      const hhmm = formatInZone(new Date(t), tz).slice(11, 16);
      if (seen.has(hhmm)) continue;
      seen.add(hhmm);
      if (t <= after.getTime()) continue;
      if (c.hours.has(Number(hhmm.slice(0, 2))) && c.minutes.has(Number(hhmm.slice(3, 5)))) return new Date(t);
    }
  }
  return null;
}
