/**
 * The Super Admin's invoice action dialogs (used through ./invoiceActions): Mark as paid (recorded by
 * hand — no payment gateway yet), More time (push the suspension date), Void (with a reason).
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { Modal, Field } from '../../shared-components/primitives/ui';
import { PAYMENT_METHODS, money, day, type PlatformInvoice } from '../../lib/platformBilling';

interface Settled { networkReactivated: boolean; subscriptionActive: boolean }
const settledNote = (s: Settled) =>
  s.networkReactivated ? ' The network was suspended for billing — it is active again.' : s.subscriptionActive ? ' Its subscription is no longer past due.' : '';

export function MarkPaid({ inv, onClose, onDone }: { inv: PlatformInvoice; onClose: () => void; onDone: (msg: string) => void }) {
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(inv.total);
  const m = useMutation((b: Record<string, unknown>) => api.post<Settled & { invoice: PlatformInvoice }>(`/platform/invoices/${inv.id}/mark-paid`, b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ method, reference: reference.trim() || null, paidAt, amount: amount.trim() || undefined });
    if (r) onDone(`${inv.number} marked as paid.${settledNote(r)}`);
  };
  return (
    <Modal open onClose={onClose} title={`Mark ${inv.number} as paid`}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <p className="text-small text-fg-secondary">{inv.network_name ?? inv.bill_to?.name} · {inv.description} · total {money(inv.total, inv.currency)}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Paid on"><input type="date" className="input" required value={paidAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          <Field label={`Amount (${inv.currency})`}><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reference" hint="Bank / UPI transaction id"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UTR 1234…" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Mark as paid'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function MoreTime({ inv, onClose, onDone }: { inv: PlatformInvoice; onClose: () => void; onDone: (msg: string) => void }) {
  const [date, setDate] = useState('');
  const m = useMutation((b: Record<string, unknown>) => api.post<Settled & { invoice: PlatformInvoice }>(`/platform/invoices/${inv.id}/extend`, b));
  const extend = async (b: Record<string, unknown>) => {
    const r = await m.run(b);
    if (r) onDone(`${inv.number}: the network won’t be suspended before ${day(r.invoice.suspend_at)}.${settledNote(r)}`);
  };
  const suspended = inv.network_status === 'suspended' && inv.network_suspended_reason === 'billing';
  return (
    <Modal open onClose={onClose} title={`More time for ${inv.number}`}>
      <div className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <p className="text-small text-fg-secondary">
          Unpaid, {inv.network_name ?? inv.bill_to?.name ?? 'the network'} {suspended ? 'is suspended for this invoice' : `will be suspended on ${day(inv.suspend_at)}`}.
          {' '}Push the date — {suspended ? 'the network is reactivated at once.' : 'it keeps running until then.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30].map((d) => <button key={d} type="button" className="btn-ghost" disabled={m.busy} onClick={() => void extend({ days: d })}>+{d} days</button>)}
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (date) void extend({ suspendAt: date }); }}>
          <Field label="Or until"><input type="date" className="input" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></Field>
          <button type="submit" className="btn-primary" disabled={m.busy || !date}>Set date</button>
        </form>
        <div className="flex justify-end"><button type="button" className="btn-ghost" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

export function VoidInvoice({ inv, onClose, onDone }: { inv: PlatformInvoice; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation((b: Record<string, unknown>) => api.post<Settled & { invoice: PlatformInvoice }>(`/platform/invoices/${inv.id}/void`, b));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.run({ reason: reason.trim() });
    if (r) onDone(`${inv.number} voided.${settledNote(r)}`);
  };
  return (
    <Modal open onClose={onClose} title={`Void ${inv.number}?`}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <p className="text-small text-fg-secondary">Nothing is owed on a voided invoice ({money(inv.total, inv.currency)}). This can’t be undone — issue a new invoice if needed.</p>
        <Field label="Reason"><input className="input" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Issued by mistake / waived" /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-danger" disabled={m.busy || !reason.trim()}>{m.busy ? 'Voiding…' : 'Void invoice'}</button>
        </div>
      </form>
    </Modal>
  );
}
