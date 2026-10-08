import { useMemo, useState } from 'react';
import { useQuery } from '../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../shared-components/primitives/ui';
import { Pagination, daysAgo, todayStr, toIso } from '../shared-components/primitives/ReportPageKit';
import { countryLabel } from '../data/geo';

interface ReportRow {
  dimensions: Record<string, string | null>;
  metrics: Record<string, string | number>;
}
interface ReportResult {
  groupBy: string[];
  metrics: string[];
  rows: ReportRow[];
  total?: number;
}
interface PortalOffer { id: string; name: string }

const PAGE_SIZE = 50;

const METRIC_LABEL: Record<string, string> = {
  clicks: 'Clicks', unique_clicks: 'Unique', conversions: 'Conv.', cr: 'CR',
  payout: 'Payout', revenue: 'Revenue', margin: 'Margin', epc: 'EPC',
};
const MONEY = new Set(['payout', 'revenue', 'margin', 'epc']);

function fmtDim(key: string, value: string | null, offerNames: Map<string, string>): string {
  if (value == null) return '—';
  // Report days/hours are UTC buckets — format them in UTC so a bucket never shifts a day.
  if (key === 'day') return new Date(value).toLocaleDateString(undefined, { timeZone: 'UTC' });
  if (key === 'hour') return `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC' })} UTC`;
  if (key === 'country') return countryLabel(value);
  if (key === 'offer') return offerNames.get(value) ?? value.slice(0, 8) + '…';
  if (['publisher', 'advertiser'].includes(key)) return value.slice(0, 8) + '…';
  return value;
}

/**
 * Generic portal stats view. `basePath` is the reporting endpoint; group-by is user-selectable.
 * Bounded by a date range (default last 30 days) and paged with the endpoint's real total; days
 * read newest first. Offer names come from the portal's own offer list (offers the viewer can
 * still see) — anything else falls back to a short id.
 */
export default function ReportView({
  title, subtitle, basePath, groupByOptions,
}: { title: string; subtitle: string; basePath: string; groupByOptions: string[] }) {
  const [groupBy, setGroupBy] = useState(groupByOptions[0]!);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({
    groupBy, from: toIso(from), to: toIso(to, true),
    limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE),
  });
  if (groupBy === 'day' || groupBy === 'hour') qs.set('orderDir', 'desc');
  const { data, loading, error } = useQuery<ReportResult>(`${basePath}?${qs.toString()}`);
  const { data: offers } = useQuery<PortalOffer[]>(groupBy === 'offer' ? '/api/portal/offers?limit=200' : null);
  const offerNames = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);

  const columns = useMemo<Column<ReportRow>[]>(() => {
    const dimCol: Column<ReportRow> = {
      header: groupBy, cell: (r) => <span className="font-medium">{fmtDim(groupBy, r.dimensions[groupBy] ?? null, offerNames)}</span>,
    };
    const metricKeys = data?.rows[0] ? Object.keys(data.rows[0].metrics) : (data?.metrics ?? []);
    const metricCols: Column<ReportRow>[] = metricKeys.map((m) => ({
      header: METRIC_LABEL[m] ?? m,
      className: 'text-right tabular-nums',
      cell: (r) => {
        const v = r.metrics[m];
        return MONEY.has(m) && typeof v === 'string' ? `$${v}` : String(v ?? '—');
      },
    }));
    return [dimCol, ...metricCols];
  }, [data, groupBy, offerNames]);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-tiny text-fg-secondary">From (UTC)
              <input type="date" className="input" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPage(1); } }} />
            </label>
            <label className="text-tiny text-fg-secondary">To (UTC)
              <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPage(1); } }} />
            </label>
            <select className="input max-w-[180px]" value={groupBy} onChange={(e) => { setGroupBy(e.target.value); setPage(1); }}>
              {groupByOptions.map((g) => <option key={g} value={g}>Group by {g}</option>)}
            </select>
          </div>
        } />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.rows.length === 0 ? <StateBlock>No data for this period yet.</StateBlock>
        : <Table columns={columns} rows={data.rows} rowKey={(r) => JSON.stringify(r.dimensions)} />}
      {!loading && !error && (data?.total ?? 0) > 0 && (
        <div className="mt-3 flex justify-end">
          <Pagination total={data?.total ?? 0} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </>
  );
}
