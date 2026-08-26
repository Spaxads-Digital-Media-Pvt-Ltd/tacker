/**
 * Add Offer (Everflow-style 8-step wizard, same step names as OfferEdit.tsx's tabs). Real fields
 * (name, status, advertiserId, category, currency, visibility, destinationUrl, previewUrl,
 * description, payoutModel, defaultRevenue, defaultPayout, allowedTrafficTypes, caps,
 * attribution/dedup windows, fallbackUrl, trackingDomainId) POST to the real /api/offers endpoint
 * on the final step.
 * Creatives can't be attached until the offer exists, so that step just explains that and defers to
 * the Offer Detail page after creation. Email has no equivalent in this app at all.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { Stepper } from '../../components/Stepper';
import type { Advertiser, TrackingDomain } from '../../types';

const STEPS = ['General', 'Tracking & Controls', 'Revenue & Payout (Events)', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'];
const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const STATUS_DOT: Record<string, string> = { draft: 'bg-fg-muted', active: 'bg-success', paused: 'bg-warning', archived: 'bg-danger' };
const VISIBILITIES = ['public', 'private', 'ask'] as const;
const DEVICES = ['desktop', 'mobile', 'tablet'] as const;

function Segmented({ options, value, onChange, dots }: { options: readonly string[]; value: string; onChange: (v: string) => void; dots?: Record<string, string> }) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`flex items-center gap-1.5 px-4 py-2 text-small font-medium capitalize transition-colors ${value === o ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
          {dots && <span className={`h-2 w-2 rounded-full ${dots[o] ?? 'bg-fg-muted'}`} />}
          {o}
        </button>
      ))}
    </div>
  );
}

function YesNoToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${on ? 'text-accent-text' : 'text-fg-secondary'}`}>
      {on ? 'Yes' : 'No'}
      <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-success' : 'bg-border'}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

export default function OfferCreate() {
  const nav = useNavigate();
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    const base = {
      advertiserId: '', name: '', destinationUrl: '', previewUrl: '', trackingDomainId: '',
      payoutModel: 'CPA', currency: 'USD', defaultRevenue: '', defaultPayout: '',
      category: '', visibility: 'public', status: 'active',
      description: '', attributionWindowS: '2592000', dedupWindowS: '86400', fallbackUrl: '',
      allowedTrafficTypes: [] as string[],
    };
    // Offers › Templates "Use Template" hands off its fieldValues this way (same field keys).
    // Read-only here (no sessionStorage.removeItem) — a useState initializer can run twice under
    // StrictMode in dev, and removing the key on the first pass would starve the second.
    const raw = sessionStorage.getItem('offerTemplatePrefill');
    if (raw) {
      try {
        const prefill = JSON.parse(raw) as Record<string, string>;
        const merged: Record<string, unknown> = { ...base };
        for (const k of Object.keys(base)) {
          if (k in prefill && typeof merged[k] === 'string') merged[k] = prefill[k];
        }
        return merged as typeof base;
      } catch { /* ignore malformed prefill */ }
    }
    return base;
  });
  useEffect(() => { sessionStorage.removeItem('offerTemplatePrefill'); }, []);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDevice = (d: string) => set('allowedTrafficTypes', form.allowedTrafficTypes.includes(d) ? form.allowedTrafficTypes.filter((x) => x !== d) : [...form.allowedTrafficTypes, d]);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [dailyClickCap, setDailyClickCap] = useState('');
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
  const [attributionMethod, setAttributionMethod] = useState('Last Touch');
  const [linkingType, setLinkingType] = useState('Redirect Linking');
  const [conversionTrackingMethod, setConversionTrackingMethod] = useState('Server To Server Postback');
  const [suppressionFile, setSuppressionFile] = useState(false);
  const [emailOptOut, setEmailOptOut] = useState(false);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/offers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      advertiserId: form.advertiserId, name: form.name, destinationUrl: form.destinationUrl,
      payoutModel: form.payoutModel, currency: form.currency,
      defaultRevenue: form.defaultRevenue || '0', defaultPayout: form.defaultPayout || '0',
      visibility: form.visibility, status: form.status, allowedTrafficTypes: form.allowedTrafficTypes,
    };
    if (form.category) body.category = form.category;
    if (form.previewUrl) body.previewUrl = form.previewUrl;
    if (form.trackingDomainId) body.trackingDomainId = form.trackingDomainId;
    if (form.description) body.description = form.description;
    if (form.attributionWindowS) body.attributionWindowS = Number(form.attributionWindowS);
    if (form.dedupWindowS) body.dedupWindowS = Number(form.dedupWindowS);
    if (failTrafficEnabled && form.fallbackUrl) body.fallbackUrl = form.fallbackUrl;
    if (capsEnabled && dailyClickCap) body.dailyClickCap = Number(dailyClickCap);
    const res = await run(body);
    if (res) nav(`/app/offers/${res.id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit(e);
  };

  return (
    <>
      <PageHeader title="Add Offer" subtitle="Offers › Add" />
      <div className="max-w-2xl mx-auto">
      <Stepper steps={STEPS} current={step} />
      <form onSubmit={next} className="card space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {step === 0 && (
          <div className="space-y-4">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <label className="label mb-2 block">Status *</label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Advertiser *">
                <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                  <option value="" disabled>Select Advertiser…</option>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <div>
                <label className="label mb-2 block">Thumbnail</label>
                <div className="grid h-[42px] place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Drag and drop or Browse</div>
              </div>
            </div>
            <Field label="Category"><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Fashion" /></Field>
            <Field label="Currency *"><input className="input" maxLength={3} required value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            <div>
              <label className="label mb-2 block">Visibility *</label>
              <Segmented options={VISIBILITIES} value={form.visibility} onChange={(v) => set('visibility', v)} />
            </div>
            <Field label="Labels"><textarea className="input min-h-[60px]" placeholder="Add labels…" /></Field>
            <Field label="App Identifier"><input className="input" /></Field>
            <Field label="Preview URL"><input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} /></Field>
            <Field label="Description"><textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detailed description of your offer…" /></Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-h3 font-medium text-fg">Tracking</h3>
              <Field label="Default Landing Page URL *"><textarea className="input min-h-[80px] font-mono text-tiny" required value={form.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} placeholder="https://xyz.domain.com/click/?click_id={click_id}" /></Field>
              <Field label="Tracking Domain *">
                <select className="input" required value={form.trackingDomainId} onChange={(e) => set('trackingDomainId', e.target.value)}>
                  <option value="" disabled>Select Tracking Domain…</option>
                  {(domains ?? []).map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
                </select>
              </Field>
              <div>
                <label className="label mb-2 block">Linking Type *</label>
                <Segmented options={['Redirect Linking', 'Redirect + Direct Linking']} value={linkingType} onChange={setLinkingType} />
              </div>
              <div>
                <label className="label mb-2 block">Conversion Tracking Method *</label>
                <Segmented options={['Server To Server Postback', 'Javascript SDK', 'HTML Pixel']} value={conversionTrackingMethod} onChange={setConversionTrackingMethod} />
              </div>
            </div>
            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Caps</h3>
              <div>
                <label className="label mb-2 block">Enable Caps</label>
                <YesNoToggle on={capsEnabled} onChange={setCapsEnabled} />
              </div>
              {capsEnabled && <Field label="Daily Click Cap"><input type="number" min={0} className="input" value={dailyClickCap} onChange={(e) => setDailyClickCap(e.target.value)} placeholder="Unlimited" /></Field>}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-h3 font-medium text-fg">Base Revenue &amp; Payout</h3>
            <Field label="Model">
              <select className="input" value={form.payoutModel} onChange={(e) => set('payoutModel', e.target.value)}>
                {['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Revenue Per Action (RPA) *"><input className="input" value={form.defaultRevenue} onChange={(e) => set('defaultRevenue', e.target.value)} placeholder="8.00" /></Field>
              <Field label="Payout Per Action *"><input className="input" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} placeholder="5.00" /></Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Attribution Window (seconds)"><input type="number" min={0} className="input" value={form.attributionWindowS} onChange={(e) => set('attributionWindowS', e.target.value)} /></Field>
              <Field label="Dedup Window (seconds)"><input type="number" min={0} className="input" value={form.dedupWindowS} onChange={(e) => set('dedupWindowS', e.target.value)} /></Field>
            </div>
            <div>
              <label className="label mb-2 block">Attribution Method</label>
              <Segmented options={['Last Touch', 'First Touch']} value={attributionMethod} onChange={setAttributionMethod} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <label className="label mb-2 block">Allowed Traffic Types</label>
            <div className="flex flex-wrap gap-2">
              {DEVICES.map((d) => (
                <button key={d} type="button" onClick={() => toggleDevice(d)}
                  className={`rounded-full border px-4 py-1.5 text-small font-medium capitalize transition-colors ${form.allowedTrafficTypes.includes(d) ? 'border-accent bg-accent-subtle text-accent-text' : 'border-border text-fg-secondary hover:bg-page'}`}>
                  {d}
                </button>
              ))}
            </div>
            <p className="text-tiny text-fg-muted">Empty = all traffic types allowed. Country/device/IP targeting rules aren't available in this app yet.</p>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div>
              <label className="label mb-2 block">Enable Fail Traffic</label>
              <YesNoToggle on={failTrafficEnabled} onChange={setFailTrafficEnabled} />
            </div>
            {failTrafficEnabled && <Field label="Fallback URL"><input className="input" value={form.fallbackUrl} onChange={(e) => set('fallbackUrl', e.target.value)} placeholder="https://…" /></Field>}
          </div>
        )}

        {step === 6 && (
          <p className="rounded-card border border-dashed border-border py-10 text-center text-small text-fg-muted">Creatives can be added from the Offer Detail page once this offer is created.</p>
        )}

        {step === 7 && (
          <div className="space-y-4">
            <div><label className="label mb-2 block">Enable Suppression File</label><YesNoToggle on={suppressionFile} onChange={setSuppressionFile} /></div>
            <div><label className="label mb-2 block">Enable Email Opt-out</label><YesNoToggle on={emailOptOut} onChange={setEmailOptOut} /></div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/offers') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : step === STEPS.length - 1 ? 'Create Offer' : 'Next'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
