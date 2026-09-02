/**
 * Investigation Details — General + Report tabs backed by /api/investigator/:id and /report.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';
import { Accordion } from '../../components/Accordion';

interface Investigation {
  id: string; ref: number; startDate: string; endDate: string;
  targetType: string; target: string; targetValue: string | null; subField: string | null;
  entryCount: number; suspectCount: number; offerCount: number; partnerCount: number;
  createdAt: string;
}

interface ReportEntry {
  id: string; entryType: 'click' | 'conversion'; clickId: string; conversionId: string | null;
  offerName: string | null; offerRef: number | null;
  publisherName: string | null; publisherRef: number | null;
  createdAt: string; country: string | null; sub1: string | null; sub2: string | null;
  transactionId: string | null; eventName: string | null; status: string | null;
  payout: number | null; revenue: number | null;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString();
}
function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toFixed(2)}` : '—';
}

export default function InvestigatorDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<string>('General');
  const [q, setQ] = useState('');
  const { data: inv, loading, error } = useQuery<Investigation>(id ? `/api/investigator/${id}` : null);
  const { data: report, loading: reportLoading } = useQuery<ReportEntry[]>(
    id && tab === 'Report' ? `/api/investigator/${id}/report` : null,
  );

  const filtered = useMemo(() => {
    const rows = report ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      r.clickId.toLowerCase().includes(needle) ||
      (r.conversionId?.toLowerCase().includes(needle) ?? false) ||
      (r.publisherName?.toLowerCase().includes(needle) ?? false) ||
      (r.offerName?.toLowerCase().includes(needle) ?? false) ||
      (r.transactionId?.toLowerCase().includes(needle) ?? false),
    );
  }, [report, q]);

  const columns: Column<ReportEntry>[] = [
    { header: 'Type', cell: (r) => <Badge value={r.entryType} /> },
    { header: 'When', cell: (r) => new Date(r.createdAt).toLocaleString() },
    { header: 'Click ID', cell: (r) => <span className="font-mono text-xs">{r.clickId.slice(0, 12)}…</span> },
    { header: 'Conversion', cell: (r) => r.conversionId ? <span className="font-mono text-xs">{r.conversionId.slice(0, 12)}…</span> : '—' },
    { header: 'Offer', cell: (r) => r.offerName ? `${r.offerName} (#${r.offerRef})` : '—' },
    { header: 'Partner', cell: (r) => r.publisherName ? `${r.publisherName} (#${r.publisherRef})` : '—' },
    { header: 'Country', cell: (r) => r.country ?? '—' },
    { header: 'Sub1', cell: (r) => r.sub1 ?? '—' },
    { header: 'Txn ID', cell: (r) => r.transactionId ?? '—' },
    { header: 'Event', cell: (r) => r.eventName ?? '—' },
    { header: 'Status', cell: (r) => r.status ? <Badge value={r.status} /> : '—' },
    { header: 'Payout', cell: (r) => fmtMoney(r.payout) },
    { header: 'Revenue', cell: (r) => fmtMoney(r.revenue) },
  ];

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !inv) return <StateBlock>{error ?? 'Investigation not found.'}</StateBlock>;

  return (
    <>
      <Link to="/app/investigator" className="btn-ghost !py-1.5 !px-3 text-tiny mb-3 inline-flex">← Back</Link>
      <PageHeader title={`Investigation Details (${inv.ref})`} subtitle={`Investigator › Investigation (${inv.ref}) › Details`} />
      <Tabs tabs={['General', 'Report']} active={tab} onChange={setTab} />
      {tab === 'General' ? (
        <Accordion title="Investigation" defaultOpen>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="text-small font-semibold text-fg">ID</p>
              <p className="mt-1 text-small text-fg-secondary">{inv.ref}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Date range</p>
              <p className="mt-1 text-small text-fg-secondary">{fmtDate(inv.startDate)} – {fmtDate(inv.endDate)}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Target</p>
              <p className="mt-1 text-small text-fg-secondary">{inv.target}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Suspects</p>
              <p className="mt-1 text-small text-fg-secondary">{inv.suspectCount} partner{inv.suspectCount === 1 ? '' : 's'}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Entries</p>
              <p className="mt-1 text-small text-fg-secondary">{inv.entryCount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Offers / Partners</p>
              <p className="mt-1 text-small text-fg-secondary">{inv.offerCount} offers · {inv.partnerCount} partners</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Created</p>
              <p className="mt-1 text-small text-fg-secondary">{new Date(inv.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </Accordion>
      ) : (
        <Accordion title="Investigation" defaultOpen>
          <div className="mb-3 flex items-center justify-end gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !w-56 !pl-8" />
            </div>
          </div>
          {reportLoading ? <StateBlock><Spinner /></StateBlock>
            : filtered.length === 0 ? (
              <p className="text-small text-fg-secondary">There are no results that match your investigation</p>
            ) : (
              <Table columns={columns} rows={filtered} rowKey={(r) => `${r.entryType}-${r.id}`} />
            )}
        </Accordion>
      )}
    </>
  );
}
