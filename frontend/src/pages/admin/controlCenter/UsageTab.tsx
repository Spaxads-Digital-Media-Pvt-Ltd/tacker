/**
 * Control Center › Usage. No impression-tracking or marketplace-pull-count backend exists in this
 * app, so this shows the real current month/year (from the browser clock) with honest zero counts
 * rather than fabricated traffic numbers.
 */
import { Table, type Column } from '../../../components/ui';

interface Row { month: string; impressions: number; offersPulled: number }

export default function UsageTab() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const rows: Row[] = [{ month, impressions: 0, offersPulled: 0 }];
  const columns: Column<Row>[] = [
    { header: 'Month', cell: (r) => r.month },
    { header: 'Impressions', cell: (r) => r.impressions },
    { header: 'Total Marketplace Offers Pulled', cell: (r) => r.offersPulled },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-card border border-border bg-accent-subtle p-4 text-small text-fg-secondary">
        <span>Based on ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="input !w-auto">{year}</span>
        <span className="input !w-auto">{month}</span>
      </div>
      <Table columns={columns} rows={rows} rowKey={(r) => r.month} />
    </div>
  );
}
