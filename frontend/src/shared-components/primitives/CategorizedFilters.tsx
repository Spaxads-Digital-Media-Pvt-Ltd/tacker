/**
 * Shared filter types for the filter drawers (CategoryFilterDrawer, ReportingFiltersFlyout) and the
 * applied-filter count helper. (The old unused "CategorizedFiltersFlyout" — with its inert-label
 * placeholders — was removed in the filters audit.)
 */

export interface FilterCategory {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type FilterValues = Record<string, string[]>;

export function appliedFilterCount(values: FilterValues, singleSelectKeys: string[] = []): number {
  return Object.entries(values).reduce((n, [key, arr]) => {
    const len = arr?.length ?? 0;
    if (singleSelectKeys.includes(key)) {
      const v = arr?.[0];
      return n + (v && v !== 'any' ? 1 : 0);
    }
    return n + len;
  }, 0);
}
