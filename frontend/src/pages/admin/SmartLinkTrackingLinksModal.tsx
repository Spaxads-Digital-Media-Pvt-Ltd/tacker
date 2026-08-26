/** The detail page's top-right "Smart Link Tracking Links" button — same Parameters/Link layout as
 * the Offer Detail page's own "Offer Tracking Links" modal (offerDetail/TrackingLinksModal.tsx),
 * pointed at the tracking surface's real `/sl` smart-link resolver instead of `/click`. */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Field } from '../../components/ui';
import { CopyBox } from '../../components/CopyBox';
import { useQuery } from '../../lib/useApi';
import type { Publisher, TrackingDomain } from '../../types';
import type { SmartLink } from '../../data/smartLinks';

export function SmartLinkTrackingLinksModal({ smartLink, domains, onClose }: { smartLink: SmartLink; domains: TrackingDomain[]; onClose: () => void }) {
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const activeDomains = domains.filter((d) => d.status === 'active');
  const primary = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const trackBase = isLocal ? 'http://localhost:4002' : `https://${primary?.host ?? 'your-tracking-domain.com'}`;

  const [pubId, setPubId] = useState('');

  const link = useMemo(() => {
    if (!pubId) return '';
    return `${trackBase}/sl?${new URLSearchParams({ id: smartLink.id, pub_id: pubId }).toString()}`;
  }, [pubId, trackBase, smartLink.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Smart Link Tracking Links</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-3 text-h3 font-medium text-fg">Parameters</p>
            <Field label="Smart Link *"><input className="input" value={smartLink.name} disabled /></Field>
            <div className="mt-3">
              <label className="label">Partner <span className="text-danger-text">*</span></label>
              <select className="input" value={pubId} onChange={(e) => setPubId(e.target.value)}>
                <option value="">Select Partner…</option>
                {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {isLocal && <p className="mt-1 text-tiny text-warning">Local mode: link points at http://localhost:4002 so you can test clicks locally.</p>}
          </div>

          <div>
            <p className="mb-3 text-h3 font-medium text-fg">Link</p>
            {!link ? (
              <div className="rounded-[var(--radius)] border border-dashed border-border bg-page p-4 text-small text-fg-secondary">
                Tracking link will be displayed here as soon as a Partner is selected
              </div>
            ) : (
              <CopyBox value={link} />
            )}
            <div className="mt-6 border-t border-border pt-4 text-small">
              <p className="mb-1.5 text-fg-secondary">To generate all partners links with default parameters:</p>
              <button title="Not available yet" className="btn-ghost !py-1.5">Generate All Links</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
