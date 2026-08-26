import { useState } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { Modal } from '../../components/ui';

interface Options {
  includeCustomSettings: boolean;
  includePartnerVisibility: boolean;
  includeForwardingRules: boolean;
  includeCreatives: boolean;
}

/** Everflow's "Copy Offer" confirmation — lets the admin pick which nested collections come along
 * (goals/coupons/deals/tags always copy, matching the reference's own implicit base-config
 * behavior). "Include Offer URLs" has no equivalent concept in this app's schema (a single
 * destinationUrl, not a multi-URL set), so it stays disabled with a tooltip. */
export function CopyOfferModal({ offerId, onClose, onDone }: { offerId: string; onClose: () => void; onDone: (newId: string) => void }) {
  const [opts, setOpts] = useState<Options>({
    includeCustomSettings: false, includePartnerVisibility: false, includeForwardingRules: false, includeCreatives: true,
  });
  const { run, busy, error } = useMutation((body: Options) => api.post<{ id: string }>(`/api/offers/${offerId}/duplicate`, body));
  const toggle = (k: keyof Options) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const submit = async () => {
    const res = await run(opts);
    if (res) onDone(res.id);
  };

  const check = (key: keyof Options, label: string) => (
    <label className="flex flex-col gap-2">
      <span className="text-small text-fg">{label}</span>
      <input type="checkbox" className="chk" checked={opts[key]} onChange={() => toggle(key)} />
    </label>
  );

  return (
    <Modal open onClose={onClose} title="Copy Offer">
      <div className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          {check('includeCustomSettings', 'Include Custom Settings')}
          <label className="flex flex-col gap-2" title="Not available yet — this app has one destination URL per offer, not a multi-URL set">
            <span className="text-small text-fg-muted">Include Offer URLs</span>
            <input type="checkbox" className="chk" disabled />
          </label>
          {check('includePartnerVisibility', 'Include Partner Visibility')}
          {check('includeForwardingRules', 'Include Forwarding Rules')}
          {check('includeCreatives', 'Include Creatives')}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Copying…' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>
  );
}
