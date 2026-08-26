/**
 * Marketplace › Your Profile(s) › Edit — verified field-for-field against the live reference's real
 * Edit form (`/everxchange/profiles/partner/edit`, screenshots supplied by the user): General tab
 * (Name, Logo, Description, Categories [targeted up to 5, or All], Conversion Funnel Expertise,
 * Promotional Methods Accepted, Payout Types Accepted, Device Types Covered, Geolocations Covered
 * [global or up to 5 specific], Website URL, then a Contact section — visibility toggle, First/Last
 * Name, Phone, Email, Social Media links, one custom link, and a "Require a Default Marketplace
 * Offer" toggle) and a Review tab (the same Discovery/Pop Up cards as the Preview page, rendered
 * live off the current draft). The reference's own submit button reads "Request Changes" (profile
 * edits there go through review by Everflow); kept as the real button label here even though this
 * app's single-tenant PUT applies immediately — same real action (submit the profile you want
 * shown), just without a counterparty to review it.
 *
 * Logo is a URL field rather than a file upload: this app has no file-upload/asset-storage
 * infrastructure anywhere (checked — no multer/upload routes exist), so a real URL you paste in is
 * the honest equivalent rather than building new upload plumbing for one field.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useMutation, useQuery } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { MarketplaceProfileCards } from '../../components/MarketplaceProfileCards';
import { PAYOUT_TYPES, PROMOTIONAL_METHODS, DEVICE_TYPES, MARKETPLACE_CATEGORIES, CONVERSION_FUNNEL_EXPERTISE } from '../../lib/marketplaceProfile';
import type { MarketplaceProfile } from '../../types';

interface AggResult { rows: { dimensions: Record<string, string | null> }[] }

interface Draft {
  name: string; description: string; logoUrl: string;
  categoriesMode: 'targeted' | 'all'; categories: string[];
  conversionFunnelExpertise: string[]; promotionalMethods: string[]; payoutTypesAccepted: string[];
  deviceTypesCovered: string[]; geolocationsMode: 'global' | 'specific'; geolocations: string[];
  websiteUrl: string; contactSharePublicly: boolean;
  contactFirstName: string; contactLastName: string; contactPhone: string; contactEmail: string;
  socialTwitter: string; socialInstagram: string; socialMeta: string; socialTiktok: string; socialYoutube: string; socialLinkedin: string;
  customLinkLabel: string; customLinkUrl: string; requireDefaultOffer: boolean;
}
const EMPTY_DRAFT: Draft = {
  name: '', description: '', logoUrl: '', categoriesMode: 'targeted', categories: [],
  conversionFunnelExpertise: [], promotionalMethods: [], payoutTypesAccepted: [], deviceTypesCovered: [],
  geolocationsMode: 'global', geolocations: [], websiteUrl: '', contactSharePublicly: false,
  contactFirstName: '', contactLastName: '', contactPhone: '', contactEmail: '',
  socialTwitter: '', socialInstagram: '', socialMeta: '', socialTiktok: '', socialYoutube: '', socialLinkedin: '',
  customLinkLabel: '', customLinkUrl: '', requireDefaultOffer: false,
};
function fromProfile(p: MarketplaceProfile): Draft {
  return {
    name: p.name, description: p.description ?? '', logoUrl: p.logoUrl ?? '',
    categoriesMode: p.categoriesMode, categories: p.categories,
    conversionFunnelExpertise: p.conversionFunnelExpertise, promotionalMethods: p.promotionalMethods,
    payoutTypesAccepted: p.payoutTypesAccepted, deviceTypesCovered: p.deviceTypesCovered,
    geolocationsMode: p.geolocationsMode, geolocations: p.geolocations, websiteUrl: p.websiteUrl ?? '',
    contactSharePublicly: p.contactSharePublicly, contactFirstName: p.contactFirstName ?? '',
    contactLastName: p.contactLastName ?? '', contactPhone: p.contactPhone ?? '', contactEmail: p.contactEmail ?? '',
    socialTwitter: p.socialTwitter ?? '', socialInstagram: p.socialInstagram ?? '', socialMeta: p.socialMeta ?? '',
    socialTiktok: p.socialTiktok ?? '', socialYoutube: p.socialYoutube ?? '', socialLinkedin: p.socialLinkedin ?? '',
    customLinkLabel: p.customLinkLabel ?? '', customLinkUrl: p.customLinkUrl ?? '', requireDefaultOffer: p.requireDefaultOffer,
  };
}
function toPreviewProfile(d: Draft): MarketplaceProfile {
  return {
    id: 'draft', name: d.name || 'Your Company', description: d.description || null, logoUrl: d.logoUrl || null,
    categoriesMode: d.categoriesMode, categories: d.categories, conversionFunnelExpertise: d.conversionFunnelExpertise,
    promotionalMethods: d.promotionalMethods, payoutTypesAccepted: d.payoutTypesAccepted, deviceTypesCovered: d.deviceTypesCovered,
    geolocationsMode: d.geolocationsMode, geolocations: d.geolocations, websiteUrl: d.websiteUrl || null,
    contactSharePublicly: d.contactSharePublicly, contactFirstName: d.contactFirstName || null, contactLastName: d.contactLastName || null,
    contactPhone: d.contactPhone || null, contactEmail: d.contactEmail || null,
    socialTwitter: d.socialTwitter || null, socialInstagram: d.socialInstagram || null, socialMeta: d.socialMeta || null,
    socialTiktok: d.socialTiktok || null, socialYoutube: d.socialYoutube || null, socialLinkedin: d.socialLinkedin || null,
    customLinkLabel: d.customLinkLabel || null, customLinkUrl: d.customLinkUrl || null, requireDefaultOffer: d.requireDefaultOffer,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function MultiSelect({ label, options, selected, onChange, max, required }: {
  label: string; options: readonly string[]; selected: string[]; onChange: (v: string[]) => void; max?: number; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else if (!max || selected.length < max) onChange([...selected, v]);
  };
  return (
    <div className="relative">
      <label className="label mb-1 block">{label} {required && <span className="text-danger-text">*</span>} {max ? <span className="text-fg-muted">({selected.length}/{max})</span> : null}</label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex w-full items-center justify-between !py-2 text-left">
        <span className="truncate">{selected.length ? selected.join(', ') : 'Select…'}</span> <ChevronDown size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {options.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                <input type="checkbox" className="chk" checked={selected.includes(o)} onChange={() => toggle(o)} disabled={!selected.includes(o) && !!max && selected.length >= max} />
                {o}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MarketplaceProfileEdit() {
  const navigate = useNavigate();
  const { data, loading } = useQuery<MarketplaceProfile | null>('/api/marketplace-profile');
  const [tab, setTab] = useState<'general' | 'review'>('general');
  const [draft, setDraft] = useState<Draft | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d ? { ...d, [k]: v } : d);

  const { data: countryAgg } = useQuery<AggResult>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => [...new Set((countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)))].sort(), [countryAgg]);

  const { run: save, busy, error } = useMutation((body: Record<string, unknown>) => api.put('/api/marketplace-profile', body));

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const d = draft ?? (data ? fromProfile(data) : EMPTY_DRAFT);
  if (!draft) setDraft(d);

  const canSubmit = d.name.trim() && d.description.trim() && d.websiteUrl.trim()
    && (d.categoriesMode === 'all' || d.categories.length > 0)
    && d.promotionalMethods.length > 0 && d.payoutTypesAccepted.length > 0 && d.deviceTypesCovered.length > 0
    && (d.geolocationsMode === 'global' || d.geolocations.length > 0)
    && d.contactFirstName.trim() && d.contactLastName.trim() && d.contactEmail.trim();

  const submit = async () => {
    const body = {
      name: d.name, description: d.description, logoUrl: d.logoUrl || undefined,
      categoriesMode: d.categoriesMode, categories: d.categories,
      conversionFunnelExpertise: d.conversionFunnelExpertise, promotionalMethods: d.promotionalMethods,
      payoutTypesAccepted: d.payoutTypesAccepted, deviceTypesCovered: d.deviceTypesCovered,
      geolocationsMode: d.geolocationsMode, geolocations: d.geolocations, websiteUrl: d.websiteUrl,
      contactSharePublicly: d.contactSharePublicly, contactFirstName: d.contactFirstName, contactLastName: d.contactLastName,
      contactPhone: d.contactPhone || undefined, contactEmail: d.contactEmail,
      socialTwitter: d.socialTwitter || undefined, socialInstagram: d.socialInstagram || undefined, socialMeta: d.socialMeta || undefined,
      socialTiktok: d.socialTiktok || undefined, socialYoutube: d.socialYoutube || undefined, socialLinkedin: d.socialLinkedin || undefined,
      customLinkLabel: d.customLinkLabel || undefined, customLinkUrl: d.customLinkUrl || undefined,
      requireDefaultOffer: d.requireDefaultOffer,
    };
    const result = await save(body);
    if (result) navigate('/app/marketplace/profile');
  };

  const Footer = () => (
    <div className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-border bg-page py-4">
      <button type="button" className="btn-ghost" onClick={() => navigate('/app/marketplace/profile')}>Cancel</button>
      <button type="button" className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit || busy} onClick={submit}>
        {busy ? <Spinner /> : 'Request Changes'}
      </button>
    </div>
  );

  return (
    <>
      <PageHeader title="Edit Marketplace Profile" subtitle="Marketplace › Profile › Edit" />

      <div className="mb-6 flex gap-6 border-b border-border">
        {(['general', 'review'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`border-b-2 pb-2.5 text-small font-medium capitalize ${tab === t ? 'border-accent text-accent-text' : 'border-transparent text-fg-secondary hover:text-fg'}`}>
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-small text-danger-text">{error}</p>}

      {tab === 'general' ? (
        <div className="card">
          <p className="mb-6 text-small text-fg-muted">Fields with an asterisk (*) are mandatory.</p>
          <h3 className="mb-4 text-h3 font-medium text-fg">General Information</h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <label className="label mb-1 block">Name to use in the Marketplace <span className="text-danger-text">*</span></label>
              <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Logo URL</label>
              <p className="mb-1 text-tiny text-fg-muted">Paste a PNG/JPG image URL. Transparent background recommended.</p>
              <input className="input" placeholder="https://…/logo.png" value={d.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />
              {d.logoUrl && <img src={d.logoUrl} alt="" className="mt-2 h-16 w-16 rounded-[var(--radius)] border border-border object-contain" />}
            </div>
            <div className="lg:col-span-2">
              <label className="label mb-1 block">Description <span className="text-danger-text">*</span></label>
              <textarea className="input min-h-24" value={d.description} onChange={(e) => set('description', e.target.value)} />
            </div>

            <div>
              <label className="label mb-1 block">Categories <span className="text-danger-text">*</span></label>
              <div className="mb-2 inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
                <button type="button" onClick={() => set('categoriesMode', 'targeted')} className={`px-3 py-1.5 text-tiny font-medium ${d.categoriesMode === 'targeted' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary'}`}>Targeted (Up to 5)</button>
                <button type="button" onClick={() => set('categoriesMode', 'all')} className={`px-3 py-1.5 text-tiny font-medium ${d.categoriesMode === 'all' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary'}`}>All</button>
              </div>
              {d.categoriesMode === 'targeted' && (
                <MultiSelect label="" options={MARKETPLACE_CATEGORIES} selected={d.categories} onChange={(v) => set('categories', v)} max={5} />
              )}
            </div>
            <MultiSelect label="Conversion Funnel Expertise" options={CONVERSION_FUNNEL_EXPERTISE} selected={d.conversionFunnelExpertise} onChange={(v) => set('conversionFunnelExpertise', v)} />
            <MultiSelect label="Promotional Methods Accepted" options={PROMOTIONAL_METHODS} selected={d.promotionalMethods} onChange={(v) => set('promotionalMethods', v)} required />
            <MultiSelect label="Payout Types Accepted" options={PAYOUT_TYPES} selected={d.payoutTypesAccepted} onChange={(v) => set('payoutTypesAccepted', v)} required />
            <MultiSelect label="Device Types Covered" options={DEVICE_TYPES} selected={d.deviceTypesCovered} onChange={(v) => set('deviceTypesCovered', v)} required />

            <div>
              <label className="label mb-1 block">Geolocations Covered <span className="text-danger-text">*</span></label>
              <div className="mb-2 inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
                <button type="button" onClick={() => set('geolocationsMode', 'global')} className={`px-3 py-1.5 text-tiny font-medium ${d.geolocationsMode === 'global' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary'}`}>Global</button>
                <button type="button" onClick={() => set('geolocationsMode', 'specific')} className={`px-3 py-1.5 text-tiny font-medium ${d.geolocationsMode === 'specific' ? 'bg-accent text-white' : 'bg-surface text-fg-secondary'}`}>Specific</button>
              </div>
              {d.geolocationsMode === 'specific' && (
                countryOptions.length === 0
                  ? <p className="text-tiny text-fg-muted">No countries with real traffic yet.</p>
                  : <MultiSelect label="" options={countryOptions} selected={d.geolocations} onChange={(v) => set('geolocations', v)} max={5} />
              )}
            </div>
            <div>
              <label className="label mb-1 block">Website URL <span className="text-danger-text">*</span></label>
              <input className="input" placeholder="https://example.com" value={d.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} />
            </div>
          </div>

          <h3 className="mb-1 mt-8 text-h3 font-medium text-fg">Contact</h3>
          <div className="mb-4">
            <p className="mb-1 text-small font-medium text-fg">Visibility</p>
            <p className="mb-2 text-tiny text-fg-muted">Please choose how you would like your contact information to be shared. By checking Share Publicly, your contact information will be visible in your Marketplace card.</p>
            <label className="flex cursor-pointer items-center gap-2 text-small text-fg">
              <input type="checkbox" className="chk" checked={d.contactSharePublicly} onChange={(e) => set('contactSharePublicly', e.target.checked)} /> Share Publicly
            </label>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <label className="label mb-1 block">First Name <span className="text-danger-text">*</span></label>
              <input className="input" value={d.contactFirstName} onChange={(e) => set('contactFirstName', e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Last Name <span className="text-danger-text">*</span></label>
              <input className="input" value={d.contactLastName} onChange={(e) => set('contactLastName', e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Phone Number</label>
              <input className="input" value={d.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Email <span className="text-danger-text">*</span></label>
              <input className="input" type="email" value={d.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
            </div>
          </div>

          <p className="mb-2 mt-6 text-small font-medium text-fg">Social Media <span className="text-fg-muted">(Optional)</span></p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {([
              ['socialTwitter', 'Twitter URL'], ['socialInstagram', 'Instagram URL'], ['socialMeta', 'Meta URL'],
              ['socialTiktok', 'TikTok URL'], ['socialYoutube', 'YouTube URL'], ['socialLinkedin', 'LinkedIn URL'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="label mb-1 block">{label}</label>
                <input className="input" value={d[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <p className="mb-2 mt-6 text-small font-medium text-fg">Custom Link</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label className="label mb-1 block">Label</label>
              <input className="input" value={d.customLinkLabel} onChange={(e) => set('customLinkLabel', e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Link</label>
              <input className="input" value={d.customLinkUrl} onChange={(e) => set('customLinkUrl', e.target.value)} />
            </div>
          </div>

          <div className="mt-6 rounded-card border border-border bg-accent-subtle p-4">
            <p className="mb-1 text-small font-semibold text-fg">Important!</p>
            <p className="text-small text-fg-secondary">We don't suggest requiring a Default Marketplace Offer as it can add friction while connecting with new Advertisers.</p>
          </div>
          <div className="mt-3">
            <label className="flex cursor-pointer items-center gap-2 text-small text-fg">
              <input type="checkbox" className="chk" checked={d.requireDefaultOffer} onChange={(e) => set('requireDefaultOffer', e.target.checked)} /> Require a Default Marketplace Offer
            </label>
            <p className="mt-1 text-tiny text-fg-muted">Note: This setting will not apply to Advertisers you are currently working with.</p>
          </div>

          <Footer />
        </div>
      ) : (
        <div className="card">
          <p className="mb-6 text-small text-fg-muted">Fields with an asterisk (*) are mandatory.</p>
          <div className="mb-6 rounded-card border border-accent-subtle bg-accent-subtle p-4">
            <p className="mb-1 text-small font-semibold text-fg">Review Your Marketplace Profile</p>
            <p className="text-small text-fg-secondary">If something doesn't look right, you can use the tabs above to return to the original form.</p>
          </div>
          <MarketplaceProfileCards profile={toPreviewProfile(d)} />
          <Footer />
        </div>
      )}
    </>
  );
}
