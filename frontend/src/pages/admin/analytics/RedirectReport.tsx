/**
 * Analytics › Redirect — verified against the live reference (URL `/analytics/redirects`, "Redirect
 * Report": Parent = Originating Offer, Child = Fail Offer — a click that would have failed on its
 * originally-requested offer, redirected to a fallback offer instead — plus the same real 21-tile
 * Summary grid and 22-column Detailed Report shell every report page shares). Empty on the reference's
 * own demo account too (0 Total, all-zero Summary), which matches what this page can honestly show.
 *
 * This app has `offer_forwarding_rules` and `smartswitch_rules` tables (real CRUD, configurable in
 * the Offer detail screens), but neither is ever consulted on the tracking hot path — confirmed via
 * search of api-backend/src/surfaces/tracking: a click is only ever redirected to its own offer's
 * destination URL, never diverted to a different "fail offer." So no click has ever been recorded as
 * redirected-due-to-failure, and none ever will be under the current tracking logic — this isn't a
 * temporarily-empty real report (like Cohort or Click-to-Conversion-Time), it's a concept this app's
 * hot path doesn't implement. Follows the same honest-shell pattern as PartnerReferralsReport.tsx /
 * ProductsReport.tsx / RefundsReport.tsx (components/EmptyShellTable.tsx) rather than wiring up a
 * live query that could only ever return zero rows.
 */
import { Filter, MoreVertical } from 'lucide-react';
import { PageHeader } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';

const COLUMNS = [
  'Originating Offer / Fail Offer', 'Imp', 'RPM', 'CPM', 'Gross Clicks', 'Clicks', 'Uniq. Clicks',
  'Dup. Clicks', 'Invalid Clicks', 'Total CV', 'CV', 'VT CV', 'CTR', 'Throttle',
  'CVR', 'CPC', 'CPA', 'RPC', 'RPA', 'Revenue', 'Payout', 'Profit', 'Margin',
];

export default function RedirectReport() {
  return (
    <>
      <PageHeader title="Redirect Report" subtitle="Analytics › Redirect" action={
        <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1 block">From</label>
            <input title="Not available yet" type="date" className="input" defaultValue="" />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input title="Not available yet" type="date" className="input" defaultValue="" />
          </div>
          <div>
            <label className="label mb-1 block">Parent <span className="text-danger-text">*</span></label>
            <button title="Not available yet" className="input flex items-center justify-between !py-2 text-left text-fg-muted">Originating Offer</button>
          </div>
          <div>
            <label className="label mb-1 block">Child <span className="text-danger-text">*</span></label>
            <button title="Not available yet" className="input flex items-center justify-between !py-2 text-left text-fg-muted">Fail Offer</button>
          </div>
          <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <Filter size={15} />
          </button>
          <div className="flex-1" />
          <button title="Not available yet" className="btn-primary">Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <p className="text-small text-fg-muted">
          Offer-to-offer failure redirects aren't tracked yet — Forwarding Rules and SmartSwitch (configurable per offer) exist but aren't applied to live traffic in this network, so no click has ever been recorded as redirected from a failing offer to a fallback.
        </p>
      </div>

      <div className="card">
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        <EmptyShellTable columns={COLUMNS} search={false} />
      </div>
    </>
  );
}
