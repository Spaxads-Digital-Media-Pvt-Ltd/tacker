/**
 * Timezone-aware date/time display. Everything takes an explicit IANA zone so a report can show
 * its timestamps in the selected country's (or the network's) local time instead of hard-coded
 * UTC. Output is the unambiguous `YYYY-MM-DD HH:mm:ss` (no US month/day ordering).
 */
import { useEffect, useState } from 'react';

export const UTC = 'UTC';

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC; } catch { return UTC; }
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Every IANA zone the browser knows (falls back to a minimal list on old engines). */
export function allTimeZones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return [UTC]; }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function parts(d: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "2026-10-08 14:32:10" in the given zone. Invalid input is returned unchanged. */
export function formatDateTime(iso: string | Date, tz: string): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** "14:32:10" in the given zone. */
export function formatTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "UTC+05:30" — the zone's offset at the given instant (DST-aware). */
export function utcOffsetLabel(tz: string, at: Date = new Date()): string {
  const p = parts(at, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const mins = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  if (mins === 0) return 'UTC';
  const sign = mins > 0 ? '+' : '-';
  const a = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Short zone name where the browser has one ("IST", "PDT"), else the offset label. */
export function shortZoneName(tz: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^GMT[+-]/.test(name)) return name;
  } catch { /* fall through */ }
  return utcOffsetLabel(tz, at);
}

/** Current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
