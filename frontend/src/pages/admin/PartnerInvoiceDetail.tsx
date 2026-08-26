/**
 * Invoice Details — matches the reference's General + Billing panels, plus a read-only Ledger
 * Breakdown of the real ledger_entries rows that made up the billed snapshot (the reference's own
 * "Details" table there is freely hand-typed line items, which this app's data model has no honest
 * equivalent for — real ledger rows stand in for it instead).
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import type { PartnerInvoice, PartnerInvoiceLedgerEntry, Publisher } from '../../types';

const STATUS_DOT: Record<string, string> = { unpaid: 'bg-warning', paid: 'bg-success', deleted: 'bg-danger-text' };
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', paid: 'Paid', deleted: 'Deleted' };
const money = (v: string | number, c = 'USD') => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-tiny uppercase text-fg-secondary">{label}</p><p className="text-small text-fg">{children}</p></div>;
}

export default function PartnerInvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: invoice, loading, error, refetch } = useQuery<PartnerInvoice>(`/api/partner-invoices/${id}`);
  const { data: publisher } = useQuery<Publisher>(invoice ? `/api/publishers/${invoice.publisherId}` : null);
  const { data: ledger, loading: ledgerLoading } = useQuery<PartnerInvoiceLedgerEntry[]>(`/api/partner-invoices/${id}/ledger`);
  const approvePay = useMutation(() => api.post(`/api/partner-invoices/${id}/approve-pay`, {}));
  const [confirming, setConfirming] = useState(false);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !invoice) return <StateBlock>{error ?? 'Invoice not found'}</StateBlock>;

  const doApprovePay = async () => {
    setConfirming(false);
    if (await approvePay.run(undefined)) refetch();
  };

  const ledgerColumns: Column<PartnerInvoiceLedgerEntry>[] = [
    { header: 'Date', cell: (e) => new Date(e.createdAt).toLocaleString() },
    { header: 'Type', cell: (e) => e.entryType },
    { header: 'Conversion', cell: (e) => e.conversionId ?? <span className="text-fg-muted">-</span> },
    { header: 'Direction', cell: (e) => e.direction },
    { header: 'Amount', className: 'text-right', cell: (e) => <span className={e.direction === 'credit' ? 'text-success' : 'text-danger-text'}>{e.direction === 'credit' ? '+' : '-'}{money(e.amount, e.currency)}</span> },
  ];

  return (
    <>
      <PageHeader title={`Invoice Details (${invoice.ref})`} subtitle="Partners › Invoices › Details" />

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-h3 font-medium text-fg">General</h3>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost !py-1 !text-tiny" onClick={() => nav(`/app/aff-invoices/${invoice.id}/edit`)}>Edit</button>
              {invoice.status === 'unpaid' && <button type="button" className="btn-primary !py-1 !text-tiny" onClick={() => setConfirming(true)}>Pay Invoice</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Row label="ID">{invoice.ref}</Row>
            <Row label="Status"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[invoice.status]}`} />{STATUS_LABEL[invoice.status]}</span></Row>
            <Row label="Partner"><Link to={`/app/publishers/${invoice.publisherId}`} className="text-accent-text hover:underline">{invoice.publisherName}</Link></Row>
            <Row label="Modified">{new Date(invoice.updatedAt).toLocaleString()}</Row>
            <Row label="Start Date">{new Date(invoice.periodStart).toLocaleDateString()}</Row>
            <Row label="End Date">{new Date(invoice.periodEnd).toLocaleDateString()}</Row>
            <Row label="Payment Terms">{invoice.paymentTerms ?? '-'}</Row>
            <Row label="Created">{new Date(invoice.createdAt).toLocaleString()}</Row>
            <Row label="Billed">{money(invoice.billedAmount, invoice.currency)}</Row>
            <Row label="Payments">{money(invoice.paymentsAmount, invoice.currency)}</Row>
            <Row label="Balance">{money(invoice.balance, invoice.currency)}</Row>
            <Row label="Invoice Hidden From Partner">{invoice.visibleToPartner ? <span className="text-danger-text">NO</span> : 'YES'}</Row>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-4 text-h3 font-medium text-fg">Billing</h3>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Payment Method">{invoice.paymentMethod ?? '-'}</Row>
            <Row label="Billing Frequency">{publisher?.billingFrequency ?? '-'}</Row>
            <Row label="Tax ID / VAT or SSN">{publisher?.taxId ?? 'N/A'}</Row>
            <Row label="Currency">{invoice.currency}</Row>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mb-4 text-h3 font-medium text-fg">Ledger Breakdown</h3>
        {ledgerLoading ? <StateBlock><Spinner /></StateBlock>
          : !ledger || ledger.length === 0 ? <StateBlock>No ledger activity in this period.</StateBlock>
          : <Table columns={ledgerColumns} rows={ledger} rowKey={(e) => e.id} />}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setConfirming(false)}>
          <div className="w-full max-w-md rounded-card border border-border bg-elevated p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-h3 font-semibold text-fg">Approve &amp; Pay</h2>
            <p className="mb-4 text-small text-fg-secondary">Mark Invoice ID: {invoice.ref} as paid in full for {money(invoice.billedAmount, invoice.currency)}?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={approvePay.busy} onClick={doApprovePay}>{approvePay.busy ? 'Processing…' : 'Approve & Pay'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
