import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { CopyBox } from './CopyBox';
import { useQuery } from '../../lib/useApi';
import { Overlay } from '../primitives/ui';
import { linkId, resolveTrackingHost, trackingBase } from '../../lib/trackingLinks';
import type { Offer, Publisher, TrackingDomain } from '../../types';

// /click reads source_id and sub1–sub5 only — anything else would be silently dropped.
const SUB_KEYS = ['source_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;

/** General-purpose version of the per-offer/per-publisher tracking-link generators already built
 * into Offer Detail and Partner Detail — here both Offer and Partner are selectable, matching the
 * reference's Dashboard-level "Tracking Link Generator" modal. (The old "Encrypt Parameters"
 * toggle was removed: /click never decoded its `p=` token, so it silently dropped every sub ID.) */
export function TrackingLinkGeneratorModal({ onClose }: { onClose: () => void }) {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');

  const [offerId, setOfferId] = useState('');
  const [pubId, setPubId] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});

  const selectedOffer = (offers ?? []).find((o) => o.id === offerId);
  const selectedPub = (publishers ?? []).find((p) => p.id === pubId);
  const host = resolveTrackingHost(domains, selectedOffer?.trackingDomainId);
  const trackBase = trackingBase(host);

  const link = useMemo(() => {
    if (!selectedOffer || !pubId || !host) return '';
    const ids = { offer_id: linkId(selectedOffer), pub_id: linkId(selectedPub ?? { id: pubId }) };
    const filled = Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim()));
    return `${trackBase}/click?${new URLSearchParams({ ...ids, ...filled }).toString()}`;
  }, [selectedOffer, selectedPub, pubId, extras, trackBase, host]);

  const setExtra = (k: string, v: string) => setExtras((s) => ({ ...s, [k]: v }));

  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Tracking Link Generator</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="mb-3 text-h3 font-medium text-fg">Parameters</p>
          <label className="label">Offer <span className="text-danger-text">*</span></label>
          <select className="input mb-3" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
            <option value="">Select Offer…</option>
            {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <label className="label">Partner <span className="text-danger-text">*</span></label>
          <select className="input" value={pubId} onChange={(e) => setPubId(e.target.value)}>
            <option value="">Select Partner…</option>
            {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <button type="button" onClick={() => setShowExtra((s) => !s)} className="mt-4 flex items-center gap-1.5 text-small font-medium text-accent-text">
            {showExtra ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Additional Parameters
          </button>
          {showExtra && (
            <div className="mt-3 space-y-3">
              {SUB_KEYS.map((k) => (
                <div key={k}>
                  <label className="label">{k}</label>
                  <input className="input" value={extras[k] ?? ''} onChange={(e) => setExtra(k, e.target.value)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-h3 font-medium text-fg">Link</p>
          {!link ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border bg-page p-4 text-small text-fg-secondary">
              Tracking link will be displayed here as soon as parameters are set
            </div>
          ) : (
            <CopyBox value={link} />
          )}
        </div>
        </div>
      </div>
    </Overlay>
  );
}
