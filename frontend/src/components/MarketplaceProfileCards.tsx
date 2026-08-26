import { Check, Globe, Link2, Mail, X } from 'lucide-react';
import { Icon } from './icons';
import { PAYOUT_TYPES } from '../lib/marketplaceProfile';
import type { MarketplaceProfile } from '../types';

const DASH = '—';

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Discovery Card + Pop Up Details Card — shared between the Preview page and the Edit form's
 * Review tab (the reference shows the identical pair of cards in both places). */
export function MarketplaceProfileCards({ profile }: { profile: MarketplaceProfile }) {
  const categoriesText = profile.categoriesMode === 'all' ? 'All' : profile.categories.length ? profile.categories.join(', ') : DASH;
  const hasSocial = profile.websiteUrl || profile.socialInstagram || profile.socialLinkedin;

  return (
    <>
      <p className="mb-4 text-center text-small font-medium text-fg-secondary">Discovery Card</p>
      <div className="mx-auto mb-8 flex w-full max-w-xs flex-col items-center gap-2 rounded-card border border-border p-6 text-center">
        {profile.logoUrl ? <img src={profile.logoUrl} alt="" className="h-14 w-14 rounded-full object-contain" />
          : <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={26} height={26} /></div>}
        <p className="font-semibold text-fg">{profile.name}</p>
        <p className="line-clamp-1 text-tiny text-fg-secondary">{categoriesText}</p>
        {profile.websiteUrl && <a href={profile.websiteUrl} target="_blank" rel="noreferrer" className="text-tiny text-accent-text hover:underline">{profile.websiteUrl.replace(/^https?:\/\//, '')}</a>}
      </div>

      <p className="mb-4 text-center text-small font-medium text-fg-secondary">Pop Up Details Card</p>
      <div className="rounded-card border border-border p-6">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <h3 className="text-h3 font-medium text-fg">{profile.name}</h3>
          {hasSocial && (
            <div className="flex items-center gap-3 text-fg-secondary">
              {profile.websiteUrl && <a href={profile.websiteUrl} target="_blank" rel="noreferrer" title="Website"><Globe size={16} /></a>}
              {profile.socialInstagram && <a href={profile.socialInstagram} target="_blank" rel="noreferrer" title="Instagram"><Link2 size={16} /></a>}
              {profile.socialLinkedin && <a href={profile.socialLinkedin} target="_blank" rel="noreferrer" title="LinkedIn"><Link2 size={16} /></a>}
            </div>
          )}
        </div>

        {profile.logoUrl
          ? <img src={profile.logoUrl} alt="" className="mb-4 h-24 w-full rounded-[var(--radius)] border border-border object-contain p-3" />
          : <div className="mb-4 grid h-24 place-items-center rounded-[var(--radius)] border border-dashed border-border text-tiny text-fg-muted">No logo</div>}

        <p className="mb-4 whitespace-pre-wrap text-small text-fg-secondary">{profile.description || DASH}</p>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <p className="text-tiny font-semibold text-fg">Categories</p>
            <p className="text-small text-fg-secondary">{categoriesText}</p>
          </div>
          <div>
            <p className="mb-1 text-tiny font-semibold text-fg">Payout Types Accepted</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {PAYOUT_TYPES.map((p) => {
                const on = profile.payoutTypesAccepted.includes(p);
                return (
                  <span key={p} className={`flex items-center gap-1.5 text-tiny ${on ? 'text-fg' : 'text-fg-muted'}`}>
                    {on ? <Check size={13} className="text-success-text" /> : <X size={13} className="text-fg-muted" />} {p}
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Geo Markets Covered</p>
            <p className="text-small text-fg-secondary">{profile.geolocationsMode === 'global' ? 'Global' : profile.geolocations.length ? profile.geolocations.join(', ') : DASH}</p>
          </div>
          <div>
            <p className="mb-1 text-tiny font-semibold text-fg">Promotional Methods Available</p>
            {profile.promotionalMethods.length ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.promotionalMethods.map((m) => <span key={m} className="rounded-full border border-border px-2.5 py-0.5 text-tiny text-fg-secondary">{m}</span>)}
              </div>
            ) : <p className="text-small text-fg-muted">{DASH}</p>}
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Countries Covered</p>
            <p className="text-small text-fg-secondary">{profile.geolocationsMode === 'specific' && profile.geolocations.length ? profile.geolocations.join(', ') : DASH}</p>
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Conversion Funnel Expertise</p>
            <p className="text-small text-fg-secondary">{profile.conversionFunnelExpertise.length ? profile.conversionFunnelExpertise.join(', ') : DASH}</p>
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Device Types Covered</p>
            <p className="text-small text-fg-secondary">{profile.deviceTypesCovered.length ? profile.deviceTypesCovered.join(', ') : DASH}</p>
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Join Date</p>
            <p className="text-small text-fg-secondary">{fmtDate(profile.createdAt)}</p>
          </div>
          <div>
            <p className="text-tiny font-semibold text-fg">Contact</p>
            {profile.contactSharePublicly && (profile.contactFirstName || profile.contactEmail) ? (
              <div className="text-small text-fg-secondary">
                <p>{[profile.contactFirstName, profile.contactLastName].filter(Boolean).join(' ') || DASH}</p>
                {profile.contactEmail && <p className="flex items-center gap-1.5"><Mail size={12} /> {profile.contactEmail}</p>}
              </div>
            ) : <p className="text-small text-fg-muted">{DASH}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
