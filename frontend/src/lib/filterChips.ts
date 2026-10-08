/** Helpers + types for <ActiveFilterChips> (kept out of the component file so React Fast Refresh works). */

export interface ChipCategory { key: string; label: string; options?: { value: string; label: string }[] }
export interface FilterChip { key: string; value: string; label: string; valueLabel: string; exclude?: boolean }

type Values = Record<string, string[] | undefined>;

/** Build chips from `{ category: [values] }` using the drawer's categories for display labels. */
export function chipsFromValues(categories: ChipCategory[], values: Values, opts: { exclude?: boolean } = {}): FilterChip[] {
  const out: FilterChip[] = [];
  for (const cat of categories) {
    for (const v of values[cat.key] ?? []) {
      if (!v) continue;
      out.push({ key: cat.key, value: v, label: cat.label, valueLabel: cat.options?.find((o) => o.value === v)?.label ?? v, exclude: opts.exclude });
    }
  }
  return out;
}

/** Remove one value from a `{ category: [values] }` map (dropping the key when it empties). */
export function withoutValue<T extends Values>(values: T, key: string, value: string): T {
  const rest = (values[key] ?? []).filter((v) => v !== value);
  const next = { ...values } as Values;
  if (rest.length) next[key] = rest; else delete next[key];
  return next as T;
}
