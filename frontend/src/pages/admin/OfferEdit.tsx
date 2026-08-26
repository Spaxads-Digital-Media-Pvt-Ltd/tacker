/**
 * Edit Offer (Everflow-style multi-tab edit form). Real Offer columns (name, status, advertiserId,
 * category, currency, visibility, destinationUrl, previewUrl, description, caps, attribution/dedup
 * windows, fallbackUrl, allowedTrafficTypes, payoutModel, defaultRevenue, defaultPayout,
 * trackingDomainId) are wired to the actual PATCH /api/offers/:id endpoint. Tracking Domain pulls
 * from /api/tracking-domains; Assign to Offer Group reads/writes membership on /api/offer-groups
 * (that table has no offer→group column, only group→offerIds, so submit diffs group membership
 * separately from the main PATCH). Every other field in the reference (Thumbnail, fraud/attribution
 * toggles, geo/device targeting rules, email suppression…) has no equivalent in this app's schema,
 * so those render as real, full-color, interactive controls that simply aren't wired to persist —
 * never a disabled/greyed-out fake. Creatives reuses the same real CollectionTab already on the
 * Offer Detail page.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Tabs, Spinner, StateBlock, type Column } from '../../components/ui';
import { CollectionTab, type FieldDef } from '../../components/CollectionTab';
import type { Offer, Advertiser, TrackingDomain } from '../../types';

const TABS = ['General', 'Tracking & Controls', 'Revenue & Payout (Events)', 'Attribution', 'Targeting', 'Fail Traffic', 'Creatives', 'Email'] as const;
const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const STATUS_DOT: Record<string, string> = { draft: 'bg-fg-muted', active: 'bg-success', paused: 'bg-warning', archived: 'bg-danger' };
const VISIBILITIES = ['public', 'private', 'ask'] as const;
const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => import('react').ReactNode): Column<Row> => ({ header, cell });

interface FormState {
  name: string; status: string; advertiserId: string; category: string; currency: string;
  visibility: string; destinationUrl: string; previewUrl: string; description: string;
  dailyClickCap: string; dailyConversionCap: string; totalConversionCap: string;
  payoutModel: string; defaultPayout: string; defaultRevenue: string;
  attributionWindowS: string; dedupWindowS: string; fallbackUrl: string; allowedTrafficTypes: string[];
  trackingDomainId: string;
}

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

/** Left list + right panel picker used by the Targeting tab. Only `active===realKey` shows real
 * content (device chips); every other row is a visual match for the reference with no backing rule. */
function CategoryPicker({ categories, panel }: { categories: string[]; panel: (c: string) => import('react').ReactNode }) {
  const [active, setActive] = useState<string>(categories[0] ?? '');
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-card border border-border sm:grid-cols-[220px_1fr]">
      <div className="divide-y divide-border border-b border-border sm:border-b-0 sm:border-r">
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setActive(c)}
            className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-small ${active === c ? 'bg-accent-subtle font-medium text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
            {c}<span>›</span>
          </button>
        ))}
      </div>
      <div className="min-h-[120px] bg-page p-4">{panel(active)}</div>
    </div>
  );
}

// ── Tabs with no real backing fields at all — extracted so their toggles/segments can hold
// genuine local state (real clicks, real visual feedback) instead of dead onChange={() => {}}. ────

function TrackingExtras({ domains, value, onChange }: { domains: TrackingDomain[]; value: string; onChange: (v: string) => void }) {
  const [linkingType, setLinkingType] = useState('Redirect Linking');
  const [convMethod, setConvMethod] = useState('Server To Server Postback');
  return (
    <>
      <p className="text-small font-semibold text-fg">Tracking Domain</p>
      <Field label="Tracking Domain *">
        <select className="input" required value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Tracking Domain…</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
        </select>
      </Field>

      <p className="text-small font-semibold text-fg">Click Tracking</p>
      <div>
        <label className="label mb-2 block">Linking Type *</label>
        <Segmented options={['Redirect Linking', 'Redirect + Direct Linking']} value={linkingType} onChange={setLinkingType} />
      </div>

      <p className="text-small font-semibold text-fg">Conversion Event Tracking</p>
      <div>
        <label className="label mb-2 block">Conversion Tracking Method *</label>
        <Segmented options={['Server To Server Postback', 'Javascript SDK', 'HTML Pixel']} value={convMethod} onChange={setConvMethod} />
      </div>

      <div>
        <label className="flex items-start gap-2 text-small text-fg">
          <input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-border" />
          <span><strong>Support Deep Links</strong> — Allow Partners to direct traffic to alternate landing pages without additional Offer URLs.</span>
        </label>
      </div>
    </>
  );
}

