/**
 * Super Admin › Networks — every tenant network and its lifecycle (D3, api-backend lib/networks/lifecycle):
 * Suspend / Activate; Delete = a soft delete (tracking, the dashboard and the API stop at once, every row
 * is kept) shown as "Deleted … · can be restored until …"; Restore while it can be; Export (every row as
 * NDJSON — take one before a purge); Purge once the grace period has passed (its logins and data go
 * for good, confirmed by its slug). The money ledger is never purged: Purged networks lists the
 * tombstones with their ledger as CSV.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { useAllNetworks } from './useAllNetworks';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../shared-components/primitives/ui';
import { useConfirm } from '../../shared-components/primitives/confirm';
import type { NetworkRow, PurgedNetworkRow } from '../../types';

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
const today = () => new Date().toISOString().slice(0, 10);
/** A deleted network can be purged from `purge_after` on; until then it can only be restored. */
const purgeOpen = (n: NetworkRow) => n.status === 'deleted' && n.purge_after != null && new Date(n.purge_after) <= new Date();
const exportedSinceDelete = (n: NetworkRow) => Boolean(n.exported_at && n.deleted_at && new Date(n.exported_at) >= new Date(n.deleted_at));
const linkBtn = 'text-tiny font-medium text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline';
const dangerBtn = 'text-tiny font-medium text-danger-text hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline';

export default function Networks() {
  const { data, loading, error, refetch } = useAllNetworks();
  const purged = useQuery<PurgedNetworkRow[]>('/platform/purged-networks?limit=200');
  const [open, setOpen] = useState(false);
  const [purging, setPurging] = useState<NetworkRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();

  const setStatus = (n: NetworkRow, status: 'active' | 'suspended', verb: string, message: string) => confirm({
    title: `${verb} ${n.name}?`, message, confirmLabel: verb, destructive: status === 'suspended',
    onConfirm: async () => { await api.patch(`/platform/networks/${n.id}`, { status }); refetch(); },
  });
  const softDelete = (n: NetworkRow) => confirm({
    title: `Delete ${n.name}?`, confirmLabel: 'Delete', destructive: true,
    message: 'Tracking, the dashboard, the portals and the API stop at once and its users are signed out. Every row is kept: you can restore it during the grace period, after which it can be purged for good.',
    onConfirm: async () => { await api.del(`/platform/networks/${n.id}`); refetch(); },
  });
  const download = async (path: string, filename: string) => {
    setActionError(null);
    try { await api.download(path, filename); refetch(); purged.refetch(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Download failed'); }
  };

  const columns: Column<NetworkRow>[] = [
    {
      header: 'Network',
      cell: (n) => (
        <div>
          <span className="font-medium">{n.name}</span>
          {n.status === 'deleted' && (
            <p className="text-tiny text-danger-text">
              Deleted {day(n.deleted_at)} · {purgeOpen(n) ? 'can be purged now (still restorable until purged)' : `can be restored until ${day(n.purge_after)}`}
            </p>
          )}
        </div>
      ),
    },
    { header: 'Slug', cell: (n) => <span className="font-mono text-xs">{n.slug}</span> },
    { header: 'Status', cell: (n) => <Badge value={n.status} /> },
    { header: 'Plan', cell: (n) => n.plan_code ?? <span className="text-fg-muted">—</span> },
    { header: 'Subscription', cell: (n) => (n.subscription_status ? <Badge value={n.subscription_status} /> : <span className="text-fg-muted">none</span>) },
    { header: 'Created', cell: (n) => day(n.created_at) },
    {
      header: '', className: 'text-right',
      cell: (n) => (
        <span className="flex justify-end gap-3 whitespace-nowrap">
          {n.status === 'active' && <button className={dangerBtn} onClick={() => setStatus(n, 'suspended', 'Suspend', 'Tracking, the dashboard, the portals and the API stop until you activate it again. Nothing is deleted.')}>Suspend</button>}
          {n.status === 'suspended' && <button className={linkBtn} onClick={() => setStatus(n, 'active', 'Activate', 'Tracking, the dashboard, the portals and the API work again.')}>Activate</button>}
          {n.status !== 'deleted' && <button className={dangerBtn} onClick={() => softDelete(n)}>Delete</button>}
          {n.status === 'deleted' && <>
            <button className={linkBtn} onClick={() => setStatus(n, 'active', 'Restore', 'The network comes back as it was: tracking, the dashboard, the portals and the API work again.')}>Restore</button>
            <button className={linkBtn} onClick={() => void download(`/platform/networks/${n.id}/export`, `network-${n.slug}-${today()}.ndjson`)}>Export</button>
            <button className={dangerBtn} disabled={!purgeOpen(n)} title={purgeOpen(n) ? undefined : `Can be purged from ${day(n.purge_after)} (grace period)`}
              onClick={() => setPurging(n)}>Purge</button>
          </>}
        </span>
      ),
    },
  ];

  const purgedColumns: Column<PurgedNetworkRow>[] = [
    { header: 'Network', cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'Slug', cell: (p) => <span className="font-mono text-xs">{p.slug}</span> },
    { header: 'Deleted', cell: (p) => day(p.deleted_at) },
    { header: 'Purged', cell: (p) => `${day(p.purged_at)}${p.purged_by_email ? ` · ${p.purged_by_email}` : ''}` },
    { header: 'Ledger entries kept', className: 'text-right', cell: (p) => p.ledger_entries_retained.toLocaleString() },
    {
      header: '', className: 'text-right',
      cell: (p) => <button className={linkBtn} onClick={() => void download(`/platform/networks/${p.id}/ledger.csv`, `ledger-${p.slug}-${today()}.csv`)}>Download ledger (CSV)</button>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Networks"
        subtitle="Create, suspend, delete, restore and purge tenant networks."
        action={<button className="btn-primary" onClick={() => setOpen(true)}>New network</button>}
      />
      {actionError && <p className="mb-3 text-small text-danger-text">{actionError}</p>}
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No networks yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(n) => n.id} />}
      {(purged.data?.length ?? 0) > 0 && (
        <div className="mt-8 space-y-3">
          <div>
            <h2 className="text-h3 font-medium text-fg">Purged networks</h2>
            <p className="text-tiny text-fg-secondary">Removed for good — their money ledger is kept and can be downloaded.</p>
          </div>
          <Table columns={purgedColumns} rows={purged.data ?? []} rowKey={(p) => p.id} />
        </div>
      )}
      <CreateNetwork open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); refetch(); }} />
      {purging && <PurgeNetwork network={purging} onExport={() => download(`/platform/networks/${purging.id}/export`, `network-${purging.slug}-${today()}.ndjson`)}
        onClose={() => setPurging(null)} onPurged={() => { setPurging(null); refetch(); purged.refetch(); }} />}
    </>
  );
}

