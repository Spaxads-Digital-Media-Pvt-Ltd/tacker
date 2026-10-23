import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, ChevronDown, Inbox, RefreshCw, X } from 'lucide-react';
import { useIntersectionObserver } from '../../lib/useIntersectionObserver';
import { usePageTitle } from './PageTitle';
import { HelpHint } from '../panels/HelpHint';

/**
 * Declares the page title/subtitle (rendered in the top header, Section 2 — NOT duplicated in the
 * body) and optionally lays out page-level actions on the right. If a page has no `action`, this
 * renders nothing in the body.
 */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  usePageTitle(title, subtitle);
  if (!action) return null;
  // form-width: on a form page the actions row shares the form container (index.css); elsewhere full width.
  return <div className="form-width mb-5 flex flex-wrap items-center justify-end gap-2 sm:gap-3">{action}</div>;
}

/** Metric hue for a StatCard's icon chip (charts / chips only — never text in light mode). */
export type MetricTone = 'revenue' | 'payout' | 'margin' | 'clicks' | 'conversions';
const METRIC_CHIP: Record<MetricTone, string> = {
  revenue: 'bg-metric-revenue/10 text-metric-revenue',
  payout: 'bg-metric-payout/10 text-metric-payout',
  margin: 'bg-metric-margin/10 text-metric-margin',
  clicks: 'bg-metric-clicks/10 text-metric-clicks',
  conversions: 'bg-metric-conversions/10 text-metric-conversions',
};

/**
 * KPI tile: label, a large tabular value, an optional hint. Additive: `icon` (+ `tone` for its
 * metric-hue chip) and `muted` (the value is a placeholder such as "Mixed" / "—", not a figure).
 */
