import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
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
const NEUTRAL = 'bg-page text-fg-secondary';
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

/** Simple, accessible table. `columns` maps a header to a cell renderer. */
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[560px] text-left text-body">
        <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
          <tr className="divide-x divide-border">
            {columns.map((c, i) => (
              <th key={i} className={`whitespace-nowrap px-4 py-3 font-semibold ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="divide-x divide-border bg-surface text-fg transition-colors hover:bg-accent-subtle/40">
              {columns.map((c, i) => (
                <td key={i} className={`px-4 py-3 ${c.className ?? ''}`}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <div className={`w-full ${MODAL_SIZE[size]} animate-fade-in rounded-card border border-border bg-elevated p-6 shadow-card`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mt-4 overflow-x-auto">{children}</div>
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
