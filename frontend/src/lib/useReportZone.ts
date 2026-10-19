/**
 * The report time zone (D7 / O10) — one zone for a report page's date range, its day / hour buckets
 * and its timestamps. Default: the network's (Settings › General, from GET /api/me — staff and portals
 * alike; UTC when the network has none). The picker beside the date range overrides it, remembered
 * per network + user so every report opens in the zone last chosen. The network's zone is cached
 * (localStorage) so a page's first request already uses it; until it's known on a first visit, the
 * browser's zone stands in. Helpers: lib/reportZone.ts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from './useApi';
import { useAuth } from '../auth/AuthContext';
import { countryTimeZone, useTimezones } from '../data/geo';
import { browserTimeZone, isValidTimeZone, shortZoneName, utcOffsetLabel } from './datetime';
import { daysAgoIn, todayIn, zoneRangeParams } from './reportZone';

/** A zone's "today" / "n days ago" — what URL readers outside a component need for their defaults. */
export type ZoneDays = Pick<ReportZone, 'today' | 'daysAgo'>;

export interface ReportZone {
  /** The zone in use. */
  tz: string;
  /** What the report uses when nothing is picked (the network's zone). */
  auto: { tz: string; source: string };
  override: string | null;
  setOverride: (tz: string | null) => void;
  /** Suggestions when a Country filter is applied (its zones). */
  countryZones: string[];
  networkTz: string | null;
  /** "IST · UTC+05:30" — for column headers. */
  label: string;
  /** "IST" (or "UTC+05:30") — for the date range label. */
  short: string;
  /** Today / `n` days ago in this zone (YYYY-MM-DD). */
  today: () => string;
  daysAgo: (n: number) => string;
  /** A from / to range as API params: plain dates + `tz`. */
  range: (from: string, to: string) => { from: string; to: string; tz?: string };
}

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string | null) => {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* storage unavailable */ }
};

export function useReportZone(country?: string | null): ReportZone {
  const { session } = useAuth();
  const networkKey = `tracker.reportZone.network:${session?.networkId ?? ''}`;
  const overrideKey = `tracker.reportZone.override:${session?.networkId ?? ''}:${session?.email ?? ''}`;

  const { data: me } = useQuery<{ reportTimeZone?: string }>('/api/me');
  const fromApi = isValidTimeZone(me?.reportTimeZone) ? me!.reportTimeZone! : null;
  const [cached] = useState(() => read(networkKey));
  useEffect(() => { if (fromApi) write(networkKey, fromApi); }, [fromApi, networkKey]);
  const networkTz = fromApi ?? (isValidTimeZone(cached) ? cached : null);

  const [override, setOverrideState] = useState<string | null>(() => { const v = read(overrideKey); return isValidTimeZone(v) ? v : null; });
  const setOverride = useCallback((tz: string | null) => {
    const v = tz && isValidTimeZone(tz) ? tz : null;
    setOverrideState(v);
    write(overrideKey, v);
  }, [overrideKey]);

  const zones = useTimezones();
  const cc = country ? country.toUpperCase() : null;
  const countryTz = cc ? countryTimeZone(zones, null, cc) : null;
  const countryZones = useMemo(() => (cc ? (zones?.[cc] ?? []) : []), [cc, zones]);

  const auto = networkTz ? { tz: networkTz, source: 'Network' } : { tz: browserTimeZone(), source: 'Browser' };
  const tz = override ?? auto.tz;
  const short = shortZoneName(tz);
  const offset = utcOffsetLabel(tz);
  return {
    tz, auto, override, setOverride, networkTz,
    countryZones: countryTz && !countryZones.includes(countryTz) ? [countryTz, ...countryZones] : countryZones,
    // A zone with no short name of its own is named by its offset — said once, not twice.
    label: short === offset ? offset : `${short} · ${offset}`,
    short,
    today: () => todayIn(tz),
    daysAgo: (n: number) => daysAgoIn(n, tz),
    range: (from: string, to: string) => zoneRangeParams(from, to, tz),
  };
}
