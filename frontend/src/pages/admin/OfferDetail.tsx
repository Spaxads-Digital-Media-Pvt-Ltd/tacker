import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Badge, Spinner, StateBlock, Field, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';
import type { Offer, Publisher, Advertiser, TrackingDomain } from '../../types';
import type { Tone } from '../../lib/tones';

type Row = { id: string; [k: string]: unknown };
type EditKind = 'goals' | 'access' | 'creatives' | 'coupons' | 'deals' | 'geo' | 'tags';

export default function OfferDetail() {
  const { id = '' } = useParams();
  const base = `/api/offers/${id}`;
  const { data: offer, loading, error, refetch } = useQuery<Offer>(base);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !offer) return <StateBlock>{error ?? 'Offer not found'}</StateBlock>;

  const advName = advertisers?.find((a) => a.id === offer.advertiserId)?.name ?? offer.advertiserId;
  return (
    <>
      <PageHeader
        title={offer.name}
        subtitle={`${offer.status} · ${offer.payoutModel} · ${offer.currency}`}
        action={<Link to="/app/offers" className="btn-ghost">← All offers</Link>}
      />
      <OfferOverview offer={offer} advName={advName} publishers={publishers ?? []} domains={domains ?? []} onSaved={refetch} />
    </>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <div className="min-h-[44px] flex-1 break-all rounded-[var(--radius)] border border-border bg-subtle px-3 py-2 font-mono text-small ">
        {value || <span className="text-fg-muted">Select an affiliate to generate the link…</span>}
      </div>
      <button type="button" disabled={!value} onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="btn-ghost shrink-0 ">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-2 text-small">
      <dt className="w-32 shrink-0 text-fg-secondary ">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-medium text-fg">{children}</dd>
    </div>
  );
}

// Calmer than a gradient banner (Section 0): a thin colored top rule + a tinted icon chip, matching
// the StatCards idiom instead of the old dated gradient-header treatment.
type SectionTone = 'blue' | 'green' | 'orange' | 'red' | 'slate';
const HEADER: Record<SectionTone, Tone> = {
  blue: 'blue', green: 'teal', orange: 'amber', red: 'rose', slate: 'violet',
};
const TOP_RULE: Record<Tone, string> = {
  teal: 'bg-teal-500', blue: 'bg-sky-500', amber: 'bg-amber-500', violet: 'bg-violet-500', rose: 'bg-rose-500',
};
function SectionCard({ tone, icon, title, action, children }: { tone: SectionTone; icon: string; title: string; action?: ReactNode; children: ReactNode }) {
  const t = HEADER[tone];
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card ">
      <div className={`h-1 w-full ${TOP_RULE[t]}`} />
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h3 className="flex items-center gap-2 font-display text-h3 font-semibold text-fg"><span>{icon}</span>{title}</h3>
        {action}
      </div>
      <div className="p-5 ">{children}</div>
    </div>
  );
}
const headerBtn = (label: string, onClick: () => void) => (
  <button onClick={onClick} className="btn-ghost !px-3 !py-1.5 text-tiny">{label}</button>
);

/** Wide modal that hosts an edit surface (a CollectionTab) inline on the card. Closes on Esc. */
function EditModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fg/25 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated " onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-h3 font-semibold text-fg">{title}</h2>
          <button className="text-fg-muted hover:text-fg " onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Main overview: trackog-style card grid + inline edit modals ───────────────
