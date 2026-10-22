/**
 * Super Admin › Reports — the platform's own reports, as a table and as CSV (GET /platform/reports/*):
 * Networks (status, owner, plan and what it pays, MRR, people, health, the last 30 days), Usage (clicks,
 * conversions and events per network for a date range) and Growth (per month: networks created, deleted,
 * live at the end, MRR and what was paid — revenue access).
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/useApi';
import { usePlatformMe } from '../../lib/platformMe';
import { money } from '../../lib/platformBilling';
import { PageHeader, Spinner, StateBlock, Table, Tabs, type Column } from '../../shared-components/primitives/ui';

type Row = Record<string, unknown>;
const LABEL: Record<string, string> = {
  ref: 'Ref', name: 'Network', slug: 'Slug', status: 'Status', created: 'Created', owner_email: 'Owner', plan: 'Plan', subscription: 'Subscription',
  currency: 'Currency', interval: 'Billed', price: 'Price', custom_price: 'Own price', billing_exempt: 'Exempt', mrr: 'MRR',
  account_manager: 'Account manager', seller: 'Seller', reseller: 'Reseller', health_score: 'Health', health_status: 'Health status',
  clicks_30d: 'Clicks (30 d)', conversions_30d: 'Conversions (30 d)', clicks: 'Clicks', conversions: 'Conversions', events: 'Events',
};
const cell = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : '—')
  : /^\d+$/.test(String(v)) && String(v).length > 3 ? Number(v).toLocaleString() : String(v));
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

function GenericReport({ path, params, csvName }: { path: string; params: Record<string, string>; csvName: string }) {
  const r = useQuery<{ columns: string[]; rows: Row[] }>(path, params);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...params, format: 'csv' }).toString();
  const download = async () => { setError(null); try { await api.download(`${path}?${qs}`, `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); } };
  const columns: Column<Row>[] = (r.data?.columns ?? []).filter((c) => c !== 'slug' && c !== 'ref').map((c) => ({
    header: LABEL[c] ?? c,
    cell: (row) => (c === 'price' || c === 'mrr' ? (row['currency'] ? money(String(row[c] ?? '0'), String(row['currency'])) : '—') : cell(row[c])),
  }));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-fg-secondary">{r.data ? `${r.data.rows.length.toLocaleString()} row${r.data.rows.length === 1 ? '' : 's'}` : ''}</p>
        <button className="btn-ghost" disabled={!r.data?.rows.length} onClick={() => void download()}>Download CSV</button>
      </div>
      {error && <p className="text-small text-danger-text">{error}</p>}
      {r.loading && !r.data ? <StateBlock><Spinner /></StateBlock> : r.error ? <StateBlock>{r.error}</StateBlock>
        : !r.data?.rows.length ? <StateBlock>Nothing to show.</StateBlock>
        : <Table columns={columns} rows={r.data.rows} rowKey={(row) => String(row['slug'] ?? row['name'])} />}
    </div>
  );
}

interface GrowthMonth { month: string; created: number; deleted: number; live_at_end: number; mrr: { currency: string; amount: string }[]; paid: { currency: string; amount: string }[] }

function Growth() {
  const [months, setMonths] = useState('12');
  const g = useQuery<{ months: GrowthMonth[] }>('/platform/reports/growth', { months });
  const [error, setError] = useState<string | null>(null);
  const per = (xs: { currency: string; amount: string }[]) => (xs.length ? xs.map((x) => money(x.amount, x.currency)).join(' · ') : '—');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <select className="input !w-auto" value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months">
          {['6', '12', '24', '36'].map((m) => <option key={m} value={m}>Last {m} months</option>)}
        </select>
        <button className="btn-ghost" onClick={async () => { setError(null); try { await api.download(`/platform/reports/growth?months=${months}&format=csv`, `growth-${new Date().toISOString().slice(0, 10)}.csv`); } catch (e) { setError(e instanceof Error ? e.message : 'Download failed'); } }}>Download CSV</button>
      </div>
      {error && <p className="text-small text-danger-text">{error}</p>}
      {g.loading && !g.data ? <StateBlock><Spinner /></StateBlock> : g.error ? <StateBlock>{g.error}</StateBlock> : (
        <Table rows={g.data?.months ?? []} rowKey={(m) => m.month} columns={[
          { header: 'Month', cell: (m) => new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) },
          { header: 'New networks', cell: (m) => m.created },
          { header: 'Deleted', cell: (m) => m.deleted },
          { header: 'Live at month end', cell: (m) => m.live_at_end },
          { header: 'MRR at month end', cell: (m) => per(m.mrr) },
          { header: 'Paid', cell: (m) => per(m.paid) },
        ]} />
      )}
      <p className="text-tiny text-fg-muted">MRR is the last daily snapshot in each month (taken with the billing run); paid is by the date an invoice was paid (UTC).</p>
    </div>
  );
}

export default function Reports() {
  const { can } = usePlatformMe();
  const tabs = [...(can('networks', 'read') ? ['Networks', 'Usage'] : []), ...(can('revenue', 'read') ? ['Growth'] : [])];
  const [tab, setTab] = useState(tabs[0] ?? 'Networks');
  const [from, setFrom] = useState(ago(30));
  const [to, setTo] = useState(ago(0));
  return (
    <>
      <PageHeader title="Reports" subtitle="The platform’s networks, usage and growth — on screen or as CSV." />
      <div className="mb-4"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>
      {tab === 'Networks' && <GenericReport path="/platform/reports/networks" params={{}} csvName="networks" />}
      {tab === 'Usage' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-small text-fg-secondary">From <input type="date" className="input ml-1 !w-auto" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
            <label className="text-small text-fg-secondary">To <input type="date" className="input ml-1 !w-auto" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          </div>
          <GenericReport path="/platform/reports/usage" params={{ from, to }} csvName="usage" />
        </div>
      )}
      {tab === 'Growth' && <Growth />}
    </>
  );
}
