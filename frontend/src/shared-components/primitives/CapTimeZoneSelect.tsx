/** The cap time zone picker — when daily caps reset (Settings › General, an offer's Caps). '' = inherit. */
import { useMemo } from 'react';
import { UTC, allTimeZones, browserTimeZone, utcOffsetLabel } from '../../lib/datetime';

const pretty = (tz: string) => tz.replace(/_/g, ' ');

export function CapTimeZoneSelect({ value, onChange, inheritLabel, id }: {
  value: string; onChange: (tz: string) => void;
  /** The '' option: what applies when none is picked (e.g. "UTC (default)", "Network — Asia/Kolkata"). */
  inheritLabel: string;
  id?: string;
}) {
  const all = useMemo(() => allTimeZones(), []);
  const suggested = Array.from(new Set([UTC, browserTimeZone(), ...(value ? [value] : [])]));
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{inheritLabel}</option>
      <optgroup label="Suggested">
        {suggested.map((z) => <option key={`s-${z}`} value={z}>{pretty(z)} ({utcOffsetLabel(z)})</option>)}
      </optgroup>
      <optgroup label="All timezones">
        {all.filter((z) => !suggested.includes(z)).map((z) => <option key={z} value={z}>{pretty(z)}</option>)}
      </optgroup>
    </select>
  );
}
