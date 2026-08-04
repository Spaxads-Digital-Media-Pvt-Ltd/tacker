import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import { StatCards } from '../../components/StatCards';
import type { Advertiser } from '../../types';

const columns: Column<Advertiser>[] = [
  { header: 'ID', cell: (a) => <span className="font-mono tabular-nums text-fg-muted">{a.ref ?? '—'}</span> },
  { header: 'Name', cell: (a) => <Link to={`/app/advertisers/${a.id}`} className="font-medium text-brand-700 hover:underline ">{a.name}</Link> },
  { header: 'Status', cell: (a) => <StatusDot value={a.status} /> },
  { header: 'Contact', cell: (a) => a.contactEmail ?? <span className="text-fg-muted">—</span> },
  { header: 'Currency', cell: (a) => a.defaultCurrency },
  { header: 'Created', cell: (a) => new Date(a.createdAt).toLocaleDateString() },
  { header: '', className: 'text-right', cell: (a) => <Link to={`/app/advertisers/${a.id}`} className="text-tiny font-medium text-fg-secondary hover:text-accent hover:underline">Manage →</Link> },
];

export default function Advertisers() {
  const { data, loading, error, refetch } = useQuery<Advertiser[]>('/api/advertisers');
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Manage Advertisers"
        subtitle="Manage advertisers, billing terms, and their offers."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>+ Create Advertiser</button>}
      />
      <StatCards endpoint="/api/advertisers/stats" cards={[
        { key: 'total', label: 'Total Advertisers', tone: 'blue', icon: 'building' },
        { key: 'active', label: 'Active', tone: 'teal', icon: 'chart' },
        { key: 'pending', label: 'Pending', tone: 'amber', icon: 'wallet' },
        { key: 'suspended', label: 'Suspended', tone: 'rose', icon: 'alert' },
      ]} />
      {loading ? (
        <StateBlock><Spinner /></StateBlock>
      ) : error ? (
        <StateBlock>{error}</StateBlock>
      ) : !data || data.length === 0 ? (
        <StateBlock>No advertisers yet. Create your first one.</StateBlock>
      ) : (
        <Table columns={columns} rows={data} rowKey={(a) => a.id} />
      )}
      <CreateAdvertiser open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
    </>
  );
}

function CreateAdvertiser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [status, setStatus] = useState('active');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/advertisers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ name, status, ...(contactEmail ? { contactEmail } : {}) });
    if (res) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="New advertiser">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Contact email"><input className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
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
