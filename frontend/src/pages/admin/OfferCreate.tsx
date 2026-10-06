/**
 * Add Offer (Everflow-style wizard, same step names as OfferEdit.tsx's tabs). Everything POSTs to
 * /api/offers on the final step — column fields plus the metadata-backed ones (targeting,
 * attribution / revenue-event / email settings, app identifier, internal notes, product ID,
 * thumbnail URL). `category` is free text (no reference table): the picker lists values already in
 * use, with a "＋ New category…" escape hatch. `currency` stays a pattern-guarded ISO-4217 input —
 * there's no server-side currency list. Things that need the offer's id run as follow-ups once it
 * exists: offer-group membership (lives on offer_groups.offer_ids), labels, and an uploaded
 * thumbnail file. Creatives are added from the Offer Detail page after creation.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { advertiserPostbackUrl, groupTrackingDomains, POSTBACK_PARAMS, resolveTrackingHost } from '../../lib/trackingLinks';
import { PageHeader, Field, Segmented } from '../../shared-components/primitives/ui';
import { CopyBox } from '../../shared-components/panels/CopyBox';
import { HelpHint } from '../../shared-components/panels/HelpHint';
import { LabelsInput } from '../../shared-components/panels/LabelsEditor';
import { Stepper } from '../../shared-components/panels/Stepper';
import { YesNoToggle } from './offerForm/controls';
import { TargetingPanel } from './offerForm/TargetingPanel';
import { targetingErrors } from './offerForm/targetingValidation';
import { AttributionSettingsPanel, EmailSettingsPanel, RevenueSettingsPanel } from './offerForm/SettingsPanels';
import { ThumbnailField } from './offerForm/ThumbnailField';
import { DEFAULT_ATTRIBUTION, DEFAULT_EMAIL, DEFAULT_REVENUE, settingsErrors } from './offerForm/settings';
import type { Advertiser, Offer, OfferTargeting, TrackingDomain } from '../../types';

const STEPS = ['General', 'Tracking & Controls', 'Postback Configuration', 'Revenue & Payout', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'];
const TARGETING_STEP = STEPS.indexOf('Targeting');
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
const LINKING_TYPES = [{ value: 'redirect', label: 'Redirect Linking' }, { value: 'redirect_direct', label: 'Redirect + Direct Linking' }];
// Non-binding autocomplete for the free-text currency column (no server-side currency list exists).
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'BRL'];

export default function OfferCreate() {
  const nav = useNavigate();
  // "+ Offer" on Advertiser Details → Offers opens this page with ?advertiserId=… to preselect the
  // advertiser (same URL-prefill pattern as Add Conversion's ?offerId=). Only a starting value: the
  // field stays editable and the backend still checks the advertiser belongs to the caller's network.
  const [searchParams] = useSearchParams();
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: offerGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  const { data: networkSecurity } = useQuery<{ securityCode: string | null }>('/api/settings/security');
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
      advertiserId: searchParams.get('advertiserId') ?? '', name: '', destinationUrl: '', previewUrl: '', trackingDomainId: '',
      payoutModel: 'CPA', currency: 'USD', defaultRevenue: '', defaultPayout: '',
      category: '', visibility: 'public', status: 'active',
      description: '', attributionWindowS: '2592000', dedupWindowS: '86400', fallbackUrl: '',
      appIdentifier: '', internalNotes: '', productId: '', thumbnailUrl: '',
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
  const [assignGroup, setAssignGroup] = useState(false);
  const [groupId, setGroupId] = useState('');
  // Category picker: a dropdown of existing values by default; "＋ New category…" flips to a text input.
  const [catNew, setCatNew] = useState(false);
  // Labels (tags) — collected locally; assigned via POST /api/offers/:id/tags once the offer exists.
  const [labels, setLabels] = useState<string[]>([]);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [caps, setCaps] = useState({ dailyClickCap: '', dailyConversionCap: '', totalConversionCap: '' });
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
  const [linkingType, setLinkingType] = useState('redirect');
  const [deepLinkEnabled, setDeepLinkEnabled] = useState(false);
  // On by default — the tracker fires partner postbacks unless this is explicitly turned off.
  const [firePartnerPostback, setFirePartnerPostback] = useState(true);
  const [targeting, setTargeting] = useState<OfferTargeting>({});
  const [attribution, setAttribution] = useState(DEFAULT_ATTRIBUTION);
  const [revenue, setRevenue] = useState(DEFAULT_REVENUE);
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [pendingThumb, setPendingThumb] = useState<File | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/offers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const tErrors = targetingErrors(targeting);
    const sErrors = settingsErrors(attribution, revenue, email);
    if (failTrafficEnabled && !form.fallbackUrl.trim()) sErrors.push('Fail Traffic: enter a Fallback URL or turn Fail Traffic off.');
    if (tErrors.length || sErrors.length) {
      setFormErrors([...tErrors.map((m) => `Targeting: ${m}`), ...sErrors]);
      if (tErrors.length) setStep(TARGETING_STEP);
      return;
    }
    setFormErrors([]);
    const normalizeUrl = (v: string) => (v && !/^https?:\/\//i.test(v) ? 'https://' + v : v);
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    const capOrNull = (v: string) => (capsEnabled && v !== '' ? Number(v) : null);
    const body: Record<string, unknown> = {
      advertiserId: form.advertiserId, name: form.name, destinationUrl: normalizeUrl(form.destinationUrl),
      payoutModel: form.payoutModel, currency: form.currency,
      defaultRevenue: form.defaultRevenue || '0', defaultPayout: form.defaultPayout || '0',
      visibility: form.visibility, status: form.status, allowedTrafficTypes: form.allowedTrafficTypes,
      linkingType, deepLinkEnabled, firePartnerPostback,
      fallbackUrl: failTrafficEnabled && form.fallbackUrl.trim() ? normalizeUrl(form.fallbackUrl.trim()) : null,
      dailyClickCap: capOrNull(caps.dailyClickCap),
      dailyConversionCap: capOrNull(caps.dailyConversionCap),
      totalConversionCap: capOrNull(caps.totalConversionCap),
      appIdentifier: orNull(form.appIdentifier),
      internalNotes: orNull(form.internalNotes),
      productId: orNull(form.productId),
      thumbnailUrl: !pendingThumb && form.thumbnailUrl.trim() ? normalizeUrl(form.thumbnailUrl.trim()) : null,
      targeting,
      attributionSettings: attribution,
      revenueSettings: revenue,
      emailSettings: email,
    };
    if (form.category) body.category = form.category;
    if (form.previewUrl) body.previewUrl = normalizeUrl(form.previewUrl);
    if (form.trackingDomainId) body.trackingDomainId = form.trackingDomainId;
    if (form.description) body.description = form.description;
    if (form.attributionWindowS) body.attributionWindowS = Number(form.attributionWindowS);
    if (form.dedupWindowS) body.dedupWindowS = Number(form.dedupWindowS);
    const res = await run(body);
    if (!res) return;
    // The offer exists from here on. Follow-up steps are best-effort: a failure is reported but must
    // not strand the user on the wizard (re-submitting would create a duplicate offer).
    const problems: string[] = [];
    // Offer-group membership lives on the group (offer_groups.offer_ids), not the offer create
    // payload — so, like OfferEdit, add the new offer to the chosen group as a follow-up PATCH.
    if (assignGroup && groupId) {
      const group = (offerGroups ?? []).find((g) => g.id === groupId);
      if (group && !group.offerIds.includes(res.id)) {
        try { await api.patch(`/api/offer-groups/${groupId}`, { offerIds: [...group.offerIds, res.id] }); }
        catch { problems.push(`offer group "${group.name}"`); }
      }
    }
    // Labels: real tag assignment (POST {name} → find-or-create) once the offer id exists.
    for (const name of labels) {
      try { await api.post(`/api/offers/${res.id}/tags`, { name }); } catch { problems.push(`label "${name}"`); }
    }
    // A dropped/browsed thumbnail file needs the offer id, so it uploads now.
    if (pendingThumb) {
      try { await api.upload(`/api/offers/${res.id}/thumbnail`, pendingThumb); } catch { problems.push('thumbnail'); }
    }
    if (problems.length) window.alert(`Offer created, but these could not be saved: ${problems.join(', ')}. You can set them from Edit Offer.`);
    nav(`/app/offers/${res.id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit(e);
  };

  const trackHost = resolveTrackingHost(domains, form.trackingDomainId);
  const currentDomainId: string | null | undefined = null;
  const domainGroups = groupTrackingDomains(domains);

  return (
    <>
      <PageHeader title="Add Offer" subtitle="Offers › Add" />
      <Stepper steps={STEPS} current={step} />
      <div className="max-w-2xl mx-auto">
      <form onSubmit={next} className="card space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        {formErrors.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">
            {formErrors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
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
            {/* Advertiser / Category / Currency stacked on the left, Thumbnail on the right — matches the Everflow "Add Offer" General layout. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
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
              <ThumbnailField url={form.thumbnailUrl} onUrlChange={(v) => set('thumbnailUrl', v)} onPendingFile={setPendingThumb} />
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
            <Field label="App Identifier" hint="Store bundle / package ID for app offers (e.g. com.acme.app or id123456789).">
              <input className="input" placeholder="e.g. com.acme.app" maxLength={255} value={form.appIdentifier} onChange={(e) => set('appIdentifier', e.target.value)} />
            </Field>
            <Field label="Preview URL" hint="A no-tracking link partners can open to see the landing page before running traffic.">
              <input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} />
            </Field>
            <Field label="Internal Notes" hint="Visible to your team only — never shown to partners or advertisers.">
              <textarea className="input min-h-[80px]" value={form.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />
            </Field>
            <Field label="Product ID" hint="Your own or the advertiser's product / SKU reference for this offer.">
              <input className="input" maxLength={255} value={form.productId} onChange={(e) => set('productId', e.target.value)} />
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
              <Field label="Tracking Domain *" hint="Tracking links and the S2S postback URL for this offer use this domain.">
                <select className="input" required value={form.trackingDomainId} onChange={(e) => set('trackingDomainId', e.target.value)}>
                  <option value="" disabled>Select Tracking Domain…</option>
                  {domainGroups.production.length > 0 && (
                    <optgroup label="Production">
                      {domainGroups.production.map((d) => <option key={d.id} value={d.id} disabled={(d.status !== 'active' || d.verificationState !== 'verified') && d.id !== currentDomainId}>{d.host}{d.status !== 'active' ? ` (${d.status})` : d.verificationState !== 'verified' ? ' (not verified)' : ''}</option>)}
                    </optgroup>
                  )}
                  {domainGroups.devOnly.length > 0 && (
                    <optgroup label="Local Testing">
                      {domainGroups.devOnly.map((d) => <option key={d.id} value={d.id} disabled={(d.status !== 'active' || d.verificationState !== 'verified') && d.id !== currentDomainId}>{d.host}{d.status !== 'active' ? ` (${d.status})` : d.verificationState !== 'verified' ? ' (not verified)' : ''}</option>)}
                    </optgroup>
                  )}
                </select>
              </Field>
              <Field label="Linking Type">
                <Segmented options={LINKING_TYPES} value={linkingType} onChange={setLinkingType} />
              </Field>
              <div>
                <label className="label mb-1 block">Conversion Tracking</label>
                <p className="text-small text-fg-secondary">Conversions are accepted via Server-to-Server postback, pixel, or iframe — the advertiser fires whichever they use. It isn't a per-offer setting.</p>
              </div>
              <label className="flex items-start gap-2 text-small text-fg">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={deepLinkEnabled} onChange={(e) => setDeepLinkEnabled(e.target.checked)} />
                <span><strong>Support Deep Links</strong> — Allow Partners to direct traffic to alternate landing pages without additional Offer URLs.</span>
              </label>
            </div>
            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Caps</h3>
              <div>
                <label className="label mb-2 block">Enable Caps</label>
                <YesNoToggle on={capsEnabled} onChange={setCapsEnabled} />
              </div>
              {capsEnabled && (
                <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-3">
                  <Field label="Daily Click Cap"><input type="number" min={0} className="input" value={caps.dailyClickCap} onChange={(e) => setCaps((c) => ({ ...c, dailyClickCap: e.target.value }))} placeholder="Unlimited" /></Field>
                  <Field label="Daily Conversion Cap"><input type="number" min={0} className="input" value={caps.dailyConversionCap} onChange={(e) => setCaps((c) => ({ ...c, dailyConversionCap: e.target.value }))} placeholder="Unlimited" /></Field>
                  <Field label="Total Conversion Cap"><input type="number" min={0} className="input" value={caps.totalConversionCap} onChange={(e) => setCaps((c) => ({ ...c, totalConversionCap: e.target.value }))} placeholder="Unlimited" /></Field>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-2xl space-y-6">
            <p className="text-small text-fg-secondary">Give this URL to the advertiser. They should fire it from their server when a user converts. The {`{click_id}`} is passed automatically via the redirect.</p>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="label block">S2S Postback URL</label>
                <CopyBox value={advertiserPostbackUrl(trackHost, networkSecurity?.securityCode)} placeholder="No active tracking domain — add one first." />
                <p className="text-tiny text-fg-secondary">The advertiser replaces {`{click_id}`} and {`{txn_id}`} with their own values. The network secure code is already filled in; generate a per-offer code from the offer page after creating it.</p>
              </div>
              <div>
                <p className="label mb-2 block">Postback Parameters</p>
                <table className="premium-table w-full">
                  <thead><tr><th className="py-1.5 text-left text-tiny uppercase text-fg-muted">Parameter</th><th className="py-1.5 text-left text-tiny uppercase text-fg-muted">Meaning</th></tr></thead>
                  <tbody>
                    {POSTBACK_PARAMS.map(([m, d]) => (
                      <tr key={m}><td className="py-1 font-mono text-tiny text-accent-text">{m}</td><td className="py-1 text-small text-fg-secondary">{d}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Publisher Postback</h3>
              <label className="flex items-start gap-2 text-small text-fg">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={firePartnerPostback} onChange={(e) => setFirePartnerPostback(e.target.checked)} />
                <span><strong>Fire Partner Postback</strong> — automatically notify publishers via their configured postback URL when a conversion is approved.</span>
              </label>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <RevenueSettingsPanel value={revenue} onChange={setRevenue}
              firePartnerPostback={firePartnerPostback} onFirePartnerPostbackChange={setFirePartnerPostback}
              revenue={form.defaultRevenue} onRevenueChange={(v) => set('defaultRevenue', v)} />
            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Base Payout</h3>
              <Field label="Model">
                <select className="input" value={form.payoutModel} onChange={(e) => set('payoutModel', e.target.value)}>
                  {['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Payout Per Action *"><input className="input" required inputMode="decimal" pattern="-?\d{1,10}(\.\d{1,4})?" title="A number with up to 4 decimals" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} placeholder="5.00" /></Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Attribution Window (seconds)"><input type="number" min={0} className="input" value={form.attributionWindowS} onChange={(e) => set('attributionWindowS', e.target.value)} /></Field>
              <Field label="Dedup Window (seconds)"><input type="number" min={0} className="input" value={form.dedupWindowS} onChange={(e) => set('dedupWindowS', e.target.value)} /></Field>
            </div>
            <p className="text-tiny text-fg-muted">Attribution is click-referenced — a conversion names the exact click it belongs to, within the window above.</p>
            <AttributionSettingsPanel value={attribution} onChange={setAttribution} />
          </div>
        )}

        {step === 5 && (
          <TargetingPanel targeting={targeting} onChange={setTargeting}
            deviceTypes={form.allowedTrafficTypes} onDeviceTypesChange={(d) => set('allowedTrafficTypes', d)} />
        )}

        {step === 6 && (
          <div className="space-y-4">
            <div>
              <label className="label mb-2 block">Enable Fail Traffic</label>
              <YesNoToggle on={failTrafficEnabled} onChange={setFailTrafficEnabled} />
            </div>
            {failTrafficEnabled ? (
              <div className="rounded-card border border-border bg-page p-4">
                <Field label="Fallback URL *"><input className="input" value={form.fallbackUrl} onChange={(e) => set('fallbackUrl', e.target.value)} placeholder="https://…" /></Field>
                <p className="mt-2 text-tiny text-fg-muted">Clicks that fail targeting, geo, traffic-control, blocking or cap rules redirect here instead of the offer's destination URL.</p>
              </div>
            ) : (
              <p className="text-tiny text-fg-muted">Off — clicks that fail a rule get an empty response (HTTP 204) instead of a redirect.</p>
            )}
          </div>
        )}

        {step === 7 && (
          <p className="rounded-card border border-dashed border-border py-10 text-center text-small text-fg-muted">Creatives can be added from the Offer Detail page once this offer is created.</p>
        )}

        {step === 8 && <EmailSettingsPanel value={email} onChange={setEmail} />}

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
