/**
 * Edit Offer (Everflow-style multi-tab edit form), wired to PATCH /api/offers/:id. Column-backed
 * fields (name, status, caps, windows, fallbackUrl, trackingDomainId…) and metadata-backed ones
 * (targeting, attribution / revenue-event / email settings, app identifier, notes, product ID,
 * thumbnail) all persist. Every PATCH resends the full form, so cleared or disabled fields are sent
 * as null — that's what makes turning Fail Traffic / Caps off actually stick. Targeting and the
 * conversion settings are enforced by the tracking server. Offer-group membership lives on
 * offer_groups, so it's diffed separately after the main PATCH.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { advertiserPostbackUrl, groupTrackingDomains, POSTBACK_PARAMS, resolveTrackingHost } from '../../lib/trackingLinks';
import { PageHeader, Field, Tabs, Spinner, StateBlock, type Column, Segmented } from '../../shared-components/primitives/ui';
import { HelpHint } from '../../shared-components/panels/HelpHint';
import { LabelsEditor } from '../../shared-components/panels/LabelsEditor';
import { CollectionTab, type FieldDef } from '../../shared-components/panels/CollectionTab';
import { CopyBox } from '../../shared-components/panels/CopyBox';
import { YesNoToggle } from './offerForm/controls';
import { TargetingPanel } from './offerForm/TargetingPanel';
import { targetingErrors } from './offerForm/targetingValidation';
import { AttributionSettingsPanel, EmailSettingsPanel, RevenueSettingsPanel } from './offerForm/SettingsPanels';
import { ThumbnailField } from './offerForm/ThumbnailField';
import { DEFAULT_ATTRIBUTION, DEFAULT_EMAIL, DEFAULT_REVENUE, settingsErrors, withDefaults } from './offerForm/settings';
import type {
  Offer, Advertiser, TrackingDomain, OfferTargeting,
  OfferAttributionSettings, OfferRevenueSettings, OfferEmailSettings,
} from '../../types';

const TABS = ['General', 'Tracking & Controls', 'Postback Configuration', 'Revenue & Payout (Events)', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'] as const;
// Everflow-reference order (Active · Paused · Pending). Edit keeps "Deleted" (archived) as a 4th
// segment — unlike the create form — so an already-archived offer still shows its current status.
const STATUSES = ['active', 'paused', 'draft', 'archived'] as const;
const STATUS_DOT: Record<string, string> = { draft: 'bg-fg-muted', active: 'bg-success', paused: 'bg-warning', archived: 'bg-danger' };
// Display labels for the real backend enum — matches the Offers list vocabulary; API value stays raw.
const STATUS_LABEL: Record<string, string> = { draft: 'Pending', active: 'Active', paused: 'Paused', archived: 'Deleted' };
const VISIBILITIES = ['public', 'private', 'ask'] as const;
const LINKING_TYPES = [{ value: 'redirect', label: 'Redirect Linking' }, { value: 'redirect_direct', label: 'Redirect + Direct Linking' }];
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'BRL'];
type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => import('react').ReactNode): Column<Row> => ({ header, cell });

interface FormState {
  name: string; status: string; advertiserId: string; category: string; currency: string;
  visibility: string; destinationUrl: string; previewUrl: string; description: string;
  dailyClickCap: string; dailyConversionCap: string; totalConversionCap: string;
  payoutModel: string; defaultPayout: string; defaultRevenue: string;
  attributionWindowS: string; dedupWindowS: string; fallbackUrl: string; allowedTrafficTypes: string[];
  trackingDomainId: string;
  linkingType: string; deepLinkEnabled: boolean; firePartnerPostback: boolean;
  appIdentifier: string; internalNotes: string; productId: string; thumbnailUrl: string;
  targeting: OfferTargeting;
  attribution: OfferAttributionSettings; revenue: OfferRevenueSettings; email: OfferEmailSettings;
}

export default function OfferEdit() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const base = `/api/offers/${id}`;
  const { data: offer, loading, error, refetch } = useQuery<Offer>(base);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: groups, refetch: refetchGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  const { data: allOffers } = useQuery<Offer[]>('/api/offers');
  const { data: networkSecurity } = useQuery<{ securityCode: string | null }>('/api/settings/security');
  const categoryOptions = useMemo(
    () => Array.from(new Set((allOffers ?? []).map((o) => o.category).filter((c): c is string => Boolean(c)))).sort(),
    [allOffers],
  );
  const [tab, setTab] = useState<string>('General');
  const [form, setForm] = useState<FormState | null>(null);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
  const [assignGroup, setAssignGroup] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [catNew, setCatNew] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const { run, busy, error: saveError } = useMutation((body: Record<string, unknown>) => api.patch(base, body));
  const regenCode = useMutation(() => api.post<{ securityCode: string }>(`${base}/security-code/regenerate`));
  const clearCode = useMutation(async (_args: void) => { await api.del(`${base}/security-code`); });

  useEffect(() => {
    if (!offer) return;
    setForm({
      name: offer.name, status: offer.status, advertiserId: offer.advertiserId, category: offer.category ?? '',
      currency: offer.currency, visibility: offer.visibility ?? 'public', destinationUrl: offer.destinationUrl,
      previewUrl: offer.previewUrl ?? '', description: offer.description ?? '',
      dailyClickCap: offer.dailyClickCap != null ? String(offer.dailyClickCap) : '',
      dailyConversionCap: offer.dailyConversionCap != null ? String(offer.dailyConversionCap) : '',
      totalConversionCap: offer.totalConversionCap != null ? String(offer.totalConversionCap) : '',
      payoutModel: offer.payoutModel, defaultPayout: String(offer.defaultPayout), defaultRevenue: String(offer.defaultRevenue),
      attributionWindowS: offer.attributionWindowS != null ? String(offer.attributionWindowS) : '',
      dedupWindowS: offer.dedupWindowS != null ? String(offer.dedupWindowS) : '',
      fallbackUrl: offer.fallbackUrl ?? '', allowedTrafficTypes: offer.allowedTrafficTypes ?? [],
      trackingDomainId: offer.trackingDomainId ?? '',
      linkingType: offer.linkingType ?? 'redirect',
      deepLinkEnabled: offer.deepLinkEnabled ?? false,
      // Unset = on (the tracker fires partner postbacks unless explicitly turned off).
      firePartnerPostback: offer.firePartnerPostback ?? true,
      appIdentifier: offer.appIdentifier ?? '', internalNotes: offer.internalNotes ?? '',
      productId: offer.productId ?? '', thumbnailUrl: offer.thumbnailUrl ?? '',
      targeting: offer.targeting ?? {},
      attribution: withDefaults(DEFAULT_ATTRIBUTION, offer.attributionSettings),
      revenue: withDefaults(DEFAULT_REVENUE, offer.revenueSettings),
      email: withDefaults(DEFAULT_EMAIL, offer.emailSettings),
    });
    setCapsEnabled(Boolean(offer.dailyClickCap || offer.dailyConversionCap || offer.totalConversionCap));
    setFailTrafficEnabled(Boolean(offer.fallbackUrl));
  }, [offer]);

  // Pre-select whichever offer group (if any) already lists this offer.
  useEffect(() => {
    if (!offer || !groups) return;
    const current = groups.find((g) => g.offerIds?.includes(offer.id));
    if (current) { setAssignGroup(true); setGroupId(current.id); }
  }, [offer, groups]);

  if (loading || !form) return <StateBlock><Spinner /></StateBlock>;
  if (error || !offer) return <StateBlock>{error ?? 'Offer not found'}</StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const regenerateCode = async () => {
    const code = await regenCode.run(undefined);
    if (code) await refetch();
  };
  const removeCode = async () => {
    await clearCode.run(undefined);
    await refetch();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const tErrors = targetingErrors(form.targeting);
    const sErrors = settingsErrors(form.attribution, form.revenue, form.email);
    if (failTrafficEnabled && !form.fallbackUrl.trim()) sErrors.push('Fail Traffic: enter a Fallback URL or turn Fail Traffic off.');
    if (tErrors.length || sErrors.length) {
      setFormErrors([...tErrors.map((m) => `Targeting: ${m}`), ...sErrors]);
      if (tErrors.length) setTab('Targeting');
      return;
    }
    setFormErrors([]);
    const normalizeUrl = (v: string) => (v && !/^https?:\/\//i.test(v) ? 'https://' + v : v);
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    const capOrNull = (v: string) => (capsEnabled && v !== '' ? Number(v) : null);
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, advertiserId: form.advertiserId, currency: form.currency,
      visibility: form.visibility, destinationUrl: normalizeUrl(form.destinationUrl), payoutModel: form.payoutModel,
      defaultPayout: form.defaultPayout || '0', defaultRevenue: form.defaultRevenue || '0',
      allowedTrafficTypes: form.allowedTrafficTypes,
      category: orNull(form.category),
      previewUrl: form.previewUrl.trim() ? normalizeUrl(form.previewUrl.trim()) : null,
      description: orNull(form.description),
      linkingType: form.linkingType,
      deepLinkEnabled: form.deepLinkEnabled,
      firePartnerPostback: form.firePartnerPostback,
      // Disabled or cleared → null, so the server really drops the old value.
      fallbackUrl: failTrafficEnabled && form.fallbackUrl.trim() ? normalizeUrl(form.fallbackUrl.trim()) : null,
      dailyClickCap: capOrNull(form.dailyClickCap),
      dailyConversionCap: capOrNull(form.dailyConversionCap),
      totalConversionCap: capOrNull(form.totalConversionCap),
      appIdentifier: orNull(form.appIdentifier),
      internalNotes: orNull(form.internalNotes),
      productId: orNull(form.productId),
      thumbnailUrl: form.thumbnailUrl.trim() ? normalizeUrl(form.thumbnailUrl.trim()) : null,
      targeting: form.targeting,
      attributionSettings: form.attribution,
      revenueSettings: form.revenue,
      emailSettings: form.email,
    };
    if (form.trackingDomainId) body.trackingDomainId = form.trackingDomainId;
    if (form.attributionWindowS) body.attributionWindowS = Number(form.attributionWindowS);
    if (form.dedupWindowS) body.dedupWindowS = Number(form.dedupWindowS);
    if (!(await run(body))) return;

    // Sync offer-group membership: drop this offer from any group it's currently in, then add it
    // to the newly selected one (if the toggle is on).
    // The offer itself is saved by now; a group failure is reported, not silently swallowed.
    const failedGroups: string[] = [];
    if (groups) {
      for (const g of groups) {
        const has = g.offerIds?.includes(id);
        const shouldHave = assignGroup && g.id === groupId;
        try {
          if (has && !shouldHave) await api.patch(`/api/offer-groups/${g.id}`, { offerIds: g.offerIds.filter((o) => o !== id) });
          else if (!has && shouldHave) await api.patch(`/api/offer-groups/${g.id}`, { offerIds: [...g.offerIds, id] });
        } catch { failedGroups.push(g.name); }
      }
      refetchGroups();
    }
    if (failedGroups.length) window.alert(`Offer saved, but its offer-group membership could not be updated for: ${failedGroups.join(', ')}.`);
    nav(`/app/offers/${id}`);
  };

  const trackHost = resolveTrackingHost(domains, form.trackingDomainId);
  const currentDomainId: string | null | undefined = offer?.trackingDomainId;
  const domainGroups = groupTrackingDomains(domains);

  return (
    <>
      <PageHeader title={`Edit Offer: ${offer.name}`} subtitle={`Offers › ${offer.name} › Edit`} />
      <div className="max-w-3xl mx-auto">
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      <form onSubmit={submit} className="card space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}
        {formErrors.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">
            {formErrors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <p className="flex items-center gap-1.5 text-tiny text-fg-secondary">
          <Info size={13} className="shrink-0 text-fg-muted" /> Fields with an asterisk (*) are mandatory.
        </p>

        {tab === 'General' && (
          <div className="max-w-2xl space-y-4">
            <Field label="Name *" hint="Shown to partners in the offer list and on their tracking links — not the internal ID.">
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div>
              <label className="label mb-2 block">Status *<HelpHint text="Pending = setup in progress (not live). Active = running. Paused = temporarily stopped. Deleted = archived, hidden from partners." /></label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} labels={STATUS_LABEL} />
            </div>
            <div>
              <label className="label mb-2 block">Visibility *<HelpHint text="Public = any partner can find and run it. Private = only partners you grant access. Ask = partners must request approval." /></label>
              <Segmented options={VISIBILITIES} value={form.visibility} onChange={(v) => set('visibility', v)} />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
              <Field label="Advertiser *" hint="The company that owns this offer. Payout & revenue roll up to them for reporting and invoicing, and their account / sales managers apply to it. Every offer belongs to exactly one.">
                <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <ThumbnailField offerId={id} url={form.thumbnailUrl} onUrlChange={(v) => set('thumbnailUrl', v)} />
            </div>
            <Field label="Category" hint="Grouping label used for list filtering and marketplace facets. Pick an existing one, or choose “＋ New category…” to add a new label.">
              {catNew ? (
                <div className="flex gap-2">
                  <input className="input" autoFocus value={form.category} placeholder="New category name"
                    onChange={(e) => set('category', e.target.value)} />
                  <button type="button" className="btn-ghost shrink-0"
                    onClick={() => { setCatNew(false); set('category', ''); }}>Cancel</button>
                </div>
              ) : (
                <select className="input" value={form.category}
                  onChange={(e) => {
                    if (e.target.value === '__new__') { setCatNew(true); set('category', ''); }
                    else set('category', e.target.value);
                  }}>
                  <option value="">No category</option>
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
            <div>
              <label className="label mb-2 block">Assign To Offer Group<HelpHint text="Adds this offer to a group for shared reporting and curation. Group-level caps are stored for reference but not enforced at the click level yet — only the offer's own caps enforce. Change this later from either side." /></label>
              <div className="flex flex-wrap items-center gap-2">
                <YesNoToggle on={assignGroup} onChange={setAssignGroup} />
                {assignGroup && (
                  <select className="input !w-auto" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="" disabled>Select Offer Group…</option>
                    {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <LabelsEditor base={base} />
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
              <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>
        )}

        {tab === 'Tracking & Controls' && (
          <div className="max-w-2xl space-y-6">
            <div className="space-y-4">
              <h3 className="text-h3 font-medium text-fg">Tracking</h3>
              <p className="text-small font-semibold text-fg">Default Landing Page</p>
              <Field label="Default Landing Page URL *"><textarea className="input min-h-[80px] font-mono text-tiny" required value={form.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} /></Field>

              <p className="text-small font-semibold text-fg">Tracking Domain</p>
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

              <p className="text-small font-semibold text-fg">Click Tracking</p>
              <Field label="Linking Type">
                <Segmented options={LINKING_TYPES} value={form.linkingType || 'redirect'} onChange={(v) => set('linkingType', v)} />
              </Field>

              <p className="text-small font-semibold text-fg">Conversion Event Tracking</p>
              <div>
                <label className="label mb-1 block">Conversion Tracking</label>
                <p className="text-small text-fg-secondary">Conversions are accepted via Server-to-Server postback, pixel, or iframe — the advertiser fires whichever they use. It isn't a per-offer setting.</p>
              </div>

              <label className="flex items-start gap-2 text-small text-fg">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={form.deepLinkEnabled} onChange={(e) => set('deepLinkEnabled', e.target.checked)} />
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
                  <Field label="Daily Click Cap"><input type="number" min={0} className="input" value={form.dailyClickCap} onChange={(e) => set('dailyClickCap', e.target.value)} placeholder="Unlimited" /></Field>
                  <Field label="Daily Conversion Cap"><input type="number" min={0} className="input" value={form.dailyConversionCap} onChange={(e) => set('dailyConversionCap', e.target.value)} placeholder="Unlimited" /></Field>
                  <Field label="Total Conversion Cap"><input type="number" min={0} className="input" value={form.totalConversionCap} onChange={(e) => set('totalConversionCap', e.target.value)} placeholder="Unlimited" /></Field>
                </div>
              )}
              {!capsEnabled && <p className="text-tiny text-fg-muted">Caps off — saving removes any existing caps on this offer.</p>}
            </div>
          </div>
        )}

        {tab === 'Postback Configuration' && (
          <div className="max-w-2xl space-y-6">
            <p className="text-small text-fg-secondary">Give this URL to the advertiser. They should fire it from their server when a user converts. The click_id is passed automatically via the redirect.</p>
            <div className="space-y-4">
              <Field label="S2S Postback URL" hint="The advertiser replaces {click_id} and {txn_id} with their own values. The secure code is already filled in.">
                <CopyBox value={advertiserPostbackUrl(trackHost, offer.securityCode ?? networkSecurity?.securityCode)} placeholder="No active tracking domain — add one first." />
              </Field>
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
              <h3 className="text-h3 font-medium text-fg">Per-Offer Security Code</h3>
              <p className="text-small text-fg-secondary">Overrides the network-wide code when set. The advertiser must include the per-offer security code in their postback. Leave empty to use the network default.</p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input className="input font-mono text-tiny" readOnly value={offer.securityCode ?? ''} placeholder="No per-offer code set — using network default" />
                </div>
                <button type="button" className="btn-ghost !py-2" disabled={regenCode.busy} onClick={regenerateCode}>{regenCode.busy ? 'Generating…' : (offer.securityCode ? 'Regenerate' : 'Generate')}</button>
                {offer.securityCode && <button type="button" className="btn-ghost !py-2 text-danger-text" disabled={clearCode.busy} onClick={removeCode}>Remove</button>}
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Publisher Postback</h3>
              <div>
                <label className="flex items-start gap-2 text-small text-fg">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={form.firePartnerPostback} onChange={(e) => set('firePartnerPostback', e.target.checked)} />
                  <span><strong>Fire Partner Postback</strong> — automatically notify publishers via their configured postback URL when a conversion is approved.</span>
                </label>
                <p className="mt-1 text-tiny text-fg-secondary">Publisher postback URLs and macros are configured separately on each publisher's postback settings. When enabled, approved conversions trigger an outbound call to the publisher with their configured macro template.</p>
              </div>
            </div>
          </div>
        )}

        {tab === 'Revenue & Payout (Events)' && (
          <div className="max-w-2xl space-y-6">
            <RevenueSettingsPanel value={form.revenue} onChange={(v) => set('revenue', v)}
              firePartnerPostback={form.firePartnerPostback} onFirePartnerPostbackChange={(v) => set('firePartnerPostback', v)}
              revenue={form.defaultRevenue} onRevenueChange={(v) => set('defaultRevenue', v)} />

            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Base Payout</h3>
              <Field label="Model">
                <select className="input" value={form.payoutModel} onChange={(e) => set('payoutModel', e.target.value)}>
                  {['CPA', 'CPL', 'CPC', 'CPI', 'RevShare'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Payout Per Action *"><input className="input" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} /></Field>
            </div>
          </div>
        )}

        {tab === 'Attribution' && (
          <div className="max-w-2xl space-y-6">
            <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
              <Field label="Attribution Window (seconds)"><input type="number" min={0} className="input" value={form.attributionWindowS} onChange={(e) => set('attributionWindowS', e.target.value)} placeholder="2592000" /></Field>
              <Field label="Dedup Window (seconds)"><input type="number" min={0} className="input" value={form.dedupWindowS} onChange={(e) => set('dedupWindowS', e.target.value)} placeholder="86400" /></Field>
            </div>
            <AttributionSettingsPanel value={form.attribution} onChange={(v) => set('attribution', v)} />
          </div>
        )}

        {tab === 'Targeting' && (
          <TargetingPanel targeting={form.targeting} onChange={(t) => set('targeting', t)}
            deviceTypes={form.allowedTrafficTypes} onDeviceTypesChange={(d) => set('allowedTrafficTypes', d)} />
        )}

        {tab === 'Fail Traffic' && (
          <div className="max-w-2xl space-y-4">
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
              <p className="text-tiny text-fg-muted">Off — clicks that fail a rule get an empty response (HTTP 204) instead of a redirect. Saving removes any existing Fallback URL.</p>
            )}
          </div>
        )}

        {tab === 'Creatives' && (
          <CollectionTab basePath={`${base}/creatives`} addLabel="Creative" editable emptyText="No creatives."
            fields={[
              { key: 'name', label: 'Name', required: true },
              { key: 'type', label: 'Type', type: 'select', options: ['image', 'html', 'link', 'email', 'video'], default: 'image' },
              { key: 'url', label: 'Asset URL', type: 'url' },
              { key: 'html', label: 'HTML / snippet', type: 'textarea' },
              { key: 'width', label: 'Width', type: 'number' },
              { key: 'height', label: 'Height', type: 'number' },
            ] as FieldDef[]}
            columns={[
              col('ID', (r) => <span className="font-mono text-tiny text-fg-secondary">{r.id.slice(0, 8)}</span>),
              col('Name', (r) => String(r.name)),
              col('Type', (r) => String(r.type)),
              col('Preview', (r) => (r.url ? String(r.url) : r.html ? 'HTML' : '—')),
              col('Size', (r) => (r.width ? `${r.width}×${r.height}` : '—')),
            ]} />
        )}

        {tab === 'Email' && <EmailSettingsPanel value={form.email} onChange={(v) => set('email', v)} />}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => nav(`/app/offers/${id}`)}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
