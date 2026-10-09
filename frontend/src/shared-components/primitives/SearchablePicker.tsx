/**
 * Multi-select dropdown for long option lists (countries, regions, cities): a search box pinned at
 * the top, a scrollable list underneath, optional group headers, keyboard navigation
 * (↑/↓/Home/End/Enter/Esc) and close-on-outside-click. Optionally accepts free text that isn't in
 * the list (`allowCustom`). With `single`, picking replaces the value and closes the panel (the
 * value is then a one-element array and the trigger shows that option's label).
 *
 * Why not EntitySearchSelect / MenuPopover: EntitySearchSelect uses the search box itself as the
 * trigger and caps results at 40 with no keyboard support; MenuPopover dismisses on any scroll —
 * including scrolling its own list. The panel is portalled + fixed so it isn't clipped by
 * `overflow-hidden` containers (e.g. the Targeting CategoryPicker), and it follows the trigger on
 * page scroll instead of closing.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';

export interface PickerOption { value: string; label: string; group?: string; hint?: string }

const DEFAULT_RENDER_LIMIT = 300;

/** Case- and accent-insensitive key, so "maharashtra" finds "Mahārāshtra" and "sao" finds "São Paulo". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SearchablePicker({
  options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…',
  allowCustom, disabled = false, emptyText = 'No matches', renderLimit = DEFAULT_RENDER_LIMIT, ariaLabel, single = false, required = false,
}: {
  options: PickerOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Turn typed text into a value (or return null to reject it). Enables "Add “…”" for unlisted text. */
  allowCustom?: (text: string) => string | null;
  disabled?: boolean;
  emptyText?: string;
  renderLimit?: number;
  ariaLabel?: string;
  /** Single-select: a pick replaces the value and closes the panel. */
  single?: boolean;
  /** Take part in native form validation: submitting with no (non-empty) value is blocked. */
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [style, setStyle] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const needle = fold(q.trim());
  const matches = useMemo(() => {
    if (!needle) return options;
    // Prefix matches first (typing "ind" ranks India above "British Indian Ocean Territory").
    const starts: PickerOption[] = []; const contains: PickerOption[] = [];
    for (const o of options) {
      const l = fold(o.label); const v = o.value.toLowerCase();
      if (l.startsWith(needle) || v === needle) starts.push(o);
      else if (l.includes(needle) || v.includes(needle) || (o.hint && fold(o.hint).includes(needle))) contains.push(o);
    }
    // Keep group order stable when grouped, so headers don't repeat.
    const merged = [...starts, ...contains];
    if (!options.some((o) => o.group)) return merged;
    const order = new Map<string, number>();
    options.forEach((o) => { if (o.group && !order.has(o.group)) order.set(o.group, order.size); });
    return merged.sort((a, b) => (order.get(a.group ?? '') ?? 0) - (order.get(b.group ?? '') ?? 0));
  }, [options, needle]);
  const shown = matches.slice(0, renderLimit);
  const custom = allowCustom && needle && !options.some((o) => fold(o.label) === needle || o.value.toLowerCase() === needle)
    ? allowCustom(q.trim()) : null;
  // Row model: the options, then an optional "Add …" row last — so Enter picks the best match
  // (typing "mah" selects Maharashtra, not a literal "MAH") unless nothing matched.
  const customRow = custom ? shown.length : -1;
  const rowCount = shown.length + (custom ? 1 : 0);

  const place = useCallback(() => {
    const b = triggerRef.current?.getBoundingClientRect();
    if (!b) return;
    const gap = 4; const want = 360;
    const below = window.innerHeight - b.bottom - gap - 8;
    const above = b.top - gap - 8;
    const up = below < Math.min(want, 220) && above > below;
    const width = Math.max(b.width, 280);
    const left = Math.min(b.left, window.innerWidth - width - 8);
    setStyle(up
      ? { bottom: Math.round(window.innerHeight - b.top + gap), left, width, maxHeight: Math.min(want, above) }
      : { top: Math.round(b.bottom + gap), left, width, maxHeight: Math.min(want, below) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, place]);

  useEffect(() => { setActive(0); }, [needle]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => { setOpen(false); setQ(''); triggerRef.current?.focus(); };
  const toggle = (v: string) => {
    if (single) { onChange([v]); close(); return; }
    const has = selected.has(v.toLowerCase());
    onChange(has ? value.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...value, v]);
  };
  const activate = (row: number) => {
    if (custom && row === customRow) {
      if (single) { onChange([custom]); close(); return; }
      if (!selected.has(custom.toLowerCase())) onChange([...value, custom]); setQ(''); return;
    }
    const o = shown[row];
    if (o) toggle(o.value);
  };
  const singleLabel = single && value.length
    ? (options.find((o) => o.value.toLowerCase() === value[0]!.toLowerCase())?.label ?? value[0])
    : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rowCount - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, rowCount - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rowCount) activate(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        className="input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
        <span className={`min-w-0 truncate ${value.length ? 'text-fg' : 'text-fg-muted'}`}>
          {singleLabel ?? (value.length ? `${value.length} selected` : placeholder)}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* A button can't be `required` — this hidden mirror lets the browser's form validation see the value. */}
      {required && (
        <input className="sr-only" tabIndex={-1} aria-hidden required value={value.filter(Boolean).join(',')} onChange={() => {}} />
      )}
      {open && createPortal(
        <div ref={panelRef} onKeyDown={onKeyDown}
          style={{ top: style.top, bottom: style.bottom, left: style.left, width: style.width, maxHeight: style.maxHeight }}
          className="fixed z-50 flex animate-fade-in flex-col overflow-hidden rounded-[10px] border border-border bg-elevated shadow-elevated">
          <div className="relative border-b border-border p-2">
            <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input ref={searchRef} className="input !pl-8" placeholder={searchPlaceholder} value={q}
              role="combobox" aria-expanded aria-controls="searchable-picker-list" aria-autocomplete="list"
              aria-activedescendant={rowCount ? `spk-row-${active}` : undefined}
              onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul ref={listRef} id="searchable-picker-list" role="listbox" aria-multiselectable={!single} className="min-h-0 flex-1 overflow-y-auto py-1">
            {shown.map((o, i) => {
              const row = i;
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSel = selected.has(o.value.toLowerCase());
              return (
                <li key={`${o.group ?? ''}|${o.value}`} role="presentation">
                  {header && <div className="sticky top-0 bg-elevated px-3 pb-1 pt-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">{header}</div>}
                  <div id={`spk-row-${row}`} data-row={row} role="option" aria-selected={isSel}
                    onMouseEnter={() => setActive(row)} onClick={() => activate(row)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small ${active === row ? 'bg-accent-subtle' : ''} ${isSel ? 'font-medium text-accent-text' : 'text-fg'}`}>
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${isSel ? 'border-accent bg-accent text-white' : 'border-border'}`}>
                      {isSel && <Check size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-tiny text-fg-muted">{o.hint}</span>}
                  </div>
                </li>
              );
            })}
            {custom && (
              <li id={`spk-row-${customRow}`} data-row={customRow} role="option" aria-selected={false}
                onMouseEnter={() => setActive(customRow)} onClick={() => activate(customRow)}
                className={`flex cursor-pointer items-center gap-2 border-t border-border px-3 py-1.5 text-small text-accent-text ${active === customRow ? 'bg-accent-subtle' : ''}`}>
                <Plus size={13} /> Add “{custom}”
              </li>
            )}
            {rowCount === 0 && <li className="px-3 py-2 text-tiny text-fg-muted">{emptyText}</li>}
            {matches.length > shown.length && (
              <li className="px-3 py-2 text-tiny text-fg-muted">Showing {shown.length} of {matches.length.toLocaleString()} — type to narrow.</li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
