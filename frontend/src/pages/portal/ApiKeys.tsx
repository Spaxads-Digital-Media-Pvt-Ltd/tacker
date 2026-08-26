import { useState } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';

interface ApiKey {
  id: string; prefix: string; name: string | null; scopes: string[]; status: string;
  lastUsedAt: string | null; createdAt: string;
}

/** Reused by the publisher and advertiser portals; `basePath` points at their key namespace. */
export default function ApiKeys({ basePath }: { basePath: string }) {
  const { data, loading, error, refetch } = useQuery<ApiKey[]>(basePath);
  const [open, setOpen] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const revoke = useMutation((id: string) => api.del(`${basePath}/${id}`));

  const columns: Column<ApiKey>[] = [
    { header: 'Key', cell: (k) => <span className="font-mono text-tiny">{k.prefix}…</span> },
    { header: 'Name', cell: (k) => k.name ?? <span className="text-fg-muted">—</span> },
    { header: 'Status', cell: (k) => <Badge value={k.status} /> },
    { header: 'Last used', cell: (k) => (k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : <span className="text-fg-muted">never</span>) },
    {
      header: '', className: 'text-right',
      cell: (k) => k.status === 'active'
        ? <button className="btn-ghost !py-1 !px-3 text-tiny text-danger-text hover:bg-danger-bg" onClick={async () => { if (await revoke.run(k.id)) refetch(); }}>Revoke</button>
        : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Programmatic access scoped to your own data. The full key is shown once at creation."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>New key</button>}
      />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No API keys yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(k) => k.id} />}

      <CreateKey open={open} basePath={basePath} onClose={() => setOpen(false)}
        onCreated={(key) => { setOpen(false); setFreshKey(key); refetch(); }} />

      <Modal open={!!freshKey} onClose={() => setFreshKey(null)} title="Copy your API key now">
        <p className="text-small text-fg-secondary">This is the only time the full key is shown. Store it securely.</p>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-border bg-page p-3 font-mono text-tiny text-fg">{freshKey}</pre>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={() => { if (freshKey) navigator.clipboard?.writeText(freshKey); setFreshKey(null); }}>Copy &amp; close</button>
        </div>
      </Modal>
    </>
  );
}

function CreateKey({ open, basePath, onClose, onCreated }: { open: boolean; basePath: string; onClose: () => void; onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const { run, busy, error } = useMutation((body: { name?: string }) => api.post<{ key: string }>(basePath, body));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run(name ? { name } : {});
    if (res) onCreated(res.key);
  };
  return (
    <Modal open={open} onClose={onClose} title="New API key">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. production integration" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
        </div>
      </form>
    </Modal>
  );
}
