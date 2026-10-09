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
import { MoreVertical } from 'lucide-react';
import { PageHeader } from '../../../shared-components/primitives/ui';
import { EmptyShellTable } from '../../../shared-components/primitives/EmptyShellTable';
import { daysAgo, todayStr } from '../../../shared-components/primitives/ReportPageKit';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, FiltersButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';

const COLUMNS = [
  'Originating Offer / Fail Offer', 'Imp', 'RPM', 'CPM', 'Gross Clicks', 'Clicks', 'Uniq. Clicks',
  'Dup. Clicks', 'Invalid Clicks', 'Total CV', 'CV', 'VT CV', 'CTR', 'Throttle',
  'CVR', 'CPC', 'CPA', 'RPC', 'RPA', 'Revenue', 'Payout', 'Profit', 'Margin',
];

export default function RedirectReport() {
  // Nothing to fetch, but the range behaves like every other report's (applies on its own, no Run Report).
  const range = useAutoDateRange(daysAgo(7), todayStr());

  return (
    <>
      <PageHeader title="Redirect Report" subtitle="Analytics › Redirect" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          {/* Inert, like the rest of this shell — filtering isn't available yet. */}
          <FiltersButton disabled title="Not available yet" />
          <button type="button" title="Not available yet" className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="redirect-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <ControlField label="Parent" htmlFor="redirect-report-parent" className="w-full sm:w-48">
            <button id="redirect-report-parent" type="button" title="Not available yet" className={`input ${CONTROL} flex items-center text-left text-fg-muted`}>Originating Offer</button>
          </ControlField>
          <ControlField label="Child" htmlFor="redirect-report-child" className="w-full sm:w-48">
            <button id="redirect-report-child" type="button" title="Not available yet" className={`input ${CONTROL} flex items-center text-left text-fg-muted`}>Fail Offer</button>
          </ControlField>
        </ReportControls>

        <ResultsBar title="Detailed Report" />

        <ReportBody>
          <p className="mb-4 text-small text-fg-muted">
            Offer-to-offer failure redirects aren't tracked yet — Forwarding Rules and SmartSwitch (configurable per offer) exist but aren't applied to live traffic in this network, so no click has ever been recorded as redirected from a failing offer to a fallback.
          </p>
          <EmptyShellTable columns={COLUMNS} search={false} />
        </ReportBody>
      </ReportCard>
    </>
  );
}
