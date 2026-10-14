/**
 * Report schedules (audit F-24): the schedule form's friendly choices ⇄ the 5-field cron the API
 * stores (`minute hour day-of-month month day-of-week`, in the network's time zone). Daily, weekly
 * and monthly at a time of day cover what people pick; anything else stays editable as "custom".
 */
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface ScheduleForm {
  frequency: Frequency;
  /** HH:MM, 24-hour. */
  time: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** 1–28, so every month has it. */
  dayOfMonth: number;
  /** The expression itself, for "custom". */
  cron: string;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_SCHEDULE: ScheduleForm = { frequency: 'daily', time: '08:00', weekday: 1, dayOfMonth: 1, cron: '' };

const pad = (n: number) => String(n).padStart(2, '0');
const int = (s: string | undefined, min: number, max: number): number | null =>
  s !== undefined && /^\d{1,2}$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : null;

export function toCron(f: ScheduleForm): string {
  if (f.frequency === 'custom') return f.cron.trim().replace(/\s+/g, ' ');
  const [h = 0, m = 0] = f.time.split(':').map(Number);
  if (f.frequency === 'daily') return `${m} ${h} * * *`;
  if (f.frequency === 'weekly') return `${m} ${h} * * ${f.weekday}`;
  return `${m} ${h} ${f.dayOfMonth} * *`;
}

/** The form for a stored expression; anything that isn't a plain daily / weekly / monthly is "custom". */
export function fromCron(expr: string | null | undefined): ScheduleForm {
  if (!expr?.trim()) return DEFAULT_SCHEDULE;
  const p = expr.trim().split(/\s+/);
  const m = int(p[0], 0, 59);
  const h = int(p[1], 0, 23);
  if (p.length === 5 && m !== null && h !== null && p[3] === '*') {
    const time = `${pad(h)}:${pad(m)}`;
    if (p[2] === '*' && p[4] === '*') return { ...DEFAULT_SCHEDULE, frequency: 'daily', time };
    const wd = int(p[4], 0, 7);
    if (p[2] === '*' && wd !== null) return { ...DEFAULT_SCHEDULE, frequency: 'weekly', time, weekday: wd % 7 };
    const dom = int(p[2], 1, 28);
    if (dom !== null && p[4] === '*') return { ...DEFAULT_SCHEDULE, frequency: 'monthly', time, dayOfMonth: dom };
  }
  return { ...DEFAULT_SCHEDULE, frequency: 'custom', cron: expr.trim() };
}

/** For the Scheduled Reports table: Frequency / Week Day / Day. */
export function describeSchedule(expr: string | null | undefined): { frequency: string; weekday: string; day: string } {
  if (!expr) return { frequency: '—', weekday: '—', day: '—' };
  const f = fromCron(expr);
  switch (f.frequency) {
    case 'daily': return { frequency: `Daily at ${f.time}`, weekday: '—', day: '—' };
    case 'weekly': return { frequency: `Weekly at ${f.time}`, weekday: WEEKDAYS[f.weekday]!, day: '—' };
    case 'monthly': return { frequency: `Monthly at ${f.time}`, weekday: '—', day: String(f.dayOfMonth) };
    default: return { frequency: `Custom (${f.cron})`, weekday: '—', day: '—' };
  }
}

/** Recipients typed one per line or comma / semicolon separated → a clean, de-duplicated list. */
export function parseRecipients(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/** The rolling date range a scheduled email covers (the API's rangePreset). */
export const RANGE_OPTIONS = [
  { value: 'yesterday', label: 'Yesterday' }, { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' }, { value: 'month_to_date', label: 'Month to date' },
  { value: 'last_month', label: 'Last month' },
];
export const rangeLabel = (v: string) => RANGE_OPTIONS.find((o) => o.value === v)?.label ?? v;

/** POST /api/saved-reports/:id/send's answer. */
export interface SendResult { sent: boolean; skipped?: string; reason?: string; recipients: string[]; rows: number }

/** "Sent to a, b — 12 rows." / "Not sent: SMTP is not configured…" */
export function sendSummary(r: SendResult): string {
  return r.sent ? `Sent to ${r.recipients.join(', ')} — ${r.rows} row${r.rows === 1 ? '' : 's'}.` : `Not sent: ${r.reason ?? r.skipped ?? 'unknown reason'}`;
}
