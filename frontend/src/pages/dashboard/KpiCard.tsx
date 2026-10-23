/**
 * One KPI (Revenue / Payout / Margin / Clicks / Conversions): flat surface, tone border + icon
 * chip, the window's value (counted up once, on first load), the change vs the comparison window,
 * a sparkline in the metric hue, and Yesterday / This month / Last month. The whole card opens its
 * report for the window (Enter or Space).
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleDollarSign, MousePointerClick, Percent, Target, Wallet } from 'lucide-react';
import { AnimatedNumber, StateBlock } from '../../shared-components/primitives/ui';
import { Sparkline } from '../../shared-components/charts/Sparkline';
import type { MoneyText } from '../../lib/reportCurrency';
import { ChangeText } from './parts';
import { durSlowMs, type Change, type KpiDef, type KpiKey } from './metrics';

const TONE: Record<KpiKey, { card: string; chip: string; line: string }> = {
  revenue: {
    card: 'border-metric-revenue/35 hover:border-metric-revenue/60',
    chip: 'bg-metric-revenue/10 text-metric-revenue', line: 'rgb(var(--metric-revenue))',
  },
  payout: {
    card: 'border-metric-payout/35 hover:border-metric-payout/60',
    chip: 'bg-metric-payout/10 text-metric-payout', line: 'rgb(var(--metric-payout))',
  },
  margin: {
    card: 'border-metric-margin/35 hover:border-metric-margin/60',
    chip: 'bg-metric-margin/10 text-metric-margin', line: 'rgb(var(--metric-margin))',
  },
  clicks: {
    card: 'border-metric-clicks/35 hover:border-metric-clicks/60',
    chip: 'bg-metric-clicks/10 text-metric-clicks', line: 'rgb(var(--metric-clicks))',
  },
  conversions: {
    card: 'border-metric-conversions/35 hover:border-metric-conversions/60',
    chip: 'bg-metric-conversions/10 text-metric-conversions', line: 'rgb(var(--metric-conversions))',
  },
};
const ICON: Record<KpiKey, typeof Wallet> = {
  revenue: CircleDollarSign, payout: Wallet, margin: Percent, clicks: MousePointerClick, conversions: Target,
};

export interface KpiCardProps {
  def: KpiDef;
  href: string;
  /** What the value shows (an amount, a count, or "Mixed" / a per-currency breakdown). */
  value: MoneyText;
  /** The figure to count up from 0 — null when the value is text only (mixed currencies). */
  amount: number | null;
  format: (v: number) => string;
  /** Count up (first load only). */
  animate: boolean;
  change: Change | null;
  changeNote?: string;
  compareLabel: string;
  previous?: string;
  series: number[] | null;
  /** Shown instead of the sparkline (e.g. mixed currencies). */
  seriesNote?: ReactNode;
  breakdown: [label: string, value: string, title?: string][] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  className?: string;
}

export function KpiCard(p: KpiCardProps) {
  const navigate = useNavigate();
  const tone = TONE[p.def.key];
  const Icon = ICON[p.def.key];
  const head = (
    <div className="flex items-center justify-between gap-3">
      <p className="text-small font-semibold text-fg-secondary">{p.def.label}</p>
      <span aria-hidden className={`grid h-8 w-8 place-items-center rounded-[var(--radius)] ${tone.chip}`}><Icon size={16} /></span>
    </div>
  );

  // No figure yet: skeleton / error with retry (not a link — the retry is a button).
  if (p.loading || p.error) {
    return (
      <div className={`card flex flex-col gap-3 !p-5 ${tone.card} ${p.className ?? ''}`}>
        {head}
        {p.loading
          ? <div aria-hidden className="space-y-2"><div className="h-8 w-2/3 animate-pulse rounded-[var(--radius)] bg-subtle motion-reduce:animate-none" /><div className="h-3 w-1/2 animate-pulse rounded-full bg-subtle motion-reduce:animate-none" /></div>
          : <StateBlock variant="error" title={`Couldn’t load ${p.def.label.toLowerCase()}`} hint={p.error} onRetry={p.onRetry} />}
        {p.loading && <span className="sr-only" role="status">Loading {p.def.label}…</span>}
      </div>
    );
  }

  const long = p.value.muted || p.value.text.length > 11;
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ') { e.preventDefault(); navigate(p.href); }
  };
  return (
    <Link to={p.href} onKeyDown={onKeyDown} aria-label={`${p.def.label}: ${p.value.text}. Open the report`}
      className={`card group flex flex-col gap-3 !p-5 hover:shadow-card-hover ${tone.card} ${p.className ?? ''}`}>
      {head}
      <p title={p.value.title}
        className={`break-words font-bold leading-tight tracking-tight tabular-nums ${long ? 'text-[22px]' : 'text-[30px]'} ${p.value.muted ? 'text-fg-muted' : 'text-fg'}`}>
        {p.animate && p.amount !== null ? <AnimatedNumber value={p.amount} formatFn={p.format} duration={durSlowMs()} /> : p.value.text}
      </p>
      <ChangeText change={p.change} compareLabel={p.compareLabel} previous={p.previous} note={p.changeNote} />
      <div className="h-10">
        {p.series ? <Sparkline data={p.series} color={tone.line} height={40} /> : p.seriesNote}
      </div>
      {p.breakdown && (
        <dl className="mt-auto space-y-1 border-t border-border pt-2.5 text-tiny">
          {p.breakdown.map(([k, v, title]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="shrink-0 text-fg-muted">{k}</dt>
              <dd className="truncate text-right font-medium tabular-nums text-fg-secondary" title={title}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Link>
  );
}
