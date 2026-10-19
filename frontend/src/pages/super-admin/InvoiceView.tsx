/** Super Admin › Billing › one invoice: its printable copy, and the actions while it's open. */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { InvoiceDocument } from '../../shared-components/panels/InvoiceDocument';
import { useInvoiceActions } from './invoiceActions';
import type { InvoiceDocumentData } from '../../lib/platformBilling';

export default function InvoiceView() {
  const { id = '' } = useParams<{ id: string }>();
  const doc = useQuery<InvoiceDocumentData>(`/platform/invoices/${id}`);
  const actions = useInvoiceActions(() => doc.refetch());
  if (doc.loading) return <StateBlock><Spinner /></StateBlock>;
  if (doc.error || !doc.data) return <StateBlock>{doc.error ?? 'Invoice not found'}</StateBlock>;
  const inv = doc.data.invoice;
  return (
    <>
      <PageHeader title={`Invoice ${inv.number}`} subtitle={inv.bill_to?.name ?? undefined} />
      {actions.notice && <p className="mx-auto mb-3 max-w-3xl text-small text-fg-secondary print:hidden">{actions.notice}</p>}
      <InvoiceDocument data={doc.data} actions={<>
        <Link to="/admin/billing" className="btn-ghost">All invoices</Link>
        <Link to={`/admin/networks/${inv.network_id}`} className="btn-ghost">Network</Link>
        <span className="mr-2">{actions.buttons(inv)}</span>
      </>} />
      {actions.modal}
    </>
  );
}
