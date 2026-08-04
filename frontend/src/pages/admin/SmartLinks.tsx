import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';

interface SmartLink { id: string; name: string; rotation: string; status: string; fallbackUrl: string | null }

const columns: Column<SmartLink>[] = [
  { header: 'Name', cell: (s) => <Link to={`/app/smart-links/${s.id}`} className="font-medium text-brand-700 hover:underline ">{s.name}</Link> },
  { header: 'Rotation', cell: (s) => s.rotation },
  { header: 'Status', cell: (s) => <StatusDot value={s.status} /> },
  { header: '', className: 'text-right', cell: (s) => <Link to={`/app/smart-links/${s.id}`} className="text-tiny font-medium text-fg-secondary hover:text-accent hover:underline">Manage →</Link> },
];

export default function SmartLinks() {
  const { data, loading, error, refetch } = useQuery<SmartLink[]>('/api/smart-links');
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader title="Smart Links" subtitle="One link that rotates traffic across offers by weight and geo, with a fallback."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>New smart link</button>} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No smart links yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(s) => s.id} />}
      <CreateSmartLink open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
    </>
  );
}

function CreateSmartLink({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', rotation: 'weighted', fallbackUrl: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/smart-links', body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, rotation: form.rotation };
    if (form.fallbackUrl) body['fallbackUrl'] = form.fallbackUrl;
    if (await run(body)) onCreated();
  };
  return (
    <Modal open={open} onClose={onClose} title="New smart link">
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-sm text-danger-text">{error}</p>}
        <Field label="Name"><input className="input" required value={form.name} onChange={set('name')} /></Field>
        <Field label="Rotation"><select className="input" value={form.rotation} onChange={set('rotation')}><option value="weighted">weighted</option><option value="round_robin">round_robin</option></select></Field>
        <Field label="Fallback URL (optional)"><input className="input" type="url" value={form.fallbackUrl} onChange={set('fallbackUrl')} placeholder="https://…" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}
