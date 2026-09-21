import { useState, useEffect } from 'react';
import { SearchFilterDrawer, FieldBlock } from './SearchFilterDrawer';
import type { FilterCategory, FilterValues } from './CategorizedFilters';

export { type FilterCategory, type FilterValues } from './CategorizedFilters';

interface CategoryFilterDrawerProps {
  categories: FilterCategory[];
  values: FilterValues;
  onApply: (v: FilterValues) => void;
  onClose: () => void;
  singleSelectKeys?: string[];
  inertLabels?: string[];
}

export function CategoryFilterDrawer({ categories, values, onApply, onClose, singleSelectKeys = [], inertLabels = [] }: CategoryFilterDrawerProps) {
  const [draft, setDraft] = useState<FilterValues>(values);

  useEffect(() => { setDraft(values); }, [values]);

  const toggle = (key: string, value: string) => {
    const current = draft[key] ?? [];
    const isSingle = singleSelectKeys.includes(key);
    if (isSingle) {
      setDraft((d) => ({ ...d, [key]: current.includes(value) ? [] : [value] }));
    } else {
      setDraft((d) => ({ ...d, [key]: current.includes(value) ? current.filter((x) => x !== value) : [...current, value] }));
    }
  };

  const selectAll = (cat: FilterCategory) => {
    if (singleSelectKeys.includes(cat.key)) return;
    setDraft((d) => ({ ...d, [cat.key]: cat.options.map((o) => o.value) }));
  };

  const clearCategory = (key: string) => {
    setDraft((d) => ({ ...d, [key]: [] }));
  };

  const clearAll = () => setDraft({});
  const apply = () => { onApply(draft); onClose(); };

  const total = Object.values(draft).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  return (
    <SearchFilterDrawer appliedCount={total} onClose={onClose} onApply={apply}>
      <div className="mb-3 flex justify-end">
        <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
      </div>
      {categories.map((cat) => {
        if (inertLabels.includes(cat.label)) {
          return (
            <FieldBlock key={cat.key} label={cat.label}>
              <p className="text-tiny text-fg-muted">No options.</p>
            </FieldBlock>
          );
        }
        const selected = draft[cat.key] ?? [];
        const isSingle = singleSelectKeys.includes(cat.key);
        return (
          <FieldBlock key={cat.key} label={cat.label}>
            {!isSingle && (
              <div className="mb-1 flex items-center gap-2 text-tiny">
                <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => selectAll(cat)}>Select All</button>
                <span className="text-border">|</span>
                <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => clearCategory(cat.key)}>Clear</button>
              </div>
            )}
            {isSingle && (
              <button type="button" className="mb-1 text-tiny font-medium text-accent-text hover:underline" onClick={() => clearCategory(cat.key)}>Clear</button>
            )}
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {cat.options.map((o) => {
                const checked = selected.includes(o.value);
                if (isSingle) {
                  return (
                    <button key={o.value} type="button" onClick={() => toggle(cat.key, o.value)}
                      className={`flex w-full items-center gap-2 text-left text-small hover:bg-page ${checked ? 'font-medium text-accent-text' : 'text-fg'}`}>
                      <span className="inline-block w-3 text-accent-text">{checked ? '✓' : ''}</span>
                      {o.label}
                    </button>
                  );
                }
                return (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 text-small text-fg hover:bg-page">
                    <input type="checkbox" className="chk" checked={checked} onChange={() => toggle(cat.key, o.value)} />
                    {o.label}
                  </label>
                );
              })}
              {cat.options.length === 0 && <p className="text-tiny text-fg-muted">No options.</p>}
            </div>
          </FieldBlock>
        );
      })}
    </SearchFilterDrawer>
  );
}
