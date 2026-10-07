import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Field, Overlay } from '../../../shared-components/primitives/ui';
import { CopyBox } from '../../../shared-components/panels/CopyBox';
import { useQuery } from '../../../lib/useApi';
import { linkId, resolveTrackingHost, trackingBase } from '../../../lib/trackingLinks';
import { downloadCsv } from '../../../lib/export';
import type { Offer, Publisher, TrackingDomain, TrafficSource } from '../../../types';

const SUB_KEYS = ['source_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5'] as const;

/** Everflow's top-right "Offer Tracking Links" button opens this — Offer is fixed to the current one.
 * Only options /click actually honours are offered: partner, sub IDs, source id and Traffic Source
 * presets. (Impression type, creative id and "encrypted" params were removed — /click never read
 * them, and the encrypted form silently dropped every sub ID.) "Generate All Links" downloads one
 * link per partner; "Advertiser Test Link" is a partner-less link to check the landing page receives
 * {click_id}.
 *
 * "Traffic Source" applies a real Partners › Traffic Sources preset — its Parameter/Value pairs
 * (values often containing the partner's own macros like {campaign_id}) are appended verbatim to the
 * generated link, so a preset like "Facebook Ads" one-click-fills the tracking params. */
export function TrackingLinksModal({ offer, publishers, domains, onClose }: {
  offer: Offer; publishers: Publisher[]; domains: TrackingDomain[]; onClose: () => void;
}) {
  const { data: trafficSources } = useQuery<TrafficSource[]>('/api/traffic-sources');
  // The offer's own selected tracking domain (network primary only if it has none).
  const host = resolveTrackingHost(domains, offer.trackingDomainId);
  const trackBase = trackingBase(host);

  const [pubId, setPubId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [showExtra, setShowExtra] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [testLink, setTestLink] = useState('');
  const setExtra = (k: string, v: string) => setExtras((s) => ({ ...s, [k]: v }));

  const source = (trafficSources ?? []).find((s) => s.id === sourceId);

  const linkFor = (pub: Publisher | { id: string } | null): string => {
    if (!trackBase) return '';
    const filled = Object.fromEntries(Object.entries(extras).filter(([, v]) => v.trim()));
    const base: Record<string, string> = { offer_id: linkId(offer), ...(pub ? { pub_id: linkId(pub) } : {}) };
    // Traffic Source preset params are appended raw (not URLSearchParams-encoded) so partner macros
    // like {campaign_id} survive; manual "Additional Parameters" come first so they win on collision.
    const preset = source?.trackingLinkParameters ? `&${source.trackingLinkParameters}` : '';
    return `${trackBase}/click?${new URLSearchParams({ ...base, ...filled }).toString()}${preset}`;
  };
  const link = useMemo(
    () => (pubId ? linkFor(publishers.find((p) => p.id === pubId) ?? { id: pubId }) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubId, extras, trackBase, offer, publishers, source],
  );
  const downloadAll = () => downloadCsv(`tracking-links-${linkId(offer)}.csv`,
    publishers.map((p) => ({ partner: p.name, partnerId: linkId(p), trackingLink: linkFor(p) })));

  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[85vh] w-full max-w-3xl animate-fade-in overflow-y-auto rounded-card border border-border bg-elevated p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-h3 font-semibold tracking-tight text-fg">Offer Tracking Links</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-3 text-h3 font-medium text-fg">Parameters</p>
            <Field label="Offer *"><input className="input" value={offer.name} disabled /></Field>
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
            <div className="mt-3">
              <Field label="Traffic Source (Optional)">
                <select className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">No preset</option>
                  {(trafficSources ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              {source && (
                <p className="mt-1 break-all font-mono text-tiny text-fg-secondary">
                  Appends: <span className="text-fg">{source.trackingLinkParameters}</span>
                </p>
              )}
            </div>
            <p className="mt-1 text-tiny text-fg-muted">Tracking domain: <span className="font-mono text-fg">{host ?? 'none — set one on the offer'}</span></p>

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

            <div className="mt-6 space-y-4 text-small">
              <div>
                <p className="mb-1.5 text-fg-secondary">To generate all partners links with default parameters:</p>
                <button type="button" className="btn-ghost !py-1.5" disabled={!trackBase || publishers.length === 0} onClick={downloadAll}>Generate All Links (CSV)</button>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-1.5 text-fg-secondary">To generate all partners QR codes:</p>
                <button type="button" disabled title="QR code generation isn't available yet" className="btn-ghost !py-1.5 opacity-50">Generate Link to All QR codes</button>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-1.5 text-fg-secondary">To generate an advertiser test tracking link:</p>
                <button type="button" className="btn-ghost !py-1.5" disabled={!trackBase} onClick={() => setTestLink(linkFor(null))}>Advertiser Test Link</button>
                {testLink && (
                  <div className="mt-2 space-y-1">
                    <CopyBox value={testLink} />
                    <p className="text-tiny text-fg-muted">No partner attached — open it to confirm the landing page receives the click_id.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
