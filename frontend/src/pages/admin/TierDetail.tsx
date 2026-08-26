/**
 * Tier Details — General (Basis/Description + Partners + Offers panels) and History tabs,
 * matching the reference's layout. Partners panel is searchable/status-filterable (reads the
 * same /members endpoint the "View all" modal on the list page uses). Offers panel lets an
 * admin attach/detach offers to this tier with per-offer Apply Margin / Auto Approve toggles.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Edit2, MoreVertical } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, Table, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import type { PartnerTier, PartnerTierMember, PartnerTierOffer, Offer } from '../../types';

const STATUS_DOT: Record<string, string> = { active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' };

interface HistoryRow { id: string; operationTime: string; service: string; changes: string; employee: string | null; method: string; portal: string; userIp: string | null }

function OfferLinkModal({ tierId, existing, onClose, onSaved }: { tierId: string; existing: PartnerTierOffer | null; onClose: () => void; onSaved: () => void }) {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [offerId, setOfferId] = useState(existing?.offerId ?? '');
  const [applyMargin, setApplyMargin] = useState(existing?.applyMargin ?? true);
  const [autoApprove, setAutoApprove] = useState(existing?.autoApprovePartners ?? true);
  const save = useMutation((body: Record<string, unknown>) => api.put<{ linked: boolean }>(`/api/partner-tiers/${tierId}/offers`, body));

  const submit = async () => {
    if (!offerId) return;
    const res = await save.run({ offerId, applyMargin, autoApprovePartners: autoApprove });
    if (res) { onSaved(); onClose(); }
  };

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit Offer' : 'Add Offer'}>
      <div className="space-y-4">
        {save.error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{save.error}</p>}
        <Field label="Offer *">
          <select className="input" required disabled={Boolean(existing)} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="" disabled>Select Offer…</option>
            {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-small text-fg">
          <input type="checkbox" className="chk" checked={applyMargin} onChange={(e) => setApplyMargin(e.target.checked)} /> Apply Margin
        </label>
        <label className="flex items-center gap-2 text-small text-fg">
          <input type="checkbox" className="chk" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} /> Automatically Approve Partners
        </label>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={save.busy || !offerId} onClick={submit}>{save.busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

function OffersPanel({ tierId }: { tierId: string }) {
  const { data, loading, refetch } = useQuery<PartnerTierOffer[]>(`/api/partner-tiers/${tierId}/offers`);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PartnerTierOffer | null | undefined>(undefined);
  const del = useMutation((offerId: string) => api.del(`/api/partner-tiers/${tierId}/offers/${offerId}`));
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const rows = (data ?? []).filter((o) => !q.trim() || o.offerName.toLowerCase().includes(q.trim().toLowerCase()));

  const doRemove = async (o: PartnerTierOffer) => {
    setOpenMenuId(null);
    if (!confirm(`Remove "${o.offerName}" from this tier?`)) return;
    if (await del.run(o.offerId)) refetch();
  };

  const columns: Column<PartnerTierOffer>[] = [
    { header: 'ID', cell: (o) => o.offerRef ?? o.offerId.slice(0, 8) },
    { header: 'Name', cell: (o) => <Link to={`/app/offers/${o.offerId}`} className="text-accent-text hover:underline">{o.offerName}</Link> },
    { header: 'Apply Margin', cell: (o) => <span className={o.applyMargin ? 'text-success' : 'text-danger-text'}>{o.applyMargin ? 'YES' : 'NO'}</span> },
    { header: 'Automatically Approve Partners', cell: (o) => <span className={o.autoApprovePartners ? 'text-success' : 'text-danger-text'}>{o.autoApprovePartners ? 'YES' : 'NO'}</span> },
    {
      header: '', className: 'text-right', cell: (o) => (
        <div className="relative inline-block">
          <button title="Actions" onClick={() => setOpenMenuId(openMenuId === o.offerId ? null : o.offerId)}
            className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
          {openMenuId === o.offerId && (
            <div className="absolute right-0 top-full z-30 mt-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
              <button onClick={() => { setOpenMenuId(null); setEditing(o); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Edit</button>
              <button onClick={() => doRemove(o)} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-accent-subtle">Remove</button>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-h3 font-medium text-fg">Offers</h3>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>+ Add/Edit</button>
          <input className="input !w-48" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : rows.length === 0 ? <StateBlock>No offers linked to this tier.</StateBlock>
        : <Table columns={columns} rows={rows} rowKey={(o) => o.id} />}
      {editing !== undefined && <OfferLinkModal tierId={tierId} existing={editing} onClose={() => setEditing(undefined)} onSaved={refetch} />}
    </div>
  );
}

function PartnersPanel({ tierId }: { tierId: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const { data, loading } = useQuery<PartnerTierMember[]>(`/api/partner-tiers/${tierId}/members?status=${status}&search=${encodeURIComponent(q)}`);
  const columns: Column<PartnerTierMember>[] = [
    { header: 'ID', cell: (p) => p.ref ?? p.id.slice(0, 8) },
    { header: 'Name', cell: (p) => <Link to={`/app/publishers/${p.id}`} className="text-accent-text hover:underline">{p.name}</Link> },
  ];
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2">
        <input className="input flex-1" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : !data || data.length === 0 ? <StateBlock>No partners.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(p) => p.id} />}
    </div>
  );
}

function GeneralTab({ tier }: { tier: PartnerTier }) {
  const [sub, setSub] = useState<'basis' | 'description'>('basis');
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-h3 font-medium text-fg">General</h3>
          <Link to={`/app/aff-tiers/${tier.id}/edit`} className="inline-flex items-center gap-1.5 text-small text-accent-text hover:underline">
            <Edit2 size={13} /> Edit
          </Link>
        </div>
        <div className="mb-3 flex gap-1 border-b border-border text-tiny">
          <button onClick={() => setSub('basis')} className={`-mb-px border-b-2 px-2 py-1.5 font-medium ${sub === 'basis' ? 'border-accent text-accent-text' : 'border-transparent text-fg-secondary'}`}>Basis</button>
          <button onClick={() => setSub('description')} className={`-mb-px border-b-2 px-2 py-1.5 font-medium ${sub === 'description' ? 'border-accent text-accent-text' : 'border-transparent text-fg-secondary'}`}>Description</button>
        </div>
        {sub === 'basis' ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-small">
            <div><p className="text-tiny text-fg-secondary">ID</p><p className="text-fg">{tier.id.slice(0, 8)}</p></div>
            <div><p className="text-tiny text-fg-secondary">Status</p><p className="inline-flex items-center gap-1.5 text-fg"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[tier.status]}`} />{tier.status}</p></div>
            <div><p className="text-tiny text-fg-secondary">Name</p><p className="text-fg">{tier.name}</p></div>
            <div><p className="text-tiny text-fg-secondary">Modified</p><p className="text-fg">{new Date(tier.updatedAt).toLocaleString()}</p></div>
            <div><p className="text-tiny text-fg-secondary">Margin</p><p className="text-fg">{tier.marginPct}%</p></div>
            <div><p className="text-tiny text-fg-secondary">Created</p><p className="text-fg">{new Date(tier.createdAt).toLocaleString()}</p></div>
            <div className="col-span-2"><p className="text-tiny text-fg-secondary">Labels</p>
              <p className="text-fg">{tier.labels.length ? tier.labels.map((l) => <span key={l} className="mr-1 inline-block rounded-full bg-accent-subtle px-2 py-0.5 text-tiny text-accent-text">{l}</span>) : '—'}</p>
            </div>
          </div>
        ) : (
          <p className="text-small text-fg">{tier.description || <span className="text-fg-muted">No description.</span>}</p>
        )}
      </div>
      <PartnersPanel tierId={tier.id} />
      <div className="lg:col-span-2"><OffersPanel tierId={tier.id} /></div>
    </div>
  );
}

function HistoryTab({ tierId }: { tierId: string }) {
  const { data, loading, error } = useQuery<HistoryRow[]>(`/api/partner-tiers/${tierId}/history`);
  const columns: Column<HistoryRow>[] = [
    { header: 'Operation Time', cell: (r) => new Date(r.operationTime).toLocaleString() },
    { header: 'Changes', cell: (r) => r.changes },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => r.userIp ?? '—' },
  ];
  return loading ? <StateBlock><Spinner /></StateBlock>
    : error ? <StateBlock>{error}</StateBlock>
    : !data || data.length === 0 ? <StateBlock>No changes recorded yet.</StateBlock>
    : <div className="card"><Table columns={columns} rows={data} rowKey={(r) => r.id} /></div>;
}

export default function TierDetail() {
  const { id } = useParams();
  const { data: tier, loading, error } = useQuery<PartnerTier>(`/api/partner-tiers/${id}`);
  const [tab, setTab] = useState('General');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !tier) return <StateBlock>{error ?? 'Tier not found.'}</StateBlock>;

  return (
    <>
      <PageHeader title={`Tier Details: ${tier.name}`} subtitle={`Partners › Tiers › ${tier.name} › Details`} />
      <Tabs tabs={['General', 'History']} active={tab} onChange={setTab} />
      {tab === 'General' ? <GeneralTab tier={tier} /> : <HistoryTab tierId={tier.id} />}
    </>
  );
}
