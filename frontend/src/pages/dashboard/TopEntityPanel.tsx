/**
 * Top offers / partners / advertisers — ranked by the SERVER (`orderBy`; revenue is sorted within
 * each currency, never EUR against USD) over this panel's own range (default 30 days). Names come
 * from the rows' `labels`. Revenue is in each row's own currency ("Mixed" when its conversions mix);
 * the share bars are drawn only when every row's amount is comparable (counts, or one currency).
 * The chevron loads that entity's hourly trend for today, on demand.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Sparkline } from '../../shared-components/charts/Sparkline';
import { moneyText, resolveCurrency, currenciesOf, showSortedWithinNote, SORTED_WITHIN_CURRENCY_NOTE, type RowCurrency } from '../../lib/reportCurrency';
import { buildRange, periodPhrase, type RangePreset } from './range';
import { useEntityHours, useTop, type EntityDim, type LabeledRow, type RankMetric } from './data';
import { alignSeries, formatCount, num, reportHref, rowsCurrency } from './metrics';
import { MixedNote, SectionBody, SectionCard, StaleNote } from './parts';
import { PillTabs, RangeSelect } from './controls';

const METRICS: readonly { id: RankMetric; label: string }[] = [
  { id: 'revenue', label: 'Revenue' }, { id: 'clicks', label: 'Clicks' }, { id: 'conversions', label: 'Conversions' },
];
/** One column template for the header and every row (rank · name · clicks · conv. ≥sm · revenue · trend). */
const COLS = 'grid grid-cols-[1.5rem_minmax(0,1fr)_4rem_6.5rem_1.75rem] items-center gap-x-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_4rem_3.5rem_6.5rem_1.75rem]';
const DETAIL: Record<EntityDim, string> = { offer: '/app/offers', publisher: '/app/publishers', advertiser: '/app/advertisers' };

function nameOf(r: LabeledRow, dim: EntityDim): string {
  const id = r.dimensions[dim] ?? '';
  const l = r.labels?.[dim];
  if (l) return l.ref != null ? `(${l.ref}) ${l.name}` : l.name;
  return id ? `${id.slice(0, 8)}…` : '—';
}

