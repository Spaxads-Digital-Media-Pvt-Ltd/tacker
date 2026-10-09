/**
 * Reporting › Products — verified against the live reference (URL `/reporting/product`, empty on
 * their demo account too — 0 Total). Columns: SKU (expandable by Partner) | Total CV | CV | VT CV |
 * Throttle | Event | Gross Sales, same date-range/Add Filter/Run Report shell as every other report.
 *
 * This app has no product/SKU concept anywhere — no order-line-item tracking, and (per the
 * reference's own adjacent "Refunds" nav entry, "View refund data from WooCommerce, ClickFunnels,
 * Stripe, and/or Shopify integrations") this data is native to Everflow's real e-commerce platform
 * integrations, which this app doesn't have (confirmed: no Shopify/WooCommerce/SKU concept anywhere
 * in the schema). Rather than fabricate SKU rows, this follows the same honest-shell pattern already
 * established for Partner Referrals (PartnerReferralsReport.tsx) and elsewhere in the app
 * (components/EmptyShellTable.tsx) — the real column structure, genuinely empty, with inert
 * "Not available yet" controls instead of live filtering that doesn't exist.
 */
import { MoreVertical } from 'lucide-react';
import { PageHeader } from '../../shared-components/primitives/ui';
import { EmptyShellTable } from '../../shared-components/primitives/EmptyShellTable';
import { daysAgo, todayStr } from '../../shared-components/primitives/ReportPageKit';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';

const COLUMNS = ['SKU / Partner', 'Total CV', 'CV', 'VT CV', 'Throttle', 'Event', 'Gross Sales'];

export default function ProductsReport() {
  // Nothing to fetch, but the range behaves like every other report's (applies on its own, no Run Report).
  const range = useAutoDateRange(daysAgo(7), todayStr());

  return (
    <>
      <PageHeader title="Products Report" subtitle="Reporting › Products" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          {/* Inert, like the rest of this shell — filtering isn't available yet. */}
          <FiltersButton disabled title="Not available yet" />
          <button title="Not available yet" className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="products-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" />

        <ReportBody>
          <p className="mb-4 text-small text-fg-muted">
            Product/SKU-level tracking isn't available yet — this data comes from a WooCommerce, ClickFunnels, Stripe, or Shopify integration, none of which this network has connected. See Connect › Integrations.
          </p>
          <EmptyShellTable columns={COLUMNS} search={false} />
        </ReportBody>
      </ReportCard>
    </>
  );
}
