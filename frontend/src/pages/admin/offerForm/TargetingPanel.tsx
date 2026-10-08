/**
 * Offer Targeting (Edit/Create Offer › Targeting). Every dimension is a real include/exclude rule
 * saved in the offer's `targeting` and enforced by the tracking server on /click — a click that
 * fails a rule is diverted to the Fail Traffic URL (or a neutral 204). Device Type maps onto the
 * offer's allowed traffic types. Geo dimensions need the GeoIP database on the tracking server;
 * without it they're skipped rather than blocking all traffic.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Segmented } from '../../../shared-components/primitives/ui';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { normalizePostal } from '../../../lib/postal';
import { countryName, loadCityNames, regionName, useRegions } from '../../../data/geo';
import { validateTargetingValue, zipCountries } from './targetingValidation';
import type { OfferTargeting, TargetingKey, TargetingRule } from '../../../types';
import { CategoryPicker, ChipInput } from './controls';
import { CityPicker, CountryClocks, CountryPicker, RegionPicker, ValueChips } from './GeoTargeting';
import { LanguagePicker, NamePicker, OsVersionPicker } from './DeviceTargeting';
import { BROWSERS, DEVICE_BRANDS, PLATFORMS, POPULAR_BRANDS, POPULAR_BROWSERS, POPULAR_PLATFORMS, languageLabel } from '../../../data/userAgent';

const DEVICES = ['desktop', 'mobile', 'tablet'] as const;

interface DimMeta { label: string; placeholder: string; hint: string; suggestions?: string[]; geo?: boolean; normalize?: (v: string) => string }

const DIMS: Record<Exclude<TargetingKey, 'zip'>, DimMeta> = {
  platform: { label: 'Platform', placeholder: 'Select platforms…', hint: 'Operating system, as detected from the User-Agent (names exactly as the tracker reports them).' },
  browser: { label: 'Browser', placeholder: 'Select browsers…', hint: 'Browser family, as detected from the User-Agent (names exactly as the tracker reports them).' },
  deviceBrand: { label: 'Device Brand', placeholder: 'Select brands…', hint: 'Device manufacturer (mobile/tablet User-Agents).' },
  osVersion: { label: 'OS Version', placeholder: 'e.g. 17 or 17.4', hint: '“17” matches 17, 17.4, 17.4.1… Include a Platform to list only its versions (e.g. iOS 17).' },
  language: { label: 'Language', placeholder: 'Select languages…', hint: 'From the browser’s Accept-Language. “en” matches any English variant.' },
  country: { label: 'Country', placeholder: 'Select countries…', hint: 'Search by name or ISO code; saved as the 2-letter ISO code.', geo: true },
  region: { label: 'Region', placeholder: 'e.g. US-CA or CA', hint: 'State/province ISO code, optionally prefixed with the country. Include a Country to pick from that country’s regions.', geo: true, normalize: (v) => v.toUpperCase() },
  city: { label: 'City', placeholder: 'e.g. San Jose', hint: 'City name (English). Include a Country to get that country’s cities as suggestions.', geo: true },
  dma: { label: 'DMA', placeholder: 'e.g. 501', hint: 'US Nielsen DMA (metro) code — 3 digits.', geo: true },
  mobileCarrier: { label: 'Mobile Carrier', placeholder: 'e.g. Verizon Wireless', hint: 'Requires the GeoIP2-ISP database on the tracking server; skipped when it isn’t loaded.', geo: true },
  isp: { label: 'ISP', placeholder: 'e.g. Comcast', hint: 'Matches if the ISP name contains this text.', geo: true },
  ipExact: { label: 'Exact', placeholder: 'e.g. 203.0.113.7', hint: 'Single IPv4 or IPv6 address.' },
  ipRange: { label: 'Range', placeholder: 'e.g. 203.0.113.0/24 or 203.0.113.10-203.0.113.50', hint: 'IPv4 CIDR or inclusive start-end range.' },
};

const DEVICE_KEYS: Record<string, TargetingKey | 'deviceType'> = {
  Platform: 'platform', 'Device Type': 'deviceType', Browser: 'browser', 'Device Brand': 'deviceBrand', 'OS Version': 'osVersion', Language: 'language',
};
const GEO_KEYS: Record<string, TargetingKey> = {
  Country: 'country', Region: 'region', City: 'city', DMA: 'dma', 'Mobile Carrier': 'mobileCarrier', ISP: 'isp',
};
const IP_KEYS: Record<string, TargetingKey> = { Exact: 'ipExact', Range: 'ipRange' };

function RuleEditor({ dim, rule, onChange, hintOverride, editor, footer }: {
  dim: TargetingKey; rule: TargetingRule | undefined; onChange: (r: TargetingRule | undefined) => void;
  hintOverride?: string;
  /** Replaces the default free-text chip input (the country-aware geo pickers). */
  editor?: (values: string[], setValues: (v: string[]) => void) => ReactNode;
  /** Extra content under the hint (e.g. the selected countries' local times). */
  footer?: ReactNode;
}) {
  const meta = { ...DIMS[dim as Exclude<TargetingKey, 'zip'>], ...(hintOverride ? { hint: hintOverride } : {}) };
  // Mode is tracked locally so picking Include/Exclude before any value exists actually sticks —
  // with zero values there's nothing to save into `targeting` yet (an empty rule would show as a
  // blank chip in the summary), so the parent rule stays undefined until the first value is added.
  // Deriving mode from `rule?.mode` alone would snap back to "include" on every such click.
  const [localMode, setLocalMode] = useState<TargetingRule['mode']>(rule?.mode ?? 'include');
  const mode = rule?.mode ?? localMode;
  const values = rule?.values ?? [];
  const setMode = (m: TargetingRule['mode']) => {
    setLocalMode(m);
    if (values.length) onChange({ mode: m, values });
  };
  const setValues = (v: string[]) => onChange(v.length ? { mode, values: v } : undefined);
  return (
    <div className="space-y-3">
      <Segmented className="!w-auto inline-flex" options={[{ value: 'include', label: 'Include' }, { value: 'exclude', label: 'Exclude' }]}
        value={mode} onChange={(v) => setMode(v as TargetingRule['mode'])} />
      {editor ? editor(values, setValues) : (
        <ChipInput values={values} onChange={setValues} placeholder={meta.placeholder} suggestions={meta.suggestions}
          normalize={meta.normalize} validate={(v) => validateTargetingValue(dim, v)} />
      )}
      <p className="text-tiny text-fg-muted">
        {meta.hint} {mode === 'include' ? 'Only matching clicks are accepted.' : 'Matching clicks are rejected.'}
        {meta.geo && ' Needs the GeoIP database on the tracking server — skipped (not blocked) when it isn’t loaded.'}
      </p>
      {footer}
    </div>
  );
}

