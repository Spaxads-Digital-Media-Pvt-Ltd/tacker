import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { useAllPages } from '../../hooks/useAllPages';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { CopyBox } from '../../shared-components/panels/CopyBox';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { isDevOnlyHost } from '../../lib/trackingLinks';
import type { TrackingDomain } from '../../types';

/** POST /api/tracking-domains/:id/verify's answer (F-15). */
interface VerifyResult { verified: boolean; reason: string; domain: TrackingDomain | null }

export default function TrackingDomains() {
  // The endpoint defaults to 50 rows; walk every page so no domain is silently dropped.
  const { data, loading, error, refetch } = useAllPages<TrackingDomain>('/api/tracking-domains');
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<TrackingDomain | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const setStatus = useMutation((v: { id: string; status: 'active' | 'disabled' }) => api.patch<TrackingDomain>(`/api/tracking-domains/${v.id}`, { status: v.status }));
  const confirm = useConfirm();
  // A subdomain on our own domain is a CNAME target custom hosts can point at — the primary one first.
  const targets = (data ?? []).filter((d) => d.mode === 'subdomain' && d.status === 'active' && !isDevOnlyHost(d.host));
  const cnameTarget = (targets.find((d) => d.isPrimary) ?? targets[0])?.host ?? null;

  const changeStatus = async (d: TrackingDomain, status: 'active' | 'disabled') => {
    setNotice(null);
    if (await setStatus.run({ id: d.id, status })) {
      setNotice(`${d.host} is now ${status === 'active' ? 'active — tracking links on it work' : 'disabled — tracking links on it stop working'}.`);
      refetch();
    }
  };

  const columns: Column<TrackingDomain>[] = [
    { header: 'Host', cell: (d) => (
      <span className="font-mono text-xs">
        {d.host}
        {d.isPrimary && <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ">PRIMARY</span>}
        {isDevOnlyHost(d.host) && <span className="ml-2 rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning-text" title="Local/dev testing only — excluded from the Production group when picking an offer's tracking domain">LOCAL</span>}
      </span>
    ) },
    { header: 'Mode', cell: (d) => d.mode },
    { header: 'Status', cell: (d) => <Badge value={d.status} /> },
    { header: 'Verification', cell: (d) => <Badge value={d.verificationState} /> },
    { header: 'SSL', cell: (d) => <Badge value={d.sslStatus} /> },
    { header: '', className: 'text-right', cell: (d) => (
      <span className="flex justify-end gap-3">
        {d.mode === 'custom' && d.verificationState !== 'verified' && (
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => { setNotice(null); setSetup(d); }}>DNS setup &amp; verify</button>
        )}
        {d.verificationState === 'verified' && d.status !== 'active' && (
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" disabled={setStatus.busy} onClick={() => void changeStatus(d, 'active')}>Activate</button>
        )}
        {d.status === 'active' && (
          <button type="button" className="text-tiny font-medium text-danger-text hover:underline" disabled={setStatus.busy}
            onClick={() => void confirm({
              title: `Disable ${d.host}?`, message: 'Tracking links that use this domain stop working until you activate it again.',
              confirmLabel: 'Disable', destructive: true, onConfirm: () => changeStatus(d, 'disabled'),
            })}>Disable</button>
        )}
      </span>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Tracking domains"
        subtitle="Subdomains on our domain, or custom domains (CNAME) verified before activation."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>Add domain</button>}
      />
      {setStatus.error && <p className="mb-3 text-small text-danger-text">{setStatus.error}</p>}
      {notice && <p className="mb-3 rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg">{notice}</p>}
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No tracking domains yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(d) => d.id} />}
      <AddDomain open={open} onClose={() => setOpen(false)}
        onCreated={(d) => { setOpen(false); refetch(); if (d.mode === 'custom') setSetup(d); }} />
      {setup && <DnsSetup domain={setup} cnameTarget={cnameTarget} onClose={() => setSetup(null)}
        onVerified={(host) => { setSetup(null); setNotice(`${host} is verified and active.`); refetch(); }} onChecked={refetch} />}
    </>
  );
}

/**
 * Custom host setup (F-15): the DNS TXT record that proves ownership, where to point the host, and
 * a "Verify now" (a miss is reported with the reason; pending hosts are also re-checked every 10 min).
 */
function DnsSetup({ domain, cnameTarget, onClose, onVerified, onChecked }: {
  domain: TrackingDomain; cnameTarget: string | null; onClose: () => void; onVerified: (host: string) => void; onChecked: () => void;
}) {
  const verify = useMutation(() => api.post<VerifyResult>(`/api/tracking-domains/${domain.id}/verify`, {}));
  const [miss, setMiss] = useState<string | null>(null);
  const rec = domain.dnsRecord;

  const check = async () => {
    setMiss(null);
    const r = await verify.run(undefined);
    if (!r) return;
    if (r.verified) onVerified(domain.host);
    else { setMiss(r.reason); onChecked(); }
  };

  return (
    <Modal open onClose={onClose} title={`Set up ${domain.host}`}
      footer={(
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary" onClick={() => void check()} disabled={verify.busy || !rec}>{verify.busy ? 'Checking DNS…' : 'Verify now'}</button>
        </>
      )}
    >
      <div className="space-y-4 text-small text-fg">
        {verify.error && <p className="text-danger-text">{verify.error}</p>}
        {miss && <p className="rounded-[var(--radius)] border border-border bg-page px-3 py-2 text-danger-text">Not verified yet: {miss}</p>}
        {rec ? (
          <>
            <div className="space-y-2">
              <p className="font-semibold">1. Add this TXT record at your DNS provider</p>
              <Field label="Name / host"><CopyBox value={rec.name} /></Field>
              <Field label="Type"><CopyBox value={rec.type} /></Field>
              <Field label="Value"><CopyBox value={rec.value} /></Field>
            </div>
            <div className="space-y-2">
              <p className="font-semibold">2. Point the host at your tracking</p>
              {cnameTarget ? (
                <p className="text-fg-secondary">Add a <span className="font-mono">CNAME</span> record for <span className="font-mono">{domain.host}</span> pointing to <span className="font-mono">{cnameTarget}</span>.</p>
              ) : (
                <p className="text-fg-secondary">Add a <span className="font-mono">CNAME</span> record for <span className="font-mono">{domain.host}</span> pointing to your tracking domain (ask your platform administrator for the target).</p>
              )}
            </div>
            <p className="text-tiny text-fg-muted">3. Click Verify now. DNS changes can take a few minutes (sometimes longer) to show up — pending domains are also re-checked automatically every 10 minutes, and become active once verified.</p>
          </>
        ) : (
          <p className="text-fg-secondary">This domain has no verification record — delete it and add it again.</p>
        )}
      </div>
    </Modal>
  );
}

function AddDomain({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (d: TrackingDomain) => void }) {
  const [mode, setMode] = useState<'subdomain' | 'custom'>('subdomain');
  const [subdomain, setSubdomain] = useState('');
  const [host, setHost] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<TrackingDomain>('/api/tracking-domains', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === 'subdomain' ? { mode, subdomain } : { mode, host };
    const res = await run(body);
    if (res) onCreated(res);
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
