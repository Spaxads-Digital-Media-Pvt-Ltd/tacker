/**
 * Reporting › Refunds — verified against the live reference (URL `/reporting/refund`, empty on their
 * demo account too — 0 Total). Columns: Conversion Status | Refund Date | Offer | Partner |
 * Advertiser | Revenue | Payout | Store | SKUs | Transaction ID | Conversion ID | Date | Email |
 * Refund Amount | Sale Amount | Order ID | Coupon Code | Offer URL — same date-range/Add Filter/Run
 * Report shell as every other report.
 *
 * Same category as Products Report (ProductsReport.tsx): the nav's own description says "Refunds
 * from connected stores," and this data is native to real e-commerce platform integrations
 * (WooCommerce, ClickFunnels, Stripe, Shopify) this app doesn't have — no Store/SKU/Order/Coupon/
 * refund concept exists anywhere in this schema. Follows the same honest-shell pattern as
 * PartnerReferralsReport.tsx and ProductsReport.tsx (components/EmptyShellTable.tsx): the real
 * column structure, genuinely empty, inert "Not available yet" controls instead of live filtering
 * that doesn't exist.
 */
import { MoreVertical } from 'lucide-react';
import { PageHeader } from '../../shared-components/primitives/ui';
import { EmptyShellTable } from '../../shared-components/primitives/EmptyShellTable';
import { daysAgo, todayStr } from '../../shared-components/primitives/ReportPageKit';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';

const COLUMNS = [
  'Conversion Status', 'Refund Date', 'Offer', 'Partner', 'Advertiser', 'Revenue', 'Payout',
  'Store', 'SKUs', 'Transaction ID', 'Conversion ID', 'Date', 'Email',
  'Refund Amount', 'Sale Amount', 'Order ID', 'Coupon Code', 'Offer URL',
];

export default function RefundsReport() {
  // Nothing to fetch, but the range behaves like every other report's (applies on its own, no Run Report).
  const range = useAutoDateRange(daysAgo(7), todayStr());

  return (
    <>
      <PageHeader title="Refunds Report" subtitle="Reporting › Refunds" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          {/* Inert, like the rest of this shell — filtering isn't available yet. */}
          <FiltersButton disabled title="Not available yet" />
          <button title="Not available yet" className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="refunds-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" />

        <ReportBody>
          <p className="mb-4 text-small text-fg-muted">
            Refunds aren't available yet — this data comes from a WooCommerce, ClickFunnels, Stripe, or Shopify integration, none of which this network has connected. See Connect › Integrations.
          </p>
          <EmptyShellTable columns={COLUMNS} search={false} />
        </ReportBody>
      </ReportCard>
    </>
  );
}
