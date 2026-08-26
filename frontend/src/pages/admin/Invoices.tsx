/**
 * Invoices (Advertisers › Invoices) — Accounts Receivable balances owed by each Advertiser, derived
 * live from the append-only ledger (/api/invoices). Partner-side Accounts Payable now has its own
 * first-class Manage Invoices page (Partners › Invoices, PartnerInvoicesManage.tsx) with generation,
 * approval and payment tracking; this page keeps the read-only advertiser half.
 */
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Spinner, StateBlock, type Column } from '../../components/ui';

interface Row { id: string; name: string; amount: string; currency: string; entries: number }
interface Data { advertiserBilling: Row[]; affiliatePayable: Row[] }

const money = (v: string, c: string) => `${c} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

export default function Invoices() {
  const { data, loading, error } = useQuery<Data>('/api/invoices');

  const columns: Column<Row>[] = [
    { header: 'Advertiser', cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: 'Entries', className: 'text-right', cell: (r) => String(r.entries) },
    { header: 'Amount', className: 'text-right', cell: (r) => <span className="font-semibold">{money(r.amount, r.currency)}</span> },
  ];

  return (
    <>
      <PageHeader title="Invoices" subtitle="Advertiser billing owed, from the ledger." />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data?.advertiserBilling.length ? <StateBlock>No advertiser billing yet.</StateBlock>
        : <Table columns={columns} rows={data.advertiserBilling} rowKey={(r) => r.id} />}
    </>
  );
}
