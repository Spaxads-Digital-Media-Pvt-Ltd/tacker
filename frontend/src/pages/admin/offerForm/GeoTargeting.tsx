/**
 * Country-aware geo pickers for Offer › Targeting. Values stay ISO codes / English city names
 * (what the tracking server matches against MaxMind); everything else here is display.
 *  - Country: every ISO country, searchable, shown by full name, with each selected country's
 *    timezone and live local time.
 *  - Region: limited to the included countries' top-level ISO 3166-2 subdivisions.
 *  - City: suggestions from the included countries (and regions), free text still allowed.
 */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { SearchablePicker, type PickerOption } from '../../../shared-components/primitives/SearchablePicker';
import {
  countryLabel, countryName, countryOptions, countryTimeZone, regionName, useCities, useRegions, useTimezones,
} from '../../../data/geo';
import { formatTime, useNow, utcOffsetLabel } from '../../../lib/datetime';

export function ValueChips({ values, label, onRemove }: { values: string[]; label?: (v: string) => string; onRemove: (v: string) => void }) {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-tiny text-fg">
          {label ? label(v) : v}
          <button type="button" aria-label={`Remove ${label ? label(v) : v}`} onClick={() => onRemove(v)} className="text-fg-muted hover:text-fg"><X size={11} /></button>
        </span>
      ))}
    </div>
  );
}

export function CountryPicker({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const options = useMemo(() => countryOptions(), []);
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} ariaLabel="Countries"
        placeholder="Select countries…" searchPlaceholder="Search countries by name or code…" />
      <ValueChips values={values} label={countryLabel} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}

/** Each selected country's timezone + live local time. Multi-zone countries get a zone picker. */
export function CountryClocks({ countries, regionCodes, picked, onPick }: {
  countries: string[]; regionCodes: string[];
  picked: Record<string, string>; onPick: (country: string, tz: string) => void;
}) {
  const zones = useTimezones();
  const regions = useRegions();
  const now = useNow(1000);
  if (!countries.length) return null;
  const MAX = 8;
  return (
    <div className="space-y-1.5 rounded-card border border-border bg-surface p-3">
      <div className="text-tiny font-semibold uppercase tracking-wide text-fg-muted">Local time</div>
      {!zones ? <p className="text-tiny text-fg-muted">Loading timezones…</p> : countries.slice(0, MAX).map((cc) => {
        const list = zones[cc] ?? [];
        const tz = countryTimeZone(zones, regions, cc, { picked: picked[cc], regionCodes });
        return (
          <div key={cc} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
            <span className="min-w-[9rem] font-medium text-fg">{countryName(cc)}</span>
            {!tz ? <span className="text-fg-muted">No timezone data</span> : list.length > 1 ? (
              <select className="input !w-auto !py-1 text-tiny" value={tz} aria-label={`${countryName(cc)} timezone`}
                onChange={(e) => onPick(cc, e.target.value)}>
                {/* The region-derived zone may not be the country's first; it's always in the list. */}
                {list.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')} ({utcOffsetLabel(z, now)})</option>)}
              </select>
            ) : (
              <span className="text-fg-secondary">{tz.replace(/_/g, ' ')} ({utcOffsetLabel(tz, now)})</span>
            )}
            {tz && <span className="font-mono tabular-nums text-fg">· {formatTime(now, tz)}</span>}
          </div>
        );
      })}
      {countries.length > MAX && <p className="text-tiny text-fg-muted">+{countries.length - MAX} more countries</p>}
    </div>
  );
}

const REGION_CODE = /^([A-Z]{2}-)?[A-Z0-9]{1,3}$/;

export function RegionPicker({ countries, values, onChange }: { countries: string[]; values: string[]; onChange: (v: string[]) => void }) {
  const regions = useRegions();
  const options = useMemo<PickerOption[]>(() => {
    if (!regions) return [];
    const grouped = countries.length > 1;
    return countries.flatMap((cc) => (regions[cc] ?? []).map(([code, name]) => ({
      value: code, label: name, hint: code, group: grouped ? countryName(cc) : undefined,
    })));
  }, [regions, countries]);
  const label = (v: string) => { const n = regionName(regions, v, countries.length === 1 ? countries[0] : null); return n ? `${n} (${v})` : v; };
  const noData = regions && options.length === 0;
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} disabled={!regions} ariaLabel="Regions"
        placeholder={!regions ? 'Loading regions…' : `Select ${countries.length === 1 ? `${countryName(countries[0])} ` : ''}regions…`}
        searchPlaceholder="Search regions by name or code…"
        emptyText={noData ? 'No region list for the selected countries — type an ISO code and press Enter.' : 'No matches'}
        allowCustom={(t) => (REGION_CODE.test(t.toUpperCase()) ? t.toUpperCase() : null)} />
      <ValueChips values={values} label={label} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}

export function CityPicker({ countries, regionCodes, values, onChange }: {
  countries: string[]; regionCodes: string[]; values: string[]; onChange: (v: string[]) => void;
}) {
  const cities = useCities(countries, regionCodes);
  const regions = useRegions();
  const options = useMemo<PickerOption[]>(() => {
    const grouped = countries.length > 1;
    const seen = new Set<string>();
    const out: PickerOption[] = [];
    for (const c of cities) {
      const k = `${c.country}|${c.name.toLowerCase()}`;
      if (seen.has(k)) continue; // same name in two regions — the value is the name either way
      seen.add(k);
      out.push({ value: c.name, label: c.name, hint: c.region ? (regionName(regions, c.region) ?? undefined) : undefined, group: grouped ? countryName(c.country) : undefined });
    }
    return out;
  }, [cities, regions, countries.length]);
  const narrowed = regionCodes.length > 0;
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} ariaLabel="Cities"
        placeholder={`Select cities${narrowed ? ' in the selected regions' : ''}…`} searchPlaceholder="Search cities, or type any city name…"
        allowCustom={(t) => t.trim() || null} />
      <ValueChips values={values} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}
