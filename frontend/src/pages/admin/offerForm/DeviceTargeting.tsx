/**
 * Searchable pickers for Offer › Targeting › Device Characteristics — same pattern as the geo
 * pickers: full list in a dropdown with a pinned search box, popular entries first, values saved
 * exactly as the tracking server's User-Agent parser names them. OS Version follows the included
 * Platforms the way Region follows Country.
 */
import { useMemo } from 'react';
import { SearchablePicker, type PickerOption } from '../../../shared-components/primitives/SearchablePicker';
import { LANGUAGE_TAGS, OS_VERSIONS, POPULAR_LANGUAGES, languageLabel } from '../../../data/userAgent';
import { ValueChips } from './GeoTargeting';

/** Popular entries as their own group on top, then everything else A–Z. */
function popularFirst(all: readonly string[], popular: readonly string[], noun: string, label: (v: string) => string = (v) => v): PickerOption[] {
  const pop = new Set(popular.map((p) => p.toLowerCase()));
  const rest = all.filter((v) => !pop.has(v.toLowerCase()))
    .sort((a, b) => label(a).localeCompare(label(b), 'en', { sensitivity: 'base' }));
  return [
    ...popular.map((v) => ({ value: v, label: label(v), group: 'Popular' })),
    ...rest.map((v) => ({ value: v, label: label(v), group: `All ${noun}` })),
  ];
}

const FREE_TEXT = (t: string) => t.trim() || null;

export function NamePicker({ all, popular, noun, values, onChange }: {
  all: readonly string[]; popular: readonly string[]; noun: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const options = useMemo(() => popularFirst(all, popular, noun), [all, popular, noun]);
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} ariaLabel={noun}
        placeholder={`Select ${noun}…`} searchPlaceholder={`Search ${all.length} ${noun}…`} allowCustom={FREE_TEXT} />
      <ValueChips values={values} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}

export function LanguagePicker({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const options = useMemo(() => popularFirst(LANGUAGE_TAGS, POPULAR_LANGUAGES, 'languages', languageLabel), []);
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} ariaLabel="Languages"
        placeholder="Select languages…" searchPlaceholder="Search by language name or code (e.g. hindi, pt-BR)…"
        allowCustom={(t) => (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(t.trim()) ? t.trim() : null)} />
      <ValueChips values={values} label={languageLabel} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}

/** Versions grouped by the included Platforms (or every known platform when none is included). */
export function OsVersionPicker({ platforms, values, onChange }: { platforms: string[]; values: string[]; onChange: (v: string[]) => void }) {
  const known = Object.keys(OS_VERSIONS);
  const chosen = platforms.length
    ? known.filter((p) => platforms.some((x) => x.toLowerCase() === p.toLowerCase()))
    : known;
  const chosenKey = chosen.join('|');
  const options = useMemo<PickerOption[]>(() => (chosenKey ? chosenKey.split('|') : []).flatMap((p) => (OS_VERSIONS[p] ?? []).map((v) => ({
    value: v, label: `${p} ${v}`, group: p,
  }))), [chosenKey]);
  const empty = platforms.length > 0 && chosen.length === 0;
  return (
    <div className="space-y-2">
      <SearchablePicker options={options} value={values} onChange={onChange} ariaLabel="OS versions"
        placeholder={chosen.length && platforms.length ? `Select ${chosen.join(' / ')} versions…` : 'Select OS versions…'}
        searchPlaceholder="Search versions, or type one (e.g. 17.4)…"
        emptyText={empty ? 'No version list for the selected platforms — type a version and press Enter.' : 'No matches'}
        allowCustom={(t) => (/^[0-9a-z][0-9a-z. ]{0,20}$/i.test(t.trim()) ? t.trim() : null)} />
      <ValueChips values={values} onRemove={(v) => onChange(values.filter((x) => x !== v))} />
    </div>
  );
}
