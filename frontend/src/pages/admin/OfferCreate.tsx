import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import type { Advertiser } from '../../types';

const OBJECTIVES = [
  { key: 'conversions', label: 'Conversions', hint: 'Available for any conversion type.' },
  { key: 'sale', label: 'Sale', hint: 'For sale offers, quick rev-share model.' },
  { key: 'app_installs', label: 'App Installs', hint: 'Install acts as the default goal.' },
  { key: 'leads', label: 'Leads', hint: 'For lead generation offers.' },
  { key: 'impressions', label: 'Impressions', hint: 'For impression-based offers.' },
  { key: 'clicks', label: 'Clicks', hint: 'Best for pay-per-click offers.' },
] as const;

const MACROS = ['{click_id}', '{offer_id}', '{aff_id}', '{source}', '{sub1}', '{sub2}'];
const DEVICES = ['All', 'Desktop', 'Mobile', 'Tablet'];

export default function OfferCreate() {
  const nav = useNavigate();
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const urlRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    objective: 'conversions', advertiserId: '', name: '', destinationUrl: '', previewUrl: '',
    payoutModel: 'CPA', currency: 'USD', defaultRevenue: '', defaultPayout: '',
    category: '', visibility: 'public', status: 'active', device: 'All',
    description: '', kpi: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/offers', body));

  const insertMacro = (m: string) => {
    const el = urlRef.current;
    const cur = form.destinationUrl;
    const pos = el?.selectionStart ?? cur.length;
    set('destinationUrl', cur.slice(0, pos) + m + cur.slice(pos));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      objective: form.objective, advertiserId: form.advertiserId, name: form.name,
      destinationUrl: form.destinationUrl, payoutModel: form.payoutModel, currency: form.currency,
      defaultRevenue: form.defaultRevenue || '0', defaultPayout: form.defaultPayout || '0',
      visibility: form.visibility, status: form.status,
      allowedTrafficTypes: form.device === 'All' ? [] : [form.device.toLowerCase()],
    };
    if (form.category) body['category'] = form.category;
    if (form.previewUrl) body['previewUrl'] = form.previewUrl;
    if (form.description) body['description'] = form.description;
    if (form.kpi) body['kpi'] = form.kpi;
    const res = await run(body);
    if (res) nav(`/app/offers/${res.id}`);
  };

  return (
    <>
      <PageHeader title="Create Offer" subtitle="Offers › Create Offer"
        action={<button className="btn-ghost" onClick={() => nav('/app/offers')}>Cancel</button>} />
      <form onSubmit={submit} className="space-y-6 pb-24">
        {error && <p className="rounded-[var(--radius)] bg-danger-bg px-4 py-3 text-small text-danger-text ">{error}</p>}

        {/* Offer Details */}
        <section className="card">
          <h2 className="mb-1 font-display text-h3 font-semibold text-fg">🎯 Offer Details</h2>
          <p className="mb-4 text-small text-fg-secondary">Choose an objective — used by you and affiliates to filter offers.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OBJECTIVES.map((o) => {
              const on = form.objective === o.key;
              return (
                <button type="button" key={o.key} onClick={() => set('objective', o.key)}
                  className={`rounded-[var(--radius)] border p-4 text-left transition-colors ${on ? 'border-accent bg-accent-subtle ' : 'border-border hover:border-fg-muted '}`}>
                  <p className="font-semibold text-fg">{o.label}</p>
                  <p className="mt-1 text-tiny text-fg-secondary">{o.hint}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Advertiser *">
              <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                <option value="" disabled>Search advertiser…</option>
                {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Title *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Offer title" /></Field>
          </div>
          <div className="mt-4">
            <Field label="Advertiser Offer URL *">
              <textarea ref={urlRef} className="input min-h-[64px] font-mono text-small" required value={form.destinationUrl}
                onChange={(e) => set('destinationUrl', e.target.value)} placeholder="https://xyz.domain.com/click/?click_id={click_id}" />
            </Field>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-tiny text-fg-secondary">Macros:</span>
              {MACROS.map((m) => (
                <button type="button" key={m} onClick={() => insertMacro(m)}
                  className="rounded-md bg-subtle px-2 py-0.5 font-mono text-tiny text-fg-secondary hover:bg-accent-subtle hover:text-accent-text ">{m}</button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <Field label="Preview URL"><input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} placeholder="https://…" /></Field>
          </div>
        </section>

        {/* Revenue & Payout */}
        <section className="card">
          <h2 className="mb-4 font-display text-h3 font-semibold text-fg">💲 Revenue &amp; Payout</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Model">
              <select className="input" value={form.payoutModel} onChange={(e) => set('payoutModel', e.target.value)}>
                {['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Currency"><input className="input" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            <Field label="Revenue (you get)"><input className="input" value={form.defaultRevenue} onChange={(e) => set('defaultRevenue', e.target.value)} placeholder="8.00" /></Field>
            <Field label="Payout (affiliate)"><input className="input" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} placeholder="5.00" /></Field>
          </div>
        </section>

        {/* Targeting & meta */}
        <section className="card">
          <h2 className="mb-4 font-display text-h3 font-semibold text-fg">⚙️ Settings &amp; Targeting</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {['active', 'draft', 'paused', 'archived'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Visibility">
              <select className="input" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
                {['public', 'private', 'ask'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Device">
              <select className="input" value={form.device} onChange={(e) => set('device', e.target.value)}>
                {DEVICES.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Category"><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Finance" /></Field>
          </div>
        </section>

        {/* Description & KPI */}
        <section className="card">
          <h2 className="mb-4 font-display text-h3 font-semibold text-fg">📝 Description &amp; KPI</h2>
          <Field label="Description (optional)"><textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detailed description of your offer…" /></Field>
          <div className="mt-4">
            <Field label="KPI (optional)"><textarea className="input min-h-[80px]" value={form.kpi} onChange={(e) => set('kpi', e.target.value)} placeholder="e.g. CR > 2.8%…" /></Field>
          </div>
        </section>

        {/* Sticky action bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-end gap-2 border-t border-border bg-surface/90 px-6 py-3 backdrop-blur md:left-64">
          <button type="button" className="btn-ghost" onClick={() => nav('/app/offers')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : '🎯 Create Offer'}</button>
        </div>
      </form>
    </>
  );
}