/** Purge: past the grace period, confirmed by typing the slug; without an export since the delete it must be waived. */
function PurgeNetwork({ network, onExport, onClose, onPurged }: { network: NetworkRow; onExport: () => Promise<void>; onClose: () => void; onPurged: () => void }) {
  const [slug, setSlug] = useState('');
  const [waive, setWaive] = useState(false);
  const [exported, setExported] = useState(exportedSinceDelete(network));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post(`/platform/networks/${network.id}/purge`, body));
  const ready = slug === network.slug && (exported || waive);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const res = await run({ confirm: slug, ...(exported ? {} : { acknowledgeNoExport: true }) });
    if (res) onPurged();
  };
  return (
    <Modal open onClose={onClose} title={`Purge ${network.name}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-small text-fg">
          This removes the network for good: its logins, offers, partners, advertisers, clicks, conversions and every other row.
          The money ledger is kept — download it under Purged networks afterwards. This can’t be undone.
        </p>
        {!exported && (
          <div className="space-y-2 rounded-card border border-border bg-page p-3">
            <p className="text-small text-fg">No export has been taken since the network was deleted.</p>
            <button type="button" className="btn-ghost" onClick={async () => { await onExport(); setExported(true); }}>Export now</button>
            <label className="flex items-start gap-2 text-small text-fg">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
              <span>Purge without an export</span>
            </label>
          </div>
        )}
        <Field label={`Type the slug “${network.slug}” to confirm`}>
          <input className="input font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="off" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={!ready || busy}>{busy ? 'Purging…' : 'Purge for good'}</button>
        </div>
      </form>
    </Modal>
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
        <p className="text-tiny text-fg-secondary">Provision the first admin login (optional). A subdomain tracking host is created automatically.</p>
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
