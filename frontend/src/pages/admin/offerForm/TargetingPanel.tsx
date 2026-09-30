/**
 * Offer Targeting (Edit/Create Offer › Targeting). Every dimension is a real include/exclude rule
 * saved in the offer's `targeting` and enforced by the tracking server on /click — a click that
 * fails a rule is diverted to the Fail Traffic URL (or a neutral 204). Device Type maps onto the
 * offer's allowed traffic types. Geo dimensions need the GeoIP database on the tracking server;
 * without it they're skipped rather than blocking all traffic.
 */
import { useMemo, useState } from 'react';
import { Segmented } from '../../../shared-components/primitives/ui';
import { normalizePostal } from '../../../lib/postal';
import { validateTargetingValue, zipCountries } from './targetingValidation';
import type { OfferTargeting, TargetingKey, TargetingRule } from '../../../types';
import { CategoryPicker, ChipInput } from './controls';

const DEVICES = ['desktop', 'mobile', 'tablet'] as const;

interface DimMeta { label: string; placeholder: string; hint: string; suggestions?: string[]; geo?: boolean; normalize?: (v: string) => string }

const DIMS: Record<Exclude<TargetingKey, 'zip'>, DimMeta> = {
  platform: { label: 'Platform', placeholder: 'e.g. iOS', hint: 'Operating system, as detected from the User-Agent.', suggestions: ['Windows', 'Mac OS', 'iOS', 'Android', 'Linux', 'Chrome OS'] },
  browser: { label: 'Browser', placeholder: 'e.g. Chrome', hint: 'Browser family, as detected from the User-Agent.', suggestions: ['Chrome', 'Safari', 'Mobile Safari', 'Firefox', 'Edge', 'Opera', 'Samsung Browser'] },
  deviceBrand: { label: 'Device Brand', placeholder: 'e.g. Samsung', hint: 'Device manufacturer (mobile/tablet User-Agents).', suggestions: ['Apple', 'Samsung', 'Google', 'Xiaomi', 'Huawei', 'OnePlus', 'Motorola'] },
  osVersion: { label: 'OS Version', placeholder: 'e.g. 17 or 17.4', hint: '“17” matches 17, 17.4, 17.4.1… Combine with Platform to target e.g. iOS 17.' },
  language: { label: 'Language', placeholder: 'e.g. en or en-US', hint: 'From the browser’s Accept-Language. “en” matches any English variant.', suggestions: ['en', 'en-US', 'en-GB', 'es', 'fr', 'de', 'hi', 'pt', 'ja', 'zh'] },
  country: { label: 'Country', placeholder: 'e.g. US', hint: '2-letter ISO code.', suggestions: ['US', 'GB', 'CA', 'AU', 'IN', 'DE', 'FR', 'ES', 'IT', 'BR', 'MX', 'JP'], geo: true, normalize: (v) => v.toUpperCase() },
  region: { label: 'Region', placeholder: 'e.g. US-CA or CA', hint: 'State/province ISO code, optionally prefixed with the country. Add a Country above to see that country’s own example.', geo: true, normalize: (v) => v.toUpperCase() },
  city: { label: 'City', placeholder: 'e.g. San Jose', hint: 'City name (English).', geo: true },
  dma: { label: 'DMA', placeholder: 'e.g. 501', hint: 'US Nielsen DMA (metro) code — 3 digits.', geo: true },
  mobileCarrier: { label: 'Mobile Carrier', placeholder: 'e.g. Verizon Wireless', hint: 'Requires the GeoIP2-ISP database on the tracking server; skipped when it isn’t loaded.', geo: true },
  isp: { label: 'ISP', placeholder: 'e.g. Comcast', hint: 'Matches if the ISP name contains this text.', geo: true },
  ipExact: { label: 'Exact', placeholder: 'e.g. 203.0.113.7', hint: 'Single IPv4 or IPv6 address.' },
  ipRange: { label: 'Range', placeholder: 'e.g. 203.0.113.0/24 or 203.0.113.10-203.0.113.50', hint: 'IPv4 CIDR or inclusive start-end range.' },
};

