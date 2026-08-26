import { useState } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { Modal, Field } from '../../components/ui';
import type { Offer } from '../../types';

interface Options {
  targetOfferId: string;
  includeCustomSettings: boolean;
  includeForwardingRules: boolean;
  includeCreatives: boolean;
}

/** "Copy Offer Settings" — copies THIS offer's settings ONTO an existing offer you pick (unlike
 * "Copy Offer", which creates a brand-new offer). "Include Offer URLs" has no equivalent in this
 * app's schema (one destinationUrl per offer, not a multi-URL set), so it stays disabled. */
export function CopyOfferSettingsModal({ offerId, onClose }: { offerId: string; onClose: () => void }) {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [targetOfferId, setTargetOfferId] = useState('');
  const [opts, setOpts] = useState({ includeCustomSettings: false, includeForwardingRules: false, includeCreatives: false });
  const { run, busy, error } = useMutation((body: Options) => api.post<{ copied: boolean }>(`/api/offers/${offerId}/copy-settings-to`, body));
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const submit = async () => {
    const res = await run({ targetOfferId, ...opts });
    if (res) onClose();
  };

  const check = (key: keyof typeof opts, label: string) => (
    <label className="flex flex-col gap-2">
      <span className="text-small text-fg">{label}</span>
      <input type="checkbox" className="chk" checked={opts[key]} onChange={() => toggle(key)} />
    </label>
  );

  return (
    <Modal open onClose={onClose} title="Copy Offer Settings">
      <div className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Offer *">
          <select className="input" required value={targetOfferId} onChange={(e) => setTargetOfferId(e.target.value)}>
            <option value="" disabled>Select Offer…</option>
            {(offers ?? []).filter((o) => o.id !== offerId).map((o) => <option key={o.id} value={o.id}>({o.ref}) {o.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          {check('includeCustomSettings', 'Include Custom Settings')}
          <label className="flex flex-col gap-2" title="Not available yet — this app has one destination URL per offer, not a multi-URL set">
            <span className="text-small text-fg-muted">Include Offer URLs</span>
            <input type="checkbox" className="chk" disabled />
          </label>
          {check('includeForwardingRules', 'Include Forwarding Rules')}
          {check('includeCreatives', 'Include Creatives')}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!targetOfferId || busy} onClick={submit}>{busy ? 'Copying…' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>
  );
}
