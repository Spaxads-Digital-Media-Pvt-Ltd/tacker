/**
 * Performance over the window: Revenue / Clicks / Conversions per hour (Today) or day. Its range
 * follows the page's until changed here (then it loads its own rows); while equal it reuses the
 * page's graph request. Revenue whose window mixes currencies isn't plotted (a note says why).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TimeSeriesChart, type SeriesTone } from '../../shared-components/charts/TimeSeriesChart';
import { moneyAxisTick, moneyExact } from '../../lib/moneyFormat';
import { buildRange, type DashboardRange, type RangePreset } from './range';
import { useGraph, type ReportPage } from './data';
import { alignSeries, formatCount, formatCompact, reportHref, rowsCurrency } from './metrics';
import { MixedNote, SectionBody, SectionCard, StaleNote } from './parts';
import { ChartKindToggle, PillTabs, RangeSelect } from './controls';

type Metric = 'revenue' | 'clicks' | 'conversions';
const METRICS: readonly { id: Metric; label: string }[] = [
  { id: 'revenue', label: 'Revenue' }, { id: 'clicks', label: 'Clicks' }, { id: 'conversions', label: 'Conversions' },
];
const TONE: Record<Metric, SeriesTone> = { revenue: 'revenue', clicks: 'clicks', conversions: 'conversions' };

interface Query { data: ReportPage | null; loading: boolean; error: string | null; refetch: () => void }

export function PerformanceCard({ pageRange, pageGraph, currency, zoneShort, zoneLabel }: {
  pageRange: DashboardRange; pageGraph: Query; currency: string; zoneShort: string; zoneLabel: string;
}) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const [kind, setKind] = useState<'area' | 'bar'>('area');
  const [own, setOwn] = useState<RangePreset | null>(null);
  const preset = own ?? pageRange.preset;
  // Rebuilt only when this card's own preset / the zone changes (a new `now` would refetch forever).
  const ownRange = useMemo(() => (own && own !== pageRange.preset ? buildRange(own, pageRange.tz) : null), [own, pageRange.preset, pageRange.tz]);
  const ownGraph = useGraph(ownRange);
  const range = ownRange ?? pageRange;
  const q: Query = ownRange ? ownGraph : pageGraph;
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);

  const rc = rowsCurrency(rows, currency);
  const mixed = metric === 'revenue' && rc.kind === 'mixed' ? rc.currencies : null;
  const cur = rc.kind === 'mixed' ? currency : rc.currency;
  const values = useMemo(() => alignSeries(rows, range, metric), [rows, range, metric]);
  const total = values.reduce((a, b) => a + b, 0);
  const fmt = metric === 'revenue' ? (v: number) => moneyExact(v, cur) : formatCount;
  const tick = metric === 'revenue' ? (v: number) => moneyAxisTick(v, cur) : formatCompact;
  const reportPath = range.bucket === 'hour' ? '/app/reports/hourly' : '/app/reports/daily';

  return (
    <SectionCard
      title="Performance"
      subtitle={`${range.bucket === 'hour' ? 'By hour' : 'By day'} · ${zoneLabel}`}
      actions={<>
        <PillTabs ariaLabel="Plotted metric" options={METRICS} value={metric} onChange={setMetric} />
        <RangeSelect label="Performance range" value={preset} onChange={(p) => setOwn(p === pageRange.preset ? null : p)} />
        <ChartKindToggle value={kind} onChange={setKind} />
      </>}
    >
      <SectionBody loading={q.loading} error={q.error} onRetry={q.refetch} empty={!q.data}
        emptyTitle="No data" rows={6}>
        {mixed ? <MixedNote what="Revenue" currencies={mixed} className="h-[260px]" /> : (
          <TimeSeriesChart
            title={`${METRICS.find((m) => m.id === metric)!.label} ${range.bucket === 'hour' ? 'per hour' : 'per day'} (${zoneShort})`}
            labels={range.bucketLabels} series={[{ key: metric, label: METRICS.find((m) => m.id === metric)!.label, tone: TONE[metric], values }]}
            kind={kind} height={260} formatValue={fmt} formatTick={tick}
            tooltipTitle={(i) => `${range.bucketLabels[i]} · ${zoneShort}`}
            emptyText={`No ${metric} in this period`}
          />
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3 text-small">
          <p className="text-fg-secondary">
            Total <span className="font-semibold tabular-nums text-fg">{mixed ? 'Mixed' : fmt(total)}</span>
            <span className="text-fg-muted"> · {zoneShort}</span>
          </p>
          <Link to={reportHref(reportPath, range)} className="font-semibold text-accent-text hover:underline">
            View {range.bucket === 'hour' ? 'hourly' : 'daily'} report
          </Link>
        </div>
        <StaleNote error={q.data ? q.error : null} onRetry={q.refetch} />
      </SectionBody>
    </SectionCard>
  );
}
