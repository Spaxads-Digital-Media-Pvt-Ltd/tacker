/** Control Center › Billing › one invoice — its printable copy (the network's own invoices only). */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { InvoiceDocument } from '../../shared-components/panels/InvoiceDocument';
import type { InvoiceDocumentData } from '../../lib/platformBilling';

export default function NetworkBillingInvoice() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, loading, error } = useQuery<InvoiceDocumentData>(`/api/subscription/invoices/${id}`);
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !data) return <StateBlock>{error ?? 'Invoice not found'}</StateBlock>;
  return (
    <>
      <PageHeader title={`Invoice ${data.invoice.number}`} subtitle="Billing" />
      <InvoiceDocument data={data} actions={<Link to="/app/billing" className="btn-ghost">All invoices</Link>} />
    </>
  );
}
