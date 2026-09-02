/**
 * Add Offer (Everflow-style 8-step wizard, same step names as OfferEdit.tsx's tabs). Real fields
 * (name, status, advertiserId, category, currency, visibility, destinationUrl, previewUrl,
 * description, payoutModel, defaultRevenue, defaultPayout, allowedTrafficTypes, caps,
 * attribution/dedup windows, fallbackUrl, trackingDomainId) POST to the real /api/offers endpoint
 * on the final step. `category` is a free-text column (no reference table): the picker is a real
 * dropdown of the distinct values already in use, with a "＋ New category…" escape hatch so a
 * brand-new label can still be typed. `currency` stays a free-text ISO-4217 input (pattern-guarded)
 * because there is NO server-side currency list to validate against — a constraining dropdown would
 * imply a check the backend doesn't do (see the QA note). "Assign To Offer Group" isn't part of the
 * create payload — group membership
 * lives on offer_groups.offer_ids — so, like OfferEdit, it's applied as a follow-up PATCH to the
 * chosen group once the offer exists.
 * Creatives can't be attached until the offer exists, so that step just explains that and defers to
 * the Offer Detail page after creation. Email has no equivalent in this app at all.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, UnavailableField, Segmented } from '../../components/ui';
import { HelpHint } from '../../components/HelpHint';
import { LabelsInput } from '../../components/LabelsEditor';
import { Stepper } from '../../components/Stepper';
import type { Advertiser, Offer, TrackingDomain } from '../../types';

const STEPS = ['General', 'Tracking & Controls', 'Revenue & Payout', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'];
// Exactly the Everflow "Add Offer" reference: Active · Paused · Pending. `archived` is a lifecycle
// state you reach later (via the Offers list), never one you pick at creation — so it's not offered
// here. STATUS_DOT/STATUS_LABEL keep the `archived` key so existing rows still resolve elsewhere.
const STATUSES = ['active', 'paused', 'draft'] as const;
const STATUS_DOT: Record<string, string> = { draft: 'bg-fg-muted', active: 'bg-success', paused: 'bg-warning', archived: 'bg-danger' };
// Display labels for the real backend enum (draft/active/paused/archived) — matches the vocabulary
// the Offers list already uses (draft → "Pending", archived → "Deleted"); the value sent to the
// API is still the raw enum member.
const STATUS_LABEL: Record<string, string> = { draft: 'Pending', active: 'Active', paused: 'Paused', archived: 'Deleted' };
const VISIBILITIES = ['public', 'private', 'ask'] as const;
const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
// Non-binding autocomplete for the free-text currency column (no server-side currency list exists).
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'BRL'];

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
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: offerGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  // Distinct category values already in use — the offers.category column is free text (no reference
  // table), so this is the honest source for autocomplete suggestions, same list the Offers filter
  // drawer builds.
  const categoryOptions = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.category).filter((c): c is string => Boolean(c)))).sort(),
    [offers],
  );
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
  const [assignGroup, setAssignGroup] = useState(false);
  const [groupId, setGroupId] = useState('');
  // Category picker: a dropdown of existing values by default; "＋ New category…" flips to a text input.
  const [catNew, setCatNew] = useState(false);
  // Labels (tags) — collected locally; assigned via POST /api/offers/:id/tags once the offer exists.
  const [labels, setLabels] = useState<string[]>([]);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [dailyClickCap, setDailyClickCap] = useState('');
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
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
    if (!res) return;
    // Offer-group membership lives on the group (offer_groups.offer_ids), not the offer create
    // payload — so, like OfferEdit, add the new offer to the chosen group as a follow-up PATCH.
    if (assignGroup && groupId) {
      const group = (offerGroups ?? []).find((g) => g.id === groupId);
      if (group && !group.offerIds.includes(res.id)) {
        await api.patch(`/api/offer-groups/${groupId}`, { offerIds: [...group.offerIds, res.id] });
      }
    }
    // Labels: real tag assignment (POST {name} → find-or-create) once the offer id exists.
    for (const name of labels) {
      await api.post(`/api/offers/${res.id}/tags`, { name });
    }
    nav(`/app/offers/${res.id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit(e);
  };

  return (
    <>
      <PageHeader title="Add Offer" subtitle="Offers › Add" />
      <Stepper steps={STEPS} current={step} />
      <div className="max-w-2xl mx-auto">
      <form onSubmit={next} className="card space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        <p className="flex items-center gap-1.5 text-tiny text-fg-secondary">
          <Info size={13} className="shrink-0 text-fg-muted" /> Fields with an asterisk (*) are mandatory.
        </p>

        {step === 0 && (
          <div className="space-y-4">
            <Field label="Name *" hint="Shown to partners in the offer list and on their tracking links — not the internal ID.">
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            {/* Status — segmented state control (Everflow "Add Offer" parity). */}
            <div>
              <label className="label mb-2 block">Status *<HelpHint text="Active = running. Paused = temporarily stopped. Pending = setup in progress (not live)." /></label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} labels={STATUS_LABEL} />
            </div>
            {/* Advertiser / Category / Currency stacked on the left, tall Thumbnail on the right — matches the Everflow "Add Offer" General layout. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-stretch">
              <div className="space-y-4">
                <Field label="Advertiser *" hint="The company that owns this offer. Payout & revenue roll up to them for reporting and invoicing, and their account / sales managers apply to it. Every offer belongs to exactly one.">
                  <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                    <option value="" disabled>Select Advertiser…</option>
                    {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
                <Field label="Category *" hint="Grouping label used for list filtering and marketplace facets. Pick an existing one, or choose “＋ New category…” to add a new label.">
                  {catNew ? (
                    <div className="flex gap-2">
                      <input className="input" autoFocus required value={form.category} placeholder="New category name"
                        onChange={(e) => set('category', e.target.value)} />
                      <button type="button" className="btn-ghost shrink-0"
                        onClick={() => { setCatNew(false); set('category', ''); }}>Cancel</button>
                    </div>
                  ) : (
                    <select className="input" required value={form.category}
                      onChange={(e) => {
                        if (e.target.value === '__new__') { setCatNew(true); set('category', ''); }
                        else set('category', e.target.value);
                      }}>
                      <option value="" disabled>Select Category…</option>
                      {form.category && !categoryOptions.includes(form.category) && <option value={form.category}>{form.category}</option>}
                      {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__new__">＋ New category…</option>
                    </select>
                  )}
                </Field>
                <Field label="Currency *" hint="ISO 4217 3-letter code (e.g. USD). All payout, revenue and ledger amounts for this offer are recorded in it. Not validated server-side yet — enter a real code.">
                  <input className="input" list="offer-currency-options" maxLength={3} pattern="[A-Za-z]{3}" title="Three-letter ISO 4217 code, e.g. USD" required value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
                  <datalist id="offer-currency-options">
                    {COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </Field>
              </div>
              <div className="flex flex-col">
                <label className="label mb-2 block text-fg-muted">Thumbnail</label>
                <div className="flex flex-1 select-none items-center justify-center rounded-card border border-dashed border-border p-6 text-tiny text-fg-muted opacity-60 min-h-[140px]">
                  Drag and drop or Browse
                </div>
                <p className="mt-1 text-[11px] text-fg-muted">Not yet available in this app.</p>
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Assign To Offer Group<HelpHint text="Adds this offer to a group for shared reporting and curation. Group-level caps are stored for reference but not enforced at the click level yet — only the offer's own caps enforce. Change this later from either side." /></label>
              <div className="flex flex-wrap items-center gap-2">
                <YesNoToggle on={assignGroup} onChange={setAssignGroup} />
                {assignGroup && (
                  <select className="input !w-auto" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="" disabled>Select Offer Group…</option>
                    {(offerGroups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <LabelsInput value={labels} onChange={setLabels} />
            <UnavailableField label="App Identifier"><input className="input" disabled placeholder="e.g. com.acme.app" /></UnavailableField>
            <Field label="Preview URL" hint="A no-tracking link partners can open to see the landing page before running traffic.">
              <input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} />
            </Field>
            <Field label="Description" hint="Notes about the offer for your team and partners. Plain text.">
              <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detailed description of your offer…" />
            </Field>
            {/* Visibility lives below the fold — the Everflow "Add Offer" General step doesn't surface it
                up top, but it's a real offer field so it stays settable here. */}
            <div>
              <label className="label mb-2 block">Visibility *<HelpHint text="Public = any partner can find and run it. Private = only partners you grant access. Ask = partners must request approval." /></label>
              <Segmented options={VISIBILITIES} value={form.visibility} onChange={(v) => set('visibility', v)} />
            </div>
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
              <UnavailableField label="Linking Type">
                <Segmented options={['Redirect Linking', 'Redirect + Direct Linking']} value="Redirect Linking" onChange={() => {}} />
              </UnavailableField>
              <div>
                <label className="label mb-1 block">Conversion Tracking</label>
                <p className="text-small text-fg-secondary">Conversions are accepted via Server-to-Server postback, pixel, or iframe — the advertiser fires whichever they use. It isn't a per-offer setting.</p>
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
              <Field label="Revenue Per Action (RPA) *"><input className="input" required inputMode="decimal" pattern="-?\d{1,10}(\.\d{1,4})?" title="A number with up to 4 decimals" value={form.defaultRevenue} onChange={(e) => set('defaultRevenue', e.target.value)} placeholder="8.00" /></Field>
              <Field label="Payout Per Action *"><input className="input" required inputMode="decimal" pattern="-?\d{1,10}(\.\d{1,4})?" title="A number with up to 4 decimals" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} placeholder="5.00" /></Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Attribution Window (seconds)"><input type="number" min={0} className="input" value={form.attributionWindowS} onChange={(e) => set('attributionWindowS', e.target.value)} /></Field>
              <Field label="Dedup Window (seconds)"><input type="number" min={0} className="input" value={form.dedupWindowS} onChange={(e) => set('dedupWindowS', e.target.value)} /></Field>
            </div>
            <p className="text-tiny text-fg-muted">Attribution is click-referenced — a conversion names the exact click it belongs to, within the window above.</p>
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
            <UnavailableField label="Enable Suppression File"><YesNoToggle on={false} onChange={() => {}} /></UnavailableField>
            <UnavailableField label="Enable Email Opt-out"><YesNoToggle on={false} onChange={() => {}} /></UnavailableField>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <button type="button" className="text-small font-medium text-fg-muted hover:text-fg-secondary" onClick={() => nav('/app/offers')}>Cancel</button>
          <div className="flex gap-2">
            {step > 0 && <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : step === STEPS.length - 1 ? 'Create Offer' : 'Next'}</button>
          </div>
        </div>
      </form>
      </div>
    </>
  );
}
