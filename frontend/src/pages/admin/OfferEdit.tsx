/**
 * Edit Offer (Everflow-style multi-tab edit form), wired to PATCH /api/offers/:id. Column-backed
 * fields (name, status, caps, windows, fallbackUrl, trackingDomainId…) and metadata-backed ones
 * (targeting, attribution / revenue-event / email settings, app identifier, notes, product ID,
 * thumbnail) all persist. Every PATCH resends the full form, so cleared or disabled fields are sent
 * as null — that's what makes turning Fail Traffic / Caps off actually stick. Targeting and the
 * conversion settings are enforced by the tracking server. Offer-group membership lives on
 * offer_groups, so it's diffed separately after the main PATCH.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { useOfferCategories } from '../../lib/useOfferCategories';
import { useSubmitGuard } from '../../lib/useSubmitGuard';
import { advertiserPostbackUrl, groupTrackingDomains, POSTBACK_PARAMS, resolveTrackingHost } from '../../lib/trackingLinks';
import { PageHeader, Field, Tabs, Spinner, StateBlock, type Column, Segmented } from '../../shared-components/primitives/ui';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { FIELD_HELP_EMPTY } from '../../shared-components/forms/FieldHelpPanel';
import { ChoiceCards, StatusChoice } from '../../shared-components/forms/ChoiceCards';
import { OFFER_STATUS_LABEL, OFFER_STATUS_TONE } from '../../lib/offerStatus';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { HelpHint } from '../../shared-components/panels/HelpHint';
import { LabelsEditor } from '../../shared-components/panels/LabelsEditor';
import { CollectionTab, type FieldDef } from '../../shared-components/panels/CollectionTab';
import { CopyBox } from '../../shared-components/panels/CopyBox';
import { TargetingPanel } from './offerForm/TargetingPanel';
import { targetingErrors } from './offerForm/targetingValidation';
import { AttributionSettingsPanel, EmailSettingsPanel, RevenueSettingsPanel } from './offerForm/SettingsPanels';
import { ThumbnailField } from './offerForm/ThumbnailField';
import { SearchablePicker } from '../../shared-components/primitives/SearchablePicker';
import { CapTimeZoneSelect } from '../../shared-components/primitives/CapTimeZoneSelect';
import { DEFAULT_ATTRIBUTION, DEFAULT_EMAIL, DEFAULT_REVENUE, settingsErrors, withDefaults } from './offerForm/settings';
import type {
  Offer, Advertiser, TrackingDomain, OfferTargeting,
  OfferAttributionSettings, OfferRevenueSettings, OfferEmailSettings,
} from '../../types';

const TABS = ['General', 'Tracking & Controls', 'Postback Configuration', 'Revenue & Payout (Events)', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'] as const;
// Everflow-reference order (Active · Paused · Draft). Edit keeps Archived as a 4th card — unlike the
// create form — so an already-archived offer still shows its current status. Labels and tones come
// from lib/offerStatus; the API value stays the raw enum member.
const STATUSES = ['active', 'paused', 'draft', 'archived'] as const;
const STATUS_OPTIONS = STATUSES.map((v) => ({ value: v, label: OFFER_STATUS_LABEL[v] ?? v, tone: OFFER_STATUS_TONE[v] ?? ('neutral' as const) }));
const STATUS_HINT = 'Draft = setup in progress (not live). Active = running. Paused = temporarily stopped. Archived = hidden from partners.';
const VISIBILITIES = ['public', 'private', 'ask'] as const;
const VISIBILITY_OPTIONS = VISIBILITIES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
const VISIBILITY_HINT = 'Public = any partner can find and run it. Private = only partners you grant access. Ask = partners must request approval.';
const GROUP_HINT = "Adds this offer to a group for shared reporting and curation. Group-level caps are stored for reference but not enforced at the click level yet — only the offer's own caps enforce. Change this later from either side.";
/** Tabs whose fields carry existing hints (Field help). Every tab keeps the aside column so the card never changes width. */
const HINT_TABS = new Set<string>(['General', 'Tracking & Controls', 'Postback Configuration', 'Revenue & Payout (Events)', 'Attribution', 'Email']);
const LINKING_TYPES = [{ value: 'redirect', label: 'Redirect Linking' }, { value: 'redirect_direct', label: 'Redirect + Direct Linking' }];
/** CPC pays per click, CPM per 1,000 impressions (backend lib/offer-settings/billing.ts); the rest per conversion. */
const PAYOUT_LABEL: Record<string, string> = { CPC: 'Payout Per Click', CPM: 'Payout Per 1,000 Impressions' };
const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'BRL'];
/** Category picker option that switches to the "New category name" text input. */
const NEW_CATEGORY = '__new__';
type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => import('react').ReactNode): Column<Row> => ({ header, cell });