function labelOf(key: TargetingKey): string {
  return key === 'zip' ? 'ZIP/Postal Code' : key === 'ipExact' ? 'IP (Exact)' : key === 'ipRange' ? 'IP (Range)' : DIMS[key].label;
}

export function TargetingPanel({ targeting, onChange, deviceTypes, onDeviceTypesChange }: {
  targeting: OfferTargeting;
  onChange: (t: OfferTargeting) => void;
  deviceTypes: string[];
  onDeviceTypesChange: (d: string[]) => void;
}) {
  const setRule = (key: TargetingKey, rule: TargetingRule | undefined) => {
    const next = { ...targeting };
    if (rule) next[key] = rule; else delete next[key];
    onChange(next);
  };
  const toggleDevice = (d: string) => onDeviceTypesChange(deviceTypes.includes(d) ? deviceTypes.filter((x) => x !== d) : [...deviceTypes, d]);
  const confirm = useConfirm();
  const regions = useRegions();
  // Display-only timezone choice per multi-zone country (not saved — targeting has no timezone).
  const [pickedTz, setPickedTz] = useState<Record<string, string>>({});

  // ZIP textarea keeps the raw text so partially-typed lines aren't reformatted mid-edit. Mode is
  // local for the same reason as RuleEditor: with no lines typed yet there's no rule to hold it,
  // so deriving mode from targeting.zip?.mode alone would snap the toggle back to Include.
  const [zipText, setZipText] = useState(() => (targeting.zip?.values ?? []).join('\n'));
  const [localZipMode, setLocalZipMode] = useState<TargetingRule['mode']>(targeting.zip?.mode ?? 'include');
  const zipMode = targeting.zip?.mode ?? localZipMode;
  const countries = zipCountries(targeting);
  const zipLineErrors = useMemo(() => zipText.split('\n').map((line, i) => {
    const v = line.trim();
    if (!v) return null;
    const e = validateTargetingValue('zip', v, countries);
    return e ? `Line ${i + 1}: ${e}` : null;
  }).filter((x): x is string => Boolean(x)), [zipText, countries]);
  const updateZip = (text: string, mode: TargetingRule['mode'] = zipMode) => {
    setZipText(text);
    setLocalZipMode(mode);
    const values = Array.from(new Set(text.split('\n').map((l) => l.trim()).filter(Boolean).map(normalizePostal)));
    setRule('zip', values.length ? { mode, values } : undefined);
  };

  // Countries the dependent geo fields follow (included ones — an Exclude list says nothing about
  // where the traffic *is*), plus the included regions as full "CC-XX" codes.
  const selectedCountries = (targeting.country?.values ?? []).map((c) => c.toUpperCase());
  const regionCodes = targeting.region?.mode === 'include'
    ? targeting.region.values.map((r) => r.toUpperCase()).map((r) => (r.includes('-') || countries.length !== 1 ? r : `${countries[0]}-${r}`)).filter((r) => r.includes('-'))
    : [];
  const singleCountry = countries.length === 1 ? countries[0] : null;
  const displayValue = (key: TargetingKey, v: string) => (key === 'country' ? countryName(v)
    : key === 'region' ? (regionName(regions, v, singleCountry) ?? v)
    : key === 'language' ? languageLabel(v) : v);
  const includedPlatforms = targeting.platform?.mode === 'include' ? targeting.platform.values : [];

  const devicePanel = (k: TargetingKey): ReactNode => {
    const rule = targeting[k];
    const set = (r: TargetingRule | undefined) => setRule(k, r);
    switch (k) {
      case 'platform': return <RuleEditor key={k} dim={k} rule={rule} onChange={set} editor={(v, s) => <NamePicker all={PLATFORMS} popular={POPULAR_PLATFORMS} noun="platforms" values={v} onChange={s} />} />;
      case 'browser': return <RuleEditor key={k} dim={k} rule={rule} onChange={set} editor={(v, s) => <NamePicker all={BROWSERS} popular={POPULAR_BROWSERS} noun="browsers" values={v} onChange={s} />} />;
      case 'deviceBrand': return <RuleEditor key={k} dim={k} rule={rule} onChange={set} editor={(v, s) => <NamePicker all={DEVICE_BRANDS} popular={POPULAR_BRANDS} noun="brands" values={v} onChange={s} />} />;
      case 'osVersion': return <RuleEditor key={k} dim={k} rule={rule} onChange={set} editor={(v, s) => <OsVersionPicker platforms={includedPlatforms} values={v} onChange={s} />} />;
      case 'language': return <RuleEditor key={k} dim={k} rule={rule} onChange={set} editor={(v, s) => <LanguagePicker values={v} onChange={s} />} />;
      default: return <RuleEditor key={k} dim={k} rule={rule} onChange={set} />;
    }
  };

  /**
   * Country edits go through here so that un-including a country can also clean up the Region /
   * City / DMA values that only made sense for it — after asking; the country change itself
   * applies immediately either way.
   */
  const onCountryRule = async (rule: TargetingRule | undefined) => {
    const next: OfferTargeting = { ...targeting };
    if (rule) next.country = rule; else delete next.country;
    onChange(next);

    const up = (r?: TargetingRule) => (r?.mode === 'include' ? r.values.map((c) => c.toUpperCase()) : []);
    const kept = up(next.country);
    const removed = up(targeting.country).filter((c) => !kept.includes(c));
    if (!removed.length) return;

    const orphanRegions = (next.region?.values ?? []).filter((v) => removed.some((cc) => v.toUpperCase().startsWith(`${cc}-`)));
    let orphanCities: string[] = [];
    const cityValues = next.city?.values ?? [];
    if (cityValues.length) {
      const [gone, stay] = await Promise.all([Promise.all(removed.map(loadCityNames)), Promise.all(kept.map(loadCityNames))]);
      const goneSet = new Set(gone.flat().map((n) => n.toLowerCase()));
      const staySet = new Set(stay.flat().map((n) => n.toLowerCase()));
      orphanCities = cityValues.filter((v) => goneSet.has(v.toLowerCase()) && !staySet.has(v.toLowerCase()));
    }
    const orphanDma = removed.includes('US') && kept.length > 0 ? (next.dma?.values ?? []) : [];
    if (!orphanRegions.length && !orphanCities.length && !orphanDma.length) return;

    const lines = [
      orphanRegions.length ? `Region: ${orphanRegions.map((v) => regionName(regions, v) ?? v).join(', ')}` : null,
      orphanCities.length ? `City: ${orphanCities.join(', ')}` : null,
      orphanDma.length ? `DMA: ${orphanDma.join(', ')}` : null,
    ].filter((l): l is string => Boolean(l));
    const ok = await confirm({
      title: 'Remove related geo targeting?',
      message: (
        <div className="space-y-2">
          <p>These values only apply to {removed.map(countryName).join(', ')}, which you just removed from Country:</p>
          <ul className="list-disc pl-5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p>Remove them too? Keeping them leaves those rules in place.</p>
        </div>
      ),
      confirmLabel: 'Remove them', cancelLabel: 'Keep them', destructive: true,
    });
    if (!ok) return;
    const stripped: OfferTargeting = { ...next };
    const strip = (key: 'region' | 'city' | 'dma', drop: string[]) => {
      const r = next[key];
      if (!r || !drop.length) return;
      const values = r.values.filter((v) => !drop.includes(v));
      if (values.length) stripped[key] = { ...r, values }; else delete stripped[key];
    };
    strip('region', orphanRegions); strip('city', orphanCities); strip('dma', orphanDma);
    onChange(stripped);
  };

  const geoPanel = (k: TargetingKey): ReactNode => {
    const rule = targeting[k];
    if (k === 'country') {
      return <RuleEditor key={k} dim={k} rule={rule} onChange={(r) => { void onCountryRule(r); }}
        editor={(v, set) => <CountryPicker values={v} onChange={set} />}
        footer={<CountryClocks countries={selectedCountries} regionCodes={regionCodes} picked={pickedTz} onPick={(cc, tz) => setPickedTz((p) => ({ ...p, [cc]: tz }))} />} />;
    }
    if (k === 'region' && countries.length) {
      return <RuleEditor key={k} dim={k} rule={rule} onChange={(r) => setRule(k, r)}
        hintOverride={`Regions of ${countries.map(countryName).join(', ')}, saved as ISO 3166-2 codes (e.g. ${regions?.[countries[0]!]?.[0]?.[0] ?? `${countries[0]}-XX`}).`}
        editor={(v, set) => <RegionPicker countries={countries} values={v} onChange={set} />} />;
    }
    if (k === 'city' && countries.length) {
      return <RuleEditor key={k} dim={k} rule={rule} onChange={(r) => setRule(k, r)}
        hintOverride={`Suggestions are the larger cities of ${countries.map(countryName).join(', ')}${regionCodes.length ? ' in the selected regions' : ''}; any other city name can be typed. City name (English).`}
        editor={(v, set) => <CityPicker countries={countries} regionCodes={regionCodes} values={v} onChange={set} />} />;
    }
    if (k === 'dma' && countries.length && !countries.includes('US')) {
      return <RuleEditor key={k} dim={k} rule={rule} onChange={(r) => setRule(k, r)}
        editor={(v, set) => (
          <div className="space-y-2">
            <p className="rounded-card border border-border bg-surface px-3 py-2 text-small text-fg-secondary">
              DMA codes are US-only. Include United States in Country to target DMAs.
            </p>
            <ValueChips values={v} onRemove={(x) => set(v.filter((y) => y !== x))} />
          </div>
        )} />;
    }
    return <RuleEditor key={k} dim={k} rule={rule} onChange={(r) => setRule(k, r)} />;
  };

  const active = Object.entries(targeting) as [TargetingKey, TargetingRule][];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-h3 font-medium text-fg">Inclusion/Exclusion Summary</h3>
        {active.length === 0 && deviceTypes.length === 0 ? (
          <p className="text-small italic text-fg-muted">No targeting rules configured — all traffic is allowed.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {deviceTypes.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success bg-success-bg px-3 py-1 text-tiny font-medium text-success-text">
                Include Device Type: {deviceTypes.join(', ')}
                <button type="button" aria-label="Clear device type" onClick={() => onDeviceTypesChange([])}>×</button>
              </span>
            )}
            {active.map(([key, rule]) => (
              <span key={key} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny font-medium ${rule.mode === 'include' ? 'border-success bg-success-bg text-success-text' : 'border-danger bg-danger-bg text-danger-text'}`}>
                {rule.mode === 'include' ? 'Include' : 'Exclude'} {labelOf(key)}: {rule.values.slice(0, 5).map((v) => displayValue(key, v)).join(', ')}{rule.values.length > 5 ? ` +${rule.values.length - 5}` : ''}
                <button type="button" aria-label={`Clear ${labelOf(key)}`} onClick={() => {
                  if (key === 'country') { void onCountryRule(undefined); return; }
                  setRule(key, undefined);
                  if (key === 'zip') { setZipText(''); setLocalZipMode('include'); }
                }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-h3 font-medium text-fg">Device Characteristics</h3>
        <CategoryPicker
          categories={Object.keys(DEVICE_KEYS)}
          badge={(c) => { const k = DEVICE_KEYS[c]; return k === 'deviceType' ? deviceTypes.length : (targeting[k as TargetingKey]?.values.length ?? 0); }}
          panel={(c) => {
            const k = DEVICE_KEYS[c]!;
            if (k === 'deviceType') {
              return (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {DEVICES.map((d) => (
                      <button key={d} type="button" onClick={() => toggleDevice(d)}
                        className={`rounded-full border px-4 py-1.5 text-small font-medium capitalize transition-colors ${deviceTypes.includes(d) ? 'border-accent bg-accent-subtle text-accent-text' : 'border-border bg-surface text-fg-secondary hover:bg-page'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <p className="text-tiny text-fg-muted">Only the selected device types are accepted. None selected = all device types.</p>
                </div>
              );
            }
            return devicePanel(k);
          }}
        />
      </div>

      <div>
        <h3 className="mb-2 text-h3 font-medium text-fg">Geolocation</h3>
        <CategoryPicker
          categories={Object.keys(GEO_KEYS)}
          badge={(c) => targeting[GEO_KEYS[c]!]?.values.length ?? 0}
          panel={(c) => geoPanel(GEO_KEYS[c]!)}
        />
      </div>

      <div className="space-y-2">
        <label className="label block">ZIP/Postal Code</label>
        <Segmented className="!w-auto inline-flex" options={[{ value: 'include', label: 'Include' }, { value: 'exclude', label: 'Exclude' }]}
          value={zipMode} onChange={(v) => updateZip(zipText, v as TargetingRule['mode'])} />
        <textarea className="input min-h-[100px] font-mono text-small" placeholder="Enter one value per line" value={zipText}
          onChange={(e) => updateZip(e.target.value)} />
        {zipLineErrors.length > 0 ? (
          <ul className="space-y-0.5 text-tiny text-danger-text">{zipLineErrors.map((e) => <li key={e}>{e}</li>)}</ul>
        ) : (
          <p className="text-tiny text-fg-muted">
            {countries.length
              ? `Validated against ${countries.join('/')} formats (from the included Countries).`
              : 'Validated with a generic format. Include a Country above to validate that country’s format (e.g. US 12345 / 12345-6789, UK SW1A 1AA).'}
            {' '}Needs the GeoIP database on the tracking server.
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-h3 font-medium text-fg">IP Ranges</h3>
        <CategoryPicker
          categories={Object.keys(IP_KEYS)}
          badge={(c) => targeting[IP_KEYS[c]!]?.values.length ?? 0}
          panel={(c) => { const k = IP_KEYS[c]!; return <RuleEditor key={k} dim={k} rule={targeting[k]} onChange={(r) => setRule(k, r)} />; }}
        />
      </div>
    </div>
  );
}