export function TopEntityPanel({ dim, title, viewAll, currency, tz }: {
  dim: EntityDim; title: string; viewAll: string; currency: string; tz: string;
}) {
  const [metric, setMetric] = useState<RankMetric>('revenue');
  const [preset, setPreset] = useState<RangePreset>('30d');
  const range = useMemo(() => buildRange(preset, tz), [preset, tz]);
  const q = useTop(dim, metric, range.current, tz);
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => r.dimensions[dim]), [q.data, dim]);
  const rcOf = (r: LabeledRow): RowCurrency => resolveCurrency(currenciesOf(r.metrics), currency);

  // Share bars: counts always; revenue only when every row is in the same single currency.
  const rcs = rows.map(rcOf);
  // (A row without money — `none` — is zero and compares with anything.)
  const comparable = metric !== 'revenue'
    || (!rcs.some((rc) => rc.kind === 'mixed')
      && new Set(rcs.flatMap((rc) => (rc.kind === 'single' ? [rc.currency] : []))).size <= 1);
  const max = Math.max(0, ...rows.map((r) => num(r.metrics[metric])));
  const sortedWithin = metric === 'revenue' && showSortedWithinNote(q.data?.sortedWithinCurrency, rcs);

  const [open, setOpen] = useState<string | null>(null);
  const today = useMemo(() => (open ? buildRange('today', tz) : null), [open, tz]);

  return (
    <SectionCard
      title={title}
      subtitle={`Top 5 by ${metric} · ${periodPhrase(preset)}`}
      actions={<>
        <PillTabs ariaLabel={`Rank ${title.toLowerCase()} by`} options={METRICS} value={metric} onChange={setMetric} />
        <RangeSelect label={`${title} range`} value={preset} onChange={setPreset} />
      </>}
      bodyClassName="p-0"
    >
      <div className="flex flex-1 flex-col p-5 pt-3">
        <SectionBody loading={q.loading} error={q.error} onRetry={q.refetch} empty={!q.data || rows.length === 0 && !q.loading && !q.error}
          emptyTitle={`No traffic — ${periodPhrase(preset)}`} rows={5}>
          {sortedWithin && <p className="mb-2 text-tiny text-fg-muted">{SORTED_WITHIN_CURRENCY_NOTE}</p>}
          <div className={`${COLS} border-b border-border pb-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted`}>
            <span>#</span><span>Name</span><span className="text-right">Clicks</span><span className="hidden text-right sm:block">Conv.</span><span className="text-right">Revenue</span><span className="sr-only">Trend</span>
          </div>
          <ol className="divide-y divide-border">
            {rows.map((r, i) => {
              const id = r.dimensions[dim]!;
              const rev = moneyText(num(r.metrics['revenue']), rcOf(r));
              const share = comparable && max > 0 ? Math.max(2, (num(r.metrics[metric]) / max) * 100) : null;
              const isOpen = open === id;
              return (
                <li key={id} className="py-2.5">
                  <div className={`${COLS} text-small`}>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-subtle text-tiny font-semibold text-fg-secondary">{i + 1}</span>
                    <div className="min-w-0">
                      <Link to={`${DETAIL[dim]}/${id}`} className="block truncate font-medium text-fg hover:text-accent-text hover:underline">{nameOf(r, dim)}</Link>
                      {share !== null && (
                        <div aria-hidden className="mt-1.5 h-1 rounded-full bg-subtle">
                          <div className="h-1 rounded-full bg-brand" style={{ width: `${share}%` }} />
                        </div>
                      )}
                    </div>
                    <span className="text-right tabular-nums text-fg-secondary">{formatCount(num(r.metrics['clicks']))}</span>
                    <span className="hidden text-right tabular-nums text-fg-secondary sm:block">{formatCount(num(r.metrics['conversions']))}</span>
                    <span className={`text-right font-semibold tabular-nums ${rev.muted ? 'text-fg-muted' : 'text-fg'}`} title={rev.title}>{rev.text}</span>
                    <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} today’s hourly trend for ${nameOf(r, dim)}`}
                      onClick={() => setOpen(isOpen ? null : id)}
                      className="grid h-7 w-7 place-items-center rounded-full text-fg-muted transition-colors duration-fast hover:bg-subtle hover:text-fg">
                      <ChevronDown size={15} aria-hidden className={`transition-transform duration-fast ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {isOpen && today && <EntityTrend dim={dim} id={id} metric={metric} range={today} currency={currency} tz={tz} />}
                </li>
              );
            })}
          </ol>
          <div className="mt-auto flex justify-end pt-3">
            <Link to={reportHref(viewAll, range)} className="text-small font-semibold text-accent-text hover:underline">View all</Link>
          </div>
          <StaleNote error={q.data ? q.error : null} onRetry={q.refetch} />
        </SectionBody>
      </div>
    </SectionCard>
  );
}

/** Today's hourly trend for one entity — fetched when expanded. */
function EntityTrend({ dim, id, metric, range, currency, tz }: {
  dim: EntityDim; id: string; metric: RankMetric; range: ReturnType<typeof buildRange>; currency: string; tz: string;
}) {
  const q = useEntityHours(dim, id, range.current, tz);
  const rows = q.data?.rows ?? [];
  const rc = rowsCurrency(rows, currency);
  return (
    <div className="mt-2 rounded-[var(--radius)] bg-subtle px-3 py-2">
      <p className="mb-1 text-tiny text-fg-muted">Today by hour · {metric}</p>
      {q.loading && !q.data ? <div aria-hidden className="h-10 animate-pulse rounded bg-surface motion-reduce:animate-none" />
        : q.error ? <p className="text-tiny text-danger-text">Couldn’t load the trend. <button type="button" className="font-semibold underline" onClick={q.refetch}>Retry</button></p>
        : metric === 'revenue' && rc.kind === 'mixed' ? <MixedNote what="Revenue" currencies={rc.currencies} className="h-10" />
        : rows.length === 0 ? <p className="text-tiny text-fg-muted">No traffic today.</p>
        : <Sparkline data={alignSeries(rows, range, metric)} color="rgb(var(--brand))" height={40} />}
    </div>
  );
}