interface FormState {
  name: string; status: string; advertiserId: string; category: string; currency: string;
  visibility: string; destinationUrl: string; previewUrl: string; description: string;
  dailyClickCap: string; dailyConversionCap: string; totalConversionCap: string;
  /** '' = the network's cap time zone. */
  capTimezone: string;
  payoutModel: string; defaultPayout: string; defaultRevenue: string;
  attributionWindowS: string; dedupWindowS: string; fallbackUrl: string; allowedTrafficTypes: string[];
  trackingDomainId: string;
  linkingType: string; deepLinkEnabled: boolean; firePartnerPostback: boolean; impressionUrl: string;
  appIdentifier: string; internalNotes: string; productId: string; thumbnailUrl: string;
  targeting: OfferTargeting;
  attribution: OfferAttributionSettings; revenue: OfferRevenueSettings; email: OfferEmailSettings;
}

export default function OfferEdit() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const confirm = useConfirm();
  const base = `/api/offers/${id}`;
  const { data: offer, loading, error, refetch } = useQuery<Offer>(base);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: groups, refetch: refetchGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  const { data: allOffers } = useQuery<Offer[]>('/api/offers');
  // The network's cap time zone — what "Network default" means for this offer's caps.
  const { data: netSettings } = useQuery<{ general: { capTimezone?: string } }>('/api/settings');
  const { data: networkSecurity } = useQuery<{ securityCode: string | null }>('/api/settings/security');
  // Category options = Control Center › Categories catalog ∪ names already on offers.
  const { options: categoryOptions, ensureCategory } = useOfferCategories((allOffers ?? []).map((o) => o.category));
  const [tab, setTab] = useState<string>('General');
  const [form, setForm] = useState<FormState | null>(null);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
  const [assignGroup, setAssignGroup] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [catNew, setCatNew] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const { run, busy, error: saveError } = useMutation((body: Record<string, unknown>) => api.patch(base, body));
  // One lock for the whole save (PATCH + offer-group sync), not just the PATCH — see useSubmitGuard.
  const { pending: saving, guard } = useSubmitGuard();
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
      capTimezone: offer.capTimezone ?? '',
      payoutModel: offer.payoutModel, defaultPayout: String(offer.defaultPayout), defaultRevenue: String(offer.defaultRevenue),
      attributionWindowS: offer.attributionWindowS != null ? String(offer.attributionWindowS) : '',
      dedupWindowS: offer.dedupWindowS != null ? String(offer.dedupWindowS) : '',
      fallbackUrl: offer.fallbackUrl ?? '', allowedTrafficTypes: offer.allowedTrafficTypes ?? [],
      trackingDomainId: offer.trackingDomainId ?? '',
      linkingType: offer.linkingType ?? 'redirect',
      impressionUrl: offer.impressionUrl ?? '',
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void guard(saveOffer);
  };

  /** Resolves true once saved and navigating back to the offer (keeps the button locked). */
  const saveOffer = async (): Promise<boolean> => {
    const tErrors = targetingErrors(form.targeting);
    const sErrors = settingsErrors(form.attribution, form.revenue, form.email);
    if (failTrafficEnabled && !form.fallbackUrl.trim()) sErrors.push('Fail Traffic: enter a Fallback URL or turn Fail Traffic off.');
    if (tErrors.length || sErrors.length) {
      setFormErrors([...tErrors.map((m) => `Targeting: ${m}`), ...sErrors]);
      if (tErrors.length) setTab('Targeting');
      return false;
    }
    setFormErrors([]);
    const normalizeUrl = (v: string) => (v && !/^https?:\/\//i.test(v) ? 'https://' + v : v);
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    const capOrNull = (v: string) => (capsEnabled && v !== '' ? Number(v) : null);
    if (form.category.trim()) await ensureCategory(form.category); // new names join the Control Center catalog
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, advertiserId: form.advertiserId, currency: form.currency,
      visibility: form.visibility, destinationUrl: normalizeUrl(form.destinationUrl), payoutModel: form.payoutModel,
      defaultPayout: form.defaultPayout || '0', defaultRevenue: form.defaultRevenue || '0',
      allowedTrafficTypes: form.allowedTrafficTypes,
      category: orNull(form.category),
      previewUrl: form.previewUrl.trim() ? normalizeUrl(form.previewUrl.trim()) : null,
      description: orNull(form.description),
      linkingType: form.linkingType,
      impressionUrl: form.impressionUrl.trim() || null,
      deepLinkEnabled: form.deepLinkEnabled,
      firePartnerPostback: form.firePartnerPostback,
      // Disabled or cleared → null, so the server really drops the old value.
      fallbackUrl: failTrafficEnabled && form.fallbackUrl.trim() ? normalizeUrl(form.fallbackUrl.trim()) : null,
      dailyClickCap: capOrNull(form.dailyClickCap),
      dailyConversionCap: capOrNull(form.dailyConversionCap),
      totalConversionCap: capOrNull(form.totalConversionCap),
      capTimezone: form.capTimezone || null,
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
    if (!(await run(body))) return false;

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
    if (failedGroups.length) await confirm({ title: 'Offer saved with warnings', message: `Offer saved, but its offer-group membership could not be updated for: ${failedGroups.join(', ')}.`, cancelLabel: null });
    nav(`/app/offers/${id}`);
    return true;
  };

  const trackHost = resolveTrackingHost(domains, form.trackingDomainId);
  const currentDomainId: string | null | undefined = offer?.trackingDomainId;
  const domainGroups = groupTrackingDomains(domains);

  const optionalFilled = [form.appIdentifier, form.previewUrl, form.internalNotes, form.productId, form.description].filter((v) => v.trim()).length;

  return (
    <>
      <PageHeader title={`Edit Offer: ${offer.name}`} subtitle={`Offers › ${offer.name} › Edit`} />
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      <form onSubmit={submit}>
      <FormLayout title={tab} layout="aside"
        requiredNote={<span className="flex items-center gap-1.5"><Info size={13} className="shrink-0 text-fg-muted" /> Fields with an asterisk (*) are mandatory.</span>}
        help={HINT_TABS.has(tab) ? { fallback: { title: tab, body: FIELD_HELP_EMPTY } } : undefined}>
        <div className="space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}
        {formErrors.length > 0 && (
          <ul className="space-y-0.5 rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">
            {formErrors.map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}

        {tab === 'General' && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
            <div className="md:col-span-2">
              <Field label="Name *" hint="Shown to partners in the offer list and on their tracking links — not the internal ID.">
                <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-2" data-help-label="Status *" data-help={STATUS_HINT}>
              <div className="mb-1.5 flex items-center"><span id="offer-edit-status-label" className="label !mb-0">Status *</span><HelpHint text={STATUS_HINT} /></div>
              <StatusChoice options={STATUS_OPTIONS} value={form.status as (typeof STATUSES)[number]} onChange={(v) => set('status', v)} ariaLabelledby="offer-edit-status-label" />
            </div>
            <div className="md:col-span-2" data-help-label="Visibility *" data-help={VISIBILITY_HINT}>
              <div className="mb-1.5 flex items-center"><span id="offer-edit-visibility-label" className="label !mb-0">Visibility *</span><HelpHint text={VISIBILITY_HINT} /></div>
              <ChoiceCards options={VISIBILITY_OPTIONS} value={form.visibility as (typeof VISIBILITIES)[number]} onChange={(v) => set('visibility', v)} ariaLabelledby="offer-edit-visibility-label" />
            </div>
            <Field label="Advertiser *" hint="The company that owns this offer. Payout & revenue roll up to them for reporting and invoicing, and their account / sales managers apply to it. Every offer belongs to exactly one.">
              <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Category" hint="Grouping label used for list filtering and marketplace facets. Pick an existing one, or choose “＋ New category…” to add a new label.">
              {catNew ? (
                <div className="flex gap-2">
                  <input className="input" autoFocus value={form.category} placeholder="New category name"
                    onChange={(e) => set('category', e.target.value)} />
                  <button type="button" className="btn-ghost shrink-0"
                    onClick={() => { setCatNew(false); set('category', ''); }}>Cancel</button>
                </div>
              ) : (
                <SearchablePicker single ariaLabel="Category" searchPlaceholder="Search categories…"
                  value={[form.category]}
                  options={[
                    { value: '', label: 'No category' },
                    ...(form.category && !categoryOptions.includes(form.category) ? [{ value: form.category, label: form.category }] : []),
                    ...categoryOptions.map((c) => ({ value: c, label: c })),
                    { value: NEW_CATEGORY, label: '＋ New category…' },
                  ]}
                  onChange={([v = '']) => {
                    if (v === NEW_CATEGORY) { setCatNew(true); set('category', ''); }
                    else set('category', v);
                  }} />
              )}
            </Field>
            <Field label="Currency *" hint="ISO 4217 3-letter code (e.g. USD). All payout, revenue and ledger amounts for this offer are recorded in it. Not validated server-side yet — enter a real code.">
              <input className="input" list="offer-currency-options" maxLength={3} pattern="[A-Za-z]{3}" title="Three-letter ISO 4217 code, e.g. USD" required value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            </Field>
            <datalist id="offer-currency-options">
              {COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
            </datalist>
            <div className="space-y-2">
              <span aria-hidden className="label mb-1.5 hidden md:block">&nbsp;</span>
              <ToggleRow label="Assign To Offer Group" checked={assignGroup} onChange={setAssignGroup} hint={GROUP_HINT} hintIcon />
              {assignGroup && (
                <select className="input" aria-label="Offer group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="" disabled>Select Offer Group…</option>
                  {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>
            <ThumbnailField offerId={id} url={form.thumbnailUrl} onUrlChange={(v) => set('thumbnailUrl', v)} />
            <div className="md:col-span-2"><LabelsEditor base={base} /></div>
            {/* Optional fields — an edit page opens this when any of them already has a value. */}
            <FormSection id="offer-edit-optional" title="Optional details" collapsible defaultOpen={optionalFilled > 0} filledCount={optionalFilled}
              summary="App Identifier · Preview URL · Internal Notes · Product ID · Description" className="md:col-span-2">
              <div className="grid grid-cols-1 gap-5 pt-2 md:grid-cols-2">
                <Field label="App Identifier" hint="Store bundle / package ID for app offers (e.g. com.acme.app or id123456789).">
                  <input className="input" placeholder="e.g. com.acme.app" maxLength={255} value={form.appIdentifier} onChange={(e) => set('appIdentifier', e.target.value)} />
                </Field>
                <Field label="Preview URL" hint="A no-tracking link partners can open to see the landing page before running traffic.">
                  <input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Internal Notes" hint="Visible to your team only — never shown to partners or advertisers.">
                    <textarea className="input min-h-[80px]" value={form.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />
                  </Field>
                </div>
                <Field label="Product ID" hint="Your own or the advertiser's product / SKU reference for this offer.">
                  <input className="input" maxLength={255} value={form.productId} onChange={(e) => set('productId', e.target.value)} />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Description" hint="Notes about the offer for your team and partners. Plain text.">
                    <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
                  </Field>
                </div>
              </div>
            </FormSection>
          </div>
        )}

        {tab === 'Tracking & Controls' && (
          <div className="space-y-6">
            <FormSection id="offer-edit-tracking" title="Tracking">
            <div className="space-y-4">
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
              <Field label="Impression URL" hint="Optional — the advertiser's or MMP's impression link. The impression pixel sends the browser there with {imp_id} and the click macros filled in; without one it answers with a 1×1 pixel.">
                <input className="input" placeholder="https://… {imp_id}" value={form.impressionUrl} onChange={(e) => set('impressionUrl', e.target.value)} />
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
            </FormSection>

            <FormSection id="offer-edit-caps" title="Caps" className="border-t border-border pt-6">
            <div className="space-y-4">
              <ToggleRow label="Enable Caps" checked={capsEnabled} onChange={setCapsEnabled} />
              {capsEnabled && (
                <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-3">
                  <Field label="Daily Click Cap"><input type="number" min={0} className="input" value={form.dailyClickCap} onChange={(e) => set('dailyClickCap', e.target.value)} placeholder="Unlimited" /></Field>
                  <Field label="Daily Conversion Cap"><input type="number" min={0} className="input" value={form.dailyConversionCap} onChange={(e) => set('dailyConversionCap', e.target.value)} placeholder="Unlimited" /></Field>
                  <Field label="Total Conversion Cap"><input type="number" min={0} className="input" value={form.totalConversionCap} onChange={(e) => set('totalConversionCap', e.target.value)} placeholder="Unlimited" /></Field>
                </div>
              )}
              {!capsEnabled && <p className="text-tiny text-fg-muted">Caps off — saving removes any existing caps on this offer.</p>}
              <Field label="Cap Time Zone" hint="When this offer's daily caps — and its partners' caps (Custom Settings) — start over: midnight in this zone. The advertiser who says “500 a day” may count the day in their own zone.">
                <CapTimeZoneSelect value={form.capTimezone} onChange={(tz) => set('capTimezone', tz)}
                  inheritLabel={`Network default — ${netSettings?.general.capTimezone ?? 'UTC'}`} />
              </Field>
            </div>
            </FormSection>
          </div>
        )}

        {tab === 'Postback Configuration' && (
          <div className="space-y-6">
            <p className="text-small text-fg-secondary">Give this URL to the advertiser. They should fire it from their server when a user converts. The click_id is passed automatically via the redirect.</p>
            <div className="space-y-4">
              <Field label="S2S Postback URL" hint="The advertiser replaces {click_id} and {txn_id} with their own values. The secure code is already filled in.">
                {offer.securityCodeHidden
                  ? <p className="rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg-secondary">Only admins and managers can see this offer's postback URL, because it contains the security code.</p>
                  : <CopyBox value={advertiserPostbackUrl(trackHost, offer.securityCode ?? networkSecurity?.securityCode)} placeholder="No active tracking domain — add one first." />}
              </Field>
              <div>
                <p className="label mb-2 block">Postback Parameters</p>
                <div className="overflow-x-auto">
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
            </div>

            <FormSection id="offer-edit-security-code" title="Per-Offer Security Code" className="border-t border-border pt-6">
            <div className="space-y-4">
              <p className="text-small text-fg-secondary">Overrides the network-wide code when set. The advertiser must include the per-offer security code in their postback. Leave empty to use the network default.</p>
              {offer.securityCodeHidden ? (
                <p className="text-small text-fg-secondary">{offer.securityCodeSet ? 'This offer has its own security code — hidden for your role.' : 'This offer uses the network default code.'}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input className="input font-mono text-tiny" readOnly value={offer.securityCode ?? ''} placeholder="No per-offer code set — using network default" />
                  </div>
                  <button type="button" className="btn-ghost !py-2" disabled={regenCode.busy} onClick={regenerateCode}>{regenCode.busy ? 'Generating…' : (offer.securityCode ? 'Regenerate' : 'Generate')}</button>
                  {offer.securityCode && <button type="button" className="btn-ghost !py-2 text-danger-text" disabled={clearCode.busy} onClick={removeCode}>Remove</button>}
                </div>
              )}
              {(regenCode.error || clearCode.error) && <p className="text-small text-danger-text">{regenCode.error ?? clearCode.error}</p>}
            </div>
            </FormSection>

            <FormSection id="offer-edit-publisher-postback" title="Publisher Postback" className="border-t border-border pt-6">
              <div>
                <label className="flex items-start gap-2 text-small text-fg">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={form.firePartnerPostback} onChange={(e) => set('firePartnerPostback', e.target.checked)} />
                  <span><strong>Fire Partner Postback</strong> — automatically notify publishers via their configured postback URL when a conversion is approved.</span>
                </label>
                <p className="mt-1 text-tiny text-fg-secondary">Publisher postback URLs and macros are configured separately on each publisher's postback settings. When enabled, approved conversions trigger an outbound call to the publisher with their configured macro template.</p>
              </div>
            </FormSection>
          </div>
        )}

        {tab === 'Revenue & Payout (Events)' && (
          <div className="space-y-6">
            <RevenueSettingsPanel value={form.revenue} onChange={(v) => set('revenue', v)}
              firePartnerPostback={form.firePartnerPostback} onFirePartnerPostbackChange={(v) => set('firePartnerPostback', v)}
              revenue={form.defaultRevenue} onRevenueChange={(v) => set('defaultRevenue', v)} />

            <FormSection id="offer-edit-base-payout" title="Base Payout" className="border-t border-border pt-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Model">
                <select className="input" value={form.payoutModel} onChange={(e) => set('payoutModel', e.target.value)}>
                  {['CPA', 'CPL', 'CPC', 'CPI', 'CPM', 'RevShare'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label={`${PAYOUT_LABEL[form.payoutModel] ?? 'Payout Per Action'} *`}><input className="input" value={form.defaultPayout} onChange={(e) => set('defaultPayout', e.target.value)} /></Field>
            </div>
            </FormSection>
          </div>
        )}

        {tab === 'Attribution' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 md:grid-cols-2">
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
          <div className="space-y-4">
            <ToggleRow label="Enable Fail Traffic" checked={failTrafficEnabled} onChange={setFailTrafficEnabled} />
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
        </div>
      </FormLayout>
      <FormFooter
        cancel={<button type="button" className="btn-ghost" onClick={() => nav(`/app/offers/${id}`)}>Cancel</button>}
        primary={{ label: busy || saving ? 'Saving…' : 'Save', disabled: busy || saving, busy: busy || saving }} />
      </form>
    </>
  );
}
