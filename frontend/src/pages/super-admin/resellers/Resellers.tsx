/**
 * Super Admin › Resellers — agencies and partners who sell the platform to networks for a commission on
 * what those networks pay. The list shows each reseller's networks and %; a reseller's page shows its
 * networks and the monthly commission statement (paid invoices × %, per currency).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Table, Modal, Field, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { Chip, Panel } from '../kit';
import type { Reseller, ResellerDetail as Detail } from '../../../lib/platformResellers';

const statusChip = (s: string) => (s === 'active'
  ? <Chip className="bg-success-bg text-success-text">Active</Chip>
  : <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">Inactive</Chip>);

function ResellerForm({ initial, onClose, onSaved }: { initial: Reseller | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? '', contactName: initial?.contactName ?? '', contactEmail: initial?.contactEmail ?? '',
    commissionPct: initial ? String(Number(initial.commissionPct)) : '10', status: initial?.status ?? 'active', notes: initial?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation((body: Record<string, unknown>) =>
    (initial ? api.patch<Reseller>(`/platform/resellers/${initial.id}`, body) : api.post<Reseller>('/platform/resellers', body)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await save.run({ ...f, name: f.name.trim(), commissionPct: f.commissionPct.trim() });
    if (r) onSaved(r.id);
  };
  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.name}` : 'New reseller'}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="reseller" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="reseller" onSubmit={submit} className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <Field label="Name"><input className="input" required maxLength={200} value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Contact name"><input className="input" maxLength={200} value={f.contactName} onChange={set('contactName')} /></Field>
          <Field label="Contact email"><input className="input" type="email" maxLength={200} value={f.contactEmail} onChange={set('contactEmail')} /></Field>
          <Field label="Commission (% of what its networks pay)"><input className="input" inputMode="decimal" value={f.commissionPct} onChange={set('commissionPct')} /></Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </Field>
        </div>
        <Field label="Notes"><textarea className="input min-h-[4rem]" maxLength={5000} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

export default function Resellers() {
  const canEdit = usePlatformMe().can('resellers', 'full');
  const nav = useNavigate();
  const list = useQuery<Reseller[]>('/platform/resellers');
  const [creating, setCreating] = useState(false);
  const columns: Column<Reseller>[] = [
    { header: 'Reseller', cell: (r) => <div><Link to={`/admin/resellers/${r.id}`} className="font-medium text-accent-text hover:underline">{r.name}</Link>{r.contactEmail && <p className="text-tiny text-fg-muted">{r.contactEmail}</p>}</div> },
    { header: 'Commission', cell: (r) => `${Number(r.commissionPct)}%` },
    { header: 'Networks', className: 'text-right', cell: (r) => <span className="tabular-nums">{r.networks}</span> },
    { header: 'Status', cell: (r) => statusChip(r.status) },
  ];
  return (
    <>
      <PageHeader title="Resellers" subtitle="Agencies and partners who sell the platform — their networks and commission."
        action={canEdit ? <button className="btn-primary" onClick={() => setCreating(true)}>New reseller</button> : undefined} />
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock>
        : list.error ? <StateBlock>{list.error}</StateBlock>
        : !(list.data ?? []).length ? <StateBlock>No resellers yet. Add one, then give networks a reseller on their page (Overview).</StateBlock>
        : <Table columns={columns} rows={list.data ?? []} rowKey={(r) => r.id} />}
      {creating && <ResellerForm initial={null} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); nav(`/admin/resellers/${id}`); }} />}
    </>
  );
}

export function ResellerPage() {
  const { id = '' } = useParams();
  const canEdit = usePlatformMe().can('resellers', 'full');
  const nav = useNavigate();
  const confirm = useConfirm();
  const r = useQuery<Detail>(`/platform/resellers/${id}`);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (r.loading && !r.data) return <StateBlock><Spinner /></StateBlock>;
  if (r.error || !r.data) return <StateBlock>{r.error ?? 'Reseller not found'}</StateBlock>;
  const d = r.data;
  const totals = d.statement.reduce<Record<string, { commission: number; paid: number }>>((acc, s) => {
    const t = acc[s.currency] ?? { commission: 0, paid: 0 };
    // Display totals only — the statement rows are the exact amounts.
    acc[s.currency] = { commission: t.commission + Number(s.commission), paid: t.paid + Number(s.paid) };
    return acc;
  }, {});
  return (
    <>
      <PageHeader title={d.name} subtitle={`Reseller · ${Number(d.commissionPct)}% commission`}
        action={<>
          <Link to="/admin/resellers" className="btn-ghost">All resellers</Link>
          {canEdit && <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>}
          {canEdit && <button className="btn-ghost text-danger-text" onClick={() => void confirm({
            title: 'Delete reseller?', message: `Delete ${d.name}? Its ${d.networks} network(s) keep running, with no reseller.`, confirmLabel: 'Delete', destructive: true,
            onConfirm: async () => { try { await api.del(`/platform/resellers/${d.id}`); nav('/admin/resellers'); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); } },
          })}>Delete</button>}
        </>} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Contact">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
            <dt className="text-fg-secondary">Status</dt><dd>{statusChip(d.status)}</dd>
            <dt className="text-fg-secondary">Contact</dt><dd>{d.contactName ?? '—'}</dd>
            <dt className="text-fg-secondary">Email</dt><dd>{d.contactEmail ?? '—'}</dd>
            <dt className="text-fg-secondary">Notes</dt><dd className="whitespace-pre-wrap">{d.notes ?? '—'}</dd>
          </dl>
        </Panel>
        <Panel title="Commission, last 12 months">
          {!d.statement.length ? <p className="text-small text-fg-muted">No paid invoices from its networks yet.</p> : (
            <>
              <table className="w-full text-small">
                <thead className="text-tiny uppercase text-fg-secondary"><tr><th className="py-1 text-left">Month</th><th className="py-1 text-right">Paid</th><th className="py-1 text-right">Invoices</th><th className="py-1 text-right">Commission</th></tr></thead>
                <tbody>{d.statement.map((s) => (
                  <tr key={`${s.month}-${s.currency}`}><td className="py-1">{s.month}</td><td className="py-1 text-right tabular-nums">{s.paid} {s.currency}</td><td className="py-1 text-right tabular-nums">{s.invoices}</td><td className="py-1 text-right font-medium tabular-nums">{s.commission} {s.currency}</td></tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-tiny text-fg-secondary">12-month commission: {Object.entries(totals).map(([c, t]) => `${t.commission.toFixed(2)} ${c}`).join(' · ')}</p>
            </>
          )}
        </Panel>
      </div>
      <div className="mt-4">
        <Panel title={`Networks (${d.networkList.length})`}>
          {!d.networkList.length ? <p className="text-small text-fg-muted">No networks yet — give a network this reseller on its page (Overview › Reseller).</p> : (
            <table className="w-full text-small">
              <thead className="text-tiny uppercase text-fg-secondary"><tr><th className="py-1 text-left">Network</th><th className="py-1 text-left">Plan</th><th className="py-1 text-left">Status</th></tr></thead>
              <tbody>{d.networkList.map((n) => (
                <tr key={n.id}><td className="py-1"><Link to={`/admin/networks/${n.id}`} className="text-accent-text hover:underline">{n.name}</Link></td><td className="py-1">{n.plan ?? '—'}</td><td className="py-1 capitalize">{n.status}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
      </div>
      {editing && <ResellerForm initial={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); r.refetch(); }} />}
    </>
  );
}
