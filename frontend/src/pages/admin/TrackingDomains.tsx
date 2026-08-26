import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import type { TrackingDomain } from '../../types';

const columns: Column<TrackingDomain>[] = [
  { header: 'Host', cell: (d) => <span className="font-mono text-xs">{d.host}{d.isPrimary && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ">PRIMARY</span>}</span> },
  { header: 'Mode', cell: (d) => d.mode },
  { header: 'Status', cell: (d) => <Badge value={d.status} /> },
  { header: 'Verification', cell: (d) => <Badge value={d.verificationState} /> },
  { header: 'SSL', cell: (d) => <Badge value={d.sslStatus} /> },
];

export default function TrackingDomains() {
  const { data, loading, error, refetch } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Tracking domains"
        subtitle="Subdomains on our domain, or custom domains (CNAME) verified before activation."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>Add domain</button>}
      />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No tracking domains yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(d) => d.id} />}
      <AddDomain open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
    </>
  );
}

function AddDomain({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<'subdomain' | 'custom'>('subdomain');
  const [subdomain, setSubdomain] = useState('');
  const [host, setHost] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/tracking-domains', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === 'subdomain' ? { mode, subdomain } : { mode, host };
    const res = await run(body);
    if (res) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add tracking domain">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Mode">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'subdomain' | 'custom')}>
            <option value="subdomain">Subdomain on our domain</option>
            <option value="custom">Custom domain (their CNAME)</option>
          </select>
        </Field>
        {mode === 'subdomain' ? (
          <Field label="Subdomain label"><input className="input" required value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="acme" /></Field>
        ) : (
          <Field label="Custom host (FQDN)"><input className="input" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="track.acmecorp.com" /></Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
