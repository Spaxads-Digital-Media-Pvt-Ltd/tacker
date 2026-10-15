/** The report's time zone picker (D7, see lib/useReportZone): its date range, days, hours and timestamps. */
import { useMemo } from 'react';
import { Globe } from 'lucide-react';
import { UTC, allTimeZones, browserTimeZone, utcOffsetLabel } from '../../lib/datetime';
import type { ReportZone } from '../../lib/useReportZone';

const pretty = (tz: string) => tz.replace(/_/g, ' ');

/** `selectClassName` overrides the compact default sizing (e.g. to match a taller toolbar row). */
export function TimeZoneSelect({ zone, selectClassName = '!py-1 text-tiny' }: { zone: ReportZone; selectClassName?: string }) {
  const all = useMemo(() => allTimeZones(), []);
  const suggested = Array.from(new Set([...zone.countryZones, zone.networkTz, browserTimeZone(), UTC].filter((z): z is string => Boolean(z))));
  return (
    <label className="flex items-center gap-1.5 text-tiny text-fg-secondary" title="The report's time zone — its date range, days, hours and times">
      <Globe size={14} className="shrink-0 text-fg-muted" />
      <select className={`input !w-auto ${selectClassName}`} aria-label="Report time zone" value={zone.override ?? ''}
        onChange={(e) => zone.setOverride(e.target.value || null)}>
        <option value="">{zone.auto.source === 'Network' ? 'Network' : 'Default'} — {pretty(zone.auto.tz)} ({utcOffsetLabel(zone.auto.tz)})</option>
        <optgroup label="Suggested">
          {suggested.map((z) => <option key={`s-${z}`} value={z}>{pretty(z)} ({utcOffsetLabel(z)})</option>)}
        </optgroup>
        <optgroup label="All timezones">
          {all.filter((z) => !suggested.includes(z)).map((z) => <option key={z} value={z}>{pretty(z)}</option>)}
        </optgroup>
      </select>
    </label>
  );
}
