/**
 * Everflow-style "Table Filters" — funnel trigger opens a category list; hovering or clicking a
 * category shows a checkbox submenu to its left (search + Select All/Clear). Real presets are stored
 * in localStorage when `storageKey` is provided.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Filter as FilterIcon, Search as SearchIcon } from 'lucide-react';

export interface FilterCategory {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type FilterValues = Record<string, string[]>;

function loadPresets(storageKey: string): { name: string; values: FilterValues }[] {
  try {
    const raw = localStorage.getItem(`tracker.filterPresets.${storageKey}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function savePresets(storageKey: string, presets: { name: string; values: FilterValues }[]): void {
  try {
    localStorage.setItem(`tracker.filterPresets.${storageKey}`, JSON.stringify(presets));
  } catch {
    // Best-effort — localStorage may be unavailable.
  }
}

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

function CategorySubmenu({
  category, selected, onChange, singleSelect,
}: {
  category: FilterCategory;
  selected: string[];
  onChange: (v: string[]) => void;
  singleSelect?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = category.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));

  const toggle = (v: string) => {
    if (singleSelect) {
      onChange(selected.includes(v) ? [] : [v]);
      return;
    }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  const selectAll = () => {
    if (singleSelect) return;
    onChange(category.options.map((o) => o.value));
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h4 className="text-small font-semibold text-fg">{category.label}</h4>
        {!singleSelect && (
          <div className="flex items-center gap-2 text-tiny">
            <button type="button" className="font-medium text-accent-text hover:underline" onClick={selectAll}>Select All</button>
            <span className="text-border">|</span>
            <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange([])}>Clear</button>
          </div>
        )}
        {singleSelect && (
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => onChange([])}>Clear</button>
        )}
      </div>
      <div className="relative border-b border-border px-3 py-2">
        <SearchIcon size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input className="input !pl-7" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="max-h-72 overflow-y-auto py-1">
        {filtered.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No options.</p>}
        {filtered.map((o) => (
          singleSelect ? (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${
                selected.includes(o.value) ? 'font-medium text-accent-text' : 'text-fg'
              }`}
            >
              <span className="inline-block w-3 text-accent-text">{selected.includes(o.value) ? '✓' : ''}</span>
              {o.label}
            </button>
          ) : (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
              <input type="checkbox" className="chk" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          )
        ))}
      </div>
    </div>
  );
}

export function CategorizedFiltersFlyout({
  categories,
  values,
  onApply,
  onClose,
  storageKey,
  title = 'Table Filters',
  inertLabels = [],
  singleSelectKeys = [],
  categorySearch = false,
  showPresets,
  align = 'right',
}: {
  categories: FilterCategory[];
  values: FilterValues;
  onApply: (v: FilterValues) => void;
  onClose: () => void;
  storageKey?: string;
  title?: string;
  inertLabels?: string[];
  singleSelectKeys?: string[];
  categorySearch?: boolean;
  showPresets?: boolean;
  align?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FilterValues>(values);
  const [activeKey, setActiveKey] = useState<string | null>(categories[0]?.key ?? null);
  const [catSearch, setCatSearch] = useState('');
  const [presets, setPresets] = useState(() => (storageKey ? loadPresets(storageKey) : []));
  const [showPresetList, setShowPresetList] = useState(false);
  const presetsEnabled = showPresets ?? Boolean(storageKey);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const activeCategory = categories.find((c) => c.key === activeKey) ?? null;
  const visibleCategories = categories.filter((c) => c.label.toLowerCase().includes(catSearch.toLowerCase()));
  const total = useMemo(() => appliedFilterCount(draft, singleSelectKeys), [draft, singleSelectKeys]);

  const clearAll = () => setDraft({});
  const apply = () => { onApply(draft); onClose(); };

  const saveAsPreset = () => {
    if (!storageKey) return;
    const name = window.prompt('Name this filter preset:');
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, values: draft }];
    setPresets(next);
    savePresets(storageKey, next);
  };
  const applyPreset = (p: { name: string; values: FilterValues }) => { setDraft(p.values); setShowPresetList(false); };
  const deletePreset = (name: string) => {
    if (!storageKey) return;
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(storageKey, next);
  };

  const countFor = (key: string) => {
    const arr = draft[key] ?? [];
    if (singleSelectKeys.includes(key)) {
      const v = arr[0];
      return v && v !== 'any' ? 1 : 0;
    }
    return arr.length;
  };

  return (
    <div
      ref={ref}
      className={`absolute top-full z-30 mt-1 flex flex-row-reverse items-stretch overflow-hidden rounded-card border border-border bg-elevated shadow-elevated ${
        align === 'left' ? 'left-0' : 'right-0'
      }`}
    >
      {/* Tier 1 — category list (right side, Everflow anchor) */}
      <div className="flex w-56 shrink-0 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <h3 className="text-small font-semibold text-fg">{title}</h3>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
        </div>
        {categorySearch && (
          <div className="relative border-b border-border px-3 py-2">
            <SearchIcon size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search filters…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto py-1">
          {visibleCategories.map((c) => {
            const n = countFor(c.key);
            const active = activeKey === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onMouseEnter={() => setActiveKey(c.key)}
                onClick={() => setActiveKey(c.key)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-small transition-colors ${
                  active ? 'bg-accent-subtle text-accent-text' : 'text-fg hover:bg-accent-subtle/60'
                }`}
              >
                <span className="flex items-center gap-2">
                  {c.label}
                  {n > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                      {n}
                    </span>
                  )}
                </span>
                <ChevronRight size={13} className={active ? 'text-accent-text' : 'text-fg-muted'} />
              </button>
            );
          })}
          {inertLabels.map((label) => (
            <div
              key={label}
              title="Not available yet"
              className="flex w-full cursor-not-allowed items-center justify-between px-3 py-1.5 text-left text-small text-fg-muted"
            >
              {label}
              <ChevronRight size={13} className="text-fg-muted" />
            </div>
          ))}
        </div>
        {presetsEnabled && (
          <div className="border-t border-border px-3 py-2">
            <button type="button" className="block w-full text-left text-small text-fg hover:text-accent-text" onClick={saveAsPreset}>
              Save selection as Preset
            </button>
            <button
              type="button"
              disabled={presets.length === 0}
              className="mt-1 block text-left text-small text-fg-secondary hover:text-accent-text disabled:cursor-not-allowed disabled:text-fg-muted"
              onClick={() => setShowPresetList((s) => !s)}
            >
              Presets{presets.length > 0 ? ` (${presets.length})` : ''}
            </button>
            {showPresetList && presets.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {presets.map((p) => (
                  <div key={p.name} className="flex items-center justify-between rounded-[var(--radius)] px-2 py-1 text-tiny hover:bg-accent-subtle">
                    <button type="button" className="text-fg hover:text-accent-text" onClick={() => applyPreset(p)}>{p.name}</button>
                    <button type="button" className="text-fg-muted hover:text-danger-text" onClick={() => deletePreset(p.name)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-auto flex justify-end gap-2 border-t border-border px-3 py-2.5">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={apply}>Apply{total > 0 ? ` (${total})` : ''}</button>
        </div>
      </div>

      {/* Tier 2 — option submenu (left of category list) */}
      {activeCategory && (
        <CategorySubmenu
          category={activeCategory}
          selected={draft[activeCategory.key] ?? []}
          onChange={(v) => setDraft((d) => ({ ...d, [activeCategory.key]: v }))}
          singleSelect={singleSelectKeys.includes(activeCategory.key)}
        />
      )}
    </div>
  );
}

export function FilterButton({ count, onClick, title = 'Table Filters' }: { count: number; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="relative grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg"
    >
      <FilterIcon size={15} />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}
