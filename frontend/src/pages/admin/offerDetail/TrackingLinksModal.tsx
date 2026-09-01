import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Field } from '../../../components/ui';
import { CopyBox } from '../../../components/CopyBox';
import { useQuery } from '../../../lib/useApi';
import type { Offer, Publisher, TrackingDomain } from '../../../types';

const SUB_KEYS = ['source_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;

interface Creative { id: string; name: string }

/** Everflow's top-right "Offer Tracking Links" button opens this. Matches the reference's two-column
 * Parameters/Link layout (same pattern as the Dashboard's general Tracking Link Generator) — Offer is
 * fixed to the current one. Creative list is real (this offer's own creatives); "Generate All Links"
 * / "Generate Link to All QR codes" / "Advertiser Test Link" have no bulk-generation or QR backend,
 * so they're real, full-color buttons with a tooltip rather than fake-disabled. */
export function TrackingLinksModal({ offer, publishers, domains, onClose }: {
  offer: Offer; publishers: Publisher[]; domains: TrackingDomain[]; onClose: () => void;
}) {
  const { data: creatives } = useQuery<Creative[]>(`/api/offers/${offer.id}/creatives`);
  const activeDomains = domains.filter((d) => d.status === 'active');
  const primary = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const trackBase = isLocal ? 'http://localhost:4002' : `https://${primary?.host ?? 'your-tracking-domain.com'}`;

  const [type, setType] = useState<'Click' | 'Impression'>('Click');
  const [creativeId, setCreativeId] = useState('');
  const [pubId, setPubId] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [encrypt, setEncrypt] = useState(false);
  const setExtra = (k: string, v: string) => setExtras((s) => ({ ...s, [k]: v }));

  const link = useMemo(() => {
    if (!pubId) return '';
    const filled = Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim()));
    const base: Record<string, string> = { offer_id: offer.id, pub_id: pubId, type: type.toLowerCase() };
    if (creativeId) base.creative_id = creativeId;
    if (!encrypt) return `${trackBase}/click?${new URLSearchParams({ ...base, ...filled }).toString()}`;
    const packed = btoa(JSON.stringify(filled));
    return `${trackBase}/click?${new URLSearchParams({ ...base, ...(Object.keys(filled).length ? { p: packed } : {}) }).toString()}`;
  }, [pubId, type, creativeId, extras, encrypt, trackBase, offer.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Offer Tracking Links</h2>
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
            <Field label="Offer *"><input className="input" value={offer.name} disabled /></Field>
            <div className="mt-3">
              <Field label="Creative (Optional)">
                <select className="input" value={creativeId} onChange={(e) => setCreativeId(e.target.value)}>
                  <option value="">Select Creative (Optional)…</option>
                  {(creatives ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="URL"><input className="input" value={offer.destinationUrl} disabled /></Field>
            </div>
            <div className="mt-3">
              <label className="label">Partner <span className="text-danger-text">*</span></label>
              <select className="input" value={pubId} onChange={(e) => setPubId(e.target.value)}>
                <option value="">Select Partner…</option>
                {publishers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
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

            <div className="mt-6 space-y-4 text-small">
              <div>
                <p className="mb-1.5 text-fg-secondary">To generate all partners links with default parameters:</p>
                <button title="Not available yet" className="btn-ghost !py-1.5">Generate All Links</button>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-1.5 text-fg-secondary">To generate all partners QR codes:</p>
                <button title="Not available yet" className="btn-ghost !py-1.5">Generate Link to All QR codes</button>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-1.5 text-fg-secondary">To generate an advertiser test tracking link:</p>
                <button title="Not available yet" className="btn-ghost !py-1.5">Advertiser Test Link</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
