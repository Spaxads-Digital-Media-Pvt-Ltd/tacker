import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { usePageTitle } from './PageTitle';
import { HelpHint } from './HelpHint';

/**
 * Declares the page title/subtitle (rendered in the top header, Section 2 — NOT duplicated in the
 * body) and optionally lays out page-level actions on the right. If a page has no `action`, this
 * renders nothing in the body.
 */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  usePageTitle(title, subtitle);
  if (!action) return null;
  return <div className="mb-6 flex flex-wrap items-center justify-end gap-3">{action}</div>;
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="text-small font-medium text-fg-secondary">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-1 text-tiny text-fg-muted">{hint}</p>}
    </div>
  );
}

export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div className="card border-dashed">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-tiny font-semibold text-accent-text">
          {phase}
        </span>
        <span className="text-small font-medium text-fg">Coming in this phase</span>
      </div>
      <p className="mt-2 text-small text-fg-secondary">{children}</p>
    </div>
  );
}

// Semantic status tones (Section 0 rule): green=positive, amber=pending, red=negative, neutral=inert.
const SUCCESS = 'bg-success-bg text-success-text';
const WARNING = 'bg-warning-bg text-warning-text';
const DANGER = 'bg-danger-bg text-danger-text';
// bg-elevated so the chip reads as *raised* in dark (bg-page there is darker than the card).
// --bg-elevated is pure #FFF in light == the card, so add a hairline inset ring to keep the chip
// visible there too; ring is box-shadow, so no size drift vs the coloured badge tones.
const NEUTRAL = 'bg-elevated text-fg-secondary ring-1 ring-inset ring-border';
const BADGE_TONES: Record<string, string> = {
  active: SUCCESS, approved: SUCCESS, verified: SUCCESS, issued: SUCCESS, completed: SUCCESS,
  pending: WARNING, trialing: WARNING, hold: WARNING,
  suspended: DANGER, rejected: DANGER, blocked: DANGER, failed: DANGER,
  draft: NEUTRAL, paused: NEUTRAL, inactive: NEUTRAL, disabled: NEUTRAL, archived: NEUTRAL,
};

