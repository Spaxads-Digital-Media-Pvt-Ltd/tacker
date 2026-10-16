/** "just now", "5 min ago", "in 3 h", "yesterday", "in 2 days", else the date — for activity and due dates. Pure. */
export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  const past = diff < 0;
  const min = Math.round(Math.abs(diff) / 60000);
  const say = (s: string) => (past ? `${s} ago` : `in ${s}`);
  if (min < 1) return 'just now';
  if (min < 60) return say(`${min} min`);
  const hr = Math.round(min / 60);
  if (hr < 24) return say(`${hr} h`);
  const days = Math.round(hr / 24);
  if (days === 1) return past ? 'yesterday' : 'tomorrow';
  if (days < 14) return say(`${days} days`);
  return new Date(iso).toLocaleDateString();
}

/** Is a due date in the past? */
export const isOverdue = (iso: string | null | undefined, now: number = Date.now()): boolean => !!iso && new Date(iso).getTime() < now;
