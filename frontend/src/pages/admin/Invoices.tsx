/**
 * Invoices — advertiser billing owed + affiliate payable, derived from the append-only ledger
 * (/api/invoices). Formal PDF documents are a later addition; these are the live balances that would
 * seed them.
 */
import { useState } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Table, Spinner, StateBlock, type Column } from '../../components/ui';

interface Row { id: string; name: string; amount: string; currency: string; entries: number }
interface Data { advertiserBilling: Row[]; affiliatePayable: Row[] }

const money = (v: string, c: string) => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

export default function Invoices() {
  const { data, loading, error } = useQuery<Data>('/api/invoices');
  const [tab, setTab] = useState('Advertiser Billing');

  const cols = (who: string): Column<Row>[] => [
    { header: who, cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: 'Entries', className: 'text-right', cell: (r) => String(r.entries) },
    { header: 'Amount', className: 'text-right', cell: (r) => <span className="font-semibold">{money(r.amount, r.currency)}</span> },
  ];
  const rows = tab === 'Advertiser Billing' ? data?.advertiserBilling : data?.affiliatePayable;

  return (
    <>
      <PageHeader title="Invoices" subtitle="Advertiser billing owed and affiliate payable, from the ledger." />
      <Tabs tabs={['Advertiser Billing', 'Affiliate Payable']} active={tab} onChange={setTab} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !rows || rows.length === 0 ? <StateBlock>No {tab.toLowerCase()} yet.</StateBlock>
        : <Table columns={cols(tab === 'Advertiser Billing' ? 'Advertiser' : 'Affiliate')} rows={rows} rowKey={(r) => r.id} />}
    </>
  );
}
