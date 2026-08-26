/**
 * "Table Filters" — Everflow-style categorized flyout: a funnel-icon trigger opens a category
 * list, clicking a category slides to a checkbox multi-select submenu (search + Select All/Clear),
 * and the footer offers Save/Load presets. Real presets are stored in the browser (localStorage,
 * namespaced per page) since this app has no per-user saved-filter backend — genuinely functional,
 * just local to this browser rather than synced across devices, and labeled as such.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter as FilterIcon, Search as SearchIcon } from 'lucide-react';

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
    // Best-effort — localStorage may be unavailable (private browsing, quota). Not fatal.
  }
}

export function appliedFilterCount(values: FilterValues): number {
  return Object.values(values).reduce((n, arr) => n + (arr?.length ?? 0), 0);
}

function CategorySubmenu({
  category, selected, onChange, onBack,
}: { category: FilterCategory; selected: string[]; onChange: (v: string[]) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const filtered = category.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="w-80">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
          <ChevronLeft size={15} /> {category.label}
        </button>
        <div className="flex items-center gap-2 text-tiny">
          <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange(category.options.map((o) => o.value))}>Select All</button>
          <span className="text-border">|</span>
          <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
      </div>
      <div className="relative border-b border-border px-3 py-2">
        <SearchIcon size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input className="input !pl-7" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No options.</p>}
        {filtered.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
            <input type="checkbox" className="chk" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function CategorizedFiltersFlyout({
  categories, values, onApply, onClose, storageKey,
}: {
  categories: FilterCategory[];
  values: FilterValues;
  onApply: (v: FilterValues) => void;
  onClose: () => void;
  storageKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FilterValues>(values);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState('');
  const [presets, setPresets] = useState(() => loadPresets(storageKey));
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const activeCategory = categories.find((c) => c.key === activeKey) ?? null;
  const visibleCategories = categories.filter((c) => c.label.toLowerCase().includes(catSearch.toLowerCase()));
  const total = useMemo(() => appliedFilterCount(draft), [draft]);

  const clearAll = () => setDraft({});
  const apply = () => { onApply(draft); onClose(); };

  const saveAsPreset = () => {
    const name = window.prompt('Name this filter preset:');
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, values: draft }];
    setPresets(next);
    savePresets(storageKey, next);
  };
  const applyPreset = (p: { name: string; values: FilterValues }) => { setDraft(p.values); setShowPresets(false); };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(storageKey, next);
  };

  return (
    <div ref={ref} className="absolute right-0 top-full z-30 mt-1 flex overflow-hidden rounded-card border border-border bg-elevated shadow-elevated">
      {activeCategory ? (
        <CategorySubmenu
          category={activeCategory}
          selected={draft[activeCategory.key] ?? []}
          onChange={(v) => setDraft((d) => ({ ...d, [activeCategory.key]: v }))}
          onBack={() => setActiveKey(null)}
        />
      ) : (
        <div className="w-72">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 className="text-small font-semibold text-fg">Table Filters</h3>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
          </div>
          <div className="relative border-b border-border px-3 py-2">
            <SearchIcon size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search filters…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {visibleCategories.map((c) => {
              const n = (draft[c.key] ?? []).length;
              return (
                <button key={c.key} type="button" onClick={() => setActiveKey(c.key)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                  <span className="flex items-center gap-2">{c.label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
                  <ChevronRight size={13} className="text-fg-muted" />
                </button>
              );
            })}
          </div>
          <div className="border-t border-border px-3 py-2">
            <button type="button" className="block w-full text-left text-small text-fg hover:text-accent-text" onClick={saveAsPreset}>Save selection as Preset</button>
            <button type="button" disabled={presets.length === 0} className="mt-1 block text-left text-small text-fg-secondary hover:text-accent-text disabled:cursor-not-allowed disabled:text-fg-muted"
              onClick={() => setShowPresets((s) => !s)}>
              Presets{presets.length > 0 ? ` (${presets.length})` : ''}
            </button>
            {showPresets && presets.length > 0 && (
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
          <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={apply}>Apply{total > 0 ? ` (${total})` : ''}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" title="Filters" onClick={onClick}
      className="relative grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
      <FilterIcon size={15} />
      {count > 0 && <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{count}</span>}
    </button>
  );
}
