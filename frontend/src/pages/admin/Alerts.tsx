import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';

interface Alert {
  id: string; type: string; severity: string; entityType: string | null; entityId: string | null;
  title: string; description: string | null; status: string; createdAt: string;
}

const PAGE_SIZE = 50;

const SEV_TONE: Record<string, string> = {
  critical: 'suspended', high: 'suspended', medium: 'pending', low: 'draft',
};

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, loading, error, refetch } = useQuery<Alert[]>('/api/alerts', { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  // Server paging: `total` comes from the pagination meta; if it is absent, a full page means there may be more.
  const total = (data as { pagination?: { total?: number } } | null)?.pagination?.total;
  const rowCount = data?.length ?? 0;
  const lastPage = total !== undefined ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;
  const hasNext = lastPage !== null ? page < lastPage : rowCount === PAGE_SIZE;
  // Resolving the last alert on the last page would otherwise leave an empty page.
  useEffect(() => {
    if (loading) return;
    if (lastPage !== null && page > lastPage) setPage(lastPage);
    else if (lastPage === null && rowCount === 0 && page > 1) setPage((p) => p - 1);
  }, [loading, lastPage, rowCount, page]);
  const mutate = useMutation((args: { id: string; status: string }) => api.patch(`/api/alerts/${args.id}`, { status: args.status }));

  const act = async (id: string, next: string) => { if (await mutate.run({ id, status: next })) refetch(); };

  const columns: Column<Alert>[] = [
    { header: 'Severity', cell: (a) => <Badge value={SEV_TONE[a.severity] ?? a.severity} /> },
    { header: 'Alert', cell: (a) => <div><div className="font-medium">{a.title}</div><div className="text-tiny text-fg-secondary">{a.description}</div></div> },
    { header: 'Entity', cell: (a) => a.entityType ? <span className="text-tiny">{a.entityType} {a.entityId?.slice(0, 8)}…</span> : <span className="text-fg-muted">—</span> },
    { header: 'When', cell: (a) => new Date(a.createdAt).toLocaleString() },
    {
      header: '', className: 'text-right',
      cell: (a) => (
        <div className="flex justify-end gap-2">
          {a.status === 'open' && <button className="btn-ghost !py-1 !px-3 text-tiny" onClick={() => act(a.id, 'acknowledged')}>Ack</button>}
          {a.status !== 'resolved' && <button className="btn-ghost !py-1 !px-3 text-tiny text-success-text" onClick={() => act(a.id, 'resolved')}>Resolve</button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Alerts" subtitle="Anomalies surfaced by the fraud scan. Acknowledge or resolve them here."
        action={
          <select className="input max-w-[160px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {['open', 'acknowledged', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        } />
      {mutate.error && <p role="alert" className="mb-3 rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">Could not update the alert: {mutate.error}</p>}
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No {status} alerts.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(a) => a.id} />}
      {(page > 1 || hasNext) && (
        <div className="mt-3 flex items-center justify-between text-tiny text-fg-secondary">
          <span>
            {rowCount > 0 ? `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${((page - 1) * PAGE_SIZE + rowCount).toLocaleString()}` : '0'}
            {total !== undefined ? ` of ${total.toLocaleString()}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">‹</button>
            <span className="px-1 tabular-nums">{page}{lastPage !== null ? ` / ${lastPage}` : ''}</span>
            <button type="button" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">›</button>
          </div>
        </div>
      )}
    </>
  );
}
