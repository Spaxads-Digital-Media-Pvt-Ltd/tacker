/**
 * Offer settings that stop the offer getting traffic (GET /api/offers/:id → configWarnings, computed by
 * api-backend lib/offer-settings/warnings.ts): GEO vs Targeting countries that exclude each other, a
 * private offer with no approved partner, device vs OS conflicts, and what this server's GeoIP database
 * can't evaluate. Shown at the top of Offer Details and Edit Offer so the setup is fixed where it's made.
 */
import { Fragment } from 'react';
import { AlertTriangle } from 'lucide-react';

/** `code` spans in a warning (e.g. `npm run geoip:download`) render as code. */
function WarningText({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i} className="rounded bg-surface px-1 font-mono text-tiny">{part}</code> : <Fragment key={i}>{part}</Fragment>))}</>;
}

export function OfferConfigWarnings({ warnings }: { warnings: string[] | undefined }) {
  if (!warnings?.length) return null;
  return (
    <div role="alert" className="mb-4 flex gap-3 rounded-card border border-warning/40 bg-warning-bg px-4 py-3 text-small text-warning-text">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">This offer is set up in a way that blocks traffic:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {warnings.map((w) => <li key={w}><WarningText text={w} /></li>)}
        </ul>
      </div>
    </div>
  );
}