function RevenueExtras({ revenue, onRevenueChange }: { revenue: string; onRevenueChange: (v: string) => void }) {
  const [revenueAction, setRevenueAction] = useState('Base Conversion Event');
  const [revenueType, setRevenueType] = useState('Fixed Revenue');
  const [pricePerProduct, setPricePerProduct] = useState(false);
  return (
    <>
      <div>
        <label className="label mb-2 block">Revenue Action *</label>
        <Segmented options={['Impression', 'Click', 'Base Conversion Event']} value={revenueAction} onChange={setRevenueAction} />
      </div>
      <div className="space-y-3 rounded-card border border-border bg-page p-4">
        <label className="label mb-1 block">Revenue Type *</label>
        <Segmented options={['Fixed Revenue', 'Percentage Revenue', 'Mixed Revenue']} value={revenueType} onChange={setRevenueType} />
        <Field label="Revenue Per Action (RPA) *"><input className="input" value={revenue} onChange={(e) => onRevenueChange(e.target.value)} /></Field>
        <label className="flex items-start gap-2 text-small text-fg">
          <input type="checkbox" checked={pricePerProduct} onChange={(e) => setPricePerProduct(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border" />
          <span><strong>Price Per Product</strong> — enable custom pricing per product.</span>
        </label>
      </div>
    </>
  );
}

function AttributionExtras() {
  const [method, setMethod] = useState('Last Touch');
  const [tracker24, setTracker24] = useState(false);
  const [ipQuality, setIpQuality] = useState(false);
  const [throttle, setThrottle] = useState(false);
  const [clickToConv, setClickToConv] = useState(true);
  const [emailOwnership, setEmailOwnership] = useState(false);
  const [viewThrough, setViewThrough] = useState(false);
  const [serverSideClick, setServerSideClick] = useState(false);
  return (
    <>
      <div>
        <label className="label mb-2 block">Attribution Method</label>
        <Segmented options={['Last Touch', 'First Touch']} value={method} onChange={setMethod} />
      </div>
      <div>
        <label className="label mb-2 block">24metrics Tracker</label>
        <div className="flex items-center gap-2">
          <YesNoToggle on={tracker24} onChange={setTracker24} />
          {tracker24 && <select className="input"><option>Not available yet</option></select>}
        </div>
      </div>
      <div>
        <label className="label mb-2 block">Enable IPQualityScore Fraud Detection</label>
        <YesNoToggle on={ipQuality} onChange={setIpQuality} />
      </div>
      <div>
        <label className="label mb-2 block">Apply Throttle Rate</label>
        <YesNoToggle on={throttle} onChange={setThrottle} />
      </div>
      <div>
        <label className="label mb-2 block">Enable Click to Conversion Time</label>
        <YesNoToggle on={clickToConv} onChange={setClickToConv} />
        {clickToConv && (
          <div className="mt-3 grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
            <Field label="Minimum Lookback Window"><input className="input" defaultValue="5 Seconds" /></Field>
            <Field label="Max. Approved Click to Conversion Time"><select className="input" defaultValue="6 Hours"><option>6 Hours</option><option>12 Hours</option><option>24 Hours</option></select></Field>
          </div>
        )}
      </div>
      <div>
        <label className="label mb-2 block">Enable Email Ownership</label>
        <YesNoToggle on={emailOwnership} onChange={setEmailOwnership} />
      </div>
      <div>
        <label className="label mb-2 block">Enable View-Through</label>
        <YesNoToggle on={viewThrough} onChange={setViewThrough} />
      </div>
      <div>
        <label className="label mb-2 block">Enable Server-Side Click</label>
        <YesNoToggle on={serverSideClick} onChange={setServerSideClick} />
      </div>
    </>
  );
}

function EmailTab() {
  const [suppressionFile, setSuppressionFile] = useState(false);
  const [ezepo, setEzepo] = useState(false);
  const [optizmo, setOptizmo] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [optOut, setOptOut] = useState(false);
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <label className="label mb-2 block">Enable Suppression File</label>
        <YesNoToggle on={suppressionFile} onChange={setSuppressionFile} />
      </div>
      <div>
        <label className="label mb-2 block">Ezepo Enabled</label>
        <input type="checkbox" checked={ezepo} onChange={(e) => setEzepo(e.target.checked)} className="h-4 w-4 rounded border-border" />
      </div>
      <div>
        <label className="label mb-2 block">Optizmo Suppression List</label>
        <YesNoToggle on={optizmo} onChange={setOptizmo} />
      </div>
      <div>
        <label className="label mb-2 block">Enable Email Instructions</label>
        <YesNoToggle on={instructions} onChange={setInstructions} />
      </div>
      <div>
        <label className="label mb-2 block">Enable Email Opt-out</label>
        <YesNoToggle on={optOut} onChange={setOptOut} />
      </div>
    </div>
  );
}

export default function OfferEdit() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const base = `/api/offers/${id}`;
  const { data: offer, loading, error } = useQuery<Offer>(base);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const { data: groups, refetch: refetchGroups } = useQuery<{ id: string; name: string; offerIds: string[] }[]>('/api/offer-groups');
  const [tab, setTab] = useState<string>('General');
  const [form, setForm] = useState<FormState | null>(null);
  const [capsEnabled, setCapsEnabled] = useState(false);
  const [failTrafficEnabled, setFailTrafficEnabled] = useState(false);
  const [assignGroup, setAssignGroup] = useState(false);
  const [groupId, setGroupId] = useState('');
  const { run, busy, error: saveError } = useMutation((body: Record<string, unknown>) => api.patch(base, body));

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
  const toggleDevice = (d: string) => set('allowedTrafficTypes', form.allowedTrafficTypes.includes(d) ? form.allowedTrafficTypes.filter((x) => x !== d) : [...form.allowedTrafficTypes, d]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: form.name, status: form.status, advertiserId: form.advertiserId, currency: form.currency,
      visibility: form.visibility, destinationUrl: form.destinationUrl, payoutModel: form.payoutModel,
      defaultPayout: form.defaultPayout || '0', defaultRevenue: form.defaultRevenue || '0',
      allowedTrafficTypes: form.allowedTrafficTypes,
    };
    if (form.category) body.category = form.category;
    if (form.previewUrl) body.previewUrl = form.previewUrl;
    if (form.description) body.description = form.description;
    if (form.trackingDomainId) body.trackingDomainId = form.trackingDomainId;
    if (failTrafficEnabled && form.fallbackUrl) body.fallbackUrl = form.fallbackUrl;
    if (capsEnabled) {
      if (form.dailyClickCap) body.dailyClickCap = Number(form.dailyClickCap);
      if (form.dailyConversionCap) body.dailyConversionCap = Number(form.dailyConversionCap);
      if (form.totalConversionCap) body.totalConversionCap = Number(form.totalConversionCap);
    }
    if (form.attributionWindowS) body.attributionWindowS = Number(form.attributionWindowS);
    if (form.dedupWindowS) body.dedupWindowS = Number(form.dedupWindowS);
    if (!(await run(body))) return;

    // Sync offer-group membership: drop this offer from any group it's currently in, then add it
    // to the newly selected one (if the toggle is on).
    if (groups) {
      for (const g of groups) {
        const has = g.offerIds?.includes(id);
        const shouldHave = assignGroup && g.id === groupId;
        if (has && !shouldHave) await api.patch(`/api/offer-groups/${g.id}`, { offerIds: g.offerIds.filter((o) => o !== id) });
        else if (!has && shouldHave) await api.patch(`/api/offer-groups/${g.id}`, { offerIds: [...g.offerIds, id] });
      }
      refetchGroups();
    }
    nav(`/app/offers/${id}`);
  };

  return (
    <>
      <PageHeader title={`Edit Offer: ${offer.name}`} subtitle={`Offers › ${offer.name} › Edit`} />
      <div className="max-w-3xl mx-auto">
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      <form onSubmit={submit} className="card space-y-6">
        {saveError && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{saveError}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {tab === 'General' && (
          <div className="max-w-2xl space-y-4">
            <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div>
              <label className="label mb-2 block">Status *</label>
              <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Advertiser *">
                <select className="input" required value={form.advertiserId} onChange={(e) => set('advertiserId', e.target.value)}>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <div>
                <label className="label mb-2 block">Thumbnail</label>
                <div className="grid h-[74px] place-items-center rounded-card border border-dashed border-border text-tiny text-fg-muted">Drag and drop or Browse</div>
              </div>
            </div>
            <Field label="Category"><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Fashion" /></Field>
            <Field label="Currency *"><input className="input" maxLength={3} required value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            <div>
              <label className="label mb-2 block">Visibility *</label>
              <Segmented options={VISIBILITIES} value={form.visibility} onChange={(v) => set('visibility', v)} />
            </div>
            <div>
              <label className="label mb-2 block">Assign To Offer Group</label>
              <div className="flex items-center gap-2">
                <YesNoToggle on={assignGroup} onChange={setAssignGroup} />
                {assignGroup && (
                  <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    <option value="" disabled>Select Offer Group…</option>
                    {(groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            <Field label="Labels"><textarea className="input min-h-[60px]" placeholder="Add labels…" /></Field>
            <Field label="App Identifier"><input className="input" /></Field>
            <Field label="Preview URL"><input className="input" value={form.previewUrl} onChange={(e) => set('previewUrl', e.target.value)} /></Field>
            <Field label="Internal Notes"><textarea className="input min-h-[80px]" /></Field>
            <Field label="Product ID"><input className="input" /></Field>
            <Field label="Description"><textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
          </div>
        )}

        {tab === 'Tracking & Controls' && (
          <div className="max-w-2xl space-y-6">
            <div className="space-y-4">
              <h3 className="text-h3 font-medium text-fg">Tracking</h3>
              <p className="text-small font-semibold text-fg">Default Landing Page</p>
              <Field label="Default Landing Page URL *"><textarea className="input min-h-[80px] font-mono text-tiny" required value={form.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} /></Field>

              <TrackingExtras domains={domains ?? []} value={form.trackingDomainId} onChange={(v) => set('trackingDomainId', v)} />
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
            </div>
          </div>
        )}

        {tab === 'Revenue & Payout (Events)' && (
          <div className="max-w-2xl space-y-6">
            <div className="space-y-4">
              <h3 className="text-h3 font-medium text-fg">Base Conversion Event</h3>
              <p className="text-tiny text-fg-muted">Default name is set as Base, but you can change it.</p>
              <Field label="Base Conversion Event Name"><input className="input" defaultValue="Base" /></Field>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-small text-fg"><input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-border" /><span><strong>Fire Partner Postback</strong> — fire Partner Postbacks when a conversion or Event is approved.</span></label>
                <label className="flex items-start gap-2 text-small text-fg"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" /><span><strong>Manually Approve Conversions</strong> — require manual approval for Partner conversions.</span></label>
                <label className="flex items-start gap-2 text-small text-fg"><input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-border" /><span><strong>Allow Duplicate Conversions</strong> — allow duplicate conversions triggered by the same click ID.</span></label>
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-4">
              <h3 className="text-h3 font-medium text-fg">Base Revenue</h3>
              <RevenueExtras revenue={form.defaultRevenue} onRevenueChange={(v) => set('defaultRevenue', v)} />
            </div>

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

            <AttributionExtras />
          </div>
        )}

        {tab === 'Targeting' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-h3 font-medium text-fg">Inclusion/Exclusion Summary</h3>
              {form.allowedTrafficTypes.length === 0 ? (
                <p className="text-small italic text-fg-muted">No targeting rules configured — all traffic is allowed.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {form.allowedTrafficTypes.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-success bg-success-bg px-3 py-1 text-tiny font-medium capitalize text-success-text">
                      Device: {d}<button type="button" onClick={() => toggleDevice(d)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-h3 font-medium text-fg">Device Characteristics</h3>
              <CategoryPicker
                categories={['Platform', 'Device Type', 'Browser', 'Device Brand', 'OS Version', 'Language']}
                panel={(c) => c === 'Device Type' ? (
                  <div className="flex flex-wrap gap-2">
                    {DEVICES.map((d) => (
                      <button key={d} type="button" onClick={() => toggleDevice(d)}
                        className={`rounded-full border px-4 py-1.5 text-small font-medium capitalize transition-colors ${form.allowedTrafficTypes.includes(d) ? 'border-accent bg-accent-subtle text-accent-text' : 'border-border bg-surface text-fg-secondary hover:bg-page'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                ) : <p className="text-tiny text-fg-muted">Not available yet.</p>}
              />
            </div>

            <div>
              <h3 className="mb-2 text-h3 font-medium text-fg">Geolocation</h3>
              <CategoryPicker categories={['Country', 'Region', 'City', 'DMA', 'Mobile Carrier', 'ISP']} panel={() => <p className="text-tiny text-fg-muted">Not available yet.</p>} />
            </div>

            <Field label="ZIP/Postal Code"><textarea className="input min-h-[100px]" placeholder="Enter one value per line" /></Field>

            <div>
              <h3 className="mb-2 text-h3 font-medium text-fg">IP Ranges</h3>
              <CategoryPicker categories={['Exact', 'Range']} panel={() => <p className="text-tiny text-fg-muted">Not available yet.</p>} />
            </div>
          </div>
        )}

        {tab === 'Fail Traffic' && (
          <div className="max-w-2xl space-y-4">
            <div>
              <label className="label mb-2 block">Enable Fail Traffic</label>
              <YesNoToggle on={failTrafficEnabled} onChange={setFailTrafficEnabled} />
            </div>
            {failTrafficEnabled && (
              <div className="rounded-card border border-border bg-page p-4">
                <Field label="Fallback URL"><input className="input" value={form.fallbackUrl} onChange={(e) => set('fallbackUrl', e.target.value)} placeholder="https://…" /></Field>
                <p className="mt-2 text-tiny text-fg-muted">Traffic that fails targeting/cap rules redirects here instead of the offer's destination URL.</p>
              </div>
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

        {tab === 'Email' && <EmailTab />}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => nav(`/app/offers/${id}`)}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
      </div>
    </>
  );
}
