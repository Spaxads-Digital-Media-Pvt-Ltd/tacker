/**
 * Super Admin invoice actions — on Billing and on a network's page: Mark as paid (no payment gateway yet:
 * the payment is recorded by hand), More time (push the suspension date; a billing suspension it caused
 * is lifted), Void (with a reason), and a Credit note on a paid one (a refund or goodwill credit). Each
 * says what happened, including the network coming back.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditNoteModal, MarkPaid, MoreTime, VoidInvoice } from './InvoiceActionModals';
import type { PlatformInvoice } from '../../lib/platformBilling';
import { usePlatformMe } from '../../lib/platformMe';

type Action = { kind: 'paid' | 'time' | 'void' | 'credit'; inv: PlatformInvoice } | null;

/** The three actions for one list of invoices, their modal, and what happened (`notice`). */
export function useInvoiceActions(onChanged: () => void) {
  const canEdit = usePlatformMe().can('billing', 'full');
  const [action, setAction] = useState<Action>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (msg: string) => { setAction(null); setNotice(msg); onChanged(); };
  const close = () => setAction(null);
  const buttons = (inv: PlatformInvoice) => (
    <span className="flex justify-end gap-3 whitespace-nowrap">
      <Link to={`/admin/invoices/${inv.id}`} className="text-tiny font-medium text-accent-text hover:underline">View</Link>
      {inv.status === 'open' && canEdit && <>
        <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => { setNotice(null); setAction({ kind: 'paid', inv }); }}>Mark paid</button>
        <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => { setNotice(null); setAction({ kind: 'time', inv }); }}>More time</button>
        <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => { setNotice(null); setAction({ kind: 'void', inv }); }}>Void</button>
      </>}
      {inv.status === 'paid' && canEdit && Number(inv.total) > 0 && (
        <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => { setNotice(null); setAction({ kind: 'credit', inv }); }}>Credit note</button>
      )}
    </span>
  );
  const modal = !action ? null
    : action.kind === 'paid' ? <MarkPaid inv={action.inv} onClose={close} onDone={done} />
    : action.kind === 'time' ? <MoreTime inv={action.inv} onClose={close} onDone={done} />
    : action.kind === 'credit' ? <CreditNoteModal inv={action.inv} onClose={close} onDone={done} />
    : <VoidInvoice inv={action.inv} onClose={close} onDone={done} />;
  return { buttons, modal, notice, clearNotice: () => setNotice(null) };
}
