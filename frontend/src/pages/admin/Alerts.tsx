import { useState } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, type Column } from '../../components/ui';

interface Alert {
  id: string; type: string; severity: string; entityType: string | null; entityId: string | null;
  title: string; description: string | null; status: string; createdAt: string;
}

const SEV_TONE: Record<string, string> = {
  critical: 'suspended', high: 'suspended', medium: 'pending', low: 'draft',
};

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const { data, loading, error, refetch } = useQuery<Alert[]>(`/api/alerts?status=${status}`);
  const mutate = useMutation((args: { id: string; status: string }) => api.patch(`/api/alerts/${args.id}`, { status: args.status }));

  const act = async (id: string, next: string) => { if (await mutate.run({ id, status: next })) refetch(); };

  const columns: Column<Alert>[] = [
    { header: 'Severity', cell: (a) => <StatusDot value={SEV_TONE[a.severity] ?? a.severity} /> },
    { header: 'Alert', cell: (a) => <div><div className="font-medium">{a.title}</div><div className="text-xs text-fg-secondary">{a.description}</div></div> },
    { header: 'Entity', cell: (a) => a.entityType ? <span className="text-xs">{a.entityType} {a.entityId?.slice(0, 8)}…</span> : <span className="text-fg-muted">—</span> },
    { header: 'When', cell: (a) => new Date(a.createdAt).toLocaleString() },
    {
      header: '', className: 'text-right',
      cell: (a) => (
        <div className="flex justify-end gap-2">
          {a.status === 'open' && <button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => act(a.id, 'acknowledged')}>Ack</button>}
          {a.status !== 'resolved' && <button className="btn-ghost !py-1 !px-3 text-xs text-success-text" onClick={() => act(a.id, 'resolved')}>Resolve</button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Alerts" subtitle="Anomalies surfaced by the fraud scan. Acknowledge or resolve them here."
        action={
          <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            {['open', 'acknowledged', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        } />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No {status} alerts.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(a) => a.id} />}
    </>
  );
}
