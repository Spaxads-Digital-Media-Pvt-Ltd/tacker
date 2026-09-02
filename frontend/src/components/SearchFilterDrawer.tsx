/**
 * Search Filter drawer — right slide-over, checkbox-driven, theme-aware (all tokens).
 * Tick a Group By / Report Option / column → it becomes a column (or metric) on Apply.
 *
 * Portaled to <body>: the app shell wraps every page in a `.animate-fade-in` div whose completed
 * animation leaves an identity `transform` in effect (animation-fill-mode: both), which establishes
 * a containing block for `position: fixed`. Rendered inline, this slide-over would be clipped to
 * that wrapper's height instead of the viewport — obvious on a short list (e.g. Smart Links).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FilterDef } from '../lib/reportFilters';

// EntitySearchSelect moved to ui.tsx (now shared by CollectionTab too); re-exported here so existing
// `from '../../components/SearchFilterDrawer'` imports keep working.
export { EntitySearchSelect, type EntityOpt } from './ui';

interface SearchFilterDrawerProps {
  appliedCount: number;
  onClose: () => void;
  onApply: () => void;
  children: ReactNode;
}

/** Right slide-over shell (Trackog Search Filter). Light theme. */
export function SearchFilterDrawer({ appliedCount, onClose, onApply, children }: SearchFilterDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close filters" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[440px] flex-col border-l border-border bg-surface shadow-2xl animate-fade-in">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-body font-semibold text-fg">
              <FunnelIcon /> Search Filter
            </h2>
            <p className="mt-0.5 text-tiny text-fg-secondary">Apply filters to narrow down your results</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-[11px] font-medium text-accent-text">
              {appliedCount} filters applied
            </span>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-fg-muted hover:bg-page hover:text-fg">✕</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex shrink-0 gap-2 border-t border-border bg-page px-5 py-4">
          <button type="button" className="btn-primary flex-1 justify-center" onClick={onApply}>Apply Filters</button>
          <button type="button" className="btn-ghost border border-border px-5" onClick={onClose}>Cancel</button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function FunnelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-text" aria-hidden>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

/** Two-column searchable checkbox grid (Group By / Report Options / Columns). */
export function CheckboxGrid({
  title, items, selected, onChange, searchable = true, selectAll = true, defaultOpen = true,
}: {
  title: string;
  items: FilterDef[];
  selected: string[];
  onChange: (keys: string[]) => void;
  searchable?: boolean;
  selectAll?: boolean;
  defaultOpen?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(defaultOpen);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => !s || i.label.toLowerCase().includes(s) || i.key.includes(s));
  }, [items, q]);
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key]);
  const allOn = filtered.length > 0 && filtered.every((i) => selected.includes(i.key));
  const toggleAll = () => {
    if (allOn) onChange(selected.filter((k) => !filtered.some((i) => i.key === k)));
    else {
      const add = filtered.map((i) => i.key).filter((k) => !selected.includes(k));
      onChange([...selected, ...add]);
    }
  };
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-1.5 text-small font-semibold text-fg" onClick={() => setOpen((o) => !o)}>
          <span className={`text-tiny text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {title}
          <span className="ml-1 rounded-full bg-page px-1.5 text-[10px] font-medium text-fg-secondary">{selected.length}</span>
        </button>
        {selectAll && open && (
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={toggleAll}>
            {allOn ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>
      {open && (
        <>
          {searchable && (
            <input
              className="input mb-2 h-9 text-tiny"
              placeholder={`Search ${title.toLowerCase()}...`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {filtered.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[13px] text-fg hover:bg-page">
                <input
                  type="checkbox"
                  className="chk mt-0.5"
                  checked={selected.includes(item.key)}
                  onChange={() => toggle(item.key)}
                />
                <span className="leading-snug">{item.label}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="col-span-2 text-tiny text-fg-muted">No matches</p>}
          </div>
        </>
      )}
    </section>
  );
}

/** Compact two-col checkbox row (no search) — used for the small extra-dim strip. */
export function CompactCheckboxGrid({
  items, selected, onChange,
}: {
  items: FilterDef[]; selected: string[]; onChange: (keys: string[]) => void;
}) {
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key]);
  return (
    <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-border pb-4">
      {items.map((item) => (
        <label key={item.key} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[13px] text-fg hover:bg-page">
          <input type="checkbox" className="chk mt-0.5" checked={selected.includes(item.key)} onChange={() => toggle(item.key)} />
          <span className="leading-snug">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

export function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
