import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import { StatCards } from '../../components/StatCards';
import type { Publisher } from '../../types';

const columns: Column<Publisher>[] = [
  { header: 'ID', cell: (p) => <span className="font-mono tabular-nums text-fg-muted">{p.ref ?? '—'}</span> },
  { header: 'Name', cell: (p) => <Link to={`/app/publishers/${p.id}`} className="font-medium text-brand-700 hover:underline ">{p.name}</Link> },
  { header: 'Status', cell: (p) => <StatusDot value={p.status} /> },
  { header: 'Traffic source', cell: (p) => p.trafficSource ?? <span className="text-fg-muted">—</span> },
  { header: 'Contact', cell: (p) => p.contactEmail ?? <span className="text-fg-muted">—</span> },
  { header: 'Created', cell: (p) => new Date(p.createdAt).toLocaleDateString() },
  { header: '', className: 'text-right', cell: (p) => <Link to={`/app/publishers/${p.id}`} className="text-tiny font-medium text-fg-secondary hover:text-accent hover:underline">Manage →</Link> },
];

export default function Publishers() {
  const { data, loading, error, refetch } = useQuery<Publisher[]>('/api/publishers');
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Manage Affiliates"
        subtitle="Manage your affiliates network — approval status, payout terms, traffic sources."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>+ Create Affiliate</button>}
      />
      <StatCards endpoint="/api/publishers/stats" cards={[
        { key: 'total', label: 'Total Affiliates', tone: 'blue', icon: 'users' },
        { key: 'active', label: 'Active', tone: 'teal', icon: 'chart' },
        { key: 'pending', label: 'Pending', tone: 'amber', icon: 'wallet' },
        { key: 'suspended', label: 'Suspended', tone: 'rose', icon: 'alert' },
      ]} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No publishers yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(p) => p.id} />}
      <CreatePublisher open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
    </>
  );
}

function CreatePublisher({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [trafficSource, setTrafficSource] = useState('');
  const [status, setStatus] = useState('pending');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/publishers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ name, status, ...(trafficSource ? { trafficSource } : {}) });
    if (res) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="New publisher">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Traffic source"><input className="input" value={trafficSource} onChange={(e) => setTrafficSource(e.target.value)} placeholder="e.g. Push, Native, Social" /></Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}
