/**
 * Display timezone for row-level reports (Click, Conversion). Timestamps arrive as UTC instants
 * and are only re-formatted with it — switching zones never refetches.
 *
 * Auto zone: the filtered Country's primary zone → the network timezone (Settings › General) →
 * the browser's zone. The user can override it (see <TimeZoneSelect>); changing the Country
 * filter drops the override so the report follows the newly selected country.
 */
import { useEffect, useState } from 'react';
import { useQuery } from './useApi';
import { countryName, countryTimeZone, useTimezones } from '../data/geo';
import { browserTimeZone, isValidTimeZone, shortZoneName, utcOffsetLabel } from './datetime';

interface SettingsShape { general?: { timezone?: string } }

export interface ReportTimeZone {
  tz: string;
  auto: { tz: string; source: string };
  override: string | null;
  setOverride: (tz: string | null) => void;
  countryZones: string[];
  networkTz: string | null;
  /** "IST · UTC+05:30" — for column headers. */
  label: string;
}

export function useReportTimeZone(country: string | null | undefined): ReportTimeZone {
  const zones = useTimezones();
  const { data: settings } = useQuery<SettingsShape>('/api/settings');
  const configured = settings?.general?.timezone;
  const networkTz = isValidTimeZone(configured) ? configured : null;
  const [override, setOverride] = useState<string | null>(null);
  const cc = country ? country.toUpperCase() : null;
  useEffect(() => { setOverride(null); }, [cc]);

  const countryTz = cc ? countryTimeZone(zones, null, cc) : null;
  const auto = countryTz ? { tz: countryTz, source: countryName(cc) }
    : networkTz ? { tz: networkTz, source: 'Network' }
    : { tz: browserTimeZone(), source: 'Browser' };
  const tz = override && isValidTimeZone(override) ? override : auto.tz;
  return {
    tz, auto, override, setOverride, networkTz,
    countryZones: cc ? (zones?.[cc] ?? []) : [],
    label: `${shortZoneName(tz)} · ${utcOffsetLabel(tz)}`,
  };
}
