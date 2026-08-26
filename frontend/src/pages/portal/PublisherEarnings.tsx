import { useQuery } from '../../lib/useApi';
import { PageHeader, StatCard, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';

interface StatementEntry {
  type: string; direction: string; amount: string; currency: string; status: string; createdAt: string;
}
interface Earnings { balance: string; statement: StatementEntry[] }

const columns: Column<StatementEntry>[] = [
  { header: 'Type', cell: (e) => <span className="capitalize">{e.type}</span> },
  { header: 'Direction', cell: (e) => <Badge value={e.direction === 'credit' ? 'active' : 'pending'} /> },
  { header: 'Amount', cell: (e) => <span className={e.direction === 'credit' ? 'font-semibold text-success-text' : 'text-fg-secondary'}>{e.direction === 'credit' ? '+' : '−'}{e.currency} {e.amount}</span> },
  { header: 'Date', cell: (e) => new Date(e.createdAt).toLocaleString() },
];

export default function PublisherEarnings() {
  const { data, loading, error } = useQuery<Earnings>('/api/portal/publisher/earnings');
  return (
    <>
      <PageHeader title="Earnings" subtitle="Your approved balance and statement. Payout only — never network revenue." />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label="Payable balance" value={`$${data?.balance ?? '0.00'}`} hint="approved, awaiting payout" />
              <StatCard label="Statement entries" value={String(data?.statement.length ?? 0)} hint="last 200" />
            </div>
            {!data || data.statement.length === 0
              ? <StateBlock>No earnings yet. Conversions attributed to you will appear here.</StateBlock>
              : <Table columns={columns} rows={data.statement} rowKey={(_e) => `${_e.type}-${_e.createdAt}-${_e.amount}`} />}
          </>
        )}
    </>
  );
}
