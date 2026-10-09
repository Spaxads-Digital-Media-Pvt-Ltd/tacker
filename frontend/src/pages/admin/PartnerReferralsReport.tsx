/**
 * Reporting › Partner Referrals — verified against the live reference (URL
 * `/reporting/affiliates/referrals`, 7 real rows: Referrer (Originating) Partner | Referred Partner |
 * Referral Status | Commission Structure | Billed | Balance | Referred Date).
 *
 * This app has no referral concept anywhere — no referred-by relationship between partners, no
 * referral commission structure, no billed/balance tracking. That's not an oversight for this page
 * specifically: it's already the case everywhere referrals come up elsewhere in the app — Control
 * Center › Partners › Partner Referral (controlCenter/PartnersTab.tsx) is an honest static shell of
 * the config screen, and each Publisher's General tab shows "Referral links aren't configured for
 * this network yet" (publisherDetail/GeneralTab.tsx). This page follows the same established
 * pattern — components/EmptyShellTable.tsx — rather than fabricating referral rows: the real column
 * structure from the reference, genuinely empty, with inert "Not available yet" controls instead of
 * live filtering that doesn't exist.
 */
import { MoreVertical } from 'lucide-react';
import { PageHeader } from '../../shared-components/primitives/ui';
import { EmptyShellTable } from '../../shared-components/primitives/EmptyShellTable';
import { daysAgo, todayStr } from '../../shared-components/primitives/ReportPageKit';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';

const COLUMNS = [
  'Referrer (Originating) Partner', 'Referred Partner', 'Referral Status',
  'Commission Structure', 'Billed', 'Balance', 'Referred Date',
];

export default function PartnerReferralsReport() {
  // Nothing to fetch, but the range behaves like every other report's (applies on its own, no Run Report).
  const range = useAutoDateRange(daysAgo(7), todayStr());

  return (
    <>
      <PageHeader title="Partner Referrals Report" subtitle="Reporting › Partner Referrals" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          {/* Inert, like the rest of this shell — filtering isn't available yet. */}
          <FiltersButton disabled title="Not available yet" />
          <button title="Not available yet" className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="partner-referrals-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" />

        <ReportBody>
          <p className="mb-4 text-small text-fg-muted">
            Partner Referrals aren't configured for this network yet — see Control Center › Partners › Partner Referral to enable a referral program.
          </p>
          <EmptyShellTable columns={COLUMNS} search={false} />
        </ReportBody>
      </ReportCard>
    </>
  );
}
