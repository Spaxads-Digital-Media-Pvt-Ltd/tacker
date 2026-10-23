/** Small building blocks shared by the dashboard cards. Tokens only. */
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { StateBlock } from '../../shared-components/primitives/ui';
import { changeText, type Change } from './metrics';

/** A titled dashboard panel; the body fills the remaining height (equal-height grid rows). */
export function SectionCard({ title, subtitle, actions, children, className = '', bodyClassName = 'p-5' }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={`card flex h-full flex-col !p-0 ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-tiny text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={`flex flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * A section's own loading / error / empty handling: skeleton while there's nothing yet, the error
 * with a retry (the previous data stays if a refresh fails), the empty state, else the content.
 */
export function SectionBody({ loading, error, onRetry, empty, emptyTitle, emptyHint, rows = 4, children }: {
  loading: boolean; error: string | null; onRetry: () => void; empty: boolean;
  emptyTitle: ReactNode; emptyHint?: ReactNode; rows?: number; children: ReactNode;
}) {
  if (loading && empty) return <StateBlock variant="loading" rows={rows} />;
  if (error && empty) return <StateBlock variant="error" title="Couldn’t load this section" hint={error} onRetry={onRetry} />;
  if (empty) return <StateBlock variant="empty" title={emptyTitle} hint={emptyHint} />;
  // Refreshing (new range): keep the last figures, dimmed and marked busy, until the new ones land.
  return (
    <div aria-busy={loading || undefined} className={`flex flex-1 flex-col transition-opacity duration-base ${loading ? 'opacity-60' : ''}`}>
      {children}
    </div>
  );
}

/** A refresh failed but older data is still shown. */
export function StaleNote({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-tiny text-danger-text">
      Couldn’t refresh — showing the last loaded figures.
      <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">Retry</button>
    </p>
  );
}

/**
 * The change badge: arrow + 2 decimals ("+12.34%" / "+0.42 pp"), "New" or "No change", then the
 * comparison label. The comparison period's own value is in the title.
 */
export function ChangeText({ change, compareLabel, previous, note }: {
  change: Change | null; compareLabel: string; previous?: string;
  /** Why there's no change (e.g. periods in different currencies). */
  note?: string;
}) {
  if (!change) {
    return <p className="text-tiny text-fg-muted" title={note}>{note ? 'Change not comparable' : 'No comparison'} <span className="text-fg-muted">{compareLabel}</span></p>;
  }
  const title = previous ? `${compareLabel}: ${previous}` : undefined;
  const directional = change.kind === 'pct' || change.kind === 'pp';
  const tone = !directional ? (change.kind === 'new' ? 'bg-accent-subtle text-accent-text' : 'bg-subtle text-fg-secondary')
    : change.up ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text';
  const Icon = !directional ? Minus : change.up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-tiny" title={title}>
      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${tone}`}>
        {change.kind !== 'new' && <Icon size={12} aria-hidden />}{changeText(change)}
      </span>
      <span className="text-fg-muted">{compareLabel}</span>
    </p>
  );
}

/** "• Yesterday 2.41%   • This month 2.10%   • Last month 1.98%". */
export function DotStats({ items }: { items: { label: string; value: string; title?: string }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-tiny">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-fg-muted"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-metric-margin" />{it.label}</dt>
          <dd className="mt-0.5 truncate font-semibold tabular-nums text-fg" title={it.title}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Revenue not plotted — mixed currencies (EUR, USD)". */
export function MixedNote({ what, currencies, className = '' }: { what: string; currencies: readonly string[]; className?: string }) {
  return (
    <p className={`grid place-items-center rounded-[var(--radius)] border border-dashed border-border px-4 text-center text-small text-fg-muted ${className}`}
      title="Amounts in different currencies are never added or compared (no FX conversion).">
      {what} not plotted — mixed currencies ({currencies.join(', ')})
    </p>
  );
}
