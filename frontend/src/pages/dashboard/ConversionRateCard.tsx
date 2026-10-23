/**
 * Conversion rate = approved conversions ÷ ALL clicks × 100, from raw counts (never the API's `cr`
 * field). The denominator is gross clicks (invalid included) because GET /api/reports/dashboard —
 * the Yesterday / This month / Last month source — has no `invalid_clicks`; one formula for every
 * figure here. The report pages' CVR divides by VALID clicks, so the label says "all clicks".
 * The change is in percentage points; the line is violet with buckets that had no clicks as gaps (a
 * rate of nothing isn't 0%).
 */
import { useMemo } from 'react';

const FORMULA_NOTE = 'Approved conversions ÷ all clicks (invalid clicks included). Report pages show CVR over valid clicks only, so their rate can be slightly higher.';
import { TimeSeriesChart } from '../../shared-components/charts/TimeSeriesChart';
import type { DashboardRange } from './range';
import type { PeriodTotals, ReportPage } from './data';
import { alignCrSeries, crPct, formatRate, num, pointsChange } from './metrics';
import { ChangeText, DotStats, SectionBody, SectionCard, StaleNote } from './parts';

interface Query<T> { data: T | null; loading: boolean; error: string | null; refetch: () => void }

export function ConversionRateCard({ range, current, previous, graph, periods, zoneShort }: {
  range: DashboardRange;
  current: Query<ReportPage>; previous: Query<ReportPage>; graph: Query<ReportPage>; periods: Query<PeriodTotals>;
  zoneShort: string;
}) {
  const cur = current.data?.rows[0]?.metrics;
  const prev = previous.data?.rows[0]?.metrics;
  const rate = cur ? crPct(num(cur['conversions']), num(cur['clicks'])) : null;
  const prevRate = prev ? crPct(num(prev['conversions']), num(prev['clicks'])) : null;
  const change = cur && prev ? pointsChange(rate, prevRate) : null;
  const values = useMemo(() => alignCrSeries(graph.data?.rows ?? [], range), [graph.data, range]);
  const p = periods.data;
  const periodRate = (k: 'yesterday' | 'month' | 'lastMonth') => (p ? formatRate(crPct(num(p.conversions[k]), num(p.clicks[k]))) : '…');
  const retry = () => { current.refetch(); previous.refetch(); graph.refetch(); };

  return (
    <SectionCard title="Conversion rate" subtitle={<span title={FORMULA_NOTE}>Conversions ÷ all clicks · {zoneShort}</span>}>
      <SectionBody loading={current.loading} error={current.error} onRetry={retry} empty={!current.data} emptyTitle="No data" rows={5}>
        <p className="text-[30px] font-bold leading-tight tracking-tight tabular-nums text-fg"
          title={rate === null ? 'No clicks in this period' : FORMULA_NOTE}>{formatRate(rate)}</p>
        <div className="mt-1.5">
          <ChangeText change={change} compareLabel={range.compareLabel} previous={prev ? formatRate(prevRate) : undefined}
            note={previous.error ? `Comparison unavailable: ${previous.error}` : undefined} />
        </div>
        <div className="my-4 flex-1">
          {graph.error && !graph.data
            ? <p className="grid h-[180px] place-items-center text-small text-fg-muted">Couldn’t load the trend. <button type="button" className="font-semibold text-accent-text underline" onClick={graph.refetch}>Retry</button></p>
            : <TimeSeriesChart title={`Conversion rate (conversions ÷ all clicks) ${range.bucket === 'hour' ? 'per hour' : 'per day'} (${zoneShort})`}
                labels={range.bucketLabels} series={[{ key: 'cr', label: 'CR', tone: 'margin', values }]}
                kind="line" height={180} formatValue={(v) => formatRate(v)} formatTick={(v) => `${v}%`}
                tooltipTitle={(i) => `${range.bucketLabels[i]} · ${zoneShort}`} emptyText="No clicks in this period" />}
        </div>
        {periods.error && !p
          ? <p className="border-t border-border pt-3 text-tiny text-fg-muted">Period figures unavailable. <button type="button" className="font-semibold text-accent-text underline" onClick={periods.refetch}>Retry</button></p>
          : <DotStats items={[
              { label: 'Yesterday', value: periodRate('yesterday') },
              { label: 'This month', value: periodRate('month') },
              { label: 'Last month', value: periodRate('lastMonth') },
            ]} />}
        <StaleNote error={current.data ? current.error : null} onRetry={retry} />
      </SectionBody>
    </SectionCard>
  );
}
