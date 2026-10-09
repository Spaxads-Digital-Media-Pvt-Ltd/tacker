/**
 * Layout pieces shared by the Reporting pages (no "Run Report" button — every control applies on its
 * own; see `useAutoDateRange` in pages/admin/reportView.ts for the date half of that).
 *
 *   <ReportCard>
 *     <ReportControls problem={…} actions={<><ClearButton/><FiltersButton/></>}>   report controls
 *       <DateRangeField … />  …page-specific selects…
 *     </ReportControls>
 *     <ResultsBar title=… loading=… actions={…view-only controls…}>chips</ResultsBar>
 *     <ReportBody>table</ReportBody>
 *   </ReportCard>
 *
 * Report controls change what is fetched; the results bar holds view-only controls (timezone,
 * search-this-page, table menu) that never refetch.
 */
import type { ReactNode } from 'react';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import { REPORT_CONTROL } from './reportControl';

/** One card with flush sections (controls / results bar / body). No hover lift — it holds dropdowns. */
export function ReportCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card !p-0 hover:!translate-y-0 ${className}`}>{children}</div>;
}

/** Report controls row: page controls on the left, `actions` (Clear + Filters) pinned to the right. */
export function ReportControls({ children, actions, problem }: { children?: ReactNode; actions?: ReactNode; problem?: string | null }) {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 px-5 pb-4 pt-5 sm:px-6">
        {children}
        {actions && <div className="flex flex-wrap items-end gap-3 sm:ml-auto">{actions}</div>}
      </div>
      {problem && <p className="-mt-1 px-5 pb-4 text-tiny text-danger-text sm:px-6" role="alert">{problem}</p>}
    </>
  );
}

/** A labelled control in the controls row (label above, 40 px control below). */
export function ControlField({ label, htmlFor, className = 'w-full sm:w-56', children }: { label: string; htmlFor?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/**
 * From → To as one field on wider screens; the two dates stack on phones, where side by side
 * they'd clip. Ids are `${idPrefix}-from` / `${idPrefix}-to`.
 */
export function DateRangeField({ idPrefix, label = 'Date range (UTC)', from, to, max, invalid, onFrom, onTo }: {
  idPrefix: string; label?: string; from: string; to: string; max: string; invalid?: boolean;
  onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  const labelId = `${idPrefix}-range-label`;
  return (
    <div className="w-full sm:w-auto">
      <span className="label" id={labelId}>{label}</span>
      <div role="group" aria-labelledby={labelId}
        className={`flex flex-col rounded-[var(--radius)] border bg-surface shadow-sm transition-all duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 sm:h-10 sm:flex-row sm:items-center ${invalid ? 'border-danger' : 'border-fg-muted/30 hover:border-accent/50'}`}>
        <input id={`${idPrefix}-from`} type="date" aria-label="From (UTC)" value={from} max={to || max}
          aria-invalid={invalid || undefined} onChange={(e) => onFrom(e.target.value)}
          className="h-10 w-full min-w-0 bg-transparent px-3.5 text-body text-fg focus:outline-none sm:h-full sm:w-[9.5rem] sm:pr-2" />
        <ArrowRight size={14} className="hidden shrink-0 text-fg-muted sm:block" aria-hidden />
        <input id={`${idPrefix}-to`} type="date" aria-label="To (UTC)" value={to} min={from || undefined} max={max}
          aria-invalid={invalid || undefined} onChange={(e) => onTo(e.target.value)}
          className="h-10 w-full min-w-0 border-t border-border bg-transparent px-3.5 text-body text-fg focus:outline-none sm:h-full sm:w-[9.5rem] sm:border-t-0 sm:pl-2" />
      </div>
    </div>
  );
}

/**
 * "Filters" button with the applied-filter count. Render the page's drawer/flyout as `children`.
 * `disabled` + `title` for pages whose filtering isn't available yet (the wrapper carries the
 * tooltip, since a disabled button gets no pointer events).
 */
export function FiltersButton({ count = 0, onClick, disabled = false, title, children }: {
  count?: number; onClick?: () => void; disabled?: boolean; title?: string; children?: ReactNode;
}) {
  return (
    <div className="relative" title={title}>
      <button type="button" onClick={onClick} disabled={disabled} aria-haspopup="dialog" className={`btn-ghost ${REPORT_CONTROL} !px-3.5`}>
        <SlidersHorizontal size={15} className="text-fg-secondary" /> Filters
        {count > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-tiny font-bold text-white">{count}</span>}
      </button>
      {children}
    </div>
  );
}

/** Text "Clear" control, aligned with the 40 px controls. */
export function ClearButton({ onClick, title = 'Reset dates and filters' }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" className={`inline-flex items-center px-1 text-small font-medium text-accent-text hover:underline ${REPORT_CONTROL}`}
      onClick={onClick} title={title}>Clear</button>
  );
}

/** Small inline "Updating…" indicator for a refresh in flight. */
export function UpdatingIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-tiny text-fg-muted" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden /> Updating…
    </span>
  );
}

/**
 * Tinted bar above the results: title, loading state and chips (`children`) on the left, view-only
 * controls (`actions`) on the right. `position="top"` when it is the first section of its card.
 */
export function ResultsBar({ title, loading, actions, children, position = 'middle' }: {
  title: ReactNode; loading?: boolean; actions?: ReactNode; children?: ReactNode; position?: 'top' | 'middle';
}) {
  const edge = position === 'top' ? 'rounded-t-[var(--radius-card)] border-b' : 'border-y';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ${edge} border-border bg-page/60 px-5 py-3 sm:px-6`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="mr-1 text-small font-semibold text-fg">{title}</h3>
        {loading && <UpdatingIndicator />}
        {children}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

/** Padded body below the results bar (table, pagination, empty/error states). */
export function ReportBody({ children }: { children: ReactNode }) {
  return <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>;
}