function OfferOverview({ offer, advName, publishers, domains, onSaved }: {
  offer: Offer; advName: string; publishers: Publisher[]; domains: TrackingDomain[]; onSaved: () => void;
}) {
  const base = `/api/offers/${offer.id}`;
  const goals = useQuery<Row[]>(`${base}/goals`);
  const geo = useQuery<Row[]>(`${base}/geo-rules`);
  const creatives = useQuery<Row[]>(`${base}/creatives`);
  const access = useQuery<Row[]>(`${base}/publishers`);
  const pubName = (pid: unknown) => publishers.find((p) => p.id === pid)?.name ?? String(pid ?? '—');
  const pubOptions = publishers.map((p) => ({ value: p.id, label: p.name }));

  const [edit, setEdit] = useState<EditKind | null>(null);
  const closeEdit = () => { setEdit(null); goals.refetch(); geo.refetch(); creatives.refetch(); access.refetch(); onSaved(); };

  // ── Tracking link (auto-generated on affiliate select) ──
  const activeDomains = domains.filter((d) => d.status === 'active');
  const primary = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const [pubId, setPubId] = useState('');
  const [opts, setOpts] = useState({ param: false, changeDomain: false, source: false, deeplink: false });
  const [vals, setVals] = useState({ domain: '', sub1: '', source: '', deeplink: '' });
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const domainHost = (opts.changeDomain && vals.domain) ? vals.domain : primary?.host ?? 'your-tracking-domain.com';
  // Local dev: point at the local tracking surface so the link is directly testable (port stripped by resolver).
  const trackBase = isLocal ? 'http://localhost:4002' : `https://${domainHost}`;
  const link = useMemo(() => {
    if (!pubId) return '';
    const p = new URLSearchParams({ offer_id: offer.id, pub_id: pubId });
    if (opts.param && vals.sub1) p.set('sub1', vals.sub1);
    if (opts.source && vals.source) p.set('source', vals.source);
    if (opts.deeplink && vals.deeplink) p.set('deeplink', vals.deeplink);
    return `${trackBase}/click?${p.toString()}`;
  }, [pubId, opts, vals, trackBase, offer.id]);

  // ── Per-offer postback secure_code (overrides the network-wide code) ──
  const regenCode = useMutation(() => api.post<{ securityCode: string }>(`${base}/security-code/regenerate`));
  const clearCode = useMutation(() => api.del(`${base}/security-code`));
  const [codeOverride, setCodeOverride] = useState<string | null | undefined>(undefined);
  const offerCode = codeOverride !== undefined ? codeOverride : (offer.securityCode ?? null);
  const regenerateCode = async () => { const r = await regenCode.run(undefined); if (r) setCodeOverride(r.securityCode); };
  const removeCode = async () => { if (await clearCode.run(undefined)) setCodeOverride(null); };
  const postback = `${trackBase}/postback?click_id={click_id}&txn_id={txn_id}&secure_code=${offerCode ?? '{secure_code}'}`;

  // ── Notes (persisted in offer.metadata.notes) ──
  const [note, setNote] = useState('');
  const saveNotes = useMutation((notes: string[]) => api.patch(base, { notes }));
  const notes = offer.notes ?? [];
  const addNote = async () => { if (note.trim() && await saveNotes.run([...notes, note.trim()])) { setNote(''); onSaved(); } };
  const removeNote = async (i: number) => { if (await saveNotes.run(notes.filter((_, j) => j !== i))) onSaved(); };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Details */}
      <SectionCard tone="blue" icon="📄" title="Details">
        <dl className="divide-y divide-border ">
          <DetailRow label="Title">{offer.name}</DetailRow>
          <DetailRow label="ID"><span className="font-mono tabular-nums font-semibold">{offer.ref ?? '—'}</span></DetailRow>
          <DetailRow label="Objective"><span className="capitalize">{offer.objective ?? offer.payoutModel}</span></DetailRow>
          <DetailRow label="Visibility"><span className="capitalize">{offer.visibility ?? 'public'}</span></DetailRow>
          <DetailRow label="Advertiser"><span className="text-accent ">{advName}</span></DetailRow>
          <DetailRow label="Status"><Badge value={offer.status} /></DetailRow>
          <DetailRow label="Created">{new Date(offer.createdAt).toLocaleString()}</DetailRow>
          <DetailRow label="Unique ID"><span className="font-mono text-tiny">{offer.id}</span></DetailRow>
          <DetailRow label="Currency">{offer.currency}</DetailRow>
          <DetailRow label="Preview URL">{offer.previewUrl ?? '—'}</DetailRow>
          <DetailRow label="Destination URL"><span className="break-all font-mono text-tiny text-accent ">{offer.destinationUrl}</span></DetailRow>
          <DetailRow label="Description">{offer.description ?? '—'}</DetailRow>
        </dl>
      </SectionCard>

      {/* Tracking Link — auto-generates on affiliate select */}
      <SectionCard tone="green" icon="🔗" title="Tracking Link" action={headerBtn('Manage Links', () => setEdit('access'))}>
        <p className="mb-2 text-small font-semibold text-fg">Choose any affiliate to generate its tracking link</p>
        <select className="input" value={pubId} onChange={(e) => setPubId(e.target.value)}>
          <option value="">Search Affiliate…</option>
          {publishers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {isLocal && <p className="mt-1 text-tiny text-warning-text">Local mode: link points at http://localhost:4002 so you can test clicks locally.</p>}
        <div className="mt-4">
          <p className="label">Generated Link</p>
          <CopyBox value={link} />
        </div>
        <div className="mt-4 rounded-[var(--radius)] border border-border p-4 ">
          <p className="mb-3 text-small font-semibold text-fg">Tracking Options</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="chk" checked={opts.param} onChange={() => toggle('param')} /> Add Tracking Param</label>
            <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="chk" checked={opts.changeDomain} onChange={() => toggle('changeDomain')} /> Change Tracking Domain</label>
            <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="chk" checked={opts.source} onChange={() => toggle('source')} /> Add Source (Sub Affiliate)</label>
            <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="chk" checked={opts.deeplink} onChange={() => toggle('deeplink')} /> Add DeepLink</label>
          </div>
          {(opts.param || opts.changeDomain || opts.source || opts.deeplink) && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {opts.param && <Field label="Sub1"><input className="input" value={vals.sub1} onChange={(e) => setVals((v) => ({ ...v, sub1: e.target.value }))} placeholder="campaign123" /></Field>}
              {opts.changeDomain && <Field label="Tracking domain"><select className="input" value={vals.domain} onChange={(e) => setVals((v) => ({ ...v, domain: e.target.value }))}><option value="">{primary?.host ?? 'default'}</option>{activeDomains.map((d) => <option key={d.id} value={d.host}>{d.host}</option>)}</select></Field>}
              {opts.source && <Field label="Source"><input className="input" value={vals.source} onChange={(e) => setVals((v) => ({ ...v, source: e.target.value }))} placeholder="sub-affiliate" /></Field>}
              {opts.deeplink && <Field label="DeepLink"><input className="input" value={vals.deeplink} onChange={(e) => setVals((v) => ({ ...v, deeplink: e.target.value }))} placeholder="https://app/deeplink" /></Field>}
            </div>
          )}
        </div>
      </SectionCard>

      {/* Postback & Security */}
      <SectionCard tone="red" icon="🔒" title="Postback & Security">
        <p className="label">Postback URL (advertiser fires this on conversion)</p>
        <CopyBox value={postback} />
        <div className="mt-4 rounded-[var(--radius)] border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-small font-semibold text-fg">Security code (secure_code)</p>
            <div className="flex gap-2">
              <button className="btn-ghost !px-3 !py-1 text-tiny" disabled={regenCode.busy} onClick={regenerateCode}>{regenCode.busy ? '…' : offerCode ? 'Regenerate' : 'Generate'}</button>
              {offerCode && <button className="btn-ghost !px-3 !py-1 text-tiny text-danger-text hover:bg-danger-bg" disabled={clearCode.busy} onClick={removeCode}>Remove</button>}
            </div>
          </div>
          {offerCode ? (
            <p className="mt-2 break-all rounded-[var(--radius)] border border-border bg-subtle px-3 py-2 font-mono text-tiny">{offerCode}</p>
          ) : (
            <p className="mt-2 text-tiny text-fg-secondary">No offer-specific code — this offer uses the network global security code (if set). Generate one to require a per-offer <span className="font-mono">secure_code</span> on postbacks.</p>
          )}
        </div>
      </SectionCard>

      {/* Settings */}
      <SectionCard tone="orange" icon="⚙️" title="Settings">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-border p-4 "><p className="text-tiny uppercase text-fg-muted">Landing Pages</p><p className="mt-1 text-small text-fg">Not set</p></div>
          <div className="rounded-[var(--radius)] border border-border p-4 "><p className="text-tiny uppercase text-fg-muted">Retargeting Tags</p><p className="mt-1 text-small text-fg">Not set</p></div>
          <div className="rounded-[var(--radius)] border border-border p-4 "><p className="text-tiny uppercase text-fg-muted">Cap Management</p><p className="mt-1 text-small text-fg">{offer.attributionWindowS ? 'Configured' : 'Not set'}</p></div>
          <div className="rounded-[var(--radius)] border border-border p-4 ">
            <p className="text-tiny uppercase text-fg-muted">Traffic Distribution</p>
            <p className="mt-1 text-small text-fg"><span className="text-fg-muted">Redirect type</span> <b>302</b></p>
            <p className="text-small text-fg"><span className="text-fg-muted">Tracking method</span> <b>Postback</b></p>
            <p className="text-small text-fg"><span className="text-fg-muted">Allow fallback</span> <b>Yes</b></p>
          </div>
        </div>
      </SectionCard>

      {/* Payouts & Goals */}
      <SectionCard tone="green" icon="💲" title="Payouts & Goals" action={headerBtn('Edit', () => setEdit('goals'))}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-small text-fg">
            <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-2">Goal</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">Payout</th><th className="py-2 pl-4">Currency</th></tr></thead>
            <tbody className="divide-y divide-border ">
              <tr><td className="py-2 font-medium">Default</td><td className="py-2 text-right">{offer.defaultRevenue}</td><td className="py-2 text-right">{offer.defaultPayout}</td><td className="py-2 pl-4">{offer.currency}</td></tr>
              {(goals.data ?? []).map((g) => (
                <tr key={g.id}><td className="py-2 font-medium">{String(g.name)}</td><td className="py-2 text-right">{String(g.revenue)}</td><td className="py-2 text-right">{String(g.payout)}</td><td className="py-2 pl-4">{String(g.currency)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Targeting */}
      <SectionCard tone="orange" icon="🎯" title="Targeting" action={headerBtn('Edit', () => setEdit('geo'))}>
        {geo.loading ? <Spinner /> : !geo.data || geo.data.length === 0 ? <p className="text-small text-fg-secondary">No targeting rules. Traffic from all geos is allowed.</p> : (
          <div className="overflow-x-auto">
            <p className="mb-2 text-small font-semibold text-fg">Rule Block: <span className="text-accent">Country Rule</span> <span className="text-tiny text-fg-muted">Event: ALL</span></p>
            <table className="w-full min-w-[420px] text-left text-small text-fg">
              <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-2">Variable</th><th className="py-2">Logic</th><th className="py-2">Condition</th><th className="py-2">Value</th></tr></thead>
              <tbody className="divide-y divide-border ">
                {geo.data.map((r) => (<tr key={r.id}><td className="py-2">COUNTRY</td><td className="py-2 uppercase">{String(r.action)}</td><td className="py-2">CONTAINS</td><td className="py-2">{String(r.country)}</td></tr>))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Conversion Tracking */}
      <SectionCard tone="red" icon="📈" title="Conversion Tracking">
        <p className="mb-2 text-small font-semibold text-fg">Generated Postback</p>
        <CopyBox value={postback} />
        <p className="mt-3 text-tiny text-fg-secondary">The advertiser fires this postback on conversion, substituting the click id.</p>
      </SectionCard>

      {/* Notes */}
      <SectionCard tone="slate" icon="🗒️" title="Notes">
        <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
        <button className="btn-primary mt-2" disabled={saveNotes.busy || !note.trim()} onClick={addNote}>+ Add Note</button>
        {saveNotes.error && <p className="mt-2 text-small text-danger-text">{saveNotes.error}</p>}
        <div className="mt-4 space-y-2">
          {notes.length === 0 ? <p className="text-small text-fg-muted">No notes added yet.</p> : notes.map((n, i) => (
            <div key={i} className="flex items-start justify-between gap-2 rounded-[var(--radius)] border border-border p-3 text-small ">
              <span className="min-w-0 break-words text-fg">{n}</span>
              <button className="shrink-0 text-fg-muted hover:text-danger-text" onClick={() => removeNote(i)}>×</button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Block Affiliates */}
      <SectionCard tone="red" icon="🛡️" title="Block Affiliates" action={headerBtn('Manage', () => setEdit('access'))}>
        <p className="mb-2 text-small font-semibold text-fg">Currently Blocked Affiliates ({(access.data ?? []).filter((a) => a.access === 'deny').length})</p>
        {(access.data ?? []).filter((a) => a.access === 'deny').length === 0
          ? <p className="text-small text-fg-secondary">No affiliates are currently blocked from this offer.</p>
          : <ul className="space-y-1 text-small text-fg">{(access.data ?? []).filter((a) => a.access === 'deny').map((a) => <li key={a.id}>{pubName(a.publisherId)}</li>)}</ul>}
        <p className="mt-3 rounded-[var(--radius)] bg-danger-bg p-3 text-tiny text-danger-text ">Blocked affiliates cannot access this offer. Traffic from their tracking links is rejected.</p>
      </SectionCard>

      {/* Creatives */}
      <SectionCard tone="blue" icon="🖼️" title="Creatives" action={headerBtn('+ Add', () => setEdit('creatives'))}>
        {creatives.loading ? <Spinner /> : !creatives.data || creatives.data.length === 0 ? <p className="text-small text-fg-secondary">No creatives yet.</p> : (
          <ul className="divide-y divide-border text-small ">
            {creatives.data.map((c) => <li key={c.id} className="flex justify-between py-2"><span className="font-medium text-fg">{String(c.name)}</span><span className="text-fg-muted">{String(c.type)}</span></li>)}
          </ul>
        )}
      </SectionCard>

      {/* Coupon Codes */}
      <SectionCard tone="slate" icon="🎟️" title="Coupon Codes" action={headerBtn('Edit', () => setEdit('coupons'))}>
        <p className="text-small text-fg-secondary">Manage coupon codes for this offer.</p>
      </SectionCard>

      {/* Deals */}
      <SectionCard tone="slate" icon="🏷️" title="Deals" action={headerBtn('Edit', () => setEdit('deals'))}>
        <p className="text-small text-fg-secondary">Payout boosts and promotions for this offer.</p>
      </SectionCard>

      {/* Tags */}
      <SectionCard tone="slate" icon="🔖" title="Tags" action={headerBtn('Edit', () => setEdit('tags'))}>
        <p className="text-small text-fg-secondary">Label this offer for filtering and grouping.</p>
      </SectionCard>

      {/* ── Edit modals (open on the card, not a top tab) ── */}
      {edit && <EditModal title={EDIT_TITLES[edit]} onClose={closeEdit}>{editContent(edit, base, pubOptions, pubName)}</EditModal>}
    </div>
  );
}

// ── Edit surfaces (reuse CollectionTab) ───────────────────────────────────────
const EDIT_TITLES: Record<EditKind, string> = {
  goals: 'Goals', access: 'Affiliate Access', creatives: 'Creatives',
  coupons: 'Coupon Codes', deals: 'Deals', geo: 'Geo Rules / Targeting', tags: 'Tags',
};

function editContent(kind: EditKind, base: string, pubOptions: { value: string; label: string }[], pubName: (id: unknown) => string) {
  const col = (header: string, cell: (r: Row) => ReactNode, className?: string): Column<Row> => ({ header, cell, ...(className ? { className } : {}) });
  switch (kind) {
    case 'goals':
      return <CollectionTab basePath={`${base}/goals`} addLabel="Add goal" editable emptyText="No goals yet."
        fields={[
          { key: 'name', label: 'Goal name', required: true, placeholder: 'Purchase' },
          { key: 'eventName', label: 'Event name (postback ?event=)', placeholder: 'purchase' },
          { key: 'payoutModel', label: 'Payout model', type: 'select', options: ['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'], default: 'CPA' },
          { key: 'payout', label: 'Payout', type: 'money', default: '0' },
          { key: 'revenue', label: 'Revenue', type: 'money', default: '0' },
          { key: 'isDefault', label: 'Default goal', type: 'checkbox' },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
        ] as FieldDef[]}
        columns={[col('Goal', (r) => String(r.name)), col('Event', (r) => String(r.eventName ?? '—')), col('Payout', (r) => String(r.payout)), col('Revenue', (r) => String(r.revenue))]} />;
    case 'access':
      return <CollectionTab basePath={`${base}/publishers`} addLabel="Grant access" emptyText="No affiliate access rules."
        fields={[
          { key: 'publisherId', label: 'Affiliate', type: 'select', options: pubOptions, required: true },
          { key: 'access', label: 'Access', type: 'select', options: ['allow', 'deny'], default: 'allow' },
          { key: 'approvalStatus', label: 'Approval', type: 'select', options: ['approved', 'pending', 'rejected'], default: 'approved' },
          { key: 'payoutOverride', label: 'Payout override', type: 'money' },
        ] as FieldDef[]}
        columns={[col('Affiliate', (r) => pubName(r.publisherId)), col('Access', (r) => String(r.access)), col('Approval', (r) => String(r.approvalStatus)), col('Payout override', (r) => String(r.payoutOverride ?? '—'))]} />;
    case 'creatives':
      return <CollectionTab basePath={`${base}/creatives`} addLabel="Add creative" editable emptyText="No creatives."
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'type', label: 'Type', type: 'select', options: ['image', 'html', 'link', 'email', 'video'], default: 'image' },
          { key: 'url', label: 'Asset URL', type: 'url' },
          { key: 'html', label: 'HTML / snippet', type: 'textarea' },
          { key: 'width', label: 'Width', type: 'number' },
          { key: 'height', label: 'Height', type: 'number' },
        ] as FieldDef[]}
        columns={[col('Name', (r) => String(r.name)), col('Type', (r) => String(r.type)), col('Size', (r) => (r.width ? `${r.width}×${r.height}` : '—'))]} />;
    case 'coupons':
      return <CollectionTab basePath={`${base}/coupons`} addLabel="Add coupon" editable emptyText="No coupon codes."
        fields={[
          { key: 'code', label: 'Code', required: true, placeholder: 'SAVE20' },
          { key: 'discount', label: 'Discount', placeholder: '20% off' },
          { key: 'publisherId', label: 'Assign to affiliate (optional)', type: 'select', options: pubOptions },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'expired', 'disabled'], default: 'active' },
        ] as FieldDef[]}
        columns={[col('Code', (r) => String(r.code)), col('Discount', (r) => String(r.discount ?? '—')), col('Status', (r) => String(r.status))]} />;
    case 'deals':
      return <CollectionTab basePath={`${base}/deals`} addLabel="Add deal" editable emptyText="No deals."
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'dealType', label: 'Type', type: 'select', options: ['payout_boost', 'flat_bonus', 'custom'], default: 'payout_boost' },
          { key: 'value', label: 'Value', type: 'money' },
          { key: 'status', label: 'Status', type: 'select', options: ['active', 'scheduled', 'ended'], default: 'active' },
        ] as FieldDef[]}
        columns={[col('Deal', (r) => String(r.name)), col('Type', (r) => String(r.dealType)), col('Value', (r) => String(r.value ?? '—')), col('Status', (r) => String(r.status))]} />;
    case 'geo':
      return <CollectionTab basePath={`${base}/geo-rules`} addLabel="Add geo rule" emptyText="No geo rules."
        fields={[
          { key: 'country', label: 'Country (ISO-2 or *)', required: true, placeholder: 'US' },
          { key: 'action', label: 'Action', type: 'select', options: ['allow', 'deny'], default: 'allow' },
          { key: 'payoutOverride', label: 'Payout override', type: 'money' },
          { key: 'revenueOverride', label: 'Revenue override', type: 'money' },
          { key: 'destinationOverride', label: 'Destination override', type: 'url' },
        ] as FieldDef[]}
        columns={[col('Country', (r) => String(r.country)), col('Action', (r) => String(r.action)), col('Payout', (r) => String(r.payoutOverride ?? '—'))]} />;
    case 'tags':
      return <CollectionTab basePath={`${base}/tags`} addLabel="Add tag" emptyText="No tags."
        fields={[{ key: 'name', label: 'Tag name', required: true }, { key: 'color', label: 'Color', placeholder: '#3b82f6' }] as FieldDef[]}
        columns={[col('Tag', (r) => String(r.name)), col('Color', (r) => String(r.color ?? '—'))]} />;
  }
}
