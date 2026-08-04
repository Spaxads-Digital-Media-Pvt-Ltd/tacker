import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import type { NetworkRow } from '../../types';

const columns: Column<NetworkRow>[] = [
  { header: 'Network', cell: (n) => <span className="font-medium text-fg">{n.name}</span> },
  { header: 'Slug', cell: (n) => <span className="font-mono tabular-nums text-tiny text-fg-muted">{n.slug}</span> },
  { header: 'Status', cell: (n) => <StatusDot value={n.status} /> },
  { header: 'Plan', cell: (n) => n.plan_code ?? <span className="text-fg-muted">—</span> },
  { header: 'Subscription', cell: (n) => (n.subscription_status ? <StatusDot value={n.subscription_status} /> : <span className="text-fg-muted">none</span>) },
  { header: 'Created', cell: (n) => <span className="text-fg-secondary">{new Date(n.created_at).toLocaleDateString()}</span> },
];

export default function Networks() {
  const { data, loading, error, refetch } = useQuery<NetworkRow[]>('/platform/networks');
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Networks"
        subtitle="Create, suspend, and manage every tenant network."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>New network</button>}
      />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No networks yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(n) => n.id} />}
      <CreateNetwork open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
    </>
  );
}

function CreateNetwork({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', ownerPassword: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/platform/networks', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, slug: form.slug };
    if (form.ownerEmail && form.ownerPassword) {
      body.owner = { email: form.ownerEmail, password: form.ownerPassword };
    }
    const res = await run(body);
    if (res) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="New network">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" required value={form.name} onChange={set('name')} /></Field>
          <Field label="Slug"><input className="input" required value={form.slug} onChange={set('slug')} placeholder="acme" /></Field>
        </div>
        <p className="text-tiny text-fg-muted">Provision the first admin login (optional). A subdomain tracking host is created automatically.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner email"><input className="input" type="email" value={form.ownerEmail} onChange={set('ownerEmail')} /></Field>
          <Field label="Owner password"><input className="input" type="password" value={form.ownerPassword} onChange={set('ownerPassword')} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create network'}</button>
        </div>
      </form>
    </Modal>
  );
}
