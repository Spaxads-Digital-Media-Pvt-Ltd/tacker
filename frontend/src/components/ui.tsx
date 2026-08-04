import { useEffect, type ReactNode } from 'react';
import { usePageTitle } from './PageTitle';

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
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tracking-tight text-fg">{value}</p>
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
const NEUTRAL = 'bg-subtle text-fg-secondary';
const BADGE_TONES: Record<string, string> = {
  active: SUCCESS, approved: SUCCESS, verified: SUCCESS, issued: SUCCESS, completed: SUCCESS,
  pending: WARNING, trialing: WARNING, hold: WARNING,
  suspended: DANGER, rejected: DANGER, blocked: DANGER, failed: DANGER,
  draft: NEUTRAL, paused: NEUTRAL, inactive: NEUTRAL, disabled: NEUTRAL, archived: NEUTRAL,
};
const DOT_TONES: Record<string, string> = {
  active: 'bg-success', approved: 'bg-success', verified: 'bg-success', issued: 'bg-success', completed: 'bg-success',
  pending: 'bg-warning', trialing: 'bg-warning', hold: 'bg-warning',
  suspended: 'bg-danger', rejected: 'bg-danger', blocked: 'bg-danger', failed: 'bg-danger',
  draft: 'bg-fg-muted', paused: 'bg-fg-muted', inactive: 'bg-fg-muted', disabled: 'bg-fg-muted', archived: 'bg-fg-muted',
};

export function Badge({ value }: { value: string }) {
  const tone = BADGE_TONES[value] ?? 'bg-accent-subtle text-accent-text';
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-tiny font-semibold capitalize ${tone}`}>{value}</span>;
}

/** Everflow-style compact status indicator: a colored dot + label — used in dense table cells. */
export function StatusDot({ value }: { value: string }) {
  const dot = DOT_TONES[value] ?? 'bg-accent';
  return (
    <span className="inline-flex items-center gap-1.5 text-small capitalize text-fg">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {value}
    </span>
  );
}

export function Spinner() {
  return <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />;
}

export function StateBlock({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-card border border-dashed border-border bg-surface/50 py-16 text-center text-small text-fg-secondary">{children}</div>;
}

/** Simple, accessible table. `columns` maps a header to a cell renderer. */
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
      <table className="w-full min-w-[560px] text-left text-body">
        <thead className="border-b border-border">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`whitespace-nowrap px-4 py-3 text-tiny font-semibold uppercase tracking-wide text-fg-muted ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="text-fg transition-colors hover:bg-accent-subtle/40">
              {columns.map((c) => (
                <td key={c.header} className={`px-4 py-3 ${c.className ?? ''}`}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg animate-fade-in rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-h3 font-semibold tracking-tight text-fg">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/** Segmented pill tab strip (controlled). Used by the multi-section entity screens (offers, etc.). */
export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-6 inline-flex flex-wrap gap-1 rounded-[calc(var(--radius)+4px)] border border-border bg-subtle p-1">
      {tabs.map((t) => {
        const on = t === active;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            className={`whitespace-nowrap rounded-[var(--radius)] px-3.5 py-1.5 text-small font-medium transition-colors ${
              on
                ? 'bg-surface text-fg shadow-sm'
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
