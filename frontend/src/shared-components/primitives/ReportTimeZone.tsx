/** Report header control showing / overriding the display timezone (see lib/useReportTimeZone). */
import { useMemo } from 'react';
import { Globe } from 'lucide-react';
import { UTC, allTimeZones, browserTimeZone, utcOffsetLabel } from '../../lib/datetime';
import type { ReportTimeZone } from '../../lib/useReportTimeZone';

const pretty = (tz: string) => tz.replace(/_/g, ' ');

export function TimeZoneSelect({ zone }: { zone: ReportTimeZone }) {
  const all = useMemo(() => allTimeZones(), []);
  const suggested = Array.from(new Set([...zone.countryZones, zone.networkTz, browserTimeZone(), UTC].filter((z): z is string => Boolean(z))));
  return (
    <label className="flex items-center gap-1.5 text-tiny text-fg-secondary" title="Timezone used to display the timestamps below">
      <Globe size={14} className="shrink-0 text-fg-muted" />
      <select className="input !w-auto !py-1 text-tiny" aria-label="Display timezone" value={zone.override ?? ''}
        onChange={(e) => zone.setOverride(e.target.value || null)}>
        <option value="">Auto — {zone.auto.source}: {pretty(zone.auto.tz)} ({utcOffsetLabel(zone.auto.tz)})</option>
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
