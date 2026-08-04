import { useMemo, useState } from 'react';
import { useQuery } from '../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../components/ui';

interface ReportRow {
  dimensions: Record<string, string | null>;
  metrics: Record<string, string | number>;
}
interface ReportResult {
  groupBy: string[];
  metrics: string[];
  rows: ReportRow[];
}

const METRIC_LABEL: Record<string, string> = {
  clicks: 'Clicks', unique_clicks: 'Unique', conversions: 'Conv.', cr: 'CR',
  payout: 'Payout', revenue: 'Revenue', margin: 'Margin', epc: 'EPC',
};
const MONEY = new Set(['payout', 'revenue', 'margin', 'epc']);

function fmtDim(key: string, value: string | null): string {
  if (value == null) return '—';
  if (key === 'day') return new Date(value).toLocaleDateString();
  if (key === 'hour') return new Date(value).toLocaleString();
  if (['offer', 'publisher', 'advertiser'].includes(key)) return value.slice(0, 8) + '…';
  return value;
}

/** Generic report view. `basePath` is the reporting endpoint; group-by is user-selectable. */
export default function ReportView({
  title, subtitle, basePath, groupByOptions,
}: { title: string; subtitle: string; basePath: string; groupByOptions: string[] }) {
  const [groupBy, setGroupBy] = useState(groupByOptions[0]!);
  const { data, loading, error } = useQuery<ReportResult>(`${basePath}?groupBy=${groupBy}`);

  const columns = useMemo<Column<ReportRow>[]>(() => {
    const dimCol: Column<ReportRow> = {
      header: groupBy, cell: (r) => <span className="font-medium">{fmtDim(groupBy, r.dimensions[groupBy] ?? null)}</span>,
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
  }, [data, groupBy]);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}
        action={
          <select className="input max-w-[180px]" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {groupByOptions.map((g) => <option key={g} value={g}>Group by {g}</option>)}
          </select>
        } />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.rows.length === 0 ? <StateBlock>No data for this period yet.</StateBlock>
        : <Table columns={columns} rows={data.rows} rowKey={(r) => JSON.stringify(r.dimensions)} />}
    </>
  );
}
