import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { CopyBox } from '../../../components/CopyBox';
import { useQuery } from '../../../lib/useApi';
import type { Publisher, Offer, TrackingDomain } from '../../../types';

const SUB_KEYS = ['source_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;

/** Reverse of the offer-detail tracking-link generator: this partner is fixed, pick the offer.
 * Matches the reference's two-column Parameters/Link layout — no "Generate All Links" section here
 * since (unlike the Offer version) there's only ever one partner in play, not many. */
export function PartnerTrackingLinksModal({ publisher, domains, onClose }: {
  publisher: Publisher; domains: TrackingDomain[]; onClose: () => void;
}) {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const activeDomains = domains.filter((d) => d.status === 'active');
  const primary = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const trackBase = isLocal ? 'http://localhost:4002' : `https://${primary?.host ?? 'your-tracking-domain.com'}`;

  const [type, setType] = useState<'Click' | 'Impression'>('Click');
  const [offerId, setOfferId] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [encrypt, setEncrypt] = useState(false);
  const setExtra = (k: string, v: string) => setExtras((s) => ({ ...s, [k]: v }));

  const link = useMemo(() => {
    if (!offerId) return '';
    const filled = Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim()));
    const base: Record<string, string> = { offer_id: offerId, pub_id: publisher.id, type: type.toLowerCase() };
    if (!encrypt) return `${trackBase}/click?${new URLSearchParams({ ...base, ...filled }).toString()}`;
    const packed = btoa(JSON.stringify(filled));
    return `${trackBase}/click?${new URLSearchParams({ ...base, ...(Object.keys(filled).length ? { p: packed } : {}) }).toString()}`;
  }, [offerId, type, extras, encrypt, trackBase, publisher.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Partner Tracking Links</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-3 text-h3 font-medium text-fg">Parameters</p>
            <label className="label mb-2 block">Type</label>
            <div className="mb-3 inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
              {(['Click', 'Impression'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`px-4 py-2 text-small font-medium transition-colors ${type === t ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
                  {t}
                </button>
              ))}
            </div>
            <label className="label">Offer <span className="text-danger-text">*</span></label>
            <select className="input" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Select Offer…</option>
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {isLocal && <p className="mt-1 text-tiny text-warning">Local mode: link points at http://localhost:4002 so you can test clicks locally.</p>}

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
            <div className="mb-3 flex items-center justify-between">
              <p className="text-h3 font-medium text-fg">Link</p>
              <label className="flex items-center gap-2 text-small text-fg-secondary">
                Encrypt Parameters
                <button type="button" onClick={() => setEncrypt((v) => !v)} className={`relative h-5 w-9 rounded-full transition-colors ${encrypt ? 'bg-accent' : 'bg-border'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${encrypt ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </label>
            </div>
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
    </div>
  );
}