export function StatCard({ label, value, hint, icon, tone, muted = false, valueTitle }: {
  label: string; value: string; hint?: string;
  icon?: ReactNode; tone?: MetricTone; muted?: boolean; valueTitle?: string;
}) {
  return (
    <ScrollReveal className="card !p-5 hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <p className="text-small font-medium text-fg-secondary">{label}</p>
        {icon && (
          <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] ${tone ? METRIC_CHIP[tone] : 'bg-accent-subtle text-accent-text'}`}>
            {icon}
          </span>
        )}
      </div>
      <p title={valueTitle} className={`mt-2 text-h1 font-bold tabular-nums tracking-tight ${muted ? 'text-fg-muted' : 'text-fg'}`}>{value}</p>
      {hint && <p className="mt-1 text-tiny text-fg-muted">{hint}</p>}
    </ScrollReveal>
  );
}

export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <ScrollReveal className="card border-dashed">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-tiny font-semibold text-accent-text">
          {phase}
        </span>
        <span className="text-small font-medium text-fg">Coming in this phase</span>
      </div>
      <p className="mt-2 text-small text-fg-secondary">{children}</p>
    </ScrollReveal>
  );
}

// Semantic status tones (Section 0 rule): green=positive, amber=pending, red=negative, neutral=inert.
const SUCCESS = 'bg-success-bg text-success-text';
const WARNING = 'bg-warning-bg text-warning-text';
const DANGER = 'bg-danger-bg text-danger-text';
// bg-elevated so the chip reads as *raised* in dark (bg-page there is darker than the card).
// --bg-elevated is pure white in light == the card, so add a hairline inset ring to keep the chip
// visible there too; ring is box-shadow, so no size drift vs the coloured badge tones.
const NEUTRAL = 'bg-elevated text-fg-secondary ring-1 ring-inset ring-border';
const BADGE_TONES: Record<string, string> = {
  active: SUCCESS, approved: SUCCESS, verified: SUCCESS, issued: SUCCESS, completed: SUCCESS,
  pending: WARNING, trialing: WARNING, hold: WARNING,
  suspended: DANGER, rejected: DANGER, blocked: DANGER, failed: DANGER, deleted: DANGER, overdue: DANGER, past_due: DANGER,
  // Inbound postbacks that recorded nothing (Advertiser Postback report).
  click_not_found: DANGER, security_failed: DANGER, error: DANGER,
  draft: NEUTRAL, paused: NEUTRAL, inactive: NEUTRAL, disabled: NEUTRAL, archived: NEUTRAL, duplicate: NEUTRAL,
};

const TONE_CLASSES = { success: SUCCESS, warning: WARNING, danger: DANGER, neutral: NEUTRAL } as const;

/** `value` picks the tone (and is the text unless `label` is given). Additive: `tone` overrides the
 * value-derived tone, for status sets with their own shared tone map (e.g. lib/offerStatus). */
export function Badge({ value, label, tone: toneKey }: { value: string; label?: string; tone?: keyof typeof TONE_CLASSES }) {
  const tone = (toneKey ? TONE_CLASSES[toneKey] : BADGE_TONES[value]) ?? 'bg-accent-subtle text-accent-text';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold capitalize ${tone}`}>{label ?? value}</span>;
}

export function Spinner() {
  return <div role="status" aria-label="Loading" className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none" />;
}

/**
 * Loading / empty / error placeholder for a panel or table.
 *  - No `variant` (every existing call site): a dashed box around `children`, exactly as before.
 *  - `variant="loading"`: skeleton bars (`rows`, default 4) announced as busy to screen readers.
 *  - `variant="empty"`: icon + `title` + `hint` (or `children`) + optional `action`.
 *  - `variant="error"`: alert icon + `title` + the message (`hint` or `children`) + a Retry button
 *    when `onRetry` is given.
 */
export function StateBlock({
  children, variant, title, hint, icon, action, onRetry, retryLabel = 'Retry', rows = 4,
}: {
  children?: ReactNode;
  variant?: 'loading' | 'empty' | 'error';
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  rows?: number;
}) {
  if (!variant) {
    return <div className="grid place-items-center rounded-card border border-dashed border-border px-6 py-14 text-center text-small text-fg-secondary">{children}</div>;
  }
  if (variant === 'loading') {
    return (
      <div role="status" aria-busy="true" className="rounded-card border border-border bg-surface p-5">
        <span className="sr-only">{title ?? 'Loading…'}</span>
        <div aria-hidden className="space-y-3">
          {Array.from({ length: Math.max(1, rows) }, (_, i) => (
            <div key={i} className={`h-3 animate-pulse rounded-full bg-subtle motion-reduce:animate-none ${i === 0 ? 'w-1/3' : i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />
          ))}
        </div>
      </div>
    );
  }
  const error = variant === 'error';
  const body = hint ?? children;
  return (
    <div role={error ? 'alert' : undefined}
      className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden className={`grid h-10 w-10 place-items-center rounded-full ${error ? 'bg-danger-bg text-danger-text' : 'bg-accent-subtle text-accent-text'}`}>
        {icon ?? (error ? <AlertCircle size={18} /> : <Inbox size={18} />)}
      </span>
      {(title ?? (error ? 'Something went wrong' : null)) && (
        <p className="mt-3 text-body font-semibold text-fg">{title ?? 'Something went wrong'}</p>
      )}
      {body && <div className="mt-1 max-w-md text-small text-fg-secondary">{body}</div>}
      {(action || (error && onRetry)) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {error && onRetry && (
            <button type="button" className="btn-ghost" onClick={onRetry}><RefreshCw size={15} aria-hidden /> {retryLabel}</button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * Reusable scroll shell for wide data tables — the deliberate "scroll, don't reflow" pattern
 * (see tailwind.config.js responsive strategy). Bounds height so `sticky` works, and shows a flat
 * edge bar (--border-strong, no gradient) only on the side that has more content, so the
 * horizontal scroll is discoverable.
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
      <div ref={ref} className={`max-h-[70vh] overflow-auto rounded-card border border-border bg-surface ${className}`}>
        {children}
      </div>
      {edge.left && <div aria-hidden className="pointer-events-none absolute inset-y-3 left-1 w-0.5 rounded-full bg-border-strong" />}
      {edge.right && <div aria-hidden className="pointer-events-none absolute inset-y-3 right-1 w-0.5 rounded-full bg-border-strong" />}
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

export function Table<T>({ columns, rows, rowKey, stickyCol = 0, caption }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; stickyCol?: number;
  /** Additive: an accessible name for the table (visually hidden). */
  caption?: string;
}) {
  return (
    <TableScroll>
      <table className="premium-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={`${i === stickyCol ? 'sticky left-0 z-30' : ''} ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) => (
                <td key={i} className={`${i === stickyCol ? 'sticky left-0 z-10 bg-inherit' : ''} ${c.className ?? ''}`}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

const MODAL_SIZE: Record<string, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

// Open overlays, innermost last — Escape belongs to the topmost one only, so closing a confirm or
// picker never also closes the modal underneath it (and loses its form).
const overlayStack: number[] = [];
let overlaySeq = 0;
let bodyOverflowBefore = '';

/**
 * Full-viewport dimmed layer portaled to document.body. Nested `fixed` overlays inside AppShell's
 * scrollable `<main>` (or any overflow/transform ancestor) get clipped — use Overlay (or Modal)
 * for every dimmed popup.
 *
 * Escape closes only the topmost overlay, and not while an open combobox / menu inside it owns the
 * key. The backdrop closes only on a click that both starts and ends on it, so a text selection
 * dragged out of a form doesn't dismiss the dialog.
 */
export function Overlay({
  children,
  onClose,
  className = 'grid place-items-center bg-[rgb(var(--flyout-scrim))] p-4',
}: {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  // Callers pass inline handlers — read the latest through a ref so the listener isn't re-bound
  // (and the body lock re-applied) on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const id = ++overlaySeq;
    if (overlayStack.length === 0) {
      bodyOverflowBefore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    overlayStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayStack[overlayStack.length - 1] !== id) return;
      const t = e.target as Element | null;
      if (t?.closest?.('[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]')) return;
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = overlayStack.lastIndexOf(id);
      if (i >= 0) overlayStack.splice(i, 1);
      if (overlayStack.length === 0) document.body.style.overflow = bodyOverflowBefore;
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-overlay ${className}`}
      role="presentation"
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onCloseRef.current?.();
        downOnBackdrop.current = false;
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus model (same as ConfirmDialog): on open, focus the first field in the dialog body
 * (or the dialog itself) unless something inside already took focus (autoFocus); keep Tab inside;
 * on close, return focus to whatever opened it.
 */
function useDialogFocus(boxRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const opener = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      if (box.contains(document.activeElement)) return;
      const field = box.querySelector<HTMLElement>('[data-dialog-body] :is(input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]))');
      (field ?? box).focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [boxRef]);

  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === boxRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}

/**
 * Centered modal. The box is height-bounded to the viewport and its body scrolls, so a tall form
 * never pushes its controls off-screen. Pass `footer` for a sticky action row (Save/Cancel) that
 * stays visible while the body scrolls; without it the modal is a plain scroll container.
 *
 * Uses Overlay (portaled to document.body) so it is not clipped by AppShell / animate-fade-in.
 */
export function Modal({
  open, onClose, title, children, footer, size = 'md', description,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
  /** `sm` / `lg` are additive; `md` (default) and `xl` keep their widths. */
  size?: ModalSize;
  /** Additive: a line under the title, announced as the dialog's description. */
  description?: ReactNode;
}) {
  if (!open) return null;
  return <ModalBox onClose={onClose} title={title} footer={footer} size={size} description={description}>{children}</ModalBox>;
}

function ModalBox({
  onClose, title, children, footer, size, description,
}: {
  onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size: ModalSize; description?: ReactNode;
}) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogFocus(boxRef);
  return (
    <Overlay onClose={onClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${MODAL_SIZE[size]} animate-fade-in flex-col rounded-card border border-border bg-elevated shadow-elevated focus:outline-none motion-reduce:animate-none`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
            {description && <p id={descId} className="mt-1 text-small text-fg-secondary">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="-mr-2 -mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg-muted transition-colors duration-fast hover:bg-subtle hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div data-dialog-body className="mt-4 flex-1 overflow-y-auto overflow-x-auto px-6 pb-6">{children}</div>
        {footer != null && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}

/**
 * Replacement for native `window.prompt`. Takes a title + message, returns the entered text via
 * onConfirm, or closes with no value via onClose.
 */
export function PromptModal({
  open, onClose, title, message, placeholder, onConfirm,
}: {
  open: boolean; onClose: () => void; title: string; message: string; placeholder?: string; onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const titleId = useId();

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onClose();
  };

  // Escape is handled once, by the Overlay (it used to fire onClose twice).
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  };

  if (!open) return null;
  return (
    <Overlay onClose={onClose}>
      <PromptBox titleId={titleId}>
        <h2 id={titleId} className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-2 text-small text-fg-secondary">{message}</p>
        <input
          autoFocus
          aria-labelledby={titleId}
          className="input mt-4"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit}>Save</button>
        </div>
    </PromptBox>
    </Overlay>
  );
}

function PromptBox({ titleId, children }: { titleId: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogFocus(boxRef);
  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="animate-fade-in w-full max-w-sm rounded-card border border-border bg-elevated p-6 shadow-elevated focus:outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={trapTab}
    >
      {children}
    </div>
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
  // The list stays inside its dialog (so the dialog's Tab trap still reaches its checkboxes) and is
  // scrolled into view when it opens — near the bottom of a scrolling modal body it would otherwise
  // run past the visible edge.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { if (open) listRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [open]);
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
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-on-accent">
            {value.length}
          </span>
        )}
        {open && (
          <>
            {/* z-popover: this list opens inside modals (CollectionTab) — above the dialog content. */}
            <button type="button" className="fixed inset-0 z-popover" aria-label="close" onClick={() => setOpen(false)} />
            <ul ref={listRef} className="absolute z-popover mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border bg-elevated py-1 shadow-elevated">
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
              <button key={id} type="button" onClick={() => toggle(id)} aria-label={`Remove ${o?.label ?? id.slice(0, 8)}`}
                className="inline-flex items-center gap-1 rounded-full bg-accent-subtle py-0.5 pl-2.5 pr-1.5 text-tiny font-medium text-accent-text hover:bg-accent/15">
                {o?.label ?? id.slice(0, 8)} <span aria-hidden>×</span>
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
 * Anchored dropdown menu — the standard row-kebab / "Table Actions" / toolbar-select popover.
 *
 * Portaled to <body> with `position: fixed` from the trigger's rect, so an `overflow`-clipped or
 * `transform`ed ancestor (the table scroll wrapper, a drawer or modal body, an animation utility
 * further up) can't trap or clip it. Opens below the trigger, flips above when there isn't room,
 * and is clamped 8 px inside the viewport (a panel taller than the viewport scrolls). It follows the
 * trigger on scroll / resize and closes once the trigger has scrolled out of view.
 *
 * Keyboard: opening focuses the checked (or first) item; ↑ / ↓ / Home / End move between items;
 * Escape — and choosing an item through `close()` — returns focus to the trigger. Outside
 * pointer-down closes it without moving focus.
 *
 * Deliberately has NO full-screen `fixed inset-0` click-catcher overlay. That overlay was the
 * "row kebab opens the wrong menu" bug: with a menu open, its viewport-covering overlay ate the
 * FIRST click on any *other* trigger (a different row's kebab, or the toolbar's Table Actions ⋮),
 * so switching menus silently required two clicks and left the previously-open menu showing.
 */
const MENU_ITEMS = '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled),[role="menuitemcheckbox"]:not(:disabled)';
const VIEWPORT_MARGIN = 8;

export function MenuPopover({
  button, ariaLabel, triggerClassName, align = 'end', width = 'w-max min-w-[11rem]', onOpenChange, triggerProps, children,
}: {
  button: ReactNode;
  ariaLabel: string;
  triggerClassName?: string;
  align?: 'start' | 'end';
  width?: string;
  onOpenChange?: (open: boolean) => void;
  /** Extra attributes for the trigger button (e.g. `data-active` for the toolbar's filtered state). */
  triggerProps?: Record<string, string | undefined>;
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
  const [style, setStyle] = useState<{ top: number; left: number; maxHeight?: number; visibility?: 'hidden' }>({ top: 0, left: 0, visibility: 'hidden' });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const place = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const b = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Trigger scrolled out of view: nothing left to anchor to.
    if (b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) { setOpen(false); return; }
    const gap = 4;
    const m = VIEWPORT_MARGIN;
    const w = menu.offsetWidth;
    const h = menu.scrollHeight;
    const below = vh - b.bottom - gap - m;
    const above = b.top - gap - m;
    const up = h > below && above > below;
    const room = Math.max(0, up ? above : below);
    const height = Math.min(h, room > 120 ? room : vh - 2 * m);
    let top = up ? b.top - gap - height : b.bottom + gap;
    top = Math.min(Math.max(top, m), vh - m - height);
    let left = align === 'end' ? b.right - w : b.left;
    left = Math.min(Math.max(left, m), Math.max(m, vw - m - w));
    setStyle({ top: Math.round(top), left: Math.round(left), maxHeight: height < h ? Math.floor(height) : undefined });
  }, [align, setOpen]);

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, [setOpen]);

  useLayoutEffect(() => {
    if (!open) { setStyle({ top: 0, left: 0, visibility: 'hidden' }); return; }
    place();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [])];
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (menuRef.current) ro?.observe(menuRef.current);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, place, setOpen, close]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    items[next]!.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        className={triggerClassName}
        {...triggerProps}
      >
        {button}
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label={ariaLabel} style={style} onKeyDown={onMenuKey}
          className={`fixed z-popover ${width} overflow-y-auto animate-fade-in rounded-card border border-border bg-elevated p-1.5 shadow-elevated motion-reduce:animate-none`}>
          {children({ close })}
        </div>,
        document.body,
      )}
    </>
  );
}

export interface MenuSelectOption<T extends string = string> { value: T; label: string; dot?: string }

/**
 * Toolbar select (search field, status, type, sort …) on MenuPopover: a `.btn-toolbar` trigger
 * showing the current choice and a portaled list of radio items, the current one checked.
 * `active` gives the trigger the subtle accent "filtered" state; `display` overrides what the
 * trigger shows (e.g. "3 statuses" when the drawer picked several). Values pass through untouched.
 */
export function MenuSelect<T extends string>({
  value, options, onChange, label, prefix, display, active = false, align = 'start', width = 'w-44', showCheck = true,
}: {
  value: T;
  options: readonly MenuSelectOption<T>[];
  onChange: (value: T) => void;
  /** What the select chooses ("Status", "Search field", "Sort") — the trigger reads "Status: Active". */
  label: string;
  /** Visible lead-in inside the trigger (e.g. "Sort:"). */
  prefix?: ReactNode;
  display?: { label: string; dot?: string };
  active?: boolean;
  align?: 'start' | 'end';
  width?: string;
  /** Hide the check mark (when the trigger shows a summary that no single item matches). */
  showCheck?: boolean;
}) {
  const current = display ?? options.find((o) => o.value === value) ?? options[0];
  return (
    <MenuPopover
      ariaLabel={`${label}: ${current?.label ?? ''}`}
      align={align}
      width={width}
      triggerClassName="btn-toolbar"
      triggerProps={{ 'data-active': active ? 'true' : undefined }}
      button={<>
        {prefix && <span className="text-fg-secondary">{prefix}</span>}
        {current?.dot && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${current.dot}`} />}
        <span className="truncate">{current?.label}</span>
        <ChevronDown size={14} aria-hidden className="shrink-0" />
      </>}
    >
      {({ close }) => options.map((o) => {
        const checked = showCheck && o.value === value;
        return (
          <button key={o.value} type="button" role="menuitemradio" aria-checked={checked}
            onClick={() => { onChange(o.value); close(); }}
            className="flex w-full items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-left text-small text-fg transition-colors duration-fast hover:bg-subtle focus-visible:bg-subtle">
            {o.dot && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} />}
            <span className="flex-1">{o.label}</span>
            {checked && <Check size={14} aria-hidden className="shrink-0 text-accent-text" />}
          </button>
        );
      })}
    </MenuPopover>
  );
}

/** A row inside <MenuPopover>. `tone="danger"` for destructive actions. */
export function MenuItem({ children, onSelect, tone = 'default', disabled = false, icon: Icon, title }: { children: ReactNode; onSelect: () => void; tone?: 'default' | 'danger' | 'success'; disabled?: boolean; icon?: React.ElementType; title?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} disabled={disabled} title={title}
      className={`group flex w-full items-center gap-2.5 whitespace-nowrap rounded-[var(--radius)] px-3 py-2 text-left text-small font-medium transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50 ${
        tone === 'danger' ? 'text-danger-text hover:bg-danger-bg' : tone === 'success' ? 'text-success-text hover:bg-success-bg' : 'text-fg hover:bg-subtle'
      }`}>
      {Icon && <Icon size={16} aria-hidden className={`shrink-0 transition-colors ${tone === 'danger' ? 'text-danger-text' : tone === 'success' ? 'text-success-text' : 'text-fg-secondary group-hover:text-fg'}`} />}
      {children}
    </button>
  );
}

const LABELABLE = new Set(['input', 'select', 'textarea']);

/**
 * Label + control. When the child is a single native input/select/textarea the label is tied to it
 * (htmlFor/id, generated if the control has none), so screen readers announce the field name and
 * clicking the label focuses the control. The help hint sits beside the label, not inside it, so it
 * isn't read as part of the field's name.
 *
 * Concept 05: the label turns accent while the field has focus; `data-help-label` / `data-help` feed
 * the FieldHelpPanel. `error` (display only — validation stays where it is) shows a danger outline
 * and the message under the control, tied to it with aria-invalid / aria-describedby.
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const autoId = useId();
  const errorId = `${autoId}-error`;
  let control = children;
  let htmlFor: string | undefined;
  if (isValidElement(children) && typeof children.type === 'string' && LABELABLE.has(children.type)) {
    const props = children.props as { id?: string; 'aria-describedby'?: string };
    const existing = props.id;
    htmlFor = existing ?? autoId;
    const extra: Record<string, unknown> = {};
    if (!existing) extra.id = autoId;
    if (error) {
      extra['aria-invalid'] = true;
      extra['aria-describedby'] = [props['aria-describedby'], errorId].filter(Boolean).join(' ');
    }
    if (Object.keys(extra).length) control = cloneElement(children as ReactElement<Record<string, unknown>>, extra);
  }
  return (
    <div data-help-label={label} data-help={hint}
      className={`group/field ${error ? '[&_.input]:!border-danger [&_.input]:ring-1 [&_.input]:ring-inset [&_.input]:ring-danger' : ''}`}>
      <div className="mb-1.5 flex items-center">
        <label className={`label !mb-0 transition-colors duration-fast ${error ? '!text-danger-text' : 'group-focus-within/field:text-accent-text'}`} htmlFor={htmlFor}>{label}</label>
        {hint && <HelpHint text={hint} />}
      </div>
      {control}
      {error && (
        <p id={errorId} data-field-error className="mt-1.5 flex items-start gap-1.5 text-tiny text-danger-text">
          <AlertCircle size={14} aria-hidden className="mt-px shrink-0" />{error}
        </p>
      )}
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
      <label className="label text-fg-muted">{label}</label>
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
  options, value, onChange, dots, labels, className, ariaLabel, size = 'md',
}: {
  options: readonly SegmentedOption[];
  value: string;
  onChange: (v: string) => void;
  dots?: Record<string, string>;
  labels?: Record<string, string>;
  className?: string;
  /** Additive: names the group for screen readers. */
  ariaLabel?: string;
  /** Additive: `sm` for toolbars (date presets, chart type). */
  size?: 'sm' | 'md';
}) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: labels?.[o] ?? o } : o));
  return (
    <div role="group" aria-label={ariaLabel}
      className={`flex w-full gap-1 rounded-full border border-border bg-subtle p-1 ${className ?? ''}`}>
      {items.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 basis-0 min-w-0 items-center justify-center gap-1.5 rounded-full font-medium capitalize transition-colors duration-fast ${
              size === 'sm' ? 'px-2.5 py-1 text-tiny' : 'px-3 py-2 text-small'
            } ${
              on ? 'bg-surface text-fg shadow-sm ring-1 ring-inset ring-border' : 'text-fg-secondary hover:text-fg'
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

/** Horizontal tab strip (controlled). Used by the multi-section entity screens (offers, etc.).
 * WAI-ARIA tabs: one tab stop, Left/Right/Home/End move between tabs (and select them).
 * Below `sm` the strip scrolls sideways instead of wrapping, and the selected tab is scrolled into
 * view horizontally (the page itself is never scrolled). */
export function Tabs({ tabs, active, onChange, ariaLabel, counts }: {
  tabs: string[]; active: string; onChange: (t: string) => void;
  /** Additive: names the tab list for screen readers. */
  ariaLabel?: string;
  /** Additive: a small count badge per tab (only tabs present in the map show one). */
  counts?: Record<string, number>;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIdx = Math.max(0, tabs.indexOf(active));
  useEffect(() => {
    const box = listRef.current;
    const el = refs.current[activeIdx];
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < b.left) box.scrollLeft += r.left - b.left - 8;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right + 8;
  }, [activeIdx]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div ref={listRef} role="tablist" aria-label={ariaLabel}
      className="mb-6 flex flex-wrap gap-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:p-1 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
      {tabs.map((t, i) => {
        const on = t === active;
        const count = counts?.[t];
        return (
          <button
            key={t}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={i === activeIdx ? 0 : -1}
            onClick={() => onChange(t)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-small font-medium transition-colors duration-fast ${
              on
                ? 'bg-accent-subtle text-accent-text'
                : 'text-fg-secondary hover:bg-subtle hover:text-fg'
            }`}
          >
            {t}
            {count !== undefined && (
              <span className={`rounded-full px-1.5 text-tiny font-semibold tabular-nums ${on ? 'bg-surface text-accent-text' : 'bg-subtle text-fg-secondary'}`}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function AnimatedNumber({ value, formatFn = String, animate = true, duration = 1500 }: { value: number; formatFn?: (val: number) => string; animate?: boolean; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    if (!animate) {
      setDisplayValue(0);
      prevValue.current = 0;
      return;
    }
    // Reduced motion: show the figure straight away (the CSS reduced-motion rule can't reach a
    // JS count-up).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(value);
      prevValue.current = value;
      return;
    }

    const startValue = prevValue.current;
    const endValue = value;
    if (startValue === endValue) return;

    let startTime: number | null = null;
    let rAF: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      const current = startValue + (endValue - startValue) * easeProgress;
      setDisplayValue(current);

      if (progress < 1) {
        rAF = requestAnimationFrame(step);
      } else {
        prevValue.current = endValue;
      }
    };

    rAF = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rAF);
  }, [value, animate, duration]);

  return <>{formatFn(displayValue)}</>;
}



export function ScrollReveal({ children, animation = 'animate-fade-in', delay = 0, className = '', rootMargin = '50px' }: { children: ReactNode; animation?: string; delay?: number; className?: string; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useIntersectionObserver(ref, { threshold: 0.1, rootMargin });
  return (
    <div ref={ref} className={`${className} ${inView ? animation : 'opacity-0'}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
