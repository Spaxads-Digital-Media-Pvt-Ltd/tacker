import { useState } from 'react';
import { Table, Spinner, StateBlock, type Column } from '../../../components/ui';
import { useQuery } from '../../../lib/useApi';

interface Row { month: string; impressions: number; offersPulled: number }

export default function UsageTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const { data, loading, error } = useQuery<{ year: number; rows: Row[] }>(`/api/control-center/usage?year=${year}`);

  const rows = data?.rows ?? [];
  const columns: Column<Row>[] = [
    { header: 'Month', cell: (r) => r.month },
    { header: 'Impressions', cell: (r) => r.impressions.toLocaleString() },
    { header: 'Total Marketplace Offers Pulled', cell: (r) => r.offersPulled.toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-card border border-border bg-accent-subtle p-4 text-small text-fg-secondary">
        <span>Based on ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
      </div>
      <div className="flex items-center gap-2">
        <select className="input !w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : <Table columns={columns} rows={rows} rowKey={(r) => r.month} />}
    </div>
  );
}
