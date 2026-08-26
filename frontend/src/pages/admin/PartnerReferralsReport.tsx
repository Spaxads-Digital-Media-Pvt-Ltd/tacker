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
import { Filter, MoreVertical } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const COLUMNS = [
  'Referrer (Originating) Partner', 'Referred Partner', 'Referral Status',
  'Commission Structure', 'Billed', 'Balance', 'Referred Date',
];

export default function PartnerReferralsReport() {
  return (
    <>
      <PageHeader title="Partner Referrals Report" subtitle="Reporting › Partner Referrals" action={
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
          <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <Filter size={15} />
          </button>
          <div className="flex-1" />
          <button title="Not available yet" className="btn-primary">Run Report</button>
        </div>
      </div>

      <div className="card mb-4">
        <p className="text-small text-fg-muted">
          Partner Referrals aren't configured for this network yet — see Control Center › Partners › Partner Referral to enable a referral program.
        </p>
      </div>

      <div className="card">
        <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
        <EmptyShellTable columns={COLUMNS} search={false} />
      </div>
    </>
  );
}