export function Badge({ value }: { value: string }) {
  const tone = BADGE_TONES[value] ?? 'bg-accent-subtle text-accent-text';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold capitalize ${tone}`}>{value}</span>;
}

export function Spinner() {
  return <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />;
}

export function StateBlock({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-card border border-dashed border-border py-16 text-center text-small text-fg-secondary">{children}</div>;
}

/**
 * Reusable scroll shell for wide data tables — the deliberate "scroll, don't reflow" pattern
 * (see tailwind.config.js responsive strategy). Bounds height so `sticky` works, and shows a soft
 * edge-fade only on the side that has more content, so the horizontal scroll is discoverable.
 * Wrap a bare `<table>` in this on pages that don't use <Table> below.
 */
export function TableScroll({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [update]);
  useEffect(update);  // recompute after any render (row/column count may have changed)
  return (
    <div className="relative">
      <div ref={ref} className={`max-h-[70vh] overflow-auto rounded-card border border-border ${className}`}>
        {children}
      </div>
      {edge.left && <div aria-hidden className="pointer-events-none absolute inset-y-px left-px w-9 rounded-l-card bg-gradient-to-r from-black/[0.13] to-transparent" />}
      {edge.right && <div aria-hidden className="pointer-events-none absolute inset-y-px right-px w-9 rounded-r-card bg-gradient-to-l from-black/[0.13] to-transparent" />}
    </div>
  );
}

/** Simple, accessible table. `columns` maps a header to a cell renderer. The header row stays
 * pinned while scrolling vertically; `stickyCol` (default 0 — the row's primary identifier) stays
 * pinned while scrolling horizontally. Pass `stickyCol={-1}` to pin nothing, or another index for
 * tables whose first column is a checkbox/selector. */
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, stickyCol = 0 }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; stickyCol?: number }) {
  return (
    <TableScroll>
      <table className="w-full min-w-[560px] text-left text-body">
        <thead className="sticky top-0 z-20 bg-page text-tiny uppercase tracking-wide text-fg-secondary [&_th]:border-b [&_th]:border-border">
          <tr className="divide-x divide-border">
            {columns.map((c, i) => (
              <th key={i} className={`whitespace-nowrap px-4 py-3 font-semibold ${i === stickyCol ? 'sticky left-0 z-30 bg-page' : ''} ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="divide-x divide-border bg-surface text-fg transition-colors hover:bg-accent-subtle/40">
              {columns.map((c, i) => (
                <td key={i} className={`px-4 py-3 ${i === stickyCol ? 'sticky left-0 z-10 bg-inherit' : ''} ${c.className ?? ''}`}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

const MODAL_SIZE: Record<string, string> = { md: 'max-w-lg', xl: 'max-w-4xl' };

export function Modal({ open, onClose, title, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: 'md' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className={`w-full ${MODAL_SIZE[size]} animate-fade-in rounded-card border border-border bg-elevated p-6 shadow-elevated`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-4 overflow-x-auto">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}{hint && <HelpHint text={hint} />}</label>
      {children}
    </div>
  );
}

/**
 * A form field the reference has but this app can't back yet — the control is shown for layout
 * parity but rendered non-interactive, with an honest one-line note. Same honesty convention as the
 * inert filter rows on Manage Offers (honesty over fake functionality).
 */
export function UnavailableField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label mb-2 block text-fg-muted">{label}</label>
      <div className="pointer-events-none select-none opacity-50">{children}</div>
      <p className="mt-1 text-[11px] text-fg-muted">Not yet available in this app.</p>
    </div>
  );
}

/**
 * Segmented control — a full-width recessed track (bg-page, hairline border, inset shadow) carrying
 * a single "floating" thumb on the selected option (bg-elevated + drop shadow + hairline ring);
 * unselected options are plain label text (+ optional status dot) sitting directly on the track.
 * Options divide the width into equal segments (Everflow parity). Only the *selected* pill carries a
 * raised edge — the others are bare text — so it never reads as a row of individually-boxed options.
 * Used for Status / Visibility and every other either/or picker in the
 * admin forms. `options` accepts bare strings or `{ value, label }`; `labels` remaps bare-string
 * display text; `dots` maps a value → status-dot colour class. Pass `className` (e.g. `w-auto
 * inline-flex`) to opt out of full-width where a control must hug its content.
 */
type SegmentedOption = string | { value: string; label: string };
export function Segmented({
  options, value, onChange, dots, labels, className,
}: {
  options: readonly SegmentedOption[];
  value: string;
  onChange: (v: string) => void;
  dots?: Record<string, string>;
  labels?: Record<string, string>;
  className?: string;
}) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: labels?.[o] ?? o } : o));
  return (
    <div className={`flex w-full gap-1 rounded-[var(--radius)] border border-border bg-page p-1 shadow-[inset_0_1px_2px_rgb(2_6_23_/_0.06)] ${className ?? ''}`}>
      {items.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 basis-0 min-w-0 items-center justify-center gap-1.5 rounded-[calc(var(--radius)-3px)] px-3 py-2 text-small font-medium capitalize transition-colors ${
              on ? 'bg-elevated text-fg shadow-sm ring-1 ring-inset ring-border' : 'text-fg-secondary hover:text-fg'
            }`}
          >
            {dots && <span className={`h-2 w-2 shrink-0 rounded-full ${dots[o.value] ?? 'bg-fg-muted'}`} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal tab strip (controlled). Used by the multi-section entity screens (offers, etc.). */
export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`-mb-px whitespace-nowrap rounded-t-[var(--radius)] px-3.5 py-2 text-small font-medium transition-colors ${
              on
                ? 'border-b-2 border-accent text-accent-text'
                : 'text-fg-secondary hover:text-fg'
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
