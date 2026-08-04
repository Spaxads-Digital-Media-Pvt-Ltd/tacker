import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, type Column } from '../../components/ui';

interface Batch {
  id: string; status: string; currency: string; total_amount: string; note: string | null; created_at: string;
}

const columns: Column<Batch>[] = [
  { header: 'Batch', cell: (b) => <span className="font-mono tabular-nums text-xs text-fg-muted">{b.id.slice(0, 8)}</span> },
  { header: 'Total', cell: (b) => `${b.currency} ${b.total_amount}` },
  { header: 'Status', cell: (b) => <StatusDot value={b.status} /> },
  { header: 'Created', cell: (b) => new Date(b.created_at).toLocaleString() },
];

export default function Payouts() {
  const { data, loading, error, refetch } = useQuery<Batch[]>('/api/finance/payouts/batches');
  const run = useMutation((_: void) => api.post('/api/finance/payouts/batches', {}));

  const onRun = async () => {
    const res = await run.run();
    if (res) refetch();
  };

  return (
    <>
      <PageHeader
        title="Payouts"
        subtitle="Append-only ledger. Each run pays every publisher's approved balance and freezes the FX rate."
        action={<button className="btn-primary" disabled={run.busy} onClick={onRun}>{run.busy ? 'Running…' : 'Run payout'}</button>}
      />
      {run.error && <p className="mb-4 text-sm text-danger-text">{run.error}</p>}
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No payout runs yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(b) => b.id} />}
    </>
  );
}
