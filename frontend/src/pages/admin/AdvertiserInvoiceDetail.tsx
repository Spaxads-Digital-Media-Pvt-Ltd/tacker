/**
 * Invoice Details (Advertisers) — General panel plus a read-only Ledger Breakdown of the real
 * debit ledger_entries rows that made up the billed snapshot, mirroring the Partner Invoices
 * detail page pattern.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import type { AdvertiserInvoice, AdvertiserInvoiceLedgerEntry } from '../../types';

const STATUS_DOT: Record<string, string> = { unpaid: 'bg-warning', paid: 'bg-success', deleted: 'bg-danger-text' };
const STATUS_LABEL: Record<string, string> = { unpaid: 'Unpaid', paid: 'Paid', deleted: 'Deleted' };
const money = (v: string | number, c = 'USD') => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-tiny uppercase text-fg-secondary">{label}</p><p className="text-small text-fg">{children}</p></div>;
}

export default function AdvertiserInvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: invoice, loading, error, refetch } = useQuery<AdvertiserInvoice>(`/api/advertiser-invoices/${id}`);
  const { data: ledger, loading: ledgerLoading } = useQuery<AdvertiserInvoiceLedgerEntry[]>(`/api/advertiser-invoices/${id}/ledger`);
  const pay = useMutation(() => api.post(`/api/advertiser-invoices/${id}/pay`, {}));
  const [confirming, setConfirming] = useState(false);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !invoice) return <StateBlock>{error ?? 'Invoice not found'}</StateBlock>;

  const doPay = async () => {
    setConfirming(false);
    if (await pay.run(undefined)) refetch();
  };

  const ledgerColumns: Column<AdvertiserInvoiceLedgerEntry>[] = [
    { header: 'Date', cell: (e) => new Date(e.createdAt).toLocaleString() },
    { header: 'Type', cell: (e) => e.entryType },
    { header: 'Conversion', cell: (e) => e.conversionId ?? <span className="text-fg-muted">-</span> },
    { header: 'Direction', cell: (e) => e.direction },
    { header: 'Amount', className: 'text-right', cell: (e) => <span className={e.direction === 'debit' ? 'text-danger-text' : 'text-success'}>{e.direction === 'debit' ? '+' : '-'}{money(e.amount, e.currency)}</span> },
  ];

  return (
    <>
      <PageHeader title={`Invoice Details (${invoice.ref})`} subtitle="Advertisers › Invoices › Details" />

      <div className="mb-6 card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-h3 font-medium text-fg">General</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !py-1 !text-tiny" onClick={() => nav(`/app/adv-invoices/${invoice.id}/edit`)}>Edit</button>
            {invoice.status === 'unpaid' && <button type="button" className="btn-primary !py-1 !text-tiny" onClick={() => setConfirming(true)}>Pay Invoice</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Row label="ID">{invoice.ref}</Row>
          <Row label="Status"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[invoice.status]}`} />{STATUS_LABEL[invoice.status]}</span></Row>
          <Row label="Advertiser"><Link to={`/app/advertisers/${invoice.advertiserId}`} className="text-accent-text hover:underline">{invoice.advertiserName}</Link></Row>
          <Row label="Modified">{new Date(invoice.updatedAt).toLocaleString()}</Row>
          <Row label="Start Date">{new Date(invoice.periodStart).toLocaleDateString()}</Row>
          <Row label="End Date">{new Date(invoice.periodEnd).toLocaleDateString()}</Row>
          <Row label="Payment Terms">{invoice.paymentTerms ?? '-'}</Row>
          <Row label="Created">{new Date(invoice.createdAt).toLocaleString()}</Row>
          <Row label="Billed">{money(invoice.billedAmount, invoice.currency)}</Row>
          <Row label="Paid">{money(invoice.paidAmount, invoice.currency)}</Row>
          <Row label="Balance">{money(invoice.balance, invoice.currency)}</Row>
          <Row label="Invoice Hidden From Advertiser">{invoice.visibleToAdvertiser ? <span className="text-danger-text">NO</span> : 'YES'}</Row>
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
            <h2 className="mb-2 text-h3 font-semibold text-fg">Pay Invoice</h2>
            <p className="mb-4 text-small text-fg-secondary">Mark Invoice ID: {invoice.ref} as paid in full for {money(invoice.billedAmount, invoice.currency)}?</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={pay.busy} onClick={doPay}>{pay.busy ? 'Processing…' : 'Pay'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
