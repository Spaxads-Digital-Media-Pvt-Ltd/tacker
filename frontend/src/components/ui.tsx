import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Centered modal. The box is height-bounded to the viewport and its body scrolls, so a tall form
 * never pushes its controls off-screen. Pass `footer` for a sticky action row (Save/Cancel) that
 * stays visible while the body scrolls; without it the modal is a plain scroll container.
 *
 * Portaled to <body> — same reason as `SearchFilterDrawer`: the app shell wraps every page in a
 * `.animate-fade-in` div whose completed animation leaves an identity `transform` in effect
 * (animation-fill-mode: both), which establishes a containing block for `position: fixed`.
 * Rendered inline, a modal taller than the page's own content area would be sized/centered
 * against that wrapper's (shorter) box instead of the real viewport, clipping the footer —
 * reproducible on any page whose content area is shorter than the modal.
 */
export function Modal({
  open, onClose, title, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className={`flex max-h-[calc(100vh-2rem)] w-full ${MODAL_SIZE[size]} animate-fade-in flex-col rounded-card border border-border bg-elevated shadow-elevated`} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between p-6 pb-0">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto overflow-x-auto px-6 pb-6">{children}</div>
        {footer != null && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Entity multi-select ──────────────────────────────────────────────────────
export interface EntityOpt { value: string; label: string }

/** Searchable multi-select entity picker (Offers / Affiliates / Advertisers). Type to search, tick
 * to add, chips below show the selection. `label` is optional — omit it when the caller supplies
 * its own <Field> wrapper. */
export function EntitySearchSelect({
  label, placeholder, options, value, onChange,
}: {
  label?: string; placeholder: string; options: EntityOpt[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options.filter((o) => !s || o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)).slice(0, 40);
  }, [options, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="mb-3">
      {label ? <label className="label">{label}</label> : null}
      <div className="relative">
        <input
          className="input pr-8"
          placeholder={placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {value.length > 0 && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
            {value.length}
          </span>
        )}
        {open && (
          <>
            <button type="button" className="fixed inset-0 z-10" aria-label="close" onClick={() => setOpen(false)} />
            <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-elevated py-1 shadow-elevated">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-tiny text-fg-muted">No matches</li>
              ) : filtered.map((o) => (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small hover:bg-page">
                    <input type="checkbox" className="chk" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                    <span className="truncate">{o.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.slice(0, 6).map((id) => {
            const o = options.find((x) => x.value === id);
            return (
              <button key={id} type="button" onClick={() => toggle(id)}
                className="rounded-md bg-accent-subtle px-2 py-0.5 text-[11px] text-accent-text hover:bg-accent-subtle/70">
                {o?.label ?? id.slice(0, 8)} ×
              </button>
            );
          })}
          {value.length > 6 && <span className="text-[11px] text-fg-muted">+{value.length - 6} more</span>}
        </div>
      )}
    </div>
  );
}

// ── Duration field (number + unit) ───────────────────────────────────────────
const DURATION_UNITS = ['minutes', 'hours', 'days'] as const;

/** Parses a stored free-text delay ("15 minutes", "2h", "30m", "1 day") into {n, unit}. Unknown
 * input falls back to an empty value so a bad legacy string doesn't silently become "0 minutes". */
function parseDuration(s: string): { n: string; unit: (typeof DURATION_UNITS)[number] } {
  const m = s.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!m) return { n: '', unit: 'minutes' };
  const u = m[2] ?? 'minutes';
  const unit = u.startsWith('h') ? 'hours' : u.startsWith('d') ? 'days' : 'minutes';
  return { n: m[1]!, unit };
}

/** Number input + unit dropdown. Emits a canonical "<n> <unit>" string (or '' when the number is
 * blank), so the stored value is unambiguous without changing the backend contract. */
export function DurationField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { n, unit } = parseDuration(value || '');
  const emit = (nextN: string, nextUnit: string) => onChange(nextN.trim() === '' ? '' : `${nextN.trim()} ${nextUnit}`);
  return (
    <div className="flex gap-2">
      <input type="number" min={0} className="input" placeholder="e.g. 15" value={n}
        onChange={(e) => emit(e.target.value, unit)} />
      <select className="input !w-auto" value={unit} onChange={(e) => emit(n, e.target.value)}>
        {DURATION_UNITS.map((u) => <option key={u} value={u} className="capitalize">{u[0]!.toUpperCase() + u.slice(1)}</option>)}
      </select>
    </div>
  );
}

/**
 * Anchored dropdown menu — the standard row-kebab / "Table Actions" popover.
 *
 * Portaled to <body> and positioned from the trigger's rect, so an `overflow`-clipped or
 * `transform`ed ancestor (the table scroll wrapper, an animation utility further up) can't trap or
 * clip it; flips upward when it would overflow the viewport bottom. Dismisses on outside
 * pointer-down, Escape, scroll, or resize.
 *
 * Deliberately has NO full-screen `fixed inset-0` click-catcher overlay. That overlay was the
 * "row kebab opens the wrong menu" bug: with a menu open, its viewport-covering overlay ate the
 * FIRST click on any *other* trigger (a different row's kebab, or the toolbar's Table Actions ⋮),
 * so switching menus silently required two clicks and left the previously-open menu showing.
 */
export function MenuPopover({
  button, ariaLabel, triggerClassName, align = 'end', width = 'w-44', onOpenChange, children,
}: {
  button: ReactNode;
  ariaLabel: string;
  triggerClassName?: string;
  align?: 'start' | 'end';
  width?: string;
  onOpenChange?: (open: boolean) => void;
  children: (api: { close: () => void }) => ReactNode;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean | ((o: boolean) => boolean)) => {
    setOpenState((o) => {
      const next = typeof v === 'function' ? v(o) : v;
      if (next !== o) onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);
  const [style, setStyle] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const gap = 4;
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const flipUp = menuH > 0 && b.bottom + gap + menuH > window.innerHeight && b.top - gap - menuH > 0;
    setStyle({
      ...(flipUp ? { bottom: Math.round(window.innerHeight - b.top + gap) } : { top: Math.round(b.bottom + gap) }),
      ...(align === 'end' ? { right: Math.round(window.innerWidth - b.right) } : { left: Math.round(b.left) }),
    });
  }, [align]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    place(); // second pass now the panel has a real height (drives flip-up)
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open, place, setOpen]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {button}
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={style}
          className={`fixed z-50 ${width} animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated`}>
          {children({ close: () => setOpen(false) })}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A row inside <MenuPopover>. `tone="danger"` for destructive actions. */
export function MenuItem({ children, onSelect, tone = 'default' }: { children: ReactNode; onSelect: () => void; tone?: 'default' | 'danger' }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect}
      className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-small ${
        tone === 'danger' ? 'text-danger-text hover:bg-danger-bg' : 'text-fg hover:bg-page'
      }`}>
      {children}
    </button>
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