// A real subdivision code per country in the Country suggestions list above, so once a Country is
// included, the Region placeholder/hint show *that* country's own example instead of a generic
// (and confusing — "why is it showing me a US example when I picked India?") US one.
const REGION_EXAMPLE: Record<string, string> = {
  US: 'CA', GB: 'ENG', CA: 'ON', AU: 'NSW', IN: 'MH', DE: 'BY', FR: 'IDF', ES: 'MD', IT: 'MI', BR: 'SP', MX: 'CMX', JP: '13',
};

/** Region placeholder/hint, adapted to the offer's currently-included Countries (if any). */
function regionMeta(countries: string[]): { placeholder: string; hint: string } {
  const base = DIMS.region;
  if (countries.length === 0) return { placeholder: base.placeholder, hint: base.hint };
  const examples = countries.map((c) => REGION_EXAMPLE[c] ? `${c}-${REGION_EXAMPLE[c]} or ${REGION_EXAMPLE[c]}` : `${c}-XX or XX`);
  return {
    placeholder: `e.g. ${examples[0]}`,
    hint: `State/province ISO code for ${countries.join('/')} (e.g. ${examples.join(', ')}), optionally prefixed with the country.`,
  };
}

const DEVICE_KEYS: Record<string, TargetingKey | 'deviceType'> = {
  Platform: 'platform', 'Device Type': 'deviceType', Browser: 'browser', 'Device Brand': 'deviceBrand', 'OS Version': 'osVersion', Language: 'language',
};
const GEO_KEYS: Record<string, TargetingKey> = {
  Country: 'country', Region: 'region', City: 'city', DMA: 'dma', 'Mobile Carrier': 'mobileCarrier', ISP: 'isp',
};
const IP_KEYS: Record<string, TargetingKey> = { Exact: 'ipExact', Range: 'ipRange' };

function RuleEditor({ dim, rule, onChange, metaOverride }: {
  dim: TargetingKey; rule: TargetingRule | undefined; onChange: (r: TargetingRule | undefined) => void;
  /** Overrides placeholder/hint only — used to make Region's example country-aware (see regionMeta). */
  metaOverride?: { placeholder: string; hint: string };
}) {
  const meta = { ...DIMS[dim as Exclude<TargetingKey, 'zip'>], ...metaOverride };
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
      <ChipInput values={values} onChange={setValues} placeholder={meta.placeholder} suggestions={meta.suggestions}
        normalize={meta.normalize} validate={(v) => validateTargetingValue(dim, v)} />
      <p className="text-tiny text-fg-muted">
        {meta.hint} {mode === 'include' ? 'Only matching clicks are accepted.' : 'Matching clicks are rejected.'}
        {meta.geo && ' Needs the GeoIP database on the tracking server — skipped (not blocked) when it isn’t loaded.'}
      </p>
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
                {rule.mode === 'include' ? 'Include' : 'Exclude'} {labelOf(key)}: {rule.values.slice(0, 5).join(', ')}{rule.values.length > 5 ? ` +${rule.values.length - 5}` : ''}
                <button type="button" aria-label={`Clear ${labelOf(key)}`} onClick={() => { setRule(key, undefined); if (key === 'zip') { setZipText(''); setLocalZipMode('include'); } }}>×</button>
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
            return <RuleEditor key={k} dim={k} rule={targeting[k]} onChange={(r) => setRule(k, r)} />;
          }}
        />
      </div>

      <div>
        <h3 className="mb-2 text-h3 font-medium text-fg">Geolocation</h3>
        <CategoryPicker
          categories={Object.keys(GEO_KEYS)}
          badge={(c) => targeting[GEO_KEYS[c]!]?.values.length ?? 0}
          panel={(c) => {
            const k = GEO_KEYS[c]!;
            return <RuleEditor key={k} dim={k} rule={targeting[k]} onChange={(r) => setRule(k, r)} metaOverride={k === 'region' ? regionMeta(countries) : undefined} />;
          }}
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
