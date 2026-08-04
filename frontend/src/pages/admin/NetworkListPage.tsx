/**
 * Network-wide catalog lists (top-level section pages): Creatives, Coupon Codes, Deals, Affiliate
 * Access, Postbacks — each aggregates across offers/publishers via /api/catalog/*. Prop-driven so
 * one component serves all five routes.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Table, StatusDot, Spinner, StateBlock, Field, type Column } from '../../components/ui';

type Row = Record<string, unknown>;
type Kind = 'creatives' | 'coupons' | 'deals' | 'access' | 'postbacks';

const off = (r: Row) => <Link to={`/app/offers/${r['offer_id']}`} className="text-brand-600 hover:underline ">{String(r['offer_name'] ?? '—')}</Link>;
const badge = (r: Row, k: string) => <StatusDot value={String(r[k] ?? '')} />;

const CONFIG: Record<Kind, { title: string; subtitle: string; columns: Column<Row>[] }> = {
  creatives: {
    title: 'Creatives', subtitle: 'All creative assets across your offers.',
    columns: [
      { header: 'Title', cell: (r) => <span className="font-medium">{String(r['name'])}</span> },
      { header: 'Offer', cell: off },
      { header: 'Type', cell: (r) => String(r['type']) },
      { header: 'Size', cell: (r) => (r['width'] ? `${r['width']}×${r['height']}` : '—') },
      { header: 'Status', cell: (r) => badge(r, 'status') },
    ],
  },
  coupons: {
    title: 'Coupon Codes', subtitle: 'All coupon codes across your offers.',
    columns: [
      { header: 'Code', cell: (r) => <span className="font-mono font-medium">{String(r['code'])}</span> },
      { header: 'Discount', cell: (r) => String(r['discount'] ?? '—') },
      { header: 'Offer', cell: off },
      { header: 'Status', cell: (r) => badge(r, 'status') },
    ],
  },
  deals: {
    title: 'Deals', subtitle: 'Payout boosts and promotions across your offers.',
    columns: [
      { header: 'Deal', cell: (r) => <span className="font-medium">{String(r['name'])}</span> },
      { header: 'Type', cell: (r) => String(r['deal_type']) },
      { header: 'Value', cell: (r) => String(r['value'] ?? '—') },
      { header: 'Offer', cell: off },
      { header: 'Status', cell: (r) => badge(r, 'status') },
    ],
  },
  access: {
    title: 'Affiliate Access', subtitle: 'Affiliate access grants across all offers.',
    columns: [
      { header: 'Offer', cell: off },
      { header: 'Affiliate', cell: (r) => String(r['publisher_name'] ?? '—') },
      { header: 'Access', cell: (r) => <StatusDot value={r['access'] === 'allow' ? 'active' : 'disabled'} /> },
      { header: 'Approval', cell: (r) => badge(r, 'approval_status') },
      { header: 'Payout override', className: 'text-right', cell: (r) => String(r['payout_override'] ?? '—') },
    ],
  },
  postbacks: {
    title: 'Postbacks & Pixels', subtitle: 'Outbound postback URLs across all affiliates.',
    columns: [
      { header: 'Affiliate', cell: (r) => String(r['publisher_name'] ?? '—') },
      { header: 'Offer', cell: (r) => String(r['offer_name'] ?? 'All') },
      { header: 'Method', cell: (r) => String(r['method']) },
      { header: 'Event', cell: (r) => String(r['event'] ?? 'any') },
      { header: 'Status', cell: (r) => badge(r, 'status') },
      { header: 'URL', cell: (r) => <span className="block max-w-[320px] truncate font-mono text-xs">{String(r['url'])}</span> },
    ],
  },
};

export function NetworkListPage({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const { data, loading, error, refetch } = useQuery<Row[]>(`/api/catalog/${kind}`);
  const [add, setAdd] = useState(false);
  return (
    <>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle}
        action={kind === 'postbacks' ? <button className="btn-primary" onClick={() => setAdd(true)}>+ Add Postback</button> : undefined} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>Nothing here yet.</StateBlock>
        : <Table columns={cfg.columns} rows={data} rowKey={(r) => String(r['id'])} />}
      {add && <AddPostbackModal onClose={() => setAdd(false)} onDone={() => { setAdd(false); refetch(); }} />}
    </>
  );
}

/** Create an outbound postback for an affiliate (optionally scoped to one offer/event). */
function AddPostbackModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const publishers = useQuery<{ id: string; name: string }[]>('/api/publishers');
  const offers = useQuery<{ id: string; name: string }[]>('/api/offers');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [form, setForm] = useState({ publisherId: '', offerId: '', event: '', method: 'GET', url: 'https://example.com/pb?cid={click_id}&payout={payout}&txn={txn_id}' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, busy, error } = useMutation((body: { pid: string; payload: Record<string, unknown> }) =>
    api.post(`/api/publishers/${body.pid}/postbacks`, body.payload));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.publisherId) return;
    const payload: Record<string, unknown> = { url: form.url, method: form.method };
    if (form.offerId) payload['offerId'] = form.offerId;
    if (form.event) payload['event'] = form.event;
    if (await run({ pid: form.publisherId, payload })) onDone();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-elevated " onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-h3 font-semibold text-fg">Add Postback</h2>
        <p className="mt-1 text-xs text-fg-secondary">Fires to the affiliate on an approved conversion. Use macros like {'{click_id}'}, {'{payout}'}, {'{txn_id}'}.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <Field label="Affiliate">
            <select className="input" required value={form.publisherId} onChange={set('publisherId')}>
              <option value="" disabled>Select affiliate…</option>
              {(publishers.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Offer (optional — blank = all offers)">
            <select className="input" value={form.offerId} onChange={set('offerId')}>
              <option value="">All offers</option>
              {(offers.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Event (optional)"><input className="input" value={form.event} onChange={set('event')} placeholder="purchase" /></Field>
            <Field label="Method"><select className="input" value={form.method} onChange={set('method')}><option>GET</option><option>POST</option></select></Field>
          </div>
          <Field label="Postback URL (with macros)"><input className="input font-mono text-sm" required value={form.url} onChange={set('url')} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add Postback'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
