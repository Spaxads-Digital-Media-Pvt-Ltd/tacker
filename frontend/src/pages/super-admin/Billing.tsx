/**
 * Super Admin › Billing — the platform's invoices to its tenant networks. Per currency (never summed
 * across currencies): open, overdue, collected this month. Every invoice with its state (Overdue = open
 * past its due date) and when an unpaid one suspends its network; Mark as paid / More time / Void; a
 * one-off invoice; "Run billing now" (renewals, overdue flags and suspensions — the worker does it every
 * 15 minutes). No payment gateway yet: payments are recorded by hand.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useAllPages } from '../../hooks/useAllPages';
import { withQueryParams } from '../../lib/useApi';
import { useDebounced } from '../admin/pagedList';
import { useAllNetworks } from './useAllNetworks';
import { useInvoiceActions } from './invoiceActions';
import { usePlatformMe } from '../../lib/platformMe';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, Segmented, type Column } from '../../shared-components/primitives/ui';
import { money, day, invoiceState, billingBadge, type PlatformInvoice, type InvoiceSummaryRow } from '../../lib/platformBilling';

const STATUSES = ['all', 'open', 'overdue', 'paid', 'void'] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { all: 'All', open: 'Open', overdue: 'Overdue', paid: 'Paid', void: 'Void' };

export default function Billing() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);
  const invoices = useAllPages<PlatformInvoice>(withQueryParams('/platform/invoices', { status, q: search || undefined }));
  const summary = useQuery<InvoiceSummaryRow[]>('/platform/invoices-summary');
  const refetch = () => { invoices.refetch(); summary.refetch(); };
  const actions = useInvoiceActions(refetch);
  const canEdit = usePlatformMe().can('billing', 'full');
  const [creating, setCreating] = useState(false);
  const run = useMutation(() => api.post<Record<string, number>>('/platform/billing/run', {}));
  const [runNote, setRunNote] = useState<string | null>(null);
  const runNow = async () => {
    setRunNote(null);
    const r = await run.run(undefined);
    if (!r) return;
    const parts = [
      r['invoicesIssued'] && `${r['invoicesIssued']} invoice(s) issued`, r['renewed'] && `${r['renewed']} renewal(s)`,
      r['trialsEnded'] && `${r['trialsEnded']} trial(s) ended`, r['canceled'] && `${r['canceled']} subscription(s) ended`,
      r['pastDue'] && `${r['pastDue']} flagged past due`, r['suspended'] && `${r['suspended']} network(s) suspended`,
    ].filter(Boolean);
    setRunNote(parts.length ? `Billing run: ${parts.join(', ')}.` : 'Billing run: nothing was due.');
    refetch();
  };

  const columns: Column<PlatformInvoice>[] = [
    { header: 'Invoice', cell: (i) => <Link to={`/admin/invoices/${i.id}`} className="font-mono text-xs text-fg hover:text-accent-text hover:underline">{i.number}</Link> },
    { header: 'Network', cell: (i) => <Link to={`/admin/networks/${i.network_id}`} className="font-medium text-fg hover:text-accent-text hover:underline">{i.network_name ?? i.bill_to?.name ?? '—'}</Link> },
    { header: 'Description', cell: (i) => <span className="text-small text-fg-secondary">{i.description}</span> },
    { header: 'Total', className: 'text-right', cell: (i) => <span className="whitespace-nowrap font-medium">{money(i.total, i.currency)}</span> },
    { header: 'Due', cell: (i) => day(i.due_at) },
    { header: 'Status', cell: (i) => <Badge {...billingBadge(invoiceState(i))} /> },
    {
      header: 'Suspension', cell: (i) => (i.status !== 'open' ? <span className="text-fg-muted">—</span>
        : i.network_status === 'suspended' && i.network_suspended_reason === 'billing' ? <span className="text-small font-medium text-danger-text">Network suspended</span>
        : <span className="text-small">{day(i.suspend_at)}</span>),
    },
    { header: '', className: 'text-right', cell: (i) => actions.buttons(i) },
  ];

  return (
    <>
      <PageHeader title="Billing" subtitle="Invoices to tenant networks — record payments, give more time, void."
        action={canEdit ? <>
          <button className="btn-ghost" disabled={run.busy} onClick={() => void runNow()} title="Renewals, ended trials, overdue flags and suspensions — the worker does this every 15 minutes">
            {run.busy ? 'Running…' : 'Run billing now'}
          </button>
          <button className="btn-primary" onClick={() => setCreating(true)}>New invoice</button>
        </> : undefined} />
      {(run.error || runNote || actions.notice) && (
        <p className={`mb-3 text-small ${run.error ? 'text-danger-text' : 'text-fg-secondary'}`}>{run.error ?? actions.notice ?? runNote}</p>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {summary.loading ? <Spinner /> : summary.error ? <p className="text-small text-danger-text">{summary.error}</p>
          : (summary.data ?? []).length === 0 ? <p className="text-small text-fg-secondary md:col-span-3">No invoices yet — they are issued when a network is assigned a paid plan, and at every renewal.</p>
          : <>
            <div className="card">
              <p className="text-small font-medium text-fg-secondary">Open</p>
              {(summary.data ?? []).map((s) => <p key={s.currency} className="mt-1 text-h3 font-semibold text-fg">{money(s.open_total, s.currency)} <span className="text-tiny font-normal text-fg-muted">{s.open_count} invoice(s)</span></p>)}
            </div>
            <div className="card">
              <p className="text-small font-medium text-fg-secondary">Overdue</p>
              {(summary.data ?? []).map((s) => <p key={s.currency} className={`mt-1 text-h3 font-semibold ${s.overdue_count ? 'text-danger-text' : 'text-fg'}`}>{money(s.overdue_total, s.currency)} <span className="text-tiny font-normal text-fg-muted">{s.overdue_count} invoice(s)</span></p>)}
            </div>
            <div className="card">
              <p className="text-small font-medium text-fg-secondary">Collected this month</p>
              {(summary.data ?? []).map((s) => <p key={s.currency} className="mt-1 text-h3 font-semibold text-fg">{money(s.collected_this_month, s.currency)}</p>)}
            </div>
          </>}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} value={status} onChange={(v) => setStatus(v as (typeof STATUSES)[number])} />
        <input className="input sm:max-w-xs" placeholder="Search invoice number or network…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
      </div>
      {invoices.loading ? <StateBlock><Spinner /></StateBlock>
        : invoices.error ? <StateBlock>{invoices.error}</StateBlock>
        : (invoices.data ?? []).length === 0 ? <StateBlock>{status === 'all' && !search ? 'No invoices yet.' : 'No invoices match.'}</StateBlock>
        : <Table columns={columns} rows={invoices.data ?? []} rowKey={(i) => i.id} />}

      {actions.modal}
      {creating && <NewInvoice onClose={() => setCreating(false)} onCreated={(n) => { setCreating(false); setRunNote(`Invoice ${n} issued.`); refetch(); }} />}
    </>
  );
}

/** A one-off invoice (a setup fee, a custom charge) to one network. */
export function NewInvoice({ networkId, onClose, onCreated }: { networkId?: string; onClose: () => void; onCreated: (number: string) => void }) {
  const networks = useAllNetworks();
  const [net, setNet] = useState(networkId ?? '');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [dueDays, setDueDays] = useState('');
  const [notes, setNotes] = useState('');
  const m = useMutation((b: { id: string; body: Record<string, unknown> }) => api.post<PlatformInvoice>(`/platform/networks/${b.id}/invoices`, b.body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ id: net, body: {
      description: description.trim(), amount: amount.trim(), ...(currency.trim() ? { currency: currency.trim() } : {}),
      ...(dueDays.trim() ? { dueDays: Number(dueDays) } : {}), notes: notes.trim() || null,
    } });
    if (r) onCreated(r.number);
  };
  const chosen = (networks.data ?? []).find((n) => n.id === net);
  return (
    <Modal open onClose={onClose} title="New invoice">
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        {!networkId && (
          <Field label="Network">
            <select className="input" required value={net} onChange={(e) => setNet(e.target.value)}>
              <option value="" disabled>Choose a network…</option>
              {(networks.data ?? []).filter((n) => n.status !== 'deleted').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Description"><input className="input" required maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Onboarding & setup" /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Amount"><input className="input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250.00" /></Field>
          <Field label="Currency" hint={chosen ? `Default ${chosen.default_currency}` : undefined}><input className="input uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder={chosen?.default_currency ?? 'USD'} /></Field>
          <Field label="Due in (days)" hint="Default: Settings"><input className="input" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} /></Field>
        </div>
        <Field label="Note on the invoice" hint="Optional — printed on it"><textarea className="input min-h-[60px]" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-tiny text-fg-secondary">Tax is added at the platform rate (Settings). Unpaid, the network is suspended after the grace period.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy || !net}>{m.busy ? 'Issuing…' : 'Issue invoice'}</button>
        </div>
      </form>
    </Modal>
  );
}
