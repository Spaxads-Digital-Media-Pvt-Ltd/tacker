/**
 * Status filters of the detail reports — the option lists their Reporting Filters category shows
 * and the URL/API param each maps to, validated on read so a hand-edited link can't send a value
 * the API would reject. Pure (no imports) — tested in lib/__tests__/reportStatusFilters.test.ts.
 */
export interface StatusOption { value: string; label: string }

/**
 * Click Report › "Conversion Status" (`conversionStatus` on /api/reports/clicks and /grouped): keep
 * only clicks that have a conversion in that status. No selection = no param = every click.
 */
export const CONVERSION_STATUS_PARAM = 'conversionStatus';
export const CONVERSION_STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'any', label: 'Any conversion' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'none', label: 'Not converted' },
];

/**
 * Click → Conversion Time › "Conversion Status" (`status` on /api/reports/click-to-conversion-time).
 * No param = approved — the endpoint's default — so "Approved" is labelled as the default and
 * selecting it is the same report as selecting nothing.
 */
export const C2C_STATUS_PARAM = 'status';
export const C2C_DEFAULT_STATUS = 'approved';
export const C2C_STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'approved', label: 'Approved (default)' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All statuses' },
];

/** The param's value when it is one of `options`, else undefined (absent, empty or unknown). */
export function readStatusParam(sp: URLSearchParams, key: string, options: readonly StatusOption[]): string | undefined {
  const raw = sp.get(key)?.trim().toLowerCase();
  return raw && options.some((o) => o.value === raw) ? raw : undefined;
}

/** A selected value → the API/URL param value (undefined = send nothing); unknown values are dropped. */
export function statusParamValue(selected: readonly string[] | undefined, options: readonly StatusOption[]): string | undefined {
  const v = selected?.[0];
  return v && options.some((o) => o.value === v) ? v : undefined;
}
